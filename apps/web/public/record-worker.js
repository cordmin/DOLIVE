/* global VideoFrame, OffscreenCanvas, self */
// 다른 창에서 작업해도 녹화 그림이 멈추지 않게, 공유 영상의 새 그림이 올 때마다 합친다.
let face;
let faceReader;
let faceVersion = 0;
let position = { pos: "br", circle: false, mirror: false, width: 0.22 };

async function readFace(readable) {
  const version = ++faceVersion;
  const previous = faceReader;
  faceReader = undefined;
  await previous?.cancel().catch(() => {});
  if (version !== faceVersion) { await readable?.cancel().catch(() => {}); return; }
  face?.close(); face = undefined;
  if (!readable) return;
  const reader = readable.getReader();
  faceReader = reader;
  try {
    while (version === faceVersion) {
      const { value, done } = await reader.read();
      if (done) break;
      if (version !== faceVersion) { value.close(); break; }
      face?.close(); face = value;
    }
  } finally { reader.releaseLock(); }
}

async function draw({ readable, writable, width, height }) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { alpha: false });
  const reader = readable.getReader();
  const writer = writable.getWriter();
  let last = -Infinity;
  try {
    while (true) {
      const { value: screen, done } = await reader.read();
      if (done) break;
      try {
        if (screen.timestamp - last < 32_000) continue;
        last = screen.timestamp;
        const scale = Math.min(width / screen.displayWidth, height / screen.displayHeight);
        const sw = screen.displayWidth * scale, sh = screen.displayHeight * scale;
        const sx = (width - sw) / 2, sy = (height - sh) / 2;
        ctx.fillStyle = "black"; ctx.fillRect(0, 0, width, height);
        ctx.drawImage(screen, sx, sy, sw, sh);
        if (face) {
          const p = position;
          const fw = sw * p.width, fh = p.circle ? fw : fw * 9 / 16;
          const x = p.pos === "tl" || p.pos === "bl" ? sx + sw * 0.02 : sx + sw * 0.98 - fw;
          const y = p.pos === "tl" || p.pos === "tr" ? sy + sh * 0.02 : sy + sh * 0.98 - fh;
          ctx.save();
          ctx.beginPath();
          if (p.circle) ctx.arc(x + fw / 2, y + fh / 2, fw / 2, 0, Math.PI * 2);
          else ctx.roundRect(x, y, fw, fh, 8);
          ctx.clip();
          const cover = Math.max(fw / face.displayWidth, fh / face.displayHeight);
          const dw = face.displayWidth * cover, dh = face.displayHeight * cover;
          ctx.translate(x + fw / 2, y + fh / 2);
          if (p.mirror) ctx.scale(-1, 1);
          ctx.drawImage(face, -dw / 2, -dh / 2, dw, dh);
          ctx.restore();
        }
        const frame = new VideoFrame(canvas, { timestamp: screen.timestamp });
        try { await writer.write(frame); } finally { frame.close(); }
      } finally { screen.close(); }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
    await writer.close().catch(() => {});
    writer.releaseLock();
  }
}

self.onmessage = ({ data }) => {
  if (data.type === "start") void draw(data).catch(() => { throw new Error("녹화 그림을 만들지 못했어요."); });
  if (data.type === "face") void readFace(data.readable).catch(() => { throw new Error("녹화 얼굴을 가져오지 못했어요."); });
  if (data.type === "position") position = data;
};
