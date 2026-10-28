import { useLocalParticipant, useRoomContext } from "@livekit/components-react";
import { Room, RoomEvent, Track, TrackEvent, type LocalAudioTrack, type LocalTrackPublication, type Participant, type TrackPublication } from "livekit-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Knob } from "@/components/Knob";
import { captureMicrophone, checkMicrophone, microphoneChoices, microphoneLabel } from "@/lib/microphone";
import { useHoldMenu } from "./menu";
import { preparePhoneMicrophone } from "./phone-audio";

export function MicrophoneKnob() {
  const room = useRoomContext();
  const { localParticipant: me, isMicrophoneEnabled } = useLocalParticipant();
  const hold = useHoldMenu();
  const box = useRef<HTMLDialogElement>(null);
  const staged = useRef<LocalAudioTrack | null>(null);
  const preferred = useRef("");
  const turn = useRef(0);
  const working = useRef(false);
  const [busy, setBusy] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [chosen, setChosen] = useState("");
  const [message, setMessage] = useState("");

  const cancel = useCallback(() => {
    turn.current++;
    staged.current?.stop();
    staged.current = null;
    working.current = false;
    setBusy(false);
    if (!me.isMicrophoneEnabled) preparePhoneMicrophone(false);
  }, [me]);

  const explain = useCallback((e: unknown) => {
    const error = e as Error;
    const text = error.name === "NotAllowedError" ? "마이크 사용을 허용해 주세요."
      : ["NotFoundError", "OverconstrainedError"].includes(error.name) ? "고른 마이크가 연결되어 있지 않아요. 마이크 설정에서 다시 골라 주세요."
      : error.message.startsWith("고른 마이크") ? error.message : "마이크를 연결하지 못했어요. 마이크 설정에서 다시 연결해 주세요.";
    setMessage(text);
    alert(text);
  }, []);

  const publish = useCallback(async (track: LocalAudioTrack, ticket: number) => {
    if (ticket !== turn.current) { track.stop(); return; }
    // 보내는 중에도 취소·방장 끄기가 들어오면 새 마이크를 바로 끈다.
    staged.current = track;
    await me.publishTrack(track, { source: Track.Source.Microphone, stopMicTrackOnMute: true });
    if (ticket !== turn.current) {
      await me.unpublishTrack(track);
      track.stop();
    } else {
      setMessage("");
    }
    if (staged.current === track) staged.current = null;
  }, [me]);

  const start = useCallback(async (settings = false) => {
    if (working.current) return;
    const ticket = ++turn.current;
    working.current = true;
    setBusy(true);
    try {
      const old = me.getTrackPublication(Track.Source.Microphone)?.track;
      let track = old as LocalAudioTrack | undefined;
      if (!track || !me.isMicrophoneEnabled) {
        if (old) await me.unpublishTrack(old);
        if (ticket !== turn.current) return;
        preparePhoneMicrophone(true);
        track = await captureMicrophone();
        if (ticket !== turn.current) { track.stop(); return; }
        staged.current = track;
      }
      const list = microphoneChoices(await Room.getLocalDevices("audioinput", false));
      if (ticket !== turn.current) return;
      setDevices(list);
      const available = list.some((d) => d.deviceId === preferred.current);
      const actual = track.mediaStreamTrack.getSettings().deviceId;
      setChosen(available ? preferred.current : list.find((d) => d.deviceId === actual)?.deviceId ?? list[0]?.deviceId ?? "");
      if (settings || (preferred.current && !available) || (list.length > 1 && !available)) {
        if (preferred.current && !available) setMessage("이전에 고른 마이크가 보이지 않아요. 다시 골라 주세요.");
        box.current?.showModal();
      } else if (staged.current) {
        if (preferred.current && available) {
          track.stop();
          staged.current = null;
          track = await captureMicrophone(preferred.current);
          if (ticket !== turn.current) { track.stop(); return; }
          staged.current = track;
        }
        await publish(track, ticket);
      }
    } catch (e) {
      if (ticket === turn.current) { cancel(); explain(e); }
    } finally {
      if (ticket === turn.current) { working.current = false; setBusy(false); }
    }
  }, [me, cancel, explain, publish]);
  const openSettings = useCallback(() => void start(true), [start]);

  async function apply() {
    if (working.current) return;
    const ticket = ++turn.current;
    working.current = true;
    setBusy(true);
    try {
      staged.current?.stop();
      staged.current = null;
      const old = me.getTrackPublication(Track.Source.Microphone)?.track;
      if (old) await me.unpublishTrack(old);
      if (ticket !== turn.current) return;
      preparePhoneMicrophone(true);
      const track = await captureMicrophone(chosen);
      if (ticket !== turn.current) { track.stop(); return; }
      staged.current = track;
      preferred.current = chosen;
      await publish(track, ticket);
      if (ticket === turn.current) box.current?.close();
    } catch (e) {
      if (ticket === turn.current) { cancel(); explain(e); }
    } finally {
      if (ticket === turn.current) { working.current = false; setBusy(false); }
    }
  }

  useEffect(() => {
    const turns = turn;
    let timer: ReturnType<typeof setTimeout>;
    let lastRecovery = 0;
    const watched = new Set<LocalAudioTrack>();
    const verify = (track: LocalAudioTrack) => {
      if (me.getTrackPublication(Track.Source.Microphone)?.track !== track) return;
      try { checkMicrophone(track, preferred.current); }
      catch (e) { void track.mute(); explain(e); }
    };
    const watch = (pub: LocalTrackPublication) => {
      if (pub.source !== Track.Source.Microphone || !pub.track) return;
      const track = pub.track as LocalAudioTrack;
      watched.add(track);
      // 통화 도구가 끊긴 마이크를 복구한 뒤에도 고른 장치인지 확인한다.
      track.on(TrackEvent.Restarted, verify);
    };
    const unwatch = (pub: LocalTrackPublication) => {
      const track = pub.track as LocalAudioTrack | undefined;
      if (!track || !watched.delete(track)) return;
      track.off(TrackEvent.Restarted, verify);
    };
    const muted = (pub: TrackPublication, person: Participant) => {
      if (person === me && pub.source === Track.Source.Microphone) {
        cancel();
        box.current?.close();
      }
    };
    const devicesChanged = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const track = me.getTrackPublication(Track.Source.Microphone)?.track as LocalAudioTrack | undefined;
        if (!track || track.mediaStreamTrack.readyState === "ended" || !me.isMicrophoneEnabled || working.current || Date.now() - lastRecovery < 3000) return;
        lastRecovery = Date.now();
        working.current = true;
        const ticket = turn.current;
        try {
          preparePhoneMicrophone(true);
          await track.restartTrack(preferred.current ? { deviceId: { exact: preferred.current } } : {});
          // restartTrack는 꺼진 상태를 유지한다. 끄기가 들어왔으면 다시 켜지 않는다.
          if (ticket !== turn.current || track.isMuted) { await track.mute(); return; }
        } catch (e) {
          if (ticket === turn.current) { await track.mute(); explain(e); }
        } finally {
          if (ticket === turn.current) working.current = false;
        }
      }, 400);
    };
    const current = me.getTrackPublication(Track.Source.Microphone);
    if (current) watch(current);
    room.on(RoomEvent.LocalTrackPublished, watch).on(RoomEvent.LocalTrackUnpublished, unwatch).on(RoomEvent.TrackMuted, muted);
    navigator.mediaDevices?.addEventListener("devicechange", devicesChanged);
    return () => {
      clearTimeout(timer);
      turns.current++;
      staged.current?.stop();
      room.off(RoomEvent.LocalTrackPublished, watch).off(RoomEvent.LocalTrackUnpublished, unwatch).off(RoomEvent.TrackMuted, muted);
      watched.forEach((t) => t.off(TrackEvent.Restarted, verify));
      navigator.mediaDevices?.removeEventListener("devicechange", devicesChanged);
    };
  }, [room, me, cancel, explain]);

  // hold는 함수를 보관만 하고, 실제로 누르거나 꾹 눌렀을 때 부른다.
  // eslint-disable-next-line react-hooks/refs
  const holdHandlers = hold(openSettings);
  return <>
    <Knob compactMobile role="switch" aria-checked={isMicrophoneEnabled} aria-busy={busy}
      label="마이크" led={isMicrophoneEnabled ? "green" : "red"}
      title={message || "마이크 설정: 오른쪽 클릭 또는 꾹 누르기"}
      {...holdHandlers}
      onClick={() => {
        if (isMicrophoneEnabled || working.current || staged.current) {
          cancel();
          void me.setMicrophoneEnabled(false).catch(explain);
        } else void start();
      }}
      icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden className="size-[17px]">
        <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        {!isMicrophoneEnabled && <path className="md:hidden phone-land:block!" d="M20 4 4 20" stroke="#ffffff" strokeWidth="2.2" />}
      </svg>} />
    <dialog ref={box} onCancel={cancel} onClose={cancel} aria-labelledby="microphone-title"
      className="m-auto max-h-[92dvh] w-[350px] max-w-[calc(100%-2rem)] overflow-x-hidden overflow-y-auto rounded-[18px] border border-[#3d3b3a] bg-[#252526] p-7 text-[13px] break-words whitespace-normal text-[#d6d3cd] backdrop:bg-black/60">
      <form className="min-w-0" onSubmit={(e) => { e.preventDefault(); void apply(); }}>
        <p id="microphone-title" className="mb-5 text-center text-base font-semibold">마이크 설정</p>
        <p className="mb-3">{devices.length > 1 ? "사용할 마이크를 골라 주세요." : "브라우저가 알려 준 마이크입니다."}</p>
        {devices.length > 0 ? <select aria-label="사용할 마이크" value={chosen} onChange={(e) => setChosen(e.target.value)} disabled={busy} className="w-full min-w-0 max-w-full rounded-lg bg-zinc-800 p-3">
          {devices.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{microphoneLabel(d.label, i)}</option>)}
        </select> : <p>기본 마이크</p>}
        {message && <p role="status" className="mt-3 text-red-300">{message}</p>}
        <div className="mt-6 flex gap-3">
          <button type="button" onClick={() => box.current?.close()} className="flex-1 rounded-full border border-[#535154] p-2">닫기</button>
          <button disabled={busy} className="flex-1 rounded-full bg-[#b79b68] p-2 text-[#29231c] disabled:opacity-50">{isMicrophoneEnabled ? "다시 연결" : "마이크 켜기"}</button>
        </div>
      </form>
    </dialog>
  </>;
}
