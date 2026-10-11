export const DONATION_RETURN_KEY = "dolive-donation-return";
const ATTEMPT_KEY = "dolive-donation-connect-attempt";
export const DONATION_CONNECT_HREF = "/api/auth/dorms/donation/start?next=%2Froom";

// 보내기는 하지 않고 허용증만 다시 받는다. 허용 여부는 도름스가 확인한다.
export function rememberDonationReturn(room: string) {
  try {
    sessionStorage.setItem(DONATION_RETURN_KEY, room);
    sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify({ room, at: Date.now() }));
  } catch { /* 저장이 막혀도 직접 누른 연결 확인은 진행한다. */ }
}

export function restoreDonationConnection(reason: string, room: string) {
  if (!["connection_required", "permission_expired", "invalid_token"].includes(reason)) return false;
  try {
    const last = JSON.parse(sessionStorage.getItem(ATTEMPT_KEY) ?? "null");
    // 돌아왔는데 쿠키가 또 없으면 계속 왕복하지 않고 안내를 보여 준다.
    if (last?.room === room && Number.isFinite(last.at) && Date.now() - last.at < 600_000) return false;
    sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify({ room, at: Date.now() }));
    sessionStorage.setItem(DONATION_RETURN_KEY, room);
  } catch { return false; }
  // 허용 화면은 다른 사이트로 이어지므로 브라우저 전체 이동으로 처리한다.
  window.location.assign(new URL(DONATION_CONNECT_HREF, window.location.origin).href);
  return true;
}

export function donationReturning(room: string) {
  try { return sessionStorage.getItem(DONATION_RETURN_KEY) === room; }
  catch { return false; }
}

export function finishDonationConnection(room: string) {
  try {
    sessionStorage.removeItem(ATTEMPT_KEY);
    if (donationReturning(room)) sessionStorage.removeItem(DONATION_RETURN_KEY);
  } catch { /* 저장을 못 하는 브라우저에서도 도름스의 응답으로 사용 여부를 판단한다. */ }
}
