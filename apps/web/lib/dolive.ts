// 채팅방은 하나뿐
export const ROOM = "dolive";

// 기본 프로필 사진 "1" ~ "11" (입장 화면에 이 순서로 나온다). 사진은 assets/profile/<id>.webp, 모두 240x300
export const AVATARS = Array.from({ length: 11 }, (_, i) => String(i + 1));

// 사용자가 입장 화면에서 직접 올린 사진: "u-" + 무작위 id (server/uploads/<id>.jpg)
export const isUpload = (id: unknown) => typeof id === "string" && /^u-[0-9a-f-]{36}$/.test(id);

export const isAvatar = (id: unknown) => AVATARS.includes(id as string) || isUpload(id);

// 브라우저에 저장된 사진이 목록에 없으면(예전 캐릭터 등) 첫 사진으로
export const savedAvatar = () => {
  const id = sessionStorage.getItem("avatar");
  return isAvatar(id) ? id! : AVATARS[0];
};
