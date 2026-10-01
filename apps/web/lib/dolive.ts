// 채팅방은 하나뿐
export const ROOM = "dolive";

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
};
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
