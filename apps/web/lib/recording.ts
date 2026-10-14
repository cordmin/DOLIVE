import { RoomEvent, Track, type Participant, type Room } from "livekit-client";
import { camWidth, VOICE_BOT, VOICE_ON } from "./dolive";

type Processor = { readable: ReadableStream<VideoFrame> };
type Generator = MediaStreamTrack & { writable: WritableStream<VideoFrame> };
type RecordWindow = Window & {
  MediaStreamTrackProcessor?: new (options: { track: MediaStreamTrack }) => Processor;
  MediaStreamTrackGenerator?: new (options: { kind: "video" }) => Generator;
  showDirectoryPicker?: (options: { mode: "readwrite" }) => Promise<FileSystemDirectoryHandle>;
};
export const recordWindow = () => window as RecordWindow;
export const canRecord = () => !!(recordWindow().MediaStreamTrackProcessor && recordWindow().MediaStreamTrackGenerator && recordWindow().showDirectoryPicker && window.MediaRecorder);

export function recordFormat(supported: (type: string) => boolean) {
  for (const type of ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4", "video/webm;codecs=vp8,opus", "video/webm"]) {
    if (supported(type)) return { type, extension: type.startsWith("video/mp4") ? "mp4" : "webm" };
  }
  throw new Error("이 브라우저에서는 녹화할 수 없어요. 최신 크롬이나 엣지로 열어 주세요.");
}

export function recordSize(width: number, height: number, quality: "basic" | "clear") {
  const h = Math.max(2, Math.floor(Math.min(height || 720, quality === "clear" ? 1080 : 720) / 2) * 2);
  return { width: Math.max(2, Math.round(h * (width || 1280) / (height || 720) / 2) * 2), height: h };
}

export async function startRecording(room: Room, sharer: Participant, folder: FileSystemDirectoryHandle, quality: "basic" | "clear", sound: boolean, finished: (error?: string) => void) {
  if (room.localParticipant.attributes.roomAdmin !== "1") throw new Error("방장만 녹화할 수 있어요.");
  const source = sharer.getTrackPublication(Track.Source.ScreenShare)?.track?.mediaStreamTrack;
  if (!source || source.readyState !== "live") throw new Error("먼저 화면공유를 켜 주세요.");
  const format = recordFormat((type) => MediaRecorder.isTypeSupported(type));
  const api = recordWindow();
  if (!api.MediaStreamTrackGenerator || !api.MediaStreamTrackProcessor) throw new Error("최신 크롬이나 엣지로 열어 주세요.");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = await folder.getFileHandle(`DOLIVE-${stamp}-${crypto.randomUUID().slice(0, 6)}.${format.extension}`, { create: true });
  const disk = await file.createWritable();
  const worker = new Worker("/record-worker.js");
  const output = new api.MediaStreamTrackGenerator({ kind: "video" });
  const clones: MediaStreamTrack[] = [];
  const audio = sound ? new AudioContext() : null;
  const destination = audio?.createMediaStreamDestination();
  const mix = new Map<MediaStreamTrack, { node: MediaStreamAudioSourceNode; gain: GainNode; participant: Participant; source: Track.Source.Microphone | Track.Source.ScreenShareAudio }>();
  let face: MediaStreamTrack | undefined;
  let faceClone: MediaStreamTrack | undefined;
  let queue = Promise.resolve();
  let error = "";
  let ended: Promise<void> | undefined;
  const stream = new MediaStream([output, ...(destination?.stream.getAudioTracks() ?? [])]);
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType: format.type, videoBitsPerSecond: quality === "clear" ? 8_000_000 : 4_000_000, audioBitsPerSecond: 128_000 });
  } catch (e) {
    worker.terminate(); output.stop(); await audio?.close().catch(() => {}); await disk.abort();
    throw e;
  }
  let started = false;
  let resolveStopped: () => void;
  const stopped = new Promise<void>((resolve) => { resolveStopped = resolve; });
  recorder.onstop = () => resolveStopped();
  recorder.ondataavailable = (e) => {
    if (!e.data.size) return;
    queue = queue.then(() => error ? undefined : disk.write(e.data)).catch(() => {
      error = "녹화 파일을 저장하지 못했어요. 폴더 권한과 남은 공간을 확인해 주세요.";
      void stop();
    });
  };
  const events = [RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed, RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted, RoomEvent.ParticipantAttributesChanged, RoomEvent.ParticipantDisconnected] as const;
  async function stop() {
    if (ended) return ended;
    ended = (async () => {
      events.forEach((event) => room.off(event, sync));
      room.off(RoomEvent.Disconnected, onDisconnect);
      clearInterval(volume);
      if (started) { if (recorder.state !== "inactive") recorder.stop(); await stopped; }
      worker.terminate();
      output.stop();
      clones.forEach((track) => track.stop());
      mix.forEach(({ node, gain }) => { node.disconnect(); gain.disconnect(); });
      await audio?.close().catch(() => {});
      await queue;
      try { await disk.close(); } catch { error ||= "녹화 파일을 저장하지 못했어요. 폴더 권한과 남은 공간을 확인해 주세요."; }
      finished(error || undefined);
    })();
    return ended;
  }
  const onDisconnect = () => { void stop(); };
  function frames(track: MediaStreamTrack) {
    const clone = track.clone();
    clones.push(clone);
    return new api.MediaStreamTrackProcessor!({ track: clone }).readable;
  }
  function sync() {
    if (ended) return;
    const pub = sharer.getTrackPublication(Track.Source.ScreenShare);
    if (pub?.isMuted || pub?.track?.mediaStreamTrack !== source || room.localParticipant.attributes.roomAdmin !== "1") { void stop(); return; }
    const cam = sharer.getTrackPublication(Track.Source.Camera);
    const a = sharer.attributes;
    const next = !cam?.isMuted && a.camPos !== "row" ? cam?.track?.mediaStreamTrack : undefined;
    if (face !== next) {
      faceClone?.stop();
      face = next;
      const readable = face ? frames(face) : undefined;
      faceClone = face ? clones.at(-1) : undefined;
      worker.postMessage({ type: "face", readable }, readable ? [readable] : []);
    }
    worker.postMessage({ type: "position", pos: a.camPos, circle: a.camShape === "circle", mirror: a.camMirror === "1", width: camWidth(Number(a.camSize), a.camShape === "circle") / 100 });
    if (!audio || !destination) return;
    const current = new Set<MediaStreamTrack>();
    for (const participant of [room.localParticipant, ...room.remoteParticipants.values()]) {
      for (const source of [Track.Source.Microphone, Track.Source.ScreenShareAudio] as const) {
        const publication = participant.getTrackPublication(source);
        const track = publication?.track?.mediaStreamTrack;
        if (!track || publication?.isMuted || track.readyState !== "live") continue;
        current.add(track);
        if (mix.has(track)) continue;
        const node = audio.createMediaStreamSource(new MediaStream([track]));
        const gain = audio.createGain();
        node.connect(gain).connect(destination);
        mix.set(track, { node, gain, participant, source });
      }
    }
    mix.forEach(({ node, gain }, track) => {
      if (current.has(track)) return;
      node.disconnect(); gain.disconnect(); mix.delete(track);
    });
  }
  const volume = setInterval(() => {
    // 캠 다시 연결·블러 변경은 같은 참여자 안에서 영상 장치만 바뀔 수도 있다.
    const cam = sharer.getTrackPublication(Track.Source.Camera);
    const currentFace = !cam?.isMuted && sharer.attributes.camPos !== "row" ? cam?.track?.mediaStreamTrack : undefined;
    if (currentFace !== face) sync();
    if (!audio) return;
    const tts = room.remoteParticipants.get(VOICE_BOT)?.attributes[VOICE_ON];
    mix.forEach(({ gain, participant, source }) => {
      const remote = room.remoteParticipants.get(participant.identity);
      const value = source === Track.Source.ScreenShareAudio ? (remote ? remote.getVolume(source) ?? 1 : tts ? 0.15 : room.activeSpeakers.length ? 0.3 : 1) : remote?.getVolume(source) ?? 1;
      gain.gain.setTargetAtTime(value, audio.currentTime, 0.1);
    });
  }, 100);
  worker.onerror = () => { error = "녹화 화면을 만들지 못했어요. 저장된 파일을 확인해 주세요."; void stop(); };
  recorder.onerror = () => { error = "녹화가 멈췄어요. 저장된 파일을 확인해 주세요."; void stop(); };
  try {
    await audio?.resume();
    const settings = source.getSettings();
    const readable = frames(source);
    worker.postMessage({ type: "start", readable, writable: output.writable, ...recordSize(settings.width ?? 1280, settings.height ?? 720, quality) }, [readable, output.writable]);
    recorder.start(1000); // 영상 전체를 메모리에 쌓지 않고, 1초씩 선택한 폴더에 쓴다.
    started = true;
    events.forEach((event) => room.on(event, sync));
    room.on(RoomEvent.Disconnected, onDisconnect);
    sync();
    return { stop, name: file.name };
  } catch (e) {
    error = e instanceof Error && /[가-힣]/.test(e.message) ? e.message : "녹화를 시작하지 못했어요. 폴더 권한을 확인하고 다시 시도해 주세요.";
    await stop();
    throw new Error(error);
  }
}
