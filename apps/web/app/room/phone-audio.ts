import { useEffect } from "react";
import type { Room } from "livekit-client";
import { isPhone } from "@/lib/dolive";

// 휴대폰에 계속 듣는 소리임을 알린다. 브라우저가 연결 자체를 멈추는 것까지 막지는 못한다.
export function usePhoneAudio(room: Room, microphone: boolean) {
  useEffect(() => {
    if (!isPhone()) return;
    const audioSession = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    const previousType = audioSession?.type;
    if (audioSession) audioSession.type = microphone ? "play-and-record" : "playback";
    const mediaSession = navigator.mediaSession;
    const previousMetadata = mediaSession?.metadata;
    if (mediaSession && typeof MediaMetadata !== "undefined") {
      mediaSession.metadata = new MediaMetadata({ title: "DOLIVE", artist: room.name });
    }
    // 화면을 다시 켰을 때 멈춘 재생을 다시 시도한다.
    const resume = () => {
      if (document.visibilityState === "visible") room.startAudio().catch(() => {});
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("pageshow", resume);
    return () => {
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("pageshow", resume);
      if (audioSession && previousType !== undefined) audioSession.type = previousType;
      if (mediaSession) mediaSession.metadata = previousMetadata ?? null;
    };
  }, [room, microphone]);
}
