// node tests/share-view.cjs (서버 없이 공유 안내와 채팅 보기 전환 확인)
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const source = ts.createSourceFile("stage.tsx", fs.readFileSync(path.join(__dirname, "..", "app", "room", "stage.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ["Stage", "ShareNotice", "SplitTop"];
const code = source.statements.filter((s) => ts.isFunctionDeclaration(s) && names.includes(s.name?.text)).map((s) => s.getText(source)).join("\n");
const js = ts.transpileModule(code, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS } }).outputText;
let states = [], cursor = 0, saved = null, effects = [], cams = [];
const useState = (initial) => {
  const i = cursor++;
  if (!(i in states)) states[i] = typeof initial === "function" ? initial() : initial;
  return [states[i], (value) => states[i] = value];
};
const hooks = new Function("React", "useState", "useRef", "useEffect", "useCams", "useRoomTick", "useLocalParticipant", "localStorage", "SPLIT_KEY", "ScreenView", "FaceOverlay", "FaceRow", "FaceGrid", "Floats", "VideoTrack", "Face", `const exports = {}; ${js}\nreturn { Stage, ShareNotice, SplitTop };`)(
  React, useState, () => ({ current: null }), (effect) => effects.push(effect), () => cams, () => {}, () => ({ localParticipant: { attributes: {} } }),
  { getItem: () => saved, setItem: (_, value) => saved = value }, "dolive-split-view",
  "ScreenView", "FaceOverlay", "FaceRow", "FaceGrid", "Floats", "VideoTrack", "Face",
);
function render(name, props = {}) { cursor = 0; effects = []; return hooks[name](props); }
function nodes(root) {
  if (!root || typeof root !== "object") return [];
  return [root, ...React.Children.toArray(root.props?.children).flatMap(nodes)];
}
const find = (tree, type) => nodes(tree).filter((n) => n.type === type);
const textContent = (node) => typeof node === "string" || typeof node === "number" ? String(node) : React.Children.toArray(node?.props?.children).map(textContent).join("");
const button = (tree, text) => find(tree, "button").find((n) => textContent(n).trim() === text);

(async () => {
  const hostCam = { participant: { identity: "방장", attributes: { camPos: "br" }, permissions: { canPublishSources: [1, 2, 3] } } };
  const guestCam = { participant: { identity: "참여자", attributes: { camPos: "row" } } };
  cams = [hostCam, guestCam];
  let tree = render("Stage", { floats: [], confirmShare: async () => true });
  assert.equal(find(tree, "FaceGrid")[0].props.cams, cams);
  assert.equal(find(tree, "FaceRow").length, 0);
  assert.equal(textContent(tree).includes("방송 준비 중"), false);
  tree = render("Stage", { screen: { participant: hostCam.participant, publication: { trackSid: "방장 공유" } }, floats: [], confirmShare: async () => true });
  assert.equal(find(tree, "ScreenView")[0].props.face, hostCam);
  assert.deepEqual(find(tree, "FaceRow")[0].props.cams, [guestCam]);
  assert.equal(find(tree, "FaceGrid").length, 0);
  tree = render("Stage", { floats: [], confirmShare: async () => true });
  assert.equal(find(tree, "FaceGrid")[0].props.cams, cams); // 공유를 끝내면 모두 바둑판으로 복귀
  cams = [];
  assert.ok(textContent(render("Stage", { floats: [], confirmShare: async () => true })).includes("방송 준비 중"));
  states = [];
  const local = { participant: { isLocal: true }, publication: { trackSid: "공유1" } };
  tree = render("Stage", { screen: local, floats: [], confirmShare: async () => true });
  assert.equal(find(tree, "ScreenView").length, 1); // 내 공유 영상도 표시
  let notice = nodes(tree).find((n) => n.type === hooks.ShareNotice);
  assert.ok(notice);
  notice.props.close();
  tree = render("Stage", { screen: local, floats: [], confirmShare: async () => true });
  assert.equal(nodes(tree).some((n) => n.type === hooks.ShareNotice), false);
  assert.equal(find(tree, "ScreenView").length, 1);
  tree = render("Stage", { screen: { ...local, publication: { trackSid: "공유2" } }, floats: [], confirmShare: async () => true });
  assert.ok(nodes(tree).some((n) => n.type === hooks.ShareNotice));
  tree = render("Stage", { screen: { ...local, participant: { isLocal: false } }, floats: [], confirmShare: async () => true });
  assert.equal(nodes(tree).some((n) => n.type === hooks.ShareNotice), false); // 시청자에게는 안내를 띄우지 않는다

  states = [];
  let opened = 0, closed = 0;
  tree = render("ShareNotice", { confirm: async () => { opened++; return true; }, close: () => closed++ });
  const dialog = find(tree, "dialog")[0];
  assert.equal(dialog.props["aria-modal"], "true");
  assert.equal(find(tree, "button").length, 1); // 확인 이외에는 닫을 길을 두지 않는다
  let modalOpened = 0, modalClosed = 0, focused = 0, prevented = false;
  dialog.props.ref.current = { showModal: () => modalOpened++, close: () => modalClosed++ };
  button(tree, "닫기").props.ref.current = { focus: () => focused++ };
  const cleanup = effects[0]();
  assert.equal(modalOpened, 1); // 브라우저가 다른 버튼과 키보드 이동을 막는 방식으로 연다
  assert.equal(focused, 1);
  dialog.props.onCancel({ preventDefault: () => prevented = true });
  assert.equal(prevented, true); // Esc로 확인을 건너뛰지 못한다
  assert.ok(textContent(tree).includes("DOLIVE 브라우저를 최소화하고, 연수를 시작하세요"));
  cleanup();
  assert.equal(modalClosed, 1);
  const done = button(tree, "닫기").props.onClick();
  assert.equal(opened, 1); // 클릭 중 바로 작은 창을 요청한다
  await done;
  assert.equal(closed, 1);
  states = [];
  tree = render("ShareNotice", { confirm: async () => false, close: () => closed++ });
  await button(tree, "닫기").props.onClick();
  assert.equal(closed, 1); // 창을 못 열면 안내를 남겨 다시 누를 수 있게
  assert.equal(states[0], false);

  states = [];
  tree = render("SplitTop");
  assert.equal(button(tree, "내 얼굴").props["aria-pressed"], true);
  button(tree, "공유 화면").props.onClick();
  tree = render("SplitTop", { screen: local });
  assert.equal(find(tree, "VideoTrack").length, 1);
  button(tree, "채팅만").props.onClick();
  tree = render("SplitTop", { screen: local });
  assert.equal(find(tree, "VideoTrack").length, 0);
  assert.equal(find(tree, "button").length, 3);
  assert.equal(button(tree, "채팅만").props["aria-pressed"], true);
  button(tree, "내 얼굴").props.onClick();
  tree = render("SplitTop", { screen: local });
  assert.equal(button(tree, "내 얼굴").props["aria-pressed"], true);
  states = []; saved = "chat";
  assert.equal(button(render("SplitTop"), "채팅만").props["aria-pressed"], true);
  console.log("통과: 내 공유 화면, 시작 안내와 다시 공유, 확인으로 채팅 분리, 실패 후 재시도, 세 가지 보기 전환");
})().catch((e) => { console.error(e); process.exitCode = 1; });
