// 채팅방은 하나뿐
export const ROOM = "dolive";

// 기본 프로필 사진 "1" ~ "11" (입장 화면에 이 순서로 나온다). 사진은 assets/profile/<id>.webp, 모두 240x300
export const AVATARS = Array.from({ length: 11 }, (_, i) => String(i + 1));

// 내가 직접 고른 사진. 서버에는 올리지 않고 방 안 사람들에게 통화 연결로 바로 건넨다 (room/page.tsx)
export const CUSTOM = "custom";

export const isAvatar = (id: unknown) => id === CUSTOM || AVATARS.includes(id as string);

// 브라우저에 저장된 사진이 목록에 없으면(예전 캐릭터 등) 첫 사진으로
export const savedAvatar = () => {
  const id = sessionStorage.getItem("avatar");
  return isAvatar(id) ? id! : AVATARS[0];
};
