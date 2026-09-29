// 채팅방은 하나뿐
export const ROOM = "dolive";

// 기본 프로필 사진 "1" ~ "11" (입장 화면에 이 순서로 나온다). 사진은 assets/profile/<id>.webp, 모두 240x300
export const AVATARS = Array.from({ length: 11 }, (_, i) => String(i + 1));

// 내가 직접 고른 사진. 입장할 때 서버 메모리에 올리고(api/token), 서버를 끄면 사라진다 (파일로는 저장 안 함)
export const CUSTOM = "custom";

export const isAvatar = (id: unknown) => id === CUSTOM || AVATARS.includes(id as string);

// 브라우저에 저장된 사진이 목록에 없으면(예전 캐릭터 등) 첫 사진으로
export const savedAvatar = () => {
  const id = sessionStorage.getItem("avatar");
  return isAvatar(id) ? id! : AVATARS[0];
};

// 채팅 한 줄. 서버가 기록해 두고(lib/chat.ts) 방 안 모두에게 CHAT_TOPIC 으로 보낸다.
// n: 서버가 받은 순서 (기기마다 시계가 달라도 순서가 섞이지 않게), image: 사진 주소 (/api/chat/<id>)
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
};
export const CHAT_TOPIC = "dolive-chat";
export const CHAT_MAX = 2000; // 글자 수

// 채팅 사진: 보여 줘도 안전한 종류만 (SVG 같은 건 새 탭에서 열 때 이 사이트 안에서 코드가 돌 수 있어서 뺀다)
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
export const IMAGE_MAX = 10 * 1024 * 1024;
