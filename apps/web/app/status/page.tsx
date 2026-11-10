import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { statusView } from "@/lib/status";
import { dayLabel, LONG, type DayView, type IncView } from "@/lib/statusCore";
import { StatusLive } from "./live";
import "./status.css";

// dolive.site/status: 기능별 지금 상태, 지난 90일 막대, 진행 중·지난 사건, 예정 점검 (Statuspage 모양, 시안 01).
// 점검과 기록은 lib/status.ts, 계산은 lib/statusCore.ts. 화면은 1분마다 새로 받는다 (./live.tsx)
export const metadata: Metadata = {
  title: "DOLIVE 상태",
  description: "DOLIVE 기능별 지금 상태와 지난 90일 기록",
};

function dayTip(d: DayView) {
  const lines = [dayLabel(d.key), d.lv === "none" ? "기록 없음" : `${LONG[d.lv]}${d.up === null ? "" : ` · ${d.up}%`}`];
  if (d.mins) {
    const parts = [["장애", d.mins[2]], ["느림", d.mins[1]], ["점검", d.mins[3]]].filter(([, m]) => +m > 0).map(([t, m]) => `${t} ${m}분`);
    if (parts.length) lines.push(parts.join(" · "));
  }
  return [...lines, ...d.titles].join("\n");
}

function Incident({ i, wide }: { i: IncView; wide?: boolean }) {
  return wide ? (
    <section className={`st-inc lv-${i.impact}`}>
      <h3>{i.title}</h3>
      <p className="st-inc-meta">{i.comps} · {i.span}{i.auto ? " · 자동 점검" : ""}</p>
      {i.updates.map((u, n) => (
        <div className="st-upd" key={n}>
          <b>{u.state}</b>
          <p>{u.text}</p>
          <time>{u.at}</time>
        </div>
      ))}
    </section>
  ) : (
    <div className={`st-past-item lv-${i.impact}`}>
      <strong>{i.title}</strong>
      <p><b>{i.updates[0]?.state}</b> · {i.updates[0]?.text}</p>
      <small>{i.span}{i.auto ? " · 자동 점검" : ""}</small>
    </div>
  );
}

export default async function StatusPage() {
  await connection();
  const v = statusView();
  return (
    <div className="st">
      <StatusLive />
      <div className="st-in">
        <header className="st-head">
          <Link href="/" className="st-logo" aria-label="DOLIVE 입장 화면으로">
            <span>DO<span>LIVE</span></span>
            <em>상태</em>
          </Link>
          <Link href="/" className="st-back">방송 보러 가기</Link>
        </header>

        <div className={`st-banner lv-${v.lv}`} role="status">
          <span>{v.text}</span>
          <small>{v.checked ? `${v.checked} 확인` : "아직 확인 전"}</small>
        </div>

        {v.open.map((i) => <Incident key={i.id} i={i} wide />)}

        {v.planned.filter((p) => p.now).map((p) => (
          <section key={p.title + p.span} className="st-inc lv-maint">
            <h3>{p.title}</h3>
            <p className="st-inc-meta">{p.comps} · {p.span}</p>
            {p.text && <div className="st-upd"><b>점검 중</b><p>{p.text}</p></div>}
          </section>
        ))}

        <section className="st-box" aria-label="기능별 상태">
          {v.comps.map((c) => (
            <div className="st-row" key={c.id}>
              <div className="st-row-head">
                <span className="st-name">
                  {c.name}
                  <i className="st-q" tabIndex={0} data-tip={c.desc}>?</i>
                </span>
                <span className={`st-now t-${v.stale ? "none" : c.lv}`}>{v.stale ? "확인 못 함" : LONG[c.lv]}</span>
              </div>
              <div className="st-bars">
                {c.days.map((d) => <span key={d.key} className={`st-bar lv-${d.lv}`} data-tip={dayTip(d)} />)}
              </div>
              <div className="st-legend">
                <span className="l90">90일 전</span>
                <span className="l30">30일 전</span>
                <span className="st-line" />
                <span className="l90">{c.up90 === null ? "기록 없음" : `${c.up90}% 가동`}</span>
                <span className="l30">{c.up30 === null ? "기록 없음" : `${c.up30}% 가동`}</span>
                <span className="st-line" />
                <span>오늘</span>
              </div>
            </div>
          ))}
        </section>

        {v.planned.some((p) => !p.now) && (
          <section className="st-sec">
            <h2>예정된 점검</h2>
            {v.planned.filter((p) => !p.now).map((p) => (
              <div className="st-plan" key={p.title + p.span}>
                <b>{p.title}</b>
                {p.text && <p>{p.text}</p>}
                <span>{p.span}{p.comps && ` · ${p.comps}`}</span>
              </div>
            ))}
          </section>
        )}

        <section className="st-sec">
          <h2>지난 사건</h2>
          {v.past.map((d, n) => (
            <div className="st-day" key={d.key}>
              <strong>{d.label}</strong>
              {d.items.length ? d.items.map((i) => <Incident key={i.id} i={i} />) : <p>{n === 0 && v.open.length ? "위의 진행 중인 사건 말고는 없습니다." : "보고된 문제가 없습니다."}</p>}
            </div>
          ))}
        </section>

        <footer className="st-foot">
          <p>1분마다 자동으로 점검합니다. 가동률은 장애 시간 전체와 느린 시간의 30%를 뺀 값이고, 점검 시간은 빼지 않습니다. 기록은 {v.since}부터 있습니다.</p>
          <Link href="/">dolive.site로 가기</Link>
        </footer>
      </div>
    </div>
  );
}
