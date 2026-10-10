import { useLocalParticipant } from "@livekit/components-react";
import { Room, Track, VideoPresets, createLocalVideoTrack, type LocalVideoTrack, type VideoCaptureOptions } from "livekit-client";
import { useEffect, useRef, useState } from "react";
import { Knob } from "@/components/Knob";
import { Switch } from "@/components/Switch";
import { isPhone, saveCam, savedCam, type CamSettings } from "@/lib/dolive";
import { useHoldMenu } from "./menu";

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
        data-tip={isCameraEnabled ? "누르면 끄기, 오른쪽 클릭: 카메라 설정" : "카메라 설정"}
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
  return <video ref={v} muted playsInline className={`size-full object-cover ${mirror ? "-scale-x-100" : ""}`} />;
}

const HEAD = "mb-1.5 text-xs font-semibold text-zinc-400";
const CHOICE = "rounded-lg px-3 py-2 text-sm ring-1 disabled:cursor-not-allowed disabled:opacity-35";
const choice = (on: boolean) => `${CHOICE} ${on ? "bg-indigo-600/25 text-white ring-indigo-400" : "bg-zinc-900 text-zinc-300 ring-zinc-700 enabled:hover:bg-zinc-700"}`;
// 그림 속 공유 화면의 네 구석
const SPOTS = [
  ["tl", "왼쪽 위", "left-[4%] top-[7%]"],
  ["tr", "오른쪽 위", "right-[4%] top-[7%]"],
  ["bl", "왼쪽 아래", "left-[4%] bottom-[7%]"],
  ["br", "오른쪽 아래", "right-[4%] bottom-[7%]"],
];
const POS_NAME: Record<string, string> = { ...Object.fromEntries(SPOTS.map(([id, name]) => [id, name])), row: "공유 화면 아래 얼굴 줄" };

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
        () => setError("카메라를 열 수 없어요. 다른 프로그램(DOCAM, 줌 등)이 캠을 쓰고 있지 않은지, 주소창 왼쪽에서 카메라 권한이 '허용'인지 봐 주세요."),
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
  return (
    <dialog
      ref={box}
      onClose={close}
      onPointerDown={(e) => e.target === e.currentTarget && e.currentTarget.close()} // 바깥(어두운 곳)을 누르면 닫기
      // 위쪽 버튼 줄(줄 안 바꿈) 안에 있어서, 글이 길면 줄이 바뀌게 되돌린다 (whitespace-normal)
      className="m-auto max-h-[92dvh] w-[min(92vw,400px)] overflow-y-auto whitespace-normal md:w-[min(92vw,760px)] rounded-2xl bg-zinc-800 p-5 text-zinc-100 ring-1 ring-zinc-700 backdrop:bg-black/60"
    >
      <h2 className="text-center text-base font-semibold">카메라 설정</h2>
      <p className="mt-1 mb-4 text-center text-xs text-zinc-400">
        {isCameraEnabled ? "지금 모두에게 내 얼굴이 보이고 있어요." : "[카메라 켜기]를 누르기 전에는 아무에게도 보이지 않아요."}
      </p>

      {/* PC 는 두 칸: 왼쪽 미리 보기·카메라·좌우 반전, 오른쪽 화면공유 시 얼굴 위치·모양. 휴대폰은 한 줄로 쌓는다 */}
      <div className="md:grid md:grid-cols-2 md:gap-6">
        <div>
          <div className="relative aspect-video overflow-hidden rounded-xl bg-black">
            <Preview track={track} mirror={cam.mirror} />
            {!track && <p className="absolute inset-0 grid place-items-center p-4 text-center text-xs text-zinc-400">{error || "카메라를 여는 중..."}</p>}
          </div>
          {track && error && <p className="mt-2 text-xs text-amber-300">{error}</p>}

          <p className={`${HEAD} mt-4`}>카메라</p>
          {facing ? (
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => pickCam({ ...cam, facing: "user", mirror: true })} className={choice(cam.facing === "user")}>
                전면
              </button>
              <button type="button" onClick={() => pickCam({ ...cam, facing: "environment", mirror: false })} className={choice(cam.facing === "environment")}>
                후면
              </button>
            </div>
          ) : devices.length > 1 ? (
            <div className="flex flex-col gap-1.5">
              {devices.map((d, i) => (
                <button key={d.deviceId} type="button" onClick={() => pickCam({ ...cam, device: d.deviceId })} className={`${choice(d.deviceId === (cam.device ?? devices[0].deviceId))} truncate text-left`}>
                  {camName(d, i)}
                </button>
              ))}
            </div>
          ) : (
            <p className="rounded-lg bg-zinc-900 px-3 py-2 text-sm text-zinc-300 ring-1 ring-zinc-700">{devices[0] ? camName(devices[0], 0) : "기본 카메라"}</p>
          )}

          <div className="mt-4">
            <Switch label="좌우 반전" on={cam.mirror} onChange={(mirror) => set({ ...cam, mirror })} />
          </div>
        </div>

        <div>
          <p className={`${HEAD} mt-4 md:mt-0`}>화면공유 시 얼굴 위치</p>
          {/* 공유 화면 그림: 네 구석의 얼굴 자리를 누르거나, 아래 얼굴 줄을 누른다 */}
          <div className="rounded-xl bg-zinc-900 p-2 ring-1 ring-zinc-700">
            <div className="relative aspect-video rounded-lg bg-linear-to-br from-[#2b3a55] to-[#30263a]">
              <span className="absolute inset-0 grid place-items-center text-xs text-white/40">공유 화면</span>
              {SPOTS.map(([id, name, at]) => (
                <button
                  key={id}
                  type="button"
                  aria-label={name}
                  aria-pressed={cam.pos === id}
                  onClick={() => set({ ...cam, pos: id })}
                  className={`absolute ${at} ${circle ? "aspect-square w-[16%] rounded-full" : "aspect-video w-[24%] rounded-md"} transition ${
                    cam.pos === id ? "bg-[#7ed957] ring-2 ring-white/80" : "bg-white/15 ring-1 ring-white/30 hover:bg-white/35"
                  }`}
                />
              ))}
            </div>
            <button
              type="button"
              aria-label="공유 화면 아래 얼굴 줄"
              aria-pressed={row}
              onClick={() => set({ ...cam, pos: "row", shape: "rect" })}
              className="group mt-1.5 flex w-full justify-center gap-1 rounded-lg p-1 hover:bg-white/5"
            >
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className={`aspect-video w-[18%] rounded ${row ? "bg-[#7ed957]" : "bg-white/15 ring-1 ring-white/30 group-hover:bg-white/35"}`} />
              ))}
            </button>
            <p className="mt-1 text-center text-sm text-zinc-200">{POS_NAME[cam.pos]}</p>
          </div>
          <p className="mt-1.5 text-xs text-zinc-500">화면공유를 시작하면 다른 사람 화면에서 이 자리에 내 얼굴이 보여요.</p>

          <p className={`${HEAD} mt-4`}>모양{row && <span className="font-normal text-zinc-500"> (얼굴 줄은 네모만)</span>}</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => set({ ...cam, shape: "rect" })} className={choice(!circle)}>
              네모
            </button>
            <button type="button" disabled={row} onClick={() => set({ ...cam, shape: "circle" })} className={choice(circle)}>
              동그라미
            </button>
          </div>
        </div>
      </div>

      <div className="mt-5 flex gap-2">
        {isCameraEnabled ? (
          <button type="button" onClick={stop} className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-semibold hover:bg-red-500">
            카메라 끄기
          </button>
        ) : (
          <button type="button" disabled={!preview || busy} onClick={start} className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-50">
            카메라 켜기
          </button>
        )}
        <button type="button" onClick={() => box.current?.close()} className="flex-1 rounded-lg bg-zinc-700 py-2 text-sm hover:bg-zinc-600">
          {isCameraEnabled ? "닫기" : "취소"}
        </button>
      </div>
    </dialog>
  );
}
