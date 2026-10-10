import { useLocalParticipant, useLocalParticipantPermissions } from "@livekit/components-react";
import { Room, Track, VideoPresets, createLocalVideoTrack, type LocalVideoTrack, type VideoCaptureOptions } from "livekit-client";
import { useEffect, useRef, useState } from "react";
import { Knob } from "@/components/Knob";
import { isPhone, saveCam, savedCam, type CamSettings } from "@/lib/dolive";
import { useHoldMenu } from "./menu";
import { SCREEN_SHARE_SOURCE } from "./share";

// 카메라(얼굴). 버튼을 누르면 바로 켜지 않고 카메라 설정 창부터 띄운다 (내 모습이 준비 없이 나가지 않게).
// 창 안에서 미리 보며 캠·화면공유 시 얼굴 위치·모양·좌우 반전을 고르고 [카메라 켜기]를 눌러야 모두에게 보인다.
// 켜져 있을 때 버튼을 누르면 바로 끈다. 오른쪽 클릭(휴대폰은 꾹 누르기)하면 켜져 있어도 설정 창. 얼굴은 작게 보낸다 (page.tsx ROOM_OPTIONS)

// 휴대폰·태블릿처럼 캠 이름이 "camera2 1, facing front" 같은 것은 목록 대신 전면·후면 두 개로만 보여 준다
const FACING = /front|back|rear|facing/i;
// PC 캠 이름 뒤에 붙는 장치 번호 "(046d:0825)" 는 뺀다
const camName = (d: MediaDeviceInfo, i: number) => d.label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, "") || `카메라 ${i + 1}`;
const capture = (c: CamSettings, facing: boolean): VideoCaptureOptions => ({
  resolution: VideoPresets.h360.resolution,
  ...(facing ? { facingMode: c.facing } : c.device ? { deviceId: c.device } : {}),
});

export function CameraKnob({ token }: { token: string }) {
  const { localParticipant: me, isCameraEnabled } = useLocalParticipant();
  const [open, setOpen] = useState(false);
  const hold = useHoldMenu();
  function off() {
    const t = me.getTrackPublication(Track.Source.Camera)?.track;
    if (t) me.unpublishTrack(t); // 캠 불도 같이 꺼진다
  }
  return (
    <>
      <Knob
        {...hold(() => setOpen(true))}
        compactMobile
        role="switch"
        aria-checked={isCameraEnabled}
        label="카메라"
        led={isCameraEnabled ? "green" : undefined}
        onClick={() => (isCameraEnabled ? off() : setOpen(true))}
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="size-[17px]">
            <path d="m16 10 5-3v10l-5-3z" />
            <rect x="3" y="6" width="13" height="12" rx="2" />
          </svg>
        }
      />
      {open && <CameraDialog token={token} close={() => setOpen(false)} />}
    </>
  );
}

// 미리 보기 (다른 사람에게 보이는 모습 그대로, 좌우 반전 포함)
function Preview({ track, mirror }: { track?: LocalVideoTrack; mirror: boolean }) {
  const v = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = v.current;
    if (!track || !el) return;
    track.attach(el);
    return () => void track.detach(el);
  }, [track]);
  // disablePictureInPicture: 엣지·크롬이 영상 위에 저절로 붙이는 "화면 속 화면" 버튼을 안 띄운다
  return <video ref={v} muted playsInline disablePictureInPicture className={`size-full object-cover ${mirror ? "-scale-x-100" : ""}`} />;
}

// 꾸밈은 TTS 설정 창과 같은 결 (tts.tsx): 어두운 판, 안으로 파인 선택판, 고른 것은 금색
const INSET = "rounded-[13px] bg-[#19191b] shadow-[inset_0_2px_5px_#0006]";
const TILE = "flex min-h-[34px] items-center justify-center rounded-[10px] border border-transparent px-3 text-[#99969a] transition hover:text-[#e4e0da]";
const PICKED = "border-[#75664b]! bg-[#393631] text-[#d1b77f]!";
const GOLD = "#d1b77f";
// 그림 속 공유 화면의 네 구석
const SPOTS = [
  ["tl", "왼쪽 위", "left-[4%] top-[7%]"],
  ["tr", "오른쪽 위", "right-[4%] top-[7%]"],
  ["bl", "왼쪽 아래", "left-[4%] bottom-[7%]"],
  ["br", "오른쪽 아래", "right-[4%] bottom-[7%]"],
];
const ICON = "size-[17px] fill-none stroke-current stroke-[1.8] [stroke-linecap:round] [stroke-linejoin:round]";
// DOCAM 의 좌우 반전 그림 (가운데 점선 + 마주 보는 삼각형)
const MirrorIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden className={ICON}>
    <path d="M12 3v1.8M12 7.6v1.8M12 12.2v1.8M12 16.8v1.8M12 21.4v.01M9 6.5 3.5 17.5H9ZM15 6.5l5.5 11H15Z" />
  </svg>
);

function CameraDialog({ token, close }: { token: string; close: () => void }) {
  const { localParticipant: me, isCameraEnabled } = useLocalParticipant();
  const box = useRef<HTMLDialogElement>(null);
  const [cam, setCam] = useState<CamSettings>(savedCam);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [preview, setPreview] = useState<LocalVideoTrack>(); // 꺼져 있을 때 미리 보려고 연 캠 (아직 아무에게도 안 보냄)
  const keep = useRef<LocalVideoTrack | undefined>(undefined); // 창을 닫을 때 끌 미리 보기 (켜기를 누르면 비운다)
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const live = isCameraEnabled ? (me.getTrackPublication(Track.Source.Camera)?.track as LocalVideoTrack | undefined) : undefined;
  const track = live ?? preview;
  const facing = (typeof window !== "undefined" && isPhone()) || devices.some((d) => FACING.test(d.label));
  // 화면공유를 할 수 있는 사람(방장·공유를 허락받은 사람)만 얼굴 위치·모양을 고른다. 빈 목록 = 다 보낼 수 있음(방장)
  const sources = useLocalParticipantPermissions()?.canPublishSources ?? [];
  const canShare = sources.length === 0 || sources.includes(SCREEN_SHARE_SOURCE);

  // 서버가 모두에게 내 얼굴 자리·모양·좌우 반전을 적어 준다 (api/cam)
  const tell = (c: CamSettings) =>
    fetch("/api/cam", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ pos: c.pos, shape: c.shape, mirror: c.mirror }) });

  useEffect(() => {
    box.current?.showModal();
    const first = savedCam();
    const phone = isPhone();
    if (!isCameraEnabled)
      createLocalVideoTrack(capture(first, phone)).then(
        (t) => {
          keep.current = t;
          setPreview(t);
        },
        () => setError("카메라를 열 수 없어요. 다른 프로그램이 캠을 쓰고 있거나 권한이 막혀 있어요."),
      );
    // 캠 이름은 카메라를 한 번 허락한 뒤에 보여서, 미리 보기를 연 다음에 읽는다
    const t = setTimeout(() => Room.getLocalDevices("videoinput", false).then(setDevices, () => {}), 800);
    return () => {
      clearTimeout(t);
      keep.current?.stop();
    };
    // 창이 열릴 때 한 번만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 위치·모양·좌우 반전: 저장하고, 켜져 있으면 바로 모두에게
  function set(c: CamSettings) {
    setCam(c);
    saveCam(c);
    if (isCameraEnabled) tell(c);
  }
  // 캠 바꾸기: 미리 보기든 보내는 중이든 그 캠으로 다시 연다. 휴대폰 후면은 거울이 어색해서 좌우 반전을 끄고, 전면은 켠다
  async function pickCam(c: CamSettings) {
    set(c);
    await track?.restartTrack(capture(c, facing)).catch(() => setError("그 카메라를 열 수 없어요."));
  }
  async function start() {
    const t = keep.current;
    if (!t) return;
    setBusy(true);
    try {
      await tell(cam);
      const old = me.getTrackPublication(Track.Source.Camera)?.track; // 방장이 꺼 둔(멈춘) 예전 카메라
      if (old) await me.unpublishTrack(old);
      await me.publishTrack(t, { source: Track.Source.Camera });
      keep.current = undefined;
      close();
    } catch {
      setBusy(false);
      setError("카메라를 켜지 못했어요. 다시 해 주세요.");
    }
  }
  function stop() {
    if (live) me.unpublishTrack(live);
    close();
  }

  const row = cam.pos === "row";
  const circle = !row && cam.shape === "circle";
  const face = circle ? "aspect-square w-[19%] rounded-full" : "aspect-video w-[28%] rounded-md";
  // 고른 자리에 들어가는 내 얼굴 (다른 사람에게 보이는 모습 그대로, 좌우 반전 포함)
  const myFace = track ? <Preview track={track} mirror={cam.mirror} /> : null;
  return (
    <dialog
      ref={box}
      onClose={close}
      onPointerDown={(e) => e.target === e.currentTarget && e.currentTarget.close()} // 바깥(어두운 곳)을 누르면 닫기
      // 위쪽 버튼 줄(줄 안 바꿈) 안에 있어서, 글이 길면 줄이 바뀌게 되돌린다 (whitespace-normal)
      className="m-auto max-h-[92dvh] w-[390px] max-w-[calc(100%-1.5rem)] overflow-y-auto rounded-[18px] border border-[#3d3b3a] bg-[#252526] p-[22px] text-[13px] whitespace-normal text-[#d6d3cd] backdrop:bg-black/60"
    >
      <p className="mb-[18px] text-center text-base font-semibold">카메라 설정</p>

      {/* 캠 고르기는 맨 위 (아래 버튼들과 떨어뜨려서 잘못 누르지 않게). 휴대폰은 전면·후면 */}
      {facing ? (
        <div className={`grid grid-cols-2 gap-1 p-1 ${INSET}`}>
          <button type="button" onClick={() => pickCam({ ...cam, facing: "user", mirror: true })} className={`${TILE} ${cam.facing === "user" ? PICKED : ""}`}>
            전면
          </button>
          <button type="button" onClick={() => pickCam({ ...cam, facing: "environment", mirror: false })} className={`${TILE} ${cam.facing === "environment" ? PICKED : ""}`}>
            후면
          </button>
        </div>
      ) : (
        <label className="relative block">
          <span className="sr-only">카메라</span>
          <svg viewBox="0 0 24 24" aria-hidden className={`pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 ${ICON} size-4`}>
            <path d="m16 10 5-3v10l-5-3z" />
            <rect x="3" y="6" width="13" height="12" rx="2" />
          </svg>
          <select
            value={cam.device ?? devices[0]?.deviceId ?? ""}
            onChange={(e) => pickCam({ ...cam, device: e.target.value })}
            className="h-[38px] w-full cursor-pointer appearance-none truncate rounded-[10px] bg-[#2e2e30] pr-9 pl-9 text-[13px] text-[#d6d3cd] outline-none focus-visible:ring-1 focus-visible:ring-[#d1b77f]"
          >
            {devices.length ? devices.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{camName(d, i)}</option>) : <option value="">기본 카메라</option>}
          </select>
          <svg viewBox="0 0 24 24" aria-hidden className={`pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 ${ICON} size-4`}>
            <path d="m7 10 5 5 5-5" />
          </svg>
        </label>
      )}

      {canShare ? (
        <>
        {/* 공유 화면 그림: 네 구석 점선을 누르면 내 얼굴이 그리로, 그림 아래 칸을 누르면 얼굴 줄 */}
        <div className={`mt-3.5 p-2 ${INSET}`}>
          <div className="relative aspect-video overflow-hidden rounded-[10px] bg-linear-135 from-[#2c3a52] to-[#2a2436]">
            {SPOTS.map(([id, name, at]) =>
              !row && cam.pos === id ? (
                <div key={id} className={`absolute ${at} ${face} overflow-hidden border-2 border-[#d1b77f] bg-black shadow-[0_0_0_3px_#d1b77f33,0_6px_14px_#0008]`}>{myFace}</div>
              ) : (
                <button
                  key={id}
                  type="button"
                  aria-label={`화면공유 시 얼굴 위치: ${name}`}
                  onClick={() => set({ ...cam, pos: id })}
                  className={`absolute ${at} ${row ? "aspect-video w-[28%] rounded-md" : face} border-[1.5px] border-dashed border-white/25 transition hover:border-white/60 hover:bg-white/10`}
                />
              ),
            )}
            {error && <p className="absolute inset-x-0 top-1/2 mx-auto w-[60%] -translate-y-1/2 text-center text-xs text-amber-300">{error}</p>}
          </div>
          <button
            type="button"
            aria-label="화면공유 시 얼굴 위치: 공유 화면 아래 얼굴 줄"
            aria-pressed={row}
            onClick={() => set({ ...cam, pos: "row", shape: "rect" })}
            className={`mt-1.5 flex w-full justify-center gap-1 rounded-[9px] border-[1.5px] p-[5px] transition ${row ? "border-[#75664b] bg-[#393631]" : "border-dashed border-white/15 hover:border-white/40"}`}
          >
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={`aspect-video w-[18%] overflow-hidden rounded ${row && i === 0 ? "outline-2 outline-[#d1b77f]" : "bg-white/[0.06]"}`}>
                {row && i === 0 && myFace}
              </span>
            ))}
          </button>
        </div>

        {/* 기계판 버튼 (방 오른쪽 위 버튼과 같은 모양): 좌우 반전, 모양 밀기 스위치 (얼굴 줄은 네모만이라 흐려짐) */}
        <div className="mt-[18px] flex items-start justify-center gap-[30px]">
          <button type="button" role="switch" aria-label="좌우 반전" aria-checked={cam.mirror} onClick={() => set({ ...cam, mirror: !cam.mirror })} className="group flex flex-col items-center gap-1.5">
            {/* 켜짐은 금색, 꺼짐은 어두운 회색 (모양 스위치의 안 고른 쪽과 같은 색) */}
            <span className="hw-cap transition group-hover:brightness-125 group-active:translate-y-px" style={{ color: cam.mirror ? GOLD : "#77736e" }}>
              <MirrorIcon />
            </span>
            <span className="text-[11px] text-[#a39f98]">좌우 반전</span>
          </button>
          <div role="radiogroup" aria-label="모양" className={`flex flex-col items-center gap-1.5 ${row ? "opacity-35" : ""}`}>
            <div className="relative flex h-[38px] w-[84px] rounded-full bg-[#141415] shadow-[inset_0_2px_5px_#000a,0_0_0_1px_#000,0_0_0_3px_#1b1b1c,0_0_0_4px_#ffffff0f]">
              <span className={`absolute top-[3px] h-8 w-[39px] rounded-full bg-[radial-gradient(circle_at_50%_30%,#3a3a3c,#1d1d1e)] shadow-[inset_0_1px_0_#ffffff30,0_1px_3px_#000] transition-[left] duration-200 ${circle ? "left-[42px]" : "left-[3px]"}`} />
              {(["rect", "circle"] as const).map((sh) => (
                <button
                  key={sh}
                  type="button"
                  role="radio"
                  aria-checked={(sh === "circle") === circle}
                  aria-label={sh === "rect" ? "네모" : "동그라미"}
                  disabled={row}
                  onClick={() => set({ ...cam, shape: sh })}
                  className={`relative z-[1] grid flex-1 place-items-center rounded-full disabled:cursor-not-allowed ${(sh === "circle") === circle ? "text-[#d1b77f]" : "text-[#77736e] enabled:hover:text-[#d6d3cd]"}`}
                >
                  <svg viewBox="0 0 24 24" aria-hidden className={ICON}>
                    {sh === "rect" ? <rect x="4" y="7" width="16" height="10" rx="2" /> : <circle cx="12" cy="12" r="7" />}
                  </svg>
                </button>
              ))}
            </div>
            <span className="text-[11px] text-[#a39f98]">모양</span>
          </div>
        </div>
        </>
      ) : (
        // 일반 참여자: 화면공유를 못 하니 위치·모양은 빼고, 켜기 전에 내 모습을 크게 본다. 좌우 반전은 미리 보기 안 오른쪽 아래 버튼
        <div className={`mt-3.5 p-2 ${INSET}`}>
          <div className="relative aspect-[4/3] overflow-hidden rounded-[10px] border-2 border-[#d1b77f] bg-black">
            {myFace}
            {error && <p className="absolute inset-x-0 top-1/2 mx-auto w-[70%] -translate-y-1/2 text-center text-xs text-amber-300">{error}</p>}
            <button
              type="button"
              role="switch"
              aria-checked={cam.mirror}
              onClick={() => set({ ...cam, mirror: !cam.mirror })}
              className={`absolute right-2.5 bottom-2.5 flex h-[34px] items-center gap-1.5 rounded-full bg-black/65 pr-3 pl-2.5 text-xs backdrop-blur-md transition hover:bg-black/80 ${
                cam.mirror ? "text-[#d1b77f] ring-1 ring-[#75664b]" : "text-[#b5b0aa] ring-1 ring-white/15"
              }`}
            >
              <MirrorIcon />
              좌우 반전
            </button>
          </div>
        </div>
      )}

      <div className="mt-[22px] flex gap-2.5">
        <button type="button" onClick={() => box.current?.close()} className="h-[38px] flex-1 rounded-full border border-[#535154] text-[#b5b0aa] transition hover:bg-white/5 hover:text-zinc-100 active:bg-white/10">
          {isCameraEnabled ? "닫기" : "취소"}
        </button>
        {isCameraEnabled ? (
          <button type="button" onClick={stop} className="h-[38px] flex-1 rounded-full border border-[#6b3a37] bg-[#3a2523] font-semibold text-[#e7a29b] transition hover:brightness-125">
            카메라 끄기
          </button>
        ) : (
          <button
            type="button"
            disabled={!preview || busy}
            onClick={start}
            className="h-[38px] flex-1 rounded-full bg-linear-to-b from-[#d6bd8d] to-[#b79b68] font-semibold text-[#29231c] shadow-[inset_0_1px_0_#fff5] transition hover:brightness-110 active:brightness-95 disabled:opacity-50"
          >
            카메라 켜기
          </button>
        )}
      </div>
    </dialog>
  );
}
