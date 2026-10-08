import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";
const names = ["안쪽으로 파인 선택판", "가벼운 선과 넓은 여백", "부드러운 둥근 버튼", "작고 단정한 설정판", "구역을 나눈 선택 카드", "동그란 기계 버튼"];
const voices = ["서연", "민준", "하은", "마왕"];
function Speaker() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="size-3.5" aria-hidden><path d="M11 5 6 9H3v6h3l5 4zM15 9a5 5 0 0 1 0 6M18 6a9 9 0 0 1 0 12" /></svg>;
}
export default function Concepts() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <main className="mx-auto w-full max-w-[1400px] p-8 text-[#d6d3cd]">
    <h1 className="text-xl font-semibold">TTS 설정 · 시안 6가지</h1>
    <p className="mt-2 mb-7 text-sm text-zinc-500">모양을 비교하는 예시입니다. 실제 설정은 바뀌지 않습니다.</p>
    <div className="grid grid-cols-1 gap-7 md:grid-cols-2 xl:grid-cols-3">{names.map((name, kind) => <section key={name}>
      <h2 className="mb-3 text-sm"><span className="mr-3 text-[#d1b77f]">{kind + 1}번</span>{name}</h2>
      <div className="flex h-[365px] items-center justify-center rounded-2xl bg-[#131314] p-5">
        <div className="tts-design w-full max-w-[350px]" data-kind={kind}>
          <h3>TTS 설정</h3>
          <div className="setting-section"><h4>TTS 입력 방식</h4><div className="modes">{["끄기", "항상", "/입력"].map((mode, i) => <label key={mode}><input type="radio" name={`mode-${kind}`} defaultChecked={i === 2} /><span>{kind === 5 && <i />}{mode}</span></label>)}</div></div>
          <div className="setting-section"><h4>TTS 음성 종류</h4><div className="voices">{voices.map((voice, i) => <label key={voice}><input type="radio" name={`voice-${kind}`} defaultChecked={i === 0} /><span><b>{voice}</b><Speaker /></span></label>)}</div></div>
          <div className="actions"><span className="cancel">취소</span><span className="save">저장</span></div>
        </div>
      </div>
    </section>)}</div>
    <style>{`
      .tts-design { --accent:#d1b77f; padding:22px; border:1px solid #3d3b3a; border-radius:18px; background:#252526; font-size:13px; }
      .tts-design h3 {margin:0 0 23px;text-align:center;font-size:16px;font-weight:600;}
      .tts-design h4 {margin:0 0 10px;color:#9f9b95;font-size:11px;font-weight:500;}
      .tts-design .setting-section + .setting-section {margin-top:20px;}
      .tts-design .modes {display:grid;grid-template-columns:repeat(3,1fr);gap:4px;padding:4px;background:#19191b;border-radius:13px;box-shadow:inset 0 2px 5px #0006;}
      .tts-design label {cursor:pointer;min-width:0;}
      .tts-design input {position:absolute;opacity:0;width:1px;height:1px;}
      .tts-design label span {display:flex;align-items:center;justify-content:center;min-height:34px;border:1px solid transparent;border-radius:10px;color:#99969a;transition:background .15s,color .15s;}
      .tts-design input:checked + span {background:#393631;color:var(--accent);border-color:#75664b;}
      .tts-design input:focus-visible + span {outline:2px solid var(--accent);outline-offset:2px;}
      .tts-design label:hover span {color:#e4e0da;}
      .tts-design .voices {display:grid;grid-template-columns:repeat(2,1fr);gap:7px;}
      .tts-design .voices span {justify-content:space-between;padding:0 12px;min-height:38px;background:#2e2e30;}
      .tts-design b {font-weight:500;}
      .tts-design svg {opacity:.65;}
      .tts-design .actions {display:flex;gap:10px;margin-top:24px;}
      .tts-design .actions span {display:grid;place-items:center;height:37px;border-radius:999px;}
      .tts-design .cancel {flex:1;border:1px solid #535154;color:#b5b0aa;}
      .tts-design .save {flex:2;background:linear-gradient(#d6bd8d,#b79b68);color:#29231c;font-weight:600;box-shadow:inset 0 1px 0 #fff5;}
      .tts-design[data-kind="1"] {background:#202022;border-radius:12px;border-color:#373739;padding:25px;}
      .tts-design[data-kind="1"] h3 {text-align:left;}
      .tts-design[data-kind="1"] .modes {background:none;box-shadow:none;padding:0;border-bottom:1px solid #414145;border-radius:0;}
      .tts-design[data-kind="1"] .modes span {border-radius:0;border:none;background:none;}
      .tts-design[data-kind="1"] .modes input:checked + span {border-bottom:2px solid var(--accent);}
      .tts-design[data-kind="1"] .voices {gap:0 20px;}
      .tts-design[data-kind="1"] .voices span {background:none;border:none;border-bottom:1px solid #38383b;border-radius:0;padding:0 2px;}
      .tts-design[data-kind="1"] .voices input:checked + span b:before {content:'·';margin-right:7px;color:var(--accent);}
      .tts-design[data-kind="1"] .save {background:none;color:var(--accent);border:1px solid #857351;box-shadow:none;}
      .tts-design[data-kind="2"] {--accent:#a9d3c0;border-radius:26px;background:#242a28;border-color:#3d4943;}
      .tts-design[data-kind="2"] .modes {background:#19211e;}
      .tts-design[data-kind="2"] label span {border-radius:999px;}
      .tts-design[data-kind="2"] .voices span {background:#2e3732;}
      .tts-design[data-kind="2"] input:checked + span {background:#34473b;border-color:#587463;}
      .tts-design[data-kind="2"] .save {background:linear-gradient(#b1d5bd,#84b498);}
      .tts-design[data-kind="3"] {--accent:#c5b7ec;background:#252428;border-radius:10px;}
      .tts-design[data-kind="3"] h3 {text-align:left;margin-bottom:18px;}
      .tts-design[data-kind="3"] .modes {box-shadow:none;border-radius:7px;}
      .tts-design[data-kind="3"] label span {border-radius:5px;min-height:29px;}
      .tts-design[data-kind="3"] .voices {gap:1px;padding:1px;background:#424048;border-radius:7px;overflow:hidden;}
      .tts-design[data-kind="3"] .voices span {background:#29282d;border-radius:0;border:none;min-height:42px;}
      .tts-design[data-kind="3"] input:checked + span {background:#3c364a;border-color:#6e6186;}
      .tts-design[data-kind="3"] .actions span {border-radius:7px;}
      .tts-design[data-kind="3"] .save {background:linear-gradient(#b3a0d8,#8b77b2);}
      .tts-design[data-kind="4"] {background:#222223;padding:18px;border-radius:18px;}
      .tts-design[data-kind="4"] .setting-section {background:#2b2b2d;padding:12px;border-radius:12px;border:1px solid #39393c;}
      .tts-design[data-kind="4"] .setting-section + .setting-section {margin-top:10px;}
      .tts-design[data-kind="4"] h3 {margin-bottom:17px;}
      .tts-design[data-kind="4"] .voices span {background:#252527;}
      .tts-design[data-kind="4"] .voices input:checked + span {background:#393631;}
      .tts-design[data-kind="4"] .actions {margin-top:17px;}
      .tts-design[data-kind="5"] {background:linear-gradient(#2a2a2b,#202021);border-radius:16px;box-shadow:inset 0 1px 0 #fff1,0 8px 20px #0004;}
      .tts-design[data-kind="5"] .modes {background:none;box-shadow:none;padding:0;gap:12px;}
      .tts-design[data-kind="5"] .modes span {flex-direction:column;gap:7px;border:none;background:none;font-size:11px;}
      .tts-design[data-kind="5"] i {display:block;width:35px;height:35px;border-radius:50%;background:radial-gradient(circle at 50% 25%,#464646,#19191b 70%);box-shadow:inset 0 1px 0 #fff3,0 0 0 1px #090909,0 0 0 3px #333;}
      .tts-design[data-kind="5"] input:checked + span i {outline:1px solid #d1b77faa;box-shadow:inset 0 1px 0 #fff3,0 0 8px #d1b77f33;}
      .tts-design[data-kind="5"] .voices {background:#171719;padding:4px;border-radius:12px;box-shadow:inset 0 2px 5px #0007;}
      .tts-design[data-kind="5"] .voices span {background:none;min-height:31px;}
      .tts-design[data-kind="5"] .voices input:checked + span {background:#33312e;border-color:#554d3e;}
    `}</style>
  </main>;
}
