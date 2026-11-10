// 화면공유 상태판(app/room/status.tsx)과 자동 프레임 줄이기(app/room/share-report.ts)가 쓰는 판단 규칙. 시험: node tests/share-health.cjs

// 약한 컴퓨터: CPU 4개 이하 또는 메모리 4GB 이하 (크롬은 메모리를 0.5·1·2·4·8 중 하나로만 알려 준다. 모르면 약하다고 보지 않는다)
export const isLowSpec = (cores?: number, memGB?: number) => (!!cores && cores <= 4) || (!!memGB && memGB <= 4);

// 자동 프레임 줄이기. 2초마다 limited(화질이 컴퓨터·인터넷 때문에 막혔는지)를 넣는다.
// 10초 넘게 막히면 바로 15프레임으로 내리고, 1분·3분·5분 동안 계속 괜찮아야 30프레임으로 되돌린다.
// 세 번 되돌렸는데 또 막히면 그 공유가 끝날 때까지 15프레임으로 둔다 (오르락내리락 막기)
export const DOWN_AFTER = 10_000;
export const UP_AFTER = [60_000, 180_000, 300_000];
export type Governor = { low: boolean; since: number; ups: number };
export const startGovernor = (now: number): Governor => ({ low: false, since: now, ups: 0 });
export function stepGovernor(g: Governor, limited: boolean, now: number): Governor {
  // since: 지금 상태(막힘 / 괜찮음)가 이어지기 시작한 때
  if (!g.low) {
    if (!limited) return { ...g, since: now };
    return now - g.since >= DOWN_AFTER ? { low: true, since: now, ups: g.ups } : g;
  }
  if (limited) return { ...g, since: now };
  const wait = UP_AFTER[g.ups];
  return wait !== undefined && now - g.since >= wait ? { low: false, since: now, ups: g.ups + 1 } : g;
}

export const REASON: Record<string, string> = { cpu: "컴퓨터가 바쁨", bandwidth: "인터넷이 느림", other: "기타", none: "제대로 나감" };

export type Level = "g" | "a" | "r"; // 좋음 · 주의 · 나쁨
export type Diagnosis = { level: Level; head: string; tip: string };
// 상태판 맨 위 한 줄 진단. recent: 최근 1분 중 컴퓨터·인터넷 때문에 막힌 비율 (0~1)
export function diagnose(o: {
  sharing: boolean;
  recent?: { cpu: number; bandwidth: number };
  sharerPoor?: boolean;
  serverCpu?: number;
  poorViewers: number;
}): Diagnosis {
  if (o.serverCpu !== undefined && o.serverCpu >= 85)
    return { level: "r", head: "DOLIVE 서버가 바빠서", tip: "모두의 화면이 늦거나 끊길 수 있어요. 방송이 끝난 뒤 서버 사양을 확인해 보세요." };
  if (o.sharing && o.recent && o.recent.cpu >= 0.3)
    return { level: "a", head: "송출자 컴퓨터가 바빠서", tip: "화질과 프레임을 낮추고 있어요. 송출자에게 다른 프로그램·크롬 탭을 닫아 달라고 해 보세요." };
  if (o.sharing && ((o.recent && o.recent.bandwidth >= 0.3) || o.sharerPoor))
    return { level: "a", head: "송출자 인터넷이 느려서", tip: "화질과 프레임을 낮추고 있어요. 송출자에게 유선 인터넷이나 다른 와이파이를 써 달라고 해 보세요." };
  if (o.poorViewers > 0)
    return { level: "a", head: `보는 사람 ${o.poorViewers}명의 인터넷이 느려서`, tip: "그 사람에게만 낮은 화질이 가요. 송출자와 서버는 괜찮아요." };
  return { level: "g", head: "모두 괜찮아요", tip: o.sharing ? "송출자, 보는 사람, 서버 모두 제대로 돌아가고 있어요." : "지금 화면공유하는 사람은 없어요." };
}
