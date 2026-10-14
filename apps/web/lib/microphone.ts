import { createLocalAudioTrack, type LocalAudioTrack } from "livekit-client";

// 휴대폰의 통화 경로 이름만 번역하고, 실제 제품 이름은 그대로 둔다.
export function microphoneLabel(label: string, index: number) {
  const names: Record<string, string> = {
    speakerphone: "스피커 폰",
    "wired headset": "유선 헤드셋",
    "headset earpiece": "휴대폰 수화부",
    earpiece: "휴대폰 수화부",
    "bluetooth headset": "블루투스 헤드셋",
    "usb audio": "USB 소리 장치",
    "default-device": "기본 마이크",
    default: "기본",
    headset: "헤드셋",
  };
  return label.trim().replace(/\b(speakerphone|wired headset|headset earpiece|bluetooth headset|earpiece|usb audio|default-device|default|headset)\b/gi, (name) => names[name.toLowerCase()]) || `마이크 ${index + 1}`;
}

// 기본 장치는 같은 마이크를 가리키는 별명이라 선택지에 중복해서 넣지 않는다.
export function microphoneChoices(devices: MediaDeviceInfo[]) {
  const inputs = devices.filter((d) => d.kind === "audioinput" && d.deviceId);
  const actual = inputs.filter((d) => !["default", "communications"].includes(d.deviceId));
  return (actual.length ? actual : inputs.slice(0, 1)).filter((d, i, list) => list.findIndex((x) => x.deviceId === d.deviceId) === i);
}

export function checkMicrophone(track: LocalAudioTrack, deviceId: string) {
  const actual = track.mediaStreamTrack.getSettings().deviceId;
  if (deviceId && actual && actual !== deviceId) throw new Error("고른 마이크로 연결되지 않았어요. 휴대폰의 소리 연결을 확인해 주세요.");
}

export async function captureMicrophone(deviceId = "") {
  // 문자열로 넘기면 통화 도구가 다른 마이크로 다시 시도하므로 정확히 고른 것만 요청한다.
  const track = await createLocalAudioTrack(deviceId ? { deviceId: { exact: deviceId } } : {});
  try {
    checkMicrophone(track, deviceId);
    return track;
  } catch (e) {
    track.stop();
    throw e;
  }
}
