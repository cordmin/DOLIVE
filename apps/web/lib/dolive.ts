// 채팅방은 하나뿐
export const ROOM = "dolive";

// 캐릭터 목록. 그림은 assets/avatars/<id>/idle.png, talk.png
export const AVATARS = [
  { id: "cocomong", label: "코코몽" },
  { id: "doraemon", label: "도라에몽" },
  { id: "pororo", label: "뽀로로" },
  { id: "shinchan", label: "짱구" },
];

export const isAvatar = (id: unknown) => AVATARS.some((a) => a.id === id);

// 브라우저에 저장된 캐릭터가 목록에서 빠졌으면 첫 캐릭터로
export const savedAvatar = () => {
  const id = sessionStorage.getItem("avatar");
  return isAvatar(id) ? id! : AVATARS[0].id;
};
