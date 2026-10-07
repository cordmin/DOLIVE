import path from "node:path";
import { AudioFrame, AudioSource, LocalAudioTrack, Room, RoomEvent, TrackPublishOptions, TrackSource } from "@livekit/rtc-node";
import { AccessToken } from "livekit-server-sdk";
import { VOICE_BOT, VOICE_ON, VOICES, type VoiceDef } from "@/lib/dolive";
import { loadTextToSpeech, loadVoiceStyle } from "@/lib/supertonic";
import { chatOf, store } from "@/lib/chat";
import { rooms } from "@/lib/server";

// "/글" 음성: 서버가 Supertonic 3 으로 읽고, 방에 "음성"이라는 참여자로 들어가 마이크처럼 흘려보낸다.
// 소리는 만들자마자 보내고 어디에도 저장하지 않는다. 보낸 사람을 포함해 모두가 바로 듣는다.
// 다시 듣기(말풍선 스피커)는 누를 때 다시 읽어서 누른 사람에게만 WAV 로 준다 (replay, api/voice/[id]).
// 모델(400MB)은 깃에 없어서 models/supertonic 에 직접 받아 둔다:
//   https://huggingface.co/supertone-oss-archive/supertonic-3 의 onnx 폴더 파일 전부 + voice_styles 의 F1.json, F2.json, M1.json
const DIR = path.join(process.cwd(), "models", "supertonic");

type Tts = { sampleRate: number; call(text: string, lang: string, style: unknown, steps: number, speed: number): Promise<{ wav: number[] }> };
type Voice = {
  tts: Promise<{ tts: Tts }>;
  styles?: Map<string, unknown>; // 목소리 파일. 처음 쓸 때 읽어 둔다
  line: Promise<void>; // 방에 말하기 줄 (ponytail: 모든 방송이 한 줄. 두 방송에서 같이 말하면 차례를 기다린다. 막히면 방마다 줄을 따로)
  replays: Promise<unknown>; // 다시 듣기 줄
  rooms: Map<string, Promise<{ room: Room; source: AudioSource }>>; // 방 이름 → 그 방에 들어간 "음성" 참여자
};

// 개발 중 코드를 고쳐 다시 읽혀도 모델을 또 올리거나 방에 두 번 들어가지 않게 globalThis 에 둔다
const g = globalThis as unknown as { doliveVoice?: Voice };
const voice: Voice = (g.doliveVoice ??= {
  tts: (async () => ({ tts: (await loadTextToSpeech(DIR)) as Tts }))(),
  line: Promise.resolve(),
  replays: Promise.resolve(),
  rooms: new Map(),
});

// 목록에 없는 목소리(예전에 지운 목소리로 읽은 글 다시 듣기 등)는 첫 목소리로
const voiceOf = (id: string) => VOICES.find((v) => v.id === id) ?? VOICES[0];

// 목소리 파일. 처음 쓸 때 읽어 둔다
function styleOf(v: VoiceDef) {
  const styles = (voice.styles ??= new Map());
  if (!styles.has(v.base)) styles.set(v.base, loadVoiceStyle([path.join(DIR, `${v.base}.json`)]));
  return styles.get(v.base);
}

// 높낮이 바꾸기: 소리를 pitch 배 빠르기로 틀면 목소리가 그만큼 높아지거나(1보다 크면) 낮아진다(마왕). 대신 만들 때 그 반대로 읽혀서 말 빠르기는 그대로.
// ponytail: 그냥 사이를 이어 붙이는 방식이라 아주 높이면 살짝 지글거릴 수 있다. 거슬리면 제대로 된 리샘플러로
function repitch(wav: ArrayLike<number>, pitch: number) {
  const out = new Float32Array(Math.floor(wav.length / pitch));
  for (let i = 0; i < out.length; i++) {
    const x = i * pitch;
    const j = Math.floor(x);
    out[i] = wav[j] + ((wav[j + 1] ?? 0) - wav[j]) * (x - j);
  }
  return out;
}

// 소리를 다듬는 횟수. 원래 예시는 8번인데 5번으로 줄여도 목소리는 거의 같고, 짧은 채팅 한 줄 만드는 시간이 0.5초 → 0.35초쯤으로 준다.
// (그래픽카드로 돌려 봤지만 문장 길이가 바뀔 때마다 준비를 다시 해서 CPU보다 빠르지 않았다)
const STEPS = 5;

// 말 빠르기. 예시 기본값 1.05 에서 15% 느리게 (1.05 x 0.85). 클수록 빠르다
const SPEED = 0.89;

// 소리 크기: 문장마다 가장 큰 소리가 한계의 PEAK 에 닿게 키운다 (이 목소리는 원래 한계의 30%쯤이라 보통 3배쯤 커진다).
// 배경음악 위에서도 잘 들리게. 거의 무음인 문장을 너무 키우지 않게 MAX_GAIN 배까지만
// 전체 크기는 이 숫자로 조절한다 (크기가 이 숫자에 딱 비례). 예전 0.95 는 말만 할 때 너무 커서 그 75%인 0.71 로 낮췄다
const PEAK = 0.71;
const MAX_GAIN = 4;
// 그래도 작게 들려서 작은 소리를 끌어올려 전체를 꽉 차게 (라디오 방식, tanh 로 부드럽게 눌러서 한계는 안 넘음).
// 1.5 = 전체 크기 1.5배쯤, 2.5 = 2배쯤 (안 누를 때보다. 재 본 값 1.47배 / 1.95배). 0 이면 안 누름. 키울수록 크지만 소리가 거칠어진다
// 2026-10-06 2.5 는 화면공유 연수 때 선생님 목소리보다 커서 0 으로 (지금의 절반쯤). 작으면 1.5 (지금의 75%쯤)
const DRIVE = 0;

// 글을 읽어서 16비트 소리로. 앞뒤에 붙어 나오는 무음(앞 0.4초, 뒤 0.5초쯤)은 잘라서 바로 말이 시작되게 한다
async function synth(text: string, id: string) {
  const { tts } = await voice.tts;
  const v = voiceOf(id);
  const pitch = v.pitch ?? 1;
  const raw = (await tts.call(text, "ko", styleOf(v), STEPS, (SPEED * (v.speed ?? 1)) / pitch)).wav;
  const rate = tts.sampleRate;
  const wav = pitch === 1 ? raw : repitch(raw, pitch);
  const loud = (v: number) => Math.abs(v) > 0.03;
  const start = Math.max(0, wav.findIndex(loud) - rate * 0.05); // 말 시작 0.05초 전부터
  const end = Math.min(wav.length, wav.findLastIndex(loud) + rate * 0.15); // 말 끝 0.15초 뒤까지
  const part = wav.slice(start, end > start ? end : wav.length);
  let peak = 1e-6; // (Math.max(...part) 는 긴 문장에서 숫자가 너무 많아 터진다)
  for (const v of part) peak = Math.max(peak, Math.abs(v));
  const gain = Math.min(MAX_GAIN, PEAK / peak);
  const squash = (x: number) => (DRIVE ? (Math.tanh((DRIVE * x) / PEAK) / Math.tanh(DRIVE)) * PEAK : x);
  const pcm = Int16Array.from(part, (s) => Math.max(-1, Math.min(1, squash(s * gain))) * 32767);
  return { rate, pcm };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

// 방에 소리 흘려보내기. 실제 소리 길이만큼 시간이 걸린다 (소리 통로가 1초어치만 쌓아 두고 기다린다)
async function push(source: AudioSource, pcm: Int16Array, rate: number) {
  const step = rate / 10; // 0.1초씩 넣는다
  for (let i = 0; i < pcm.length; i += step) {
    // subarray 는 안 된다: rtc-node 가 조각의 시작 위치를 무시하고 늘 맨 앞(무음)을 보낸다. slice 로 따로 복사한다
    const part = pcm.slice(i, i + step);
    await source.captureFrame(new AudioFrame(part, rate, 1, part.length));
  }
}

// 그 방에서 처음 말할 때 들어가서 계속 머문다. 방 서버가 꺼졌다 켜지거나 방송이 닫히면 다음에 말할 때 다시 들어간다.
function join(name: string, sampleRate: number) {
  const joined = voice.rooms.get(name);
  if (joined) return joined;
  const joining = (async () => {
    const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, { identity: VOICE_BOT, name: "음성" });
    at.addGrant({ roomJoin: true, room: name, canPublish: true, canSubscribe: false, canPublishData: false, canUpdateOwnMetadata: true });
    const room = new Room();
    room.on(RoomEvent.Disconnected, () => voice.rooms.delete(name));
    await room.connect("ws://localhost:7880", await at.toJwt(), { autoSubscribe: false, dynacast: false });
    const source = new AudioSource(sampleRate, 1);
    const opts = new TrackPublishOptions();
    opts.source = TrackSource.SOURCE_MICROPHONE;
    await room.localParticipant!.publishTrack(LocalAudioTrack.createAudioTrack("voice", source), opts);
    return { room, source };
  })().catch((e) => {
    voice.rooms.delete(name);
    throw e;
  });
  voice.rooms.set(name, joining);
  return joining;
}

// 한 줄로 서서 차례대로 말한다 (두 사람이 같이 보내도 소리가 겹치지 않게).
// 빨리 들리게: 읽는다는 신호(VOICE_ON)는 소리를 만들기 전에 먼저 보내서 배경음악 줄이기가 만드는 시간과 겹치게 하고,
// 문장이 여럿이면 첫 문장을 흘려보내는 동안 다음 문장을 만든다
export function say(name: string, text: string, id: string) {
  const history = chatOf(name);
  const ended = () => store.messages.get(name) !== history;
  const turn = voice.line.then(async () => {
    if (ended()) return;
    const { tts } = await voice.tts;
    if (ended() || !(await rooms.listParticipants(name)).some((p) => p.identity !== VOICE_BOT)) return;
    const rate = tts.sampleRate;
    const fresh = !voice.rooms.has(name);
    const { room, source } = await join(name, rate);
    if (ended()) { await room.disconnect(); return; }
    const me = room.localParticipant!;
    // 방에 막 들어왔으면 사람들이 새 소리를 받기 시작할 때까지 첫 소리를 기다린다
    // ponytail: 1초는 어림값. 서버를 켜고 첫 음성의 첫 마디가 잘리면 늘리기
    const ready = Date.now() + (fresh ? 1000 : 0);
    // VOICE_ON: 이제부터 읽는다고 알린다. 소리를 만드는 동안 방 사람들 화면이 배경음악을 미리 줄여 둔다
    await me.setAttributes({ [VOICE_ON]: "1" });
    try {
      const parts = text.match(/[^.!?。…]+[.!?。…]*\s*/g) ?? [text]; // 문장마다
      let next = synth(parts[0], id);
      for (let i = 0; i < parts.length; i++) {
        const { pcm } = await next;
        if (ended()) break;
        if (i + 1 < parts.length) next = synth(parts[i + 1], id);
        await sleep(ready - Date.now());
        await push(source, pcm, rate);
        if (i + 1 < parts.length) await push(source, new Int16Array(rate * 0.25), rate); // 문장 사이 쉼
      }
      await source.waitForPlayout();
      await sleep(200); // 듣는 쪽에서 끝까지 다 나온 뒤에 다음 사람 글로 넘어간다 (보낸 사람에게 끝이 새지 않게)
    } finally {
      await me.setAttributes({ [VOICE_ON]: "" }).catch(() => {}); // 실패해도 배경음악이 줄어든 채로 남지 않게
    }
  });
  voice.line = turn.catch(() => {});
  return turn;
}

// 다시 듣기: 읽어서 WAV 파일 내용으로. 여럿이 한꺼번에 눌러도 서버가 바빠지지 않게 한 줄로 서서 하나씩 만든다
export function replay(text: string, id: string) {
  const turn = voice.replays.then(async () => {
    const { rate, pcm } = await synth(text, id);
    const b = Buffer.alloc(44 + pcm.byteLength);
    b.write("RIFF", 0);
    b.writeUInt32LE(36 + pcm.byteLength, 4);
    b.write("WAVEfmt ", 8);
    b.writeUInt32LE(16, 16); // 머리말 길이
    b.writeUInt16LE(1, 20); // 압축 안 한 소리
    b.writeUInt16LE(1, 22); // 한 채널
    b.writeUInt32LE(rate, 24);
    b.writeUInt32LE(rate * 2, 28); // 1초에 몇 바이트
    b.writeUInt16LE(2, 32); // 한 번에 몇 바이트
    b.writeUInt16LE(16, 34); // 16비트
    b.write("data", 36);
    b.writeUInt32LE(pcm.byteLength, 40);
    Buffer.from(pcm.buffer).copy(b, 44);
    return new Uint8Array(b);
  });
  voice.replays = turn.catch(() => {});
  return turn;
}
