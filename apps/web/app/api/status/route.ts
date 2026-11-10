import os from "node:os";
import { roomAdminDeny } from "@/lib/chat";
import { rooms } from "@/lib/server";

// 방송 상태 창(app/room/status.tsx)의 서버 칸: 그 방의 관리자만. 웹 프로그램이 서버 컴퓨터의 CPU·메모리를 직접 읽는다 (sudo 필요 없음).
// CPU 사용은 1분 평균 부하를 코어 수로 나눈 값 (100% 넘으면 100으로)
export async function POST(req: Request) {
  const { room } = await req.json().catch(() => ({}));
  if (typeof room !== "string") return Response.json({ error: "잘못된 요청" }, { status: 400 });
  const no = await roomAdminDeny(req, room);
  if (no) return no;
  const cores = os.availableParallelism();
  const list = await rooms.listRooms().catch(() => []);
  return Response.json({
    cpu: Math.min(100, Math.round((os.loadavg()[0] / cores) * 100)),
    cores,
    memUsed: os.totalmem() - os.freemem(),
    memTotal: os.totalmem(),
    uptime: Math.round(os.uptime()),
    rooms: list.length,
    people: list.reduce((n, r) => n + r.numParticipants, 0),
  });
}
