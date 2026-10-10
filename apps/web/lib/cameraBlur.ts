import type { LocalVideoTrack } from "livekit-client";
import type { VideoTransformerInitOptions } from "@livekit/track-processors";

// 켜기·끄기가 겹쳐도 누른 순서대로 끝낸다.
const pending = new WeakMap<LocalVideoTrack, Promise<void>>();

// 구글은 사람일 가능성을 준다. 기존 블러 부품이 받는 배경 가능성으로 뒤집는다.
// 그래픽카드 안에서 계산해서 영상 자료를 중앙 처리 장치로 꺼내지 않는다.
function backgroundMask(canvas: OffscreenCanvas | HTMLCanvasElement) {
  const gl = canvas.getContext("webgl2") as WebGL2RenderingContext;
  const program = gl.createProgram()!;
  const shaders = [
    [gl.VERTEX_SHADER, `#version 300 es
      in vec2 position; out vec2 uv;
      void main() { uv = (position + 1.0) * 0.5; gl_Position = vec4(position, 0, 1); }`],
    [gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float; in vec2 uv; uniform sampler2D person; out vec4 color;
      void main() { color = vec4(vec3(1.0 - texture(person, uv).r), 1.0); }`],
  ].map(([kind, source]) => {
    const shader = gl.createShader(kind as number)!;
    gl.shaderSource(shader, source as string);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error("배경 처리를 준비하지 못했어요.");
    gl.attachShader(program, shader);
    return shader;
  });
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("배경 처리를 준비하지 못했어요.");
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const framebuffer = gl.createFramebuffer();
  const position = gl.getAttribLocation(program, "position");
  const person = gl.getUniformLocation(program, "person");
  let size = "";
  return {
    update(source: WebGLTexture, width: number, height: number) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      if (size !== `${width}x${height}`) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        size = `${width}x${height}`;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      gl.viewport(0, 0, width, height);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(position);
      gl.bindTexture(gl.TEXTURE_2D, source);
      gl.uniform1i(person, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return texture!;
    },
    destroy() {
      gl.deleteTexture(texture); gl.deleteFramebuffer(framebuffer); gl.deleteBuffer(buffer);
      gl.deleteProgram(program); shaders.forEach(shader => gl.deleteShader(shader));
    },
  };
}

export async function createCameraBlur() {
  const { BackgroundTransformer, ProcessorWrapper, supportsBackgroundProcessors } = await import("@livekit/track-processors");
  if (!supportsBackgroundProcessors()) throw new Error("이 브라우저는 블러를 못 씀");

  class CameraBlur extends BackgroundTransformer {
    private mask?: ReturnType<typeof backgroundMask>;
    async init(options: VideoTransformerInitOptions) {
      await super.init(options);
      // 사람 경계를 둘로 잘라 버리지 않고, 사람일 가능성을 그대로 쓴다.
      await this.imageSegmenter!.setOptions({ outputCategoryMask: false, outputConfidenceMasks: true });
    }

    async transform(frame: VideoFrame, controller: TransformStreamDefaultController<VideoFrame>) {
      try {
        if (!this.canvas || !this.gl || !this.imageSegmenter || !frame.displayWidth || !frame.displayHeight) return;
        if (this.canvas.width !== frame.displayWidth) this.canvas.width = frame.displayWidth;
        if (this.canvas.height !== frame.displayHeight) this.canvas.height = frame.displayHeight;
        // 같은 장의 배경 경계와 영상만 합친다. 처음 원본 장을 끼워 넣지 않는다.
        this.imageSegmenter.segmentForVideo(frame, performance.now(), (result) => {
          try {
            const person = result.confidenceMasks?.[0];
            if (!person) throw new Error("배경 경계를 찾지 못했어요.");
            this.mask ??= backgroundMask(this.canvas!);
            this.gl!.updateMask(this.mask.update(person.getAsWebGLTexture(), person.width, person.height));
            this.gl!.renderFrame(frame);
            // 0도 올바른 영상 시간이다. 날짜 시간으로 바꾸면 순서가 뒤집힌다.
            controller.enqueue(new VideoFrame(this.canvas!, { timestamp: frame.timestamp }));
          } finally {
            result.close();
          }
        });
      } finally {
        frame.close();
      }
    }

    async destroy(options?: Parameters<InstanceType<typeof BackgroundTransformer>["destroy"]>[0]) {
      this.mask?.destroy();
      this.mask = undefined;
      await super.destroy(options);
    }
  }

  return new ProcessorWrapper(new CameraBlur({ blurRadius: 12,
    assetPaths: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/latest/selfie_segmenter_landscape.tflite" },
  }), "dolive-camera-blur");
}

export function applyBlur(track: LocalVideoTrack, on: boolean) {
  const next = (pending.get(track) ?? Promise.resolve()).catch(() => {}).then(async () => {
    if (track.mediaStreamTrack.readyState === "ended") return;
    if (!on) {
      if (track.getProcessor()) await track.stopProcessor();
    } else if (!track.getProcessor()) {
      const source = track.mediaStreamTrack;
      const ended = () => source.readyState === "ended";
      const processor = await createCameraBlur();
      if (ended()) return;
      try {
        await track.setProcessor(processor);
      } catch (error) {
        await processor.destroy();
        throw error;
      }
      // 준비 중에 창을 닫았으면 남은 처리도 끈다.
      if (ended()) track.stop();
    }
  });
  pending.set(track, next);
  return next;
}
