// 고정 방 목록. 방을 늘리려면 여기에 한 줄 추가.
export const ROOMS = [
  { id: "study", label: "스터디방" },
  { id: "lounge", label: "잡담방" },
];

// 캐릭터 목록. 그림은 assets/avatars/<id>/idle.png, talk.png
export const AVATARS = [
  { id: "cocomong", label: "코코몽" },
  { id: "doraemon", label: "도라에몽" },
  { id: "pororo", label: "뽀로로" },
  { id: "shinchan", label: "짱구" },
];

export const isRoom = (id: unknown) => ROOMS.some((r) => r.id === id);
export const isAvatar = (id: unknown) => AVATARS.some((a) => a.id === id);

// 브라우저에 저장된 캐릭터가 목록에서 빠졌으면 첫 캐릭터로
export const savedAvatar = () => {
  const id = sessionStorage.getItem("avatar");
  return isAvatar(id) ? id! : AVATARS[0].id;
};
