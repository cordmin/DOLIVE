import { createLocalAudioTrack, type LocalAudioTrack } from "livekit-client";

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
