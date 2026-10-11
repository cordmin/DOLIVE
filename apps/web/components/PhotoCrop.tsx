"use client";

import { useEffect, useRef, useState } from "react";

// 결과 사진 크기 = 화면에 보이는 틀 크기 (기본 사진과 같은 240x300)
const W = 240;
const H = 300;

// 올릴 사진 자리 맞추기: 한 손가락(마우스)으로 끌어서 옮기고, 두 손가락으로 벌리거나 오므려서(PC는 마우스 휠) 크기를 맞춘다.
// 동그라미 안 = 작은 프로필 사진에 나오는 부분, 틀 전체(4:5) = 채팅방 사진 카드에 나오는 부분.
export function PhotoCrop({
  file,
  onDone,
  onCancel,
}: {
  file: File;
  onDone: (jpeg: Blob) => void;
  onCancel: () => void;
}) {
  const [url, setUrl] = useState<string>();
  const img = useRef<HTMLImageElement>(null);
  const fingers = useRef(new Map<number, { x: number; y: number }>()); // 틀 안에 닿아 있는 손가락 위치
  // 지금 동작이 시작될 때의 상태 (손가락 수가 바뀌면 새로 잡는다)
  const gesture = useRef<{ pos: { x: number; y: number }; zoom: number; mid: { x: number; y: number }; dist: number }>(
    undefined,
  );
  const [size, setSize] = useState<{ w: number; h: number }>();
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 }); // 사진 왼쪽 위 위치

  // 고른 파일을 화면에 띄울 임시 주소. 창이 닫히면 치운다
  useEffect(() => {
    const u = URL.createObjectURL(file);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const base = size ? Math.max(W / size.w, H / size.h) : 1; // 틀을 꽉 채우는 가장 작은 배율
  const k = base * zoom;
  // 틀 안에 빈 곳이 생기지 않게 위치를 묶어 둔다
  const clamp = (x: number, y: number, kk = k) =>
    size ? { x: Math.min(0, Math.max(W - size.w * kk, x)), y: Math.min(0, Math.max(H - size.h * kk, y)) } : { x, y };

  // 틀 가운데를 기준으로 확대
  function zoomTo(z: number) {
    const nz = Math.min(3, Math.max(1, z));
    const nk = base * nz;
    setPos(clamp(W / 2 - ((W / 2 - pos.x) * nk) / k, H / 2 - ((H / 2 - pos.y) * nk) / k, nk));
    setZoom(nz);
  }

  const spread = (p: { x: number; y: number }[]) =>
    p.length >= 2
      ? {
          mid: { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 },
          dist: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y),
        }
      : { mid: p[0], dist: 0 };

  function restart() {
    const p = [...fingers.current.values()];
    gesture.current = p.length ? { pos, zoom, ...spread(p) } : undefined;
  }

  function move(e: React.PointerEvent<HTMLDivElement>) {
    if (!fingers.current.has(e.pointerId)) return;
    const r = e.currentTarget.getBoundingClientRect();
    fingers.current.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top });
    const g = gesture.current;
    if (!g) return;
    const { mid, dist } = spread([...fingers.current.values()]);
    if (dist && g.dist) {
      // 두 손가락: 처음 두 손가락 사이에 있던 곳이 계속 두 손가락 사이에 오도록 확대/축소
      const nz = Math.min(3, Math.max(1, (g.zoom * dist) / g.dist));
      const k0 = base * g.zoom;
      const nk = base * nz;
      setZoom(nz);
      setPos(clamp(mid.x - ((g.mid.x - g.pos.x) / k0) * nk, mid.y - ((g.mid.y - g.pos.y) / k0) * nk, nk));
    } else {
      setPos(clamp(g.pos.x + mid.x - g.mid.x, g.pos.y + mid.y - g.mid.y));
    }
  }

  function done() {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    canvas.getContext("2d")!.drawImage(img.current!, -pos.x / k, -pos.y / k, W / k, H / k, 0, 0, W, H);
    canvas.toBlob((b) => b && onDone(b), "image/jpeg", 0.9);
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-black/85 p-4">
      <p className="text-center text-sm text-zinc-300">
        끌어서 옮기고, 두 손가락으로 벌려 크기를 맞춰 주세요
        <br />
        <span className="text-zinc-500">(PC는 마우스 휠로 크기 조절)</span>
      </p>
      <div
        className="relative cursor-grab touch-none overflow-hidden rounded-lg bg-zinc-800 active:cursor-grabbing"
        style={{ width: W, height: H }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          const r = e.currentTarget.getBoundingClientRect();
          fingers.current.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top });
          restart();
        }}
        onPointerMove={move}
        onPointerUp={(e) => {
          fingers.current.delete(e.pointerId);
          restart();
        }}
        onPointerCancel={(e) => {
          fingers.current.delete(e.pointerId);
          restart();
        }}
        onWheel={(e) => zoomTo(zoom - e.deltaY / 500)}
      >
        {url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            ref={img}
            src={url}
            alt=""
            draggable={false}
            onLoad={(e) => {
              const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
              const b = Math.max(W / w, H / h);
              setSize({ w, h });
              setPos({ x: (W - w * b) / 2, y: (H - h * b) / 2 });
            }}
            className="absolute top-0 left-0 max-w-none origin-top-left select-none"
            style={{
              transform: `translate(${pos.x}px, ${pos.y}px) scale(${k})`,
              visibility: size ? "visible" : "hidden",
            }}
          />
        )}
        {/* 동그라미 밖은 어둡게 */}
        <div
          className="pointer-events-none absolute left-0 rounded-full shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] ring-2 ring-white/80"
          style={{ top: (H - W) / 2, width: W, height: W }}
        />
      </div>
      <div className="flex w-60 gap-2">
        <button onClick={onCancel} className="dolive-button dolive-danger flex-1 rounded-lg bg-zinc-800 py-3 hover:bg-zinc-700"><span className="dolive-button-cap">
          취소
        </span></button>
        <button
          onClick={done}
          disabled={!size}
          className="dolive-button dolive-primary flex-1 rounded-lg bg-indigo-600 py-3 font-semibold hover:bg-indigo-500 disabled:opacity-40"
        ><span className="dolive-button-cap">
          완료
        </span></button>
      </div>
    </div>
  );
}
