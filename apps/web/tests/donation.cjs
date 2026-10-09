// 실행: node tests/donation.cjs. 실제 회원·도름스 서버·잔액은 쓰지 않는다.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const jose = require("jose");
const { randomUUID, createHash } = require("node:crypto");
const { NextResponse } = require("next/server");
const sdk = require("livekit-server-sdk");
const env = { NODE_ENV: "test", DORMS_CLIENT_ID: randomUUID(), DORMS_SITE_URL: "https://test.example", DORMS_API_ORIGIN_DEV: "http://localhost:3999" };
const jar = new Map();
const h = new Headers({ origin: "https://test.example", "sec-fetch-site": "same-origin" });
let state = { approval: "approved", login: true, permission: true, balance: 10, daily: 3, donationValid: true, loseReply: false };
const subject = randomUUID(), recipient = randomUUID(), grants = randomUUID();
const saved = new Map();
const announcements = [];
const chatAnnouncements = [];
let privateKey, publicKey, nonce, signed, sends = 0, checks = 0, sharing = true, member = true, inRoom = true, host = false, owner = false, present = true;
const balances = () => ({ availableBalance: state.balance, dailyRemaining: state.daily, resetsAt: "2026-10-10T00:00:00+09:00" });
const fail = (reason, status) => Response.json({ reason }, { status });
async function provider(raw, init = {}) {
  const url = new URL(raw);
  assert.equal(url.origin, "http://localhost:3999");
  if (url.pathname.endsWith("/configuration")) return Response.json({ active: true, scopes: ["openid", "profile"], donations: { status: state.approval } });
  if (url.pathname === "/api/sso/token") return Response.json({ id_token: signed });
  if (url.pathname.endsWith("/userinfo")) {
    checks++;
    if (!state.login) return fail("authentication_required", 401);
    if (!state.permission) return fail("access_denied", 403);
    return Response.json({ sub: subject, name: "시험 회원", teacher_verified: true, dorms: 20 });
  }
  if (url.pathname.endsWith("/donations/token")) {
    assert.equal(init.headers.Authorization, `Bearer ${signed}`);
    return Response.json({ subject, donation_token: "test-only-donation-token-never-for-real", expires_in: 3600 });
  }
  if (url.pathname.endsWith("/revoke")) { state.donationValid = false; return Response.json({ ok: true }); }
  if (!state.donationValid) return fail("access_denied", 403);
  if (url.pathname.endsWith("/status")) return Response.json({ subject, ...balances() });
  if (url.pathname.endsWith("/send")) {
    sends++;
    assert.equal(init.method, "POST");
    const input = JSON.parse(init.body);
    const prior = saved.get(input.requestId);
    if (prior) {
      if (prior.input.recipientId !== input.recipientId || prior.input.amount !== input.amount) return fail("idempotency_conflict", 409);
      return Response.json(prior.result);
    }
    if (state.daily < input.amount) return fail("daily_limit_exceeded", 409);
    if (state.balance < input.amount) return fail("insufficient_balance", 409);
    state.daily -= input.amount; state.balance -= input.amount;
    const result = { transferId: randomUUID(), amount: input.amount, ...balances() };
    saved.set(input.requestId, { input, result });
    if (state.loseReply) { state.loseReply = false; throw new Error("시험용 연결 끊김"); }
    return Response.json(result);
  }
  throw new Error(`예상하지 않은 시험 요청: ${url.pathname}`);
}
function load(name, replacements = {}) {
  const source = fs.readFileSync(path.join(__dirname, "..", name), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: (n) => n === "server-only" ? {} : replacements[n] ?? require(n), process: { env }, fetch: provider, Request, Response, Headers, URL, Buffer, AbortSignal, TextEncoder, crypto, setTimeout }, { filename: name });
  return module.exports;
}
async function main() {
  ({ privateKey, publicKey } = await jose.generateKeyPair("EdDSA"));
  const next = { cookies: async () => ({ get: (name) => jar.has(name) ? { value: jar.get(name) } : undefined }), headers: async () => h };
  const login = load("lib/dormsLogin.ts", { "next/headers": next, jose: { ...jose, createRemoteJWKSet: () => async () => publicKey } });
  const begin = await login.beginDormsLogin("https://test.example/", "/room");
  const flow = login.parseFlowCookie(begin.cookie.value);
  nonce = flow.nonce;
  const now = Math.floor(Date.now() / 1000);
  signed = await new jose.SignJWT({ nonce, grant_version: grants }).setProtectedHeader({ alg: "EdDSA" }).setIssuer("https://dorms.school").setAudience(env.DORMS_CLIENT_ID).setSubject(subject).setIssuedAt(now).setExpirationTime(now + 3600).setJti(randomUUID()).sign(privateKey);
  const logged = await login.finishDormsLogin({ code: "test-code", verifier: flow.verifier, nonce, requestUrl: "https://test.example/" });
  jar.set(login.SESSION_COOKIE, logged.idToken);
  assert.equal((await login.getDormsUser()).id, subject);
  assert.equal(login.safeDormsNext("//elsewhere.example"), "/");
  const donation = load("lib/dormsDonation.ts", { "next/headers": next, "./dormsLogin": login });
  await assert.rejects(donation.getDonationStatus(), { reason: "consent_required" });
  const allow = await donation.beginDonation("https://test.example/", "/room");
  const donationFlow = JSON.parse(Buffer.from(allow.flow, "base64url"));
  assert.equal(new URL(allow.authorizeUrl).searchParams.get("code_challenge"), createHash("sha256").update(donationFlow.verifier).digest("base64url"));
  await assert.rejects(donation.finishDonation("https://test.example/", "code", "wrong", allow.flow), { reason: "authentication_required" });
  const allowed = await donation.finishDonation("https://test.example/", "code", donationFlow.state, allow.flow);
  jar.set(donation.DONATION_COOKIE, allowed.value);
  assert.equal(donation.donationCookieOptions(100).httpOnly, true);
  assert.equal((await donation.getDonationStatus()).dailyRemaining, 3);
  const participant = () => ({ sid: "PA_receiver", identity: "receiver", name: "시험 받는 사람", attributes: { dorms: member ? recipient : "", roomAdmin: host ? "1" : "" }, tracks: [{ source: sdk.TrackSource.SCREEN_SHARE, muted: !sharing }] });
  const server = { findRoom: () => ({ owner: owner ? recipient : "" }), rooms: { listParticipants: async () => present ? [participant()] : [], getParticipant: async () => participant(), sendData: async (_room, data, _kind, options) => (options.topic === "dolive-donation" ? announcements : chatAnnouncements).push(JSON.parse(new TextDecoder().decode(data))) }, publicUrl: () => "https://test.example/" };
  const targets = load("lib/donationTargets.ts", { "./server": server });
  const chat = load("lib/chat.ts", { "@/lib/dolive": load("lib/dolive.ts"), "@/lib/server": server, "./donationTargets": targets });
  // 서명 없는 공유 알림과 예전 입장 알림으로는 받을 자격을 만들 수 없다.
  env.LIVEKIT_API_KEY = "시험 통화 키"; env.LIVEKIT_API_SECRET = "test-only-livekit-secret-with-at-least-32-bytes";
  const webhook = load("app/api/livekit/route.ts", { "@/lib/server": server, "@/lib/donationTargets": targets, "@/lib/chat": { clearEmptyRoom: async (room) => { if (!present) targets.clearDonationTargets(room); } } });
  async function notify(event, authorized = true) {
    const body = JSON.stringify(event);
    const token = await new jose.SignJWT({ sha256: createHash("sha256").update(body).digest("base64") }).setProtectedHeader({ alg: "HS256" }).setIssuer(env.LIVEKIT_API_KEY).setExpirationTime("1m").sign(new TextEncoder().encode(env.LIVEKIT_API_SECRET));
    return webhook.POST(new Request("https://test.example/api/livekit", { method: "POST", headers: authorized ? { authorization: token } : {}, body }));
  }
  sharing = false;
  const event = { event: "track_published", room: { name: "알림 시험" }, participant: { sid: "PA_old", identity: "receiver" }, track: { source: "SCREEN_SHARE" } };
  assert.equal((await notify(event, false)).status, 401);
  assert.equal((await targets.donationTargets("알림 시험")).length, 0);
  assert.equal((await notify(event)).status, 204);
  assert.equal((await targets.donationTargets("알림 시험")).length, 0);
  event.participant.sid = "PA_receiver";
  assert.equal((await notify(event)).status, 204);
  assert.equal((await targets.donationTargets("알림 시험"))[0].shared, true);
  present = false;
  await notify({ event: "participant_left", room: { name: "알림 시험" } });
  assert.equal((await targets.donationTargets("알림 시험")).length, 0);
  present = true; sharing = true;
  const app = load("lib/donation.ts", { "./dormsLogin": login, "./dormsDonation": donation, "./donationTargets": targets, "./chat": { ...chat, whoSent: async () => inRoom ? ({ room: "시험 방송", who: { identity: "sender", name: "시험 보낸 사람" } }) : ({ deny: new Response(null, { status: 403 }) }) }, "./server": server });
  const req = new Request("https://test.example/api/auth/dorms/donation/send", { method: "POST", headers: h });
  const input = { recipientId: recipient, identity: "receiver", amount: 1, requestId: randomUUID() };
  const result = await app.donateToSharer(req, input);
  assert.equal(result.amount, 1); assert.equal(state.daily, 2);
  const notice = chat.chatOf("시험 방송")[0];
  assert.equal(notice.message, "시험 보낸 사람님이 시험 받는 사람님에게 1도름을 도름네이션 하셨습니다");
  assert.equal(notice.donation.amount, 1); assert.equal(notice.tts, undefined);
  assert.equal(chatAnnouncements.length, 1);
  assert.equal(await chat.edit("시험 방송", notice.id, "가짜 금액"), null);
  const duplicate = await app.donateToSharer(req, input);
  assert.equal(duplicate.transferId, result.transferId); assert.equal(state.balance, 9); assert.equal(announcements.length, 1);
  assert.equal(chat.chatOf("시험 방송").length, 1); assert.equal(chatAnnouncements.length, 1);
  await assert.rejects(app.donateToSharer(req, { ...input, amount: 2 }), { reason: "idempotency_conflict" });
  await assert.rejects(app.donateToSharer(req, { ...input, recipientId: subject, requestId: randomUUID() }), { reason: "self_donation" });
  await assert.rejects(app.donateToSharer(req, { ...input, amount: 4, requestId: randomUUID() }), { reason: "invalid_request" });
  sharing = false; present = false;
  // 공유를 끄고 나간 회원도 이 방송이 이어지는 동안 받을 수 있다.
  assert.equal((await app.donateToSharer(req, { ...input, requestId: randomUUID() })).amount, 1);
  assert.equal((await targets.donationTargets("다른 방송")).length, 0);
  targets.clearDonationTargets("시험 방송"); present = true; host = true;
  // 운영진 권한만으로는 받을 수 없다. 실제 방 주인은 받을 수 있다.
  await assert.rejects(app.donateToSharer(req, { ...input, requestId: randomUUID() }), { reason: "recipient_unavailable" });
  owner = true;
  assert.equal((await app.donateToSharer(req, { ...input, requestId: randomUUID() })).amount, 1);
  owner = false;
  await assert.rejects(app.donateToSharer(req, { ...input, requestId: randomUUID() }), { reason: "recipient_unavailable" });
  targets.clearDonationTargets("시험 방송"); sharing = true; member = false;
  await assert.rejects(app.donateToSharer(req, { ...input, requestId: randomUUID() }), { reason: "recipient_unavailable" });
  member = true; host = false;
  await assert.rejects(app.donateToSharer(req, { ...input, identity: "가짜 이름표", requestId: randomUUID() }), { reason: "recipient_unavailable" });
  inRoom = false;
  await assert.rejects(app.donateToSharer(req, { ...input, requestId: randomUUID() }), { reason: "access_denied" }); inRoom = true;
  state.daily = 3;
  assert.equal((await app.donateToSharer(req, { ...input, amount: 3, requestId: randomUUID() })).amount, 3);
  const beforeFailure = chat.chatOf("시험 방송").length;
  await assert.rejects(app.donateToSharer(req, { ...input, requestId: randomUUID() }), { reason: "daily_limit_exceeded" });
  assert.equal(chat.chatOf("시험 방송").length, beforeFailure);
  state.daily = 3; state.balance = 0;
  await assert.rejects(app.donateToSharer(req, { ...input, requestId: randomUUID() }), { reason: "insufficient_balance" });
  state.balance = 10; state.loseReply = true;
  const uncertain = { ...input, requestId: randomUUID() };
  const beforeUncertain = chat.chatOf("시험 방송").length;
  await assert.rejects(app.donateToSharer(req, uncertain), { reason: "temporarily_unavailable" });
  assert.equal(state.balance, 9);
  assert.equal(chat.chatOf("시험 방송").length, beforeUncertain);
  await app.donateToSharer(req, uncertain); assert.equal(state.balance, 9);
  assert.equal(chat.chatOf("시험 방송").length, beforeUncertain + 1);
  await app.donateToSharer(req, uncertain);
  assert.equal(chat.chatOf("시험 방송").length, beforeUncertain + 1);
  // 채팅이 비워진 새 방송에 옛 보내기의 알림을 다시 올리지 않는다.
  chat.dropRoom("시험 방송");
  await app.donateToSharer(req, uncertain);
  assert.equal(chat.chatOf("시험 방송").length, 0);
  state.permission = false;
  const previousSends = sends;
  await assert.rejects(app.donateToSharer(req, { ...input, requestId: randomUUID() }), { reason: "access_denied" });
  assert.equal(sends, previousSends); state.permission = true;
  h.set("origin", "https://bad.example");
  await assert.rejects(donation.sendDonation(input), { reason: "forbidden" }); h.set("origin", "https://test.example");
  const route = load("app/api/auth/dorms/donation/send/route.ts", { "@/lib/donation": app, "@/lib/server": server, "../../../../../../lib/dormsDonation": donation, "../../../../../../lib/dormsLogin": login });
  for (const [approval, reason] of [["none", "approval_required"], ["pending", "approval_pending"], ["suspended", "approval_suspended"]]) {
    state.approval = approval;
    const response = await route.POST(new Request(req.url, { method: "POST", headers: { origin: "https://test.example", "content-type": "application/json" }, body: JSON.stringify(input) }));
    assert.equal(response.status, 403); assert.equal((await response.json()).reason, reason);
  }
  state.approval = "approved";
  const credential = jar.get(donation.DONATION_COOKIE);
  const expired = JSON.parse(Buffer.from(credential, "base64url")); expired.expiresAt = 1;
  jar.set(donation.DONATION_COOKIE, Buffer.from(JSON.stringify(expired)).toString("base64url"));
  await assert.rejects(donation.getDonationStatus(), { reason: "permission_expired" });
  jar.set(donation.DONATION_COOKIE, credential);
  await donation.revokeDonation();
  await assert.rejects(donation.getDonationStatus(), { reason: "access_denied" });
  state.donationValid = true;
  const logout = load("app/api/auth/dorms/logout/route.ts", { "@/lib/server": server, "@/lib/dormsDonation": donation, "../../../../../lib/dormsLogin": login });
  const response = await logout.POST(req);
  assert.equal(response.status, 303);
  assert.equal(response.cookies.get(login.SESSION_COOKIE).value, "");
  assert.equal(response.cookies.get(donation.DONATION_COOKIE).value, "");
  jar.delete(login.SESSION_COOKIE);
  await assert.rejects(donation.sendDonation(input), { reason: "authentication_required" });
  assert.ok(checks > 10);
  console.log("가짜 도름스로 로그인·허용·1/3도름·중복·응답 끊김·승인·철회·잔액·한도·로그아웃 확인 통과");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
