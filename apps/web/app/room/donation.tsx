"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { DonationResult, DonationStatus } from "@/lib/dormsDonation";
import type { DonationRecipient } from "@/lib/donationTargets";
import { DONATION_CONNECT_HREF, finishDonationConnection, rememberDonationReturn, restoreDonationConnection } from "./donation-connection";

const messages: Record<string, string> = {
  approval_required: "도름네이션을 신청하고 승인을 받아야 사용할 수 있어요.",
  approval_pending: "도름네이션 승인을 기다리고 있어요.",
  approval_suspended: "도름네이션 사용이 중단되어 있어요.",
  authentication_required: "도름스로 로그인해 주세요.",
  consent_required: "처음 한 번 도름스에서 보내기를 허용해 주세요.",
  connection_required: "도름네이션 연결을 다시 확인해 주세요. 브라우저가 연결 기록을 저장하지 못했을 수 있어요.",
  invalid_token: "도름네이션 연결을 다시 확인해 주세요.",
  permission_expired: "도름네이션 연결을 다시 확인해 주세요.",
  access_denied: "허용이 취소되었거나 사용이 막혔어요. 도름스에서 확인해 주세요.",
  insufficient_dorms: "사용할 수 있는 도름이 부족해요.",
  insufficient_balance: "사용할 수 있는 도름이 부족해요.",
  daily_limit: "오늘 보낼 수 있는 도름을 다 썼어요.",
  daily_limit_exceeded: "오늘 보낼 수 있는 도름을 다 썼어요.",
  self_donation: "자신에게는 도름을 보낼 수 없어요.",
  recipient_unavailable: "이 방의 방 주인이나 화면공유를 했던 회원만 받을 수 있어요. 목록을 다시 확인해 주세요.",
  idempotency_conflict: "이전에 보낸 요청과 내용이 달라요. 새로 보내지 않고 확인을 멈췄어요.",
};
const pendingKey = "dolive-donation-pending";
type Pending = { requestId: string; recipientId: string; identity: string; name: string; amount: number; subject: string; room: string };
export type DonationTarget = { recipientId: string; identity: string; name: string; isSelf?: boolean };

export function DonationDialog({ token, room, target, close, success, isGuest = false, preview = false, previewCase = "normal" }: { token: string; room: string; target?: DonationTarget; close: () => void; success: (result: DonationResult) => void; isGuest?: boolean; preview?: boolean; previewCase?: "normal" | "empty" | "limit" | "consent" }) {
  const example = process.env.NODE_ENV === "development" && preview;
  const dialog = useRef<HTMLDialogElement>(null);
  const locked = useRef(false);
  const [status, setStatus] = useState<DonationStatus>();
  const [pending, setPending] = useState<Pending | null>(null);
  const [amount, setAmount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [targets, setTargets] = useState<DonationRecipient[]>();
  const [recipientId, setRecipientId] = useState("");
  const [targetMessage, setTargetMessage] = useState("");
  const [checking, setChecking] = useState(!isGuest);
  useEffect(() => {
    dialog.current?.showModal();
    if (isGuest) return;
    // 예시 화면은 실제 로그인·보내기·저장 기록에 손대지 않는다.
    if (example) {
      if (previewCase !== "consent") setStatus({ subject: "예시 보낸 사람", availableBalance: previewCase === "empty" ? 0 : 8, dailyRemaining: previewCase === "limit" ? 0 : 3, resetsAt: "예시" });
      if (target) {
        setTargets([{ ...target, owner: true, shared: false }, { recipientId: "예시 공유 회원", identity: "예시 공유 회원", name: "화면공유 회원", owner: false, shared: true }]);
        setRecipientId(target.recipientId);
      }
      setReason(previewCase === "consent" ? "consent_required" : "");
      setMessage(previewCase === "consent" ? messages.consent_required : "");
      const timer = setTimeout(() => setChecking(false), 1000);
      return () => clearTimeout(timer);
    }
    try { const saved = JSON.parse(sessionStorage.getItem(pendingKey) ?? "null"); if (saved?.requestId && saved?.subject) { setPending(saved); setAmount(saved.amount); } } catch { setMessage("이전 보내기 기록을 읽지 못했어요. 새로 보내지 말고 확인해 주세요."); setChecking(false); return; }
    let alive = true;
    fetch("/api/auth/dorms/donation/targets", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }).then(async (response) => {
      const body = await response.json();
      if (!alive) return;
      if (!response.ok || !Array.isArray(body)) { setTargetMessage("받는 사람 목록을 확인하지 못했어요. 창을 닫고 다시 열어 주세요."); return; }
      setTargets(body);
    }).catch(() => { if (alive) setTargetMessage("받는 사람 목록을 확인하지 못했어요. 창을 닫고 다시 열어 주세요."); });
    fetch("/api/auth/dorms/donation/status", { cache: "no-store" }).then(async (response) => {
      const body = await response.json();
      if (!alive) return;
      if (!response.ok) {
        if (restoreDonationConnection(body.reason, room)) return;
        setReason(body.reason); setMessage(messages[body.reason] ?? "도름스에 연결하지 못했어요. 잠시 뒤 다시 확인해 주세요.");
      }
      else { finishDonationConnection(room); setStatus(body); setMessage(""); }
    }).catch(() => { if (alive) setMessage("도름스에 연결하지 못했어요. 잠시 뒤 다시 확인해 주세요."); }).finally(() => { if (alive) setChecking(false); });
    return () => { alive = false; };
  }, []);
  const selected = pending ?? (example && target?.isSelf ? target : targets?.find((p) => p.recipientId === recipientId));
  const self = isGuest || (example && !pending && !!target?.isSelf) || (!!status && !!selected && status.subject === selected.recipientId);
  const another = pending && (pending.subject !== status?.subject || pending.room !== room);
  const dailyExhausted = !pending && !!status && status.dailyRemaining < 1;
  const balanceExhausted = !pending && !!status && status.availableBalance < 1;
  const exhaustedText = dailyExhausted ? "일일 도름 탕진" : balanceExhausted ? "도름 탕진" : "";
  // 결과가 불확실한 이전 보내기는 잔액이 줄었어도 같은 번호로 확인할 수 있어야 한다.
  const unavailable = dailyExhausted ? messages.daily_limit : !pending && status ? status.availableBalance < amount ? messages.insufficient_dorms : status.dailyRemaining < amount ? messages.daily_limit : "" : "";
  const info = isGuest ? "비회원은 도름네이션 기능이 제한됩니다" : another ? "이전 보내기의 계정과 방송으로 돌아가 결과를 확인해 주세요." : self ? messages.self_donation : unavailable || message;
  async function send() {
    if (locked.current || !status || !selected || self || another || unavailable) return;
    if (example) {
      if (amount > status.dailyRemaining) { setMessage(messages.daily_limit); return; }
      const result = { transferId: crypto.randomUUID(), amount, availableBalance: status.availableBalance - amount, dailyRemaining: status.dailyRemaining - amount, resetsAt: "예시" };
      setStatus({ ...status, ...result });
      setMessage(`${amount}도름 보내기 예시예요. 실제 도름은 보내지 않았어요.`);
      success(result);
      return;
    }
    locked.current = true; setBusy(true);
    try {
      const intent = pending ?? { ...selected, amount, subject: status.subject, room, requestId: crypto.randomUUID() };
      // 금액과 상대만 기억한다. 비밀인 보내기 권한은 저장하지 않는다.
      sessionStorage.setItem(pendingKey, JSON.stringify(intent));
      setPending(intent);
      const response = await fetch("/api/auth/dorms/donation/send", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(intent) });
      const result = await response.json();
      if (!response.ok) {
        setReason(result.reason);
        // 도름스가 보내지 않았다고 확정한 경우에만 다음 금액을 고를 수 있다.
        if (["insufficient_dorms", "insufficient_balance", "daily_limit", "daily_limit_exceeded", "self_donation", "invalid_request", "recipient_unavailable"].includes(result.reason)) {
          sessionStorage.removeItem(pendingKey); setPending(null);
        }
        setMessage(messages[result.reason] ?? "결과를 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요.");
        return;
      }
      if (typeof result.transferId !== "string" || result.amount !== intent.amount || typeof result.availableBalance !== "number" || !Number.isInteger(result.dailyRemaining)) throw new Error();
      sessionStorage.removeItem(pendingKey); setPending(null);
      setStatus({ subject: status.subject, availableBalance: result.availableBalance, dailyRemaining: result.dailyRemaining, resetsAt: result.resetsAt });
      setReason(""); setMessage(`${result.amount}도름을 보냈어요.`);
      success(result);
    } catch { setMessage("결과를 확인하지 못했어요. 다시 누르면 같은 요청으로 확인해요."); }
    finally { locked.current = false; setBusy(false); }
  }
  return createPortal(<dialog ref={dialog} onCancel={close} className="m-auto w-80 max-w-[calc(100%-32px)] rounded-xl border border-zinc-700 bg-zinc-800 p-5 text-zinc-200 backdrop:bg-black/70">
    {!checking && !isGuest && reason === "consent_required" ? <>
      <h2 className="mb-6 text-center font-bold">도름네이션 최초 권한 요청</h2>
      <div className="flex gap-4">
        <button type="button" onClick={close} className="dolive-button dolive-danger flex h-11 flex-1 items-center justify-center rounded-full border border-zinc-600 text-zinc-300 transition hover:bg-zinc-700/50 hover:text-white active:scale-95"><span className="dolive-button-cap">반려</span></button>
        {example ? <button type="button" className="dolive-button dolive-primary donation-send flex h-11 flex-1 items-center justify-center rounded-full font-semibold text-[#29231a]" onClick={() => { setStatus({ subject: "예시 보낸 사람", availableBalance: 8, dailyRemaining: 3, resetsAt: "예시" }); setReason(""); setMessage(""); }}><span className="dolive-button-cap">허용</span></button> : <a className="dolive-button dolive-primary donation-send flex h-11 flex-1 items-center justify-center rounded-full font-semibold text-[#29231a]" href={DONATION_CONNECT_HREF} onClick={() => rememberDonationReturn(room)}><span className="dolive-button-cap">허용</span></a>}
      </div>
    </> : <>
    <h2 className="mb-4 text-center font-bold">{selected && !self && !unavailable ? `${selected.name}님에게 도름네이션 해요!` : "도름네이션"}</h2>
    <div className="relative">
    {checking && <div role="status" aria-label="도름네이션 확인 중" className="absolute inset-0 flex items-center justify-center">
      <span aria-hidden className="size-8 animate-spin rounded-full border-2 border-zinc-600 border-t-[#ead39e]" />
    </div>}
    <div className={checking ? "invisible" : ""} inert={checking}>
    {!self && !pending && <label className="block text-sm text-zinc-400">
      받는 사람
      <select aria-label="받는 사람" value={recipientId} onChange={(e) => setRecipientId(e.target.value)} disabled={busy || !targets?.length} className="mt-2 w-full appearance-none rounded-lg border border-zinc-600 bg-zinc-900 bg-no-repeat py-2 pl-3 pr-8 text-zinc-200 focus:outline-none focus:ring-1 focus:ring-[#c9a65c]" style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='m2 4 4 4 4-4' fill='none' stroke='%23e4e4e7' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")", backgroundPosition: "right 10px center", backgroundSize: "12px 12px" }}>
        <option value="">{!targets ? "목록 확인 중…" : targets.length ? "받는 사람을 골라 주세요" : "받을 수 있는 사람이 없어요"}</option>
        {targets?.map((p) => <option key={p.recipientId} value={p.recipientId}>{p.name} · {p.owner ? p.shared ? "방 주인 · 화면공유" : "방 주인" : "화면공유"}</option>)}
      </select>
      {targetMessage && <span role="status" className="mt-2 block">{targetMessage}</span>}
    </label>}
    {!self && <div role="group" aria-label="보낼 도름" className="mt-6 flex items-center justify-between rounded-full bg-zinc-900/60 px-5 py-5 shadow-[inset_0_2px_5px_rgb(0_0_0/0.35)]">
      <button type="button" aria-label="금액 줄이기" disabled={!!exhaustedText || !!pending || busy || amount <= 1} onClick={() => setAmount((n) => Math.max(1, n - 1))} className="donation-step flex size-8 items-center justify-center rounded-full bg-zinc-700 text-xl text-zinc-200 disabled:opacity-40">−</button>
      <div aria-live="polite" className={`flex items-baseline gap-1.5 font-light text-[#ead39e] ${exhaustedText ? "whitespace-nowrap text-base" : "text-3xl"}`}>{exhaustedText || <><span className="[text-shadow:0_0_8px_rgb(232_196_121/0.35),0_0_20px_rgb(232_196_121/0.15)]">{amount}</span><span>도름</span></>}</div>
      <button type="button" aria-label="금액 늘리기" disabled={!!exhaustedText || !!pending || busy || amount >= 3} onClick={() => setAmount((n) => Math.min(3, n + 1))} className="donation-step flex size-8 items-center justify-center rounded-full bg-zinc-700 text-xl text-zinc-200 disabled:opacity-40">+</button>
    </div>}
    {info && !(dailyExhausted && info === messages.daily_limit) && !(balanceExhausted && info === messages.insufficient_dorms) && <p role="status" className="mt-6 mb-4 text-center text-sm text-zinc-400">{info}</p>}
    {pending && <p className="mb-3 text-xs text-zinc-400">이전 보내기 결과를 확인할 때까지 받는 사람과 금액은 바꿀 수 없어요.</p>}
    {reason === "authentication_required" && <a className="mb-3 block text-center text-amber-300" href="/api/auth/dorms/start?next=%2Froom">DoRms로 로그인</a>}
    {["connection_required", "invalid_token", "permission_expired"].includes(reason) && <a className="dolive-button dolive-primary donation-send mb-3 flex h-11 items-center justify-center rounded-full font-semibold text-[#29231a]" href={DONATION_CONNECT_HREF} onClick={() => rememberDonationReturn(room)}><span className="dolive-button-cap">연결 다시 확인</span></a>}
    {reason === "access_denied" && <a className="mb-3 block text-center text-amber-300" href="https://dorms.school/connect" target="_blank" rel="noopener noreferrer">도름스에서 연결 확인</a>}
    </div>
    </div>
    <div className="mt-6 flex gap-4">
      {!self && <button type="button" onClick={send} disabled={checking || busy || !status || !selected?.recipientId || !!self || !!another || !!unavailable} className="dolive-button dolive-primary donation-send flex h-11 flex-1 items-center justify-center rounded-full font-semibold text-[#29231a] disabled:opacity-40"><span className="dolive-button-cap text-white">{busy ? "확인 중…" : pending ? "결과 다시 확인" : "보내기"}</span></button>}
      <button type="button" onClick={close} className="dolive-button dolive-danger flex h-11 flex-1 items-center justify-center rounded-full border border-zinc-600 text-zinc-300 transition hover:bg-zinc-700/50 hover:text-white active:scale-95"><span className="dolive-button-cap">닫기</span></button>
    </div>
    </>}
  </dialog>, document.body);
}
