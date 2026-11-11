// 서버를 켤 때 한 번: 상태 페이지(/status)와 연수 참석 기록의 1분 점검을 시작한다 (lib/status.ts, lib/attendance.ts). Node 서버에서만
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startStatus } = await import("./lib/status");
    startStatus();
    // 도름스 연수 방 참석 기록의 1분 점검 (lib/attendance.ts)
    const { startAttendance } = await import("./lib/attendance");
    startAttendance();
  }
}
