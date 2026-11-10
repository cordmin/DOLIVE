const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync('lib/statusCore.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const context = { exports: {} };
vm.runInNewContext(code, context);
const S = context.exports;
const MIN = 60_000;
const at = (iso) => Date.parse(iso);
const allOk = () => Object.fromEntries(S.COMP_IDS.map((c) => [c, 'ok']));
const noNotes = { incidents: [], maintenance: [] };

// 날짜는 한국 시간으로 나눈다
assert.equal(S.dayKey(at('2026-11-10T14:59:00Z')), '2026-11-10');
assert.equal(S.dayKey(at('2026-11-10T15:00:00Z')), '2026-11-11');
assert.equal(S.hhmm(at('2026-11-10T12:50:00Z')), '21:50');
assert.equal(S.dayLabel('2026-11-10'), '11월 10일 (화)');
assert.deepEqual([...S.lastDays(at('2026-11-10T12:00:00Z'), 3)], ['2026-11-08', '2026-11-09', '2026-11-10']);

// 받침에 맞는 조사
assert.equal(S.josa('웹 화면', '이', '가'), '웹 화면이');
assert.equal(S.josa('글 읽기', '이', '가'), '글 읽기가');
assert.equal(S.autoTitle(['tts'], 'minor'), '글 읽기가 느립니다');
assert.equal(S.autoTitle(['web', 'chat'], 'major'), '웹 화면, 채팅이 되지 않습니다');

// 한 번 실패로는 바꾸지 않고, 두 번 이어지면 바꾼다. 나아질 때도 두 번
{
  const s = S.emptySaved(0);
  const bad = { ...allOk(), tts: 'minor' };
  assert.equal(S.confirm(s, bad).tts, 'ok');
  assert.equal(S.confirm(s, bad).tts, 'minor');
  assert.equal(S.confirm(s, allOk()).tts, 'minor');
  assert.equal(S.confirm(s, allOk()).tts, 'ok');
}

// 자동 사건: 열고, 늘면 소식을 붙이고, 모두 정상이면 닫는다. 점검 중인 기능은 빼고 본다
{
  const s = S.emptySaved(0);
  const t0 = at('2026-11-10T12:05:00Z');
  S.trackAuto(s, { ...allOk(), tts: 'minor' }, t0, new Set());
  assert.equal(s.events.length, 1);
  assert.equal(s.events[0].title, '글 읽기가 느립니다');
  assert.equal(s.events[0].updates[0].state, '확인 중');
  S.trackAuto(s, { ...allOk(), tts: 'minor', web: 'major' }, t0 + 5 * MIN, new Set());
  assert.equal(s.events[0].impact, 'major');
  assert.equal(s.events[0].updates.length, 2);
  S.trackAuto(s, allOk(), t0 + 37 * MIN, new Set());
  assert.equal(s.events[0].end, t0 + 37 * MIN);
  assert.equal(s.events[0].updates[0].state, '해결');
  assert.match(s.events[0].updates[0].text, /37분/);
  S.trackAuto(s, { ...allOk(), web: 'major' }, t0 + 60 * MIN, new Set(['web']));
  assert.equal(s.events.length, 1); // 점검 중인 웹은 사건을 열지 않는다
}

// 웹이 꺼져 있던 시간: 3분 넘으면 웹 화면·채팅·글 읽기를 장애로 적고 사건을 남긴다. 점검 시간 안이면 점검으로
{
  const now = at('2026-11-10T12:30:00Z');
  const s = S.emptySaved(0);
  s.last = now - 10 * MIN;
  assert.equal(S.recordGap(s, now, noNotes), 9);
  const day = s.days['2026-11-10'];
  assert.equal(day.web[2], 9);
  assert.equal(day.chat[2], 9);
  assert.equal(day.voice, undefined); // 통화 서버는 따로 돌아서 적지 않는다
  assert.equal(s.events[0].title, '웹 서버가 멈춰 있었습니다');

  const m = S.emptySaved(0);
  m.last = now - 10 * MIN;
  const notes = { incidents: [], maintenance: [{ id: 'm', title: '서버 업데이트', comps: ['web', 'chat', 'tts'], start: now - 20 * MIN, end: now + 5 * MIN, text: '' }] };
  assert.equal(S.recordGap(m, now, notes), 0);
  assert.equal(m.days['2026-11-10'].web[3], 9);
  assert.equal(m.events.length, 0);

  const short = S.emptySaved(0);
  short.last = now - 2 * MIN;
  assert.equal(S.recordGap(short, now, noNotes), 0); // 업데이트로 다시 켜는 1~2분은 세지 않는다
}

// 운영자 메모: 틀린 JSON 은 알려 주고, 틀린 항목은 건너뛴다. 진행 중 사건과 점검 시간은 지금 상태에 반영한다
{
  assert.ok(S.parseNotes('{').error);
  assert.equal(S.parseNotes('').notes.incidents.length, 0);
  const { notes, error } = S.parseNotes(JSON.stringify({
    incidents: [
      { id: 'a', title: '글 읽기가 늦습니다', impact: 'minor', components: ['tts', 'nope'], updates: [{ at: '2026-11-10T21:05:00+09:00', state: '확인 중', text: '보고 있습니다.' }] },
      { title: '소식 없는 사건', impact: 'major', components: ['web'], updates: [] },
    ],
    maintenance: [
      { id: 'm', title: '서버 업데이트', components: ['web', 'chat'], start: '2026-11-13T04:00:00+09:00', end: '2026-11-13T04:20:00+09:00', text: '잠시 다시 켭니다.' },
      { title: '거꾸로 된 점검', components: ['web'], start: '2026-11-13T05:00:00+09:00', end: '2026-11-13T04:00:00+09:00' },
    ],
  }));
  assert.equal(error, undefined);
  assert.equal(notes.incidents.length, 1);
  assert.deepEqual([...notes.incidents[0].comps], ['tts']);
  assert.equal(notes.maintenance.length, 1);
  const now = at('2026-11-10T12:50:00Z');
  assert.equal(S.effective(allOk(), notes, now).tts, 'minor');
  assert.equal(S.effective(allOk(), notes, at('2026-11-12T19:10:00Z')).web, 'maint');
  assert.equal(S.effective({ ...allOk(), web: 'major' }, notes, at('2026-11-12T19:10:00Z')).web, 'maint');
}

// 가동률: (장애 분 + 느림 분 x 0.3) 을 기록한 분에서 뺀다. 점검은 빼지 않는다. 하루 막대 색
{
  assert.equal(S.dayLevel(undefined), 'none');
  assert.equal(S.dayLevel([1440, 0, 0, 0]), 'ok');
  assert.equal(S.dayLevel([1430, 10, 0, 0]), 'minor');
  assert.equal(S.dayLevel([1437, 0, 3, 0]), 'minor');
  assert.equal(S.dayLevel([1380, 0, 60, 0]), 'major');
  assert.equal(S.dayLevel([1420, 0, 0, 20]), 'maint');
  const now = at('2026-11-10T12:50:00Z');
  const s = S.emptySaved(at('2026-11-09T00:00:00Z'));
  s.last = now - MIN;
  s.days['2026-11-09'] = { web: [1440, 0, 0, 0] };
  s.days['2026-11-10'] = { web: [1320, 100, 20, 0] };
  const v = S.buildView(s, noNotes, now);
  const web = v.comps.find((c) => c.id === 'web');
  assert.equal(web.days.length, 90);
  assert.equal(web.days[88].lv, 'ok');
  assert.equal(web.days[89].lv, 'major');
  assert.equal(web.days[0].lv, 'none');
  assert.equal(web.up90, Math.floor((1 - 50 / 2880) * 10000) / 100); // 98.26
  assert.equal(v.comps.find((c) => c.id === 'voice').up90, null);
  assert.equal(v.lv, 'ok');
  assert.equal(v.stale, false);
  assert.equal(S.buildView({ ...s, last: now - 5 * MIN }, noNotes, now).lv, 'none'); // 점검이 멈추면 회색
}

// 진행 중·지난 사건과 예정 점검
{
  const now = at('2026-11-10T12:50:00Z');
  const s = S.emptySaved(at('2026-11-01T00:00:00Z'));
  s.last = now;
  s.auto = { ...allOk(), tts: 'minor' };
  S.trackAuto(s, { ...allOk(), share: 'minor' }, at('2026-11-03T13:10:00Z'), new Set());
  S.trackAuto(s, allOk(), at('2026-11-03T13:47:00Z'), new Set());
  S.trackAuto(s, { ...allOk(), tts: 'minor' }, at('2026-11-10T12:05:00Z'), new Set());
  const notes = { incidents: [], maintenance: [{ id: 'm', title: '서버 업데이트', comps: ['web', 'chat'], start: at('2026-11-12T19:00:00Z'), end: at('2026-11-12T19:20:00Z'), text: '' }] };
  const v = S.buildView(s, notes, now);
  assert.equal(v.lv, 'minor');
  assert.equal(v.text, '일부 기능이 느립니다');
  assert.equal(v.open.length, 1);
  assert.equal(v.open[0].title, '글 읽기가 느립니다');
  assert.equal(v.past.length, 10); // 기록을 시작한 11월 1일부터
  assert.equal(S.buildView({ ...s, since: at('2026-10-01T00:00:00Z') }, notes, now).past.length, 15);
  const nov3 = v.past.find((d) => d.key === '2026-11-03');
  assert.equal(nov3.items[0].title, '화면공유가 느립니다');
  assert.equal(nov3.items[0].span, '11월 3일 22:10 ~ 22:47 (37분)');
  assert.equal(v.planned.length, 1);
  assert.equal(v.planned[0].span, '11월 13일 (금) 04:00 ~ 04:20');
  assert.equal(v.planned[0].now, false);
}
