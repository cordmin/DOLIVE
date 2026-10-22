// 기본 프로필 사진 "1" ~ "9" (입장 화면에 이 순서로 나온다). 사진은 assets/profile/<id>.webp, 모두 240x300
// (10·11번 사진 파일은 남아 있지만 그 자리를 도름스 사진·내 사진 칸에 내줘서 고를 수 없다)
export const AVATARS = Array.from({ length: 9 }, (_, i) => String(i + 1));

// 내가 직접 고른 사진. 이 브라우저(localStorage "photo")에 남겨 두고, 입장할 때 서버 메모리에 올린다(api/token. 서버엔 파일로 저장 안 함)
export const CUSTOM = "custom";
// 도름스 프로필 사진. 사진 주소는 서버가 도름스에서 받아 입장권에 적는다(api/token)
export const DORMS = "dorms";

export const isAvatar = (id: unknown) => id === CUSTOM || id === DORMS || AVATARS.includes(id as string);

// 손가락으로 쓰는 작은 화면 (크기를 0으로 알려 주는 브라우저도 있어서 0은 제외)
export function isPhone() {
  const short = Math.min(screen.width, screen.height);
  return short > 0 && short <= 500 && matchMedia("(pointer: coarse)").matches;
}

// 방 안에서 그 사람 사진: 사진 번호, 또는 고른 사진 주소 (/api/chat/<id>). 비어 있으면 첫 사진
export const avatarOf = (a?: string) => a || AVATARS[0];

// 브라우저에 저장된 사진이 목록에 없으면(예전 캐릭터 등) 첫 사진으로
export const savedAvatar = () => {
  const id = sessionStorage.getItem("avatar");
  return isAvatar(id) ? id! : AVATARS[0];
};

// 채팅 한 줄. 서버가 기록해 두고(lib/chat.ts) 방 안 모두에게 CHAT_TOPIC 으로 보낸다.
// n: 서버가 받은 순서 (timestamp 도 서버 시계라 기기마다 시계가 달라도 순서가 섞이지 않는다. 같은 순간이면 n 으로 가른다), image: 사진 주소 (/api/chat/<id>)
export type ChatMsg = {
  id: string;
  n: number;
  timestamp: number;
  identity: string;
  name: string;
  avatar: string;
  message: string;
  image?: string;
  imageType?: string;
  mine?: boolean; // 기록을 받을 때만: 내(같은 도름스 계정)가 보낸 것 → 지우기 버튼 (api/chat GET)
  tts?: boolean; // "/글" 로 보낸 음성 글 (말풍선 앞 스피커를 누르면 /api/voice/<id> 로 다시 듣는다)
  voice?: string; // 읽은 목소리 (VOICES id). 다시 듣기도 같은 목소리로
  edited?: boolean; // 보낸 뒤 고친 글 (말풍선 옆에 "수정됨")
  donation?: { senderName: string; recipientName: string; amount: number }; // 실제 보내기가 성공한 뒤 서버가 올리는 가운데 알림
};

// 음성 목소리 (lib/voice.ts). 바탕은 Supertonic 3 의 무료 목소리 (models/supertonic/<base>.json). 여자 2, 남자 2.
// 마왕은 민준을 바꿔서 만든다: pitch = 높낮이(0.72 = 낮게, 말 빠르기는 그대로), speed = 말 빠르기(1 = 보통).
// (2026-10-04 다른 무료 목소리 8개와 꼬마 요정·햄찌·거인 등 캐릭터 목소리도 들어 봤는데 이 넷만 남김)
export type VoiceDef = { id: string; name: string; woman: boolean; base: string; pitch?: number; speed?: number };
export const VOICES: VoiceDef[] = [
  { id: "F2", name: "서연", woman: true, base: "F2" }, // 처음부터 쓰던 목소리
  { id: "F1", name: "하은", woman: true, base: "F1" },
  { id: "M1", name: "민준", woman: false, base: "M1" },
  { id: "demon", name: "마왕", woman: false, base: "M1", pitch: 0.72, speed: 0.88 },
];
export const isVoice = (id: unknown) => VOICES.some((v) => v.id === id);
// 목소리 미리 듣기·글 다시 듣기는 한 번에 하나만: 듣던 소리가 있으면 멈추고 새로 튼다 (여러 번 눌러도 겹치지 않게)
let playing: HTMLAudioElement | undefined;
export function stopPlaying() {
  if (!playing) return;
  playing.pause();
  playing.removeAttribute("src");
  playing.load();
  playing = undefined;
}
export function playOnly(url: string) {
  stopPlaying();
  playing = new Audio(url);
  return playing.play();
}
// 내 음성 설정 (각자 위 줄 TTS 버튼으로 고른다). 이 브라우저(localStorage)에 남기고, 글을 보낼 때마다 같이 보내서 바로 적용된다.
// mode: "off" = 안 읽기("/글" 도 그냥 글), "always" = 내 글을 모두 읽기, "slash" = "/글" 만 읽기. voice: VOICES id
export const TTS_MODES = ["off", "always", "slash"] as const;
export type TtsSettings = { mode: (typeof TTS_MODES)[number]; voice: string };
const TTS_KEY = "dolive-tts";
export function savedTts(): TtsSettings {
  let s: Partial<TtsSettings> = {};
  try {
    s = JSON.parse(localStorage.getItem(TTS_KEY) ?? "{}");
  } catch {}
  return { mode: TTS_MODES.includes(s.mode!) ? s.mode! : "slash", voice: isVoice(s.voice) ? s.voice! : VOICES[0].id };
}
export function saveTts(s: TtsSettings) {
  try {
    localStorage.setItem(TTS_KEY, JSON.stringify(s));
  } catch {}
}
export const CHAT_TOPIC = "dolive-chat";
export const CHAT_MAX = 2000; // 글자 수
export const TTS_MAX = 200; // "/" 로 읽어 주는 글은 이 글자 수까지 (30초쯤)
// "/글" 을 읽어 주는 서버 참여자 (lib/voice.ts). 사람 이름표엔 늘 # 이 있어서 겹치지 않는다
export const VOICE_BOT = "dolive-voice";
// 읽는 동안 "1". 화면공유 소리(배경음악)를 말이 나오기 전에 미리 줄이는 데 쓴다 (app/room/share.tsx)
export const VOICE_ON = "on";

// 채팅 사진: 보여 줘도 안전한 종류만 (SVG 같은 건 새 탭에서 열 때 이 사이트 안에서 코드가 돌 수 있어서 뺀다)
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
export const IMAGE_MAX = 10 * 1024 * 1024;

// 서버의 도름스 확인에 막혔을 때(응답의 reason). 로그인이 필요하면 입장 화면으로 (도름스로 바로 보내면 도름스에 로그인돼 있는
// 브라우저는 묻지 않고 다시 로그인돼서 로그아웃이 풀린다. 로그인은 입장 화면 [로그인]으로만).
// 허용이 끊겼거나 도름스 연결이 안 되면 안내 화면([다시 시도] 버튼이 있다, app/dorms-denied)으로 간다. 도름스 때문이 아니면 false
export function leaveForDorms(reason: unknown) {
  if (reason === "authentication_required") location.href = "/";
  else if (reason === "access_denied" || reason === "temporarily_unavailable") location.href = `/dorms-denied?reason=${reason}&next=/room`;
  else return false;
  return true;
}

// 방송은 모두 합쳐(마스터가 만든 방 포함) 이 개수까지만. 더 많으면 서버 PC가 감당하기 어렵다 (api/rooms 가 막고, 입장 화면은 안내 창)
export const MAX_ROOMS = 10;

// 카메라(얼굴) 설정. 위치는 저장하지 않고 항상 왼쪽 아래로 시작한다. 나머지는 이 브라우저에 남긴다.
// pos: 화면공유 시 얼굴 위치 (네 구석, row = 겹치지 않고 공유 화면 아래 얼굴 줄. 얼굴 줄은 네모만), shape: 구석에 띄울 모양,
// mirror: 좌우 반전 (모두에게 거울처럼 보임), device: PC 에서 고른 캠, facing: 휴대폰 전면(user)·후면(environment).
// pos·shape·mirror 는 카메라를 켤 때 서버가 참여자 표시(camPos·camShape·camMirror)로 적어서 모두 같게 본다 (api/cam)
export const CAM_POS = ["br", "bl", "tr", "tl", "row"];
export const CAM_SHAPE = ["rect", "circle"];
export const CAM_SIZES = [2, 3, 4];
// 예전에 저장한 1·5단계는 남아 있는 가장 가까운 크기로 옮긴다.
export const camSize = (size: unknown) => typeof size === "number" && Number.isInteger(size) && size >= 1 && size <= 5 ? Math.max(2, Math.min(4, size)) : 3;
// 3단계가 기존 크기. 공유 화면 너비에 대한 백분율이라 전체화면에서도 같은 비율이다.
export const camWidth = (size: unknown, circle: boolean) => (circle ? 16 : 22) + (camSize(size) - 3) * (circle ? 3 : 4);
// blur: 배경 블러 처리. PC 에서만 쓴다 (app/room/camera.tsx)
export type CamSettings = { pos: string; shape: string; mirror: boolean; device?: string; facing: "user" | "environment"; blur: boolean; size: number };
const CAM_KEY = "dolive-cam";
export function savedCam(): CamSettings {
  let s: Partial<CamSettings> = {};
  try {
    s = JSON.parse(localStorage.getItem(CAM_KEY) ?? "{}");
  } catch {}
  return {
    pos: "bl",
    shape: s.shape === "circle" ? "circle" : "rect",
    mirror: s.mirror !== false,
    device: typeof s.device === "string" ? s.device : undefined,
    facing: s.facing === "environment" ? "environment" : "user",
    blur: s.blur === true,
    size: camSize(s.size),
  };
}
export function saveCam(s: CamSettings) {
  try {
    localStorage.setItem(CAM_KEY, JSON.stringify({ ...s, pos: undefined }));
  } catch {}
}
