// 서버를 켤 때 한 번: 상태 페이지(/status)의 1분 점검을 시작한다 (lib/status.ts). Node 서버에서만
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startStatus } = await import("./lib/status");
    startStatus();
  }
}
