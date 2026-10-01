import { createHash, timingSafeEqual } from "node:crypto";
import { LOGIN_COOKIE, LOGIN_SECONDS, isLocal, loginKey, logins, logout } from "@/lib/server";

// 다른 컴퓨터에서 부방장(운영진) 로그인. 부방장도 방장과 똑같은 일을 할 수 있다 (입장 화면 오른쪽 위, app/page.tsx). 로그인 목록은 lib/server.ts 의 logins (서버 메모리)

const hash = (s: string) => createHash("sha256").update(s).digest();
const cookie = (value: string, maxAge: number) =>
  `${LOGIN_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

// 서버 PC인지(입장 화면의 [전체기기 로그아웃]을 보일지)와 그때 로그인된 부방장 기기 수, 부방장으로 로그인돼 있는지
export function GET(req: Request) {
  const local = isLocal(req);
  const count = local ? [...logins.values()].filter((l) => Date.now() - l.since <= LOGIN_SECONDS * 1000).length : 0;
  return Response.json({ local, count, loggedIn: !!loginKey(req) });
}

// 비밀번호로 로그인
export async function POST(req: Request) {
  const { password } = await req.json().catch(() => ({}));
  const real = process.env.DOLIVE_ADMIN_PASSWORD;
  if (!real || typeof password !== "string" || !timingSafeEqual(hash(password), hash(real))) {
    return Response.json({ error: "비밀번호가 틀렸어요." }, { status: 401 });
  }
  const key = crypto.randomUUID();
  logins.set(key, { since: Date.now(), identities: [] });
  return Response.json({ ok: true }, { headers: { "Set-Cookie": cookie(key, LOGIN_SECONDS) } });
}

// 로그아웃. 서버 PC에서 부르면 부방장 전부를 로그아웃시킨다 (방에 있던 부방장도 내보낸다)
export async function DELETE(req: Request) {
  if (isLocal(req)) {
    await Promise.all([...logins.keys()].map(logout));
    return new Response(null, { status: 204 });
  }
  const key = loginKey(req);
  if (key) await logout(key);
  return new Response(null, { status: 204, headers: { "Set-Cookie": cookie("", 0) } });
}
