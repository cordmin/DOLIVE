import path from "node:path";
import { AudioFrame, AudioSource, LocalAudioTrack, Room, RoomEvent, TrackPublishOptions, TrackSource } from "@livekit/rtc-node";
import { AccessToken } from "livekit-server-sdk";
import { ROOM, VOICE_BOT, VOICE_FROM } from "@/lib/dolive";
import { loadTextToSpeech, loadVoiceStyle } from "@/lib/supertonic";

// "/글" 음성: 서버가 Supertonic 3(F2 목소리)으로 읽고, 방에 "음성"이라는 참여자로 들어가 마이크처럼 흘려보낸다.
// 소리는 만들자마자 보내고 어디에도 저장하지 않는다. 보낸 사람 화면은 그 소리를 끈다 (VOICE_FROM, app/room/page.tsx).
// 다시 듣기(말풍선 스피커)는 누를 때 다시 읽어서 누른 사람에게만 WAV 로 준다 (replay, api/voice/[id]).
// 모델(400MB)은 깃에 없어서 models/supertonic 에 직접 받아 둔다:
//   https://huggingface.co/supertone-oss-archive/supertonic-3 의 onnx 폴더 파일 전부 + voice_styles/F2.json
const DIR = path.join(process.cwd(), "models", "supertonic");

type Tts = { sampleRate: number; call(text: string, lang: string, style: unknown, steps: number, speed: number): Promise<{ wav: number[] }> };
type Voice = {
  tts: Promise<{ tts: Tts; style: unknown }>;
  line: Promise<void>; // 방에 말하기 줄
  replays: Promise<unknown>; // 다시 듣기 줄
  room?: Promise<{ room: Room; source: AudioSource }>;
};

// 개발 중 코드를 고쳐 다시 읽혀도 모델을 또 올리거나 방에 두 번 들어가지 않게 globalThis 에 둔다
const g = globalThis as unknown as { doliveVoice?: Voice };
const voice: Voice = (g.doliveVoice ??= {
  tts: (async () => ({ tts: (await loadTextToSpeech(DIR)) as Tts, style: loadVoiceStyle([path.join(DIR, "F2.json")]) }))(),
  line: Promise.resolve(),
  replays: Promise.resolve(),
});

// 소리를 다듬는 횟수. 원래 예시는 8번인데 5번으로 줄여도 목소리는 거의 같고, 짧은 채팅 한 줄 만드는 시간이 0.5초 → 0.35초쯤으로 준다.
// (그래픽카드로 돌려 봤지만 문장 길이가 바뀔 때마다 준비를 다시 해서 CPU보다 빠르지 않았다)
const STEPS = 5;

// 소리 크기. 1 = 모델이 만든 그대로. 1.3 = 30% 크게 (넘치는 부분은 잘라서 찢어지는 소리가 안 나게 한다)
const GAIN = 1.3;

// 글을 읽어서 16비트 소리로. 앞뒤에 붙어 나오는 무음(앞 0.4초, 뒤 0.5초쯤)은 잘라서 바로 말이 시작되게 한다
async function synth(text: string) {
  const { tts, style } = await voice.tts;
  const { wav } = await tts.call(text, "ko", style, STEPS, 1.05);
  const rate = tts.sampleRate;
  const loud = (v: number) => Math.abs(v) > 0.03;
  const start = Math.max(0, wav.findIndex(loud) - rate * 0.05); // 말 시작 0.05초 전부터
  const end = Math.min(wav.length, wav.findLastIndex(loud) + rate * 0.15); // 말 끝 0.15초 뒤까지
  const pcm = Int16Array.from(wav.slice(start, end > start ? end : wav.length), (s) => Math.max(-1, Math.min(1, s * GAIN)) * 32767);
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

// 처음 말할 때 방에 들어가서 계속 머문다. 방 서버가 꺼졌다 켜지면 다음에 말할 때 다시 들어간다.
function join(sampleRate: number) {
  return (voice.room ??= (async () => {
    const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, { identity: VOICE_BOT, name: "음성" });
    at.addGrant({ roomJoin: true, room: ROOM, canPublish: true, canSubscribe: false, canPublishData: false, canUpdateOwnMetadata: true });
    const room = new Room();
    room.on(RoomEvent.Disconnected, () => (voice.room = undefined));
    await room.connect("ws://localhost:7880", await at.toJwt(), { autoSubscribe: false, dynacast: false });
    const source = new AudioSource(sampleRate, 1);
    const opts = new TrackPublishOptions();
    opts.source = TrackSource.SOURCE_MICROPHONE;
    await room.localParticipant!.publishTrack(LocalAudioTrack.createAudioTrack("voice", source), opts);
    return { room, source };
  })().catch((e) => {
    voice.room = undefined;
    throw e;
  }));
}

// 한 줄로 서서 차례대로 말한다 (두 사람이 같이 보내도 소리가 겹치지 않게). from: 보낸 사람 (그 사람한테는 안 들리게)
// 빨리 들리게: 누구 글인지는 소리를 만들기 전에 먼저 알려서 기다리는 시간이 만드는 시간과 겹치게 하고,
// 문장이 여럿이면 첫 문장을 흘려보내는 동안 다음 문장을 만든다
export function say(text: string, from: string) {
  const turn = voice.line.then(async () => {
    const { tts } = await voice.tts;
    const rate = tts.sampleRate;
    const fresh = !voice.room;
    const { room, source } = await join(rate);
    const me = room.localParticipant!;
    // 첫 소리 전에 이만큼은 지나야 한다. 방 사람들 화면이 '누구 글인지' 받아서 보낸 사람은 소리를 끌 틈.
    // 방에 막 들어왔으면 사람들이 새 소리를 받기 시작할 틈까지. 같은 사람이 이어서 보내면 기다릴 것 없음
    // ponytail: 0.3초 / 1초는 어림값. 보낸 사람에게 첫 마디가 새거나 남들에게 첫 마디가 잘리면 늘리기
    const ready = Date.now() + (fresh ? 1000 : me.attributes[VOICE_FROM] === from ? 0 : 300);
    await me.setAttributes({ [VOICE_FROM]: from });
    const parts = text.match(/[^.!?。…]+[.!?。…]*\s*/g) ?? [text]; // 문장마다
    let next = synth(parts[0]);
    for (let i = 0; i < parts.length; i++) {
      const { pcm } = await next;
      if (i + 1 < parts.length) next = synth(parts[i + 1]);
      await sleep(ready - Date.now());
      await push(source, pcm, rate);
      if (i + 1 < parts.length) await push(source, new Int16Array(rate * 0.25), rate); // 문장 사이 쉼
    }
    await source.waitForPlayout();
    await sleep(200); // 듣는 쪽에서 끝까지 다 나온 뒤에 다음 사람 글로 넘어간다 (보낸 사람에게 끝이 새지 않게)
  });
  voice.line = turn.catch(() => {});
  return turn;
}

// 다시 듣기: 읽어서 WAV 파일 내용으로. 여럿이 한꺼번에 눌러도 서버가 바빠지지 않게 한 줄로 서서 하나씩 만든다
export function replay(text: string) {
  const turn = voice.replays.then(async () => {
    const { rate, pcm } = await synth(text);
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
