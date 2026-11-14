import { Room, RoomEvent, VideoPresets, type RoomOptions } from "livekit-client";

// 캠은 640x360, 1초에 20장 (입장 전에 방을 준비할 때도 같은 설정을 쓴다).
export const CAM_CAPTURE = { width: 640, height: 360, frameRate: 20 };

// 영상은 화면공유와 얼굴(카메라). 안 보이는 영상은 받지 않고, 작게 보이는 영상은 작은 화질로 받음(adaptiveStream).
// 단, 다른 앱에 갔다 와도 바로 보이게 뒤에 숨어 있는 동안에도 계속 받는다.
// 얼굴은 640x360(약 0.45Mbps, 1초 20장)과 320x180(약 0.16Mbps) 두 가지로 보낸다.
const ROOM_OPTIONS: RoomOptions = {
  adaptiveStream: { pauseVideoInBackground: false },
  dynacast: true,
  videoCaptureDefaults: { resolution: CAM_CAPTURE },
  publishDefaults: { videoEncoding: VideoPresets.h360.encoding, videoSimulcastLayers: [VideoPresets.h180] },
  // 수정용 서버는 내부 브라우저에서도 열리도록 기존 연결 방식을 쓴다.
  singlePeerConnection: process.env.NODE_ENV !== "development",
};

// 입장 버튼과 방 화면이 같은 방 객체를 쓴다. 소리 준비만 하며, 연결·마이크 권한은 요청하지 않는다.
// 주소 이동·방 코드 내려받기·입장권 요청 뒤에 새 객체를 만들면 클릭할 때 풀어 둔 재생 준비가 사라진다.
let entryRoom: Room | undefined;
export function getEntryRoom() {
  if (!entryRoom) {
    const room = new Room(ROOM_OPTIONS);
    entryRoom = room;
    room.once(RoomEvent.Disconnected, () => {
      if (entryRoom === room) entryRoom = undefined;
    });
  }
  return entryRoom;
}

// 반드시 클릭·Enter 처리 안에서, await·주소 이동·화면 전환보다 먼저 부른다.
// 아이폰에서는 LiveKit이 무음 소리를 계속 틀어 두어, 나중에 도착하는 방 소리도 재생할 수 있게 한다.
export function prepareRoomAudio() {
  void getEntryRoom().startAudio().catch(() => {});
}

// 휴대폰은 손가락을 뗄 때 재생을 허용한다. 자식 버튼이 이벤트 전달을 막아도 먼저 받는다.
// 실패해도 다음 터치에 다시 시도하며, PC의 마우스 누르기 동작도 유지한다.
export function watchAudioUnlock(room: Room, target: Document = document) {
  const unlock = (event: Event) => {
    if (event.type === "pointerdown" && (event as PointerEvent).pointerType !== "mouse") return;
    if (event.type === "pointerup" && (event as PointerEvent).pointerType === "mouse") return;
    if (event.type === "keydown" && ((event as KeyboardEvent).key === "Escape" || (event as KeyboardEvent).repeat)) return;
    if (!room.canPlaybackAudio) void room.startAudio().catch(() => {});
  };
  const events = ["pointerdown", "pointerup", "touchend", "click", "keydown"];
  for (const event of events) target.addEventListener(event, unlock, true);
  return () => {
    for (const event of events) target.removeEventListener(event, unlock, true);
  };
}
