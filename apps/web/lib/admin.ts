const LOOPBACK = ["localhost", "127.0.0.1", "[::1]", "::1", "::ffff:127.0.0.1"];

// 방장 = 서버 PC에서 localhost로 직접 들어온 사람.
// Caddy를 거치면 X-Forwarded-For에 들어온 사람 IP가 붙어서, 바깥·공유기 안 다른 기기는 걸러진다.
export function isAdmin(req: Request) {
  const host = new URL(`http://${req.headers.get("host")}`).hostname;
  const forwarded = (req.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean);
  return LOOPBACK.includes(host) && forwarded.every((ip) => LOOPBACK.includes(ip));
}
