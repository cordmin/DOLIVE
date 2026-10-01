import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 컴퓨터에서 직접 도는 프로그램이 든 패키지라 묶지 않고 그대로 불러 쓴다 ("/글" 음성, lib/voice.ts)
  serverExternalPackages: ["onnxruntime-node", "@livekit/rtc-node"],
};

export default nextConfig;
