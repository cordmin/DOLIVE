import { TrackSource } from "livekit-server-sdk";

// 방장이 아닌 사람은 처음엔 마이크만 보낼 수 있다. 방장이 허락하면 화면공유(+공유 소리)도 보낼 수 있다.
export const MIC_ONLY = [TrackSource.MICROPHONE];
export const WITH_SCREEN = [TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO];
