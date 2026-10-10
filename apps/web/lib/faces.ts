// 얼굴(카메라) 칸 크기 정하기 (app/room/stage.tsx). 시험: node tests/faces.cjs
// 칸은 세로로 긴 3:4 부터 가로로 긴 16:9 까지 늘었다 줄었다 하며 자리를 꽉 채운다. 영상(16:9)은 칸에 맞게 가운데를 잘라 보여 준다.
// 자리가 그보다 더 길쭉하면 칸을 그 비율에서 멈추고 남는 곳은 비운다 (얼굴이 너무 많이 잘리지 않게. 위아래는 절대 안 잘림)
export const TALL = 3 / 4;
export const WIDE = 16 / 9;

function fitCell(cw: number, ch: number) {
  if (cw <= 0 || ch <= 0) return { tw: 0, th: 0 };
  const a = cw / ch;
  if (a > WIDE) return { tw: ch * WIDE, th: ch };
  if (a < TALL) return { tw: cw, th: cw / TALL };
  return { tw: cw, th: ch };
}

// 바둑판: n 칸을 w x h 안에 가장 크게. 한 줄에 몇 칸씩 놓을지 다 해 보고 칸이 제일 큰 것을 고른다 (마지막 줄은 가운데로)
export function gridFit(n: number, w: number, h: number, gap: number) {
  let best = { cols: 1, tw: 0, th: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const c = fitCell((w - gap * (cols - 1)) / cols, (h - gap * (rows - 1)) / rows);
    if (c.tw * c.th > best.tw * best.th) best = { cols, ...c };
  }
  // 소수점 때문에 한 칸이 다음 줄로 밀리지 않게 내림
  return { cols: best.cols, tw: Math.floor(best.tw), th: Math.floor(best.th) };
}

// 한 줄(공유 화면 아래): 높이 h 에 n 칸을 나란히 꽉 채운다. 3:4 보다 좁아질 만큼 많으면 들어가는 만큼만 (shown)
export function rowFit(n: number, w: number, h: number, gap: number) {
  const shown = Math.max(1, Math.min(n, Math.floor((w + gap) / (h * TALL + gap))));
  return { shown, tw: Math.floor(Math.min(h * WIDE, (w - gap * (shown - 1)) / shown)) };
}

// 칸이 slots 개뿐인데 얼굴이 더 많으면 마지막 칸은 "+N명" (누르면 다음 얼굴들). page 는 몇 번 눌렀는지
export function pageOf<T>(list: T[], slots: number, page: number) {
  if (list.length <= slots) return { faces: list, more: 0 };
  const per = Math.max(1, slots - 1);
  const p = page % Math.ceil(list.length / per);
  const faces = list.slice(p * per, p * per + per);
  return { faces, more: list.length - faces.length };
}
