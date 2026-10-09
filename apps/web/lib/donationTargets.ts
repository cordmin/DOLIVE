import "server-only";
import { TrackSource, type ParticipantInfo } from "livekit-server-sdk";
import { findRoom, rooms } from "./server";

export type DonationRecipient = { recipientId: string; identity: string; name: string; shared: boolean; owner: boolean };
type Record = Omit<DonationRecipient, "owner">;
const g = globalThis as unknown as { doliveDonationTargets?: Map<string, Map<string, Record>> };
const history = (g.doliveDonationTargets ??= new Map<string, Map<string, Record>>());

// 통화 서버가 확인한 회원만 기억한다. 닉네임이 같아도 도름스 회원 번호로 구분한다.
export function rememberDonationParticipant(room: string, p: ParticipantInfo, shared = false) {
  const recipientId = p.attributes?.dorms;
  if (!recipientId) return;
  const list = history.get(room) ?? new Map<string, Record>();
  const prior = list.get(recipientId);
  shared ||= !!prior?.shared || p.tracks.some((t) => t.source === TrackSource.SCREEN_SHARE && !t.muted);
  if (!shared && findRoom(room)?.owner !== recipientId) return;
  list.set(recipientId, { recipientId, identity: p.identity, name: p.name || prior?.name || p.identity, shared });
  history.set(room, list);
}

export const clearDonationTargets = (room: string) => history.delete(room);

export async function donationTargets(room: string): Promise<DonationRecipient[]> {
  for (const p of await rooms.listParticipants(room)) rememberDonationParticipant(room, p);
  const owner = findRoom(room)?.owner;
  return [...(history.get(room)?.values() ?? [])]
    .filter((p) => p.shared || p.recipientId === owner)
    .map((p) => ({ ...p, owner: p.recipientId === owner }))
    .sort((a, b) => Number(b.owner) - Number(a.owner));
}
