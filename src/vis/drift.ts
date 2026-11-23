/**
 * Drift: RevAmp's own feedback visualizer, in the spirit of the classic palette-and-warp plug-ins (written new).
 *
 * Every frame the last picture is pulled through a warp (zoom, turn, swirl, rings or mirror), dimmed a little,
 * and the music's waveform is drawn on top. The picture is one brightness channel; a 256-colour palette turns it
 * into colour on screen, and the palette slowly changes. Beats nudge the motion; a new scene changes all of it.
 */
import type { VisAudio, VisEngine } from './types';

const SIM_MAX = 960; // the feedback picture is at most this wide (it is scaled up to the canvas)
const WAVE_POINTS = 512;

export const WARP_MODES = ['Zoom', 'Swirl', 'Rings', 'Mirror'] as const;
export const WAVE_MODES = ['line', 'circle', 'beam', 'spiral'] as const;

export interface DriftScene {
  warp: number; // index into WARP_MODES
  wave: number; // index into WAVE_MODES
  zoom: number; // < 1 pulls the picture outwards
  rot: number; // turn per frame (radians)
  swirl: number;
  swirlFreq: number;
  shiftX: number;
  shiftY: number;
  decay: number;
  palette: number[]; // 9 numbers: frequency, phase and power per colour channel
}

/** A new random scene. `rnd` is replaceable for tests. */
export function randomScene(rnd: () => number = Math.random): DriftScene {
  const pick = (a: number, b: number) => a + (b - a) * rnd();
  const sign = rnd() < 0.5 ? -1 : 1;
  return {
    warp: Math.floor(rnd() * WARP_MODES.length),
    wave: Math.floor(rnd() * WAVE_MODES.length),
    zoom: pick(0.955, 0.995),
    rot: sign * pick(0.002, 0.03),
    swirl: pick(0.05, 0.4),
    swirlFreq: pick(4, 18),
    shiftX: pick(-0.004, 0.004),
    shiftY: pick(-0.004, 0.004),
    decay: pick(0.955, 0.985),
    palette: randomPalette(rnd),
  };
}

export function randomPalette(rnd: () => number = Math.random): number[] {
  const out: number[] = [];
  for (let c = 0; c < 3; c++) out.push(0.3 + rnd() * 1.4, rnd(), 0.6 + rnd() * 1.6);
  return out;
}

/** 256 RGBA colours from palette numbers: index 0 is black, brightness rises with the index. */
export function paletteBytes(p: number[]): Uint8Array {
  const out = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    for (let c = 0; c < 3; c++) {
      const f = p[c * 3]!,
        ph = p[c * 3 + 1]!,
        pw = p[c * 3 + 2]!;
      const wave = 0.55 + 0.45 * Math.cos(2 * Math.PI * (f * t + ph));
      out[i * 4 + c] = Math.round(255 * Math.min(1, Math.pow(t, pw) * wave * 1.25 + Math.pow(t, 6) * 0.35));
    }
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Beat finder: bass energy well above its recent average, at most every 0.25 s. */
export class BeatFinder {
  private avg = -1;
  private last = -1;
  /** `energy` 0..1, `t` seconds. */
  step(energy: number, t: number): boolean {
    if (this.avg < 0) {
      this.avg = energy; // the first sound is the baseline, not a beat
      return false;
    }
    const beat = energy > 0.08 && energy > this.avg * 1.35 && (this.last < 0 || t - this.last > 0.25);
    this.avg = this.avg * 0.94 + energy * 0.06;
    if (beat) this.last = t;
    return beat;
  }
}

const VS_QUAD = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FS_WARP = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform sampler2D uPrev; uniform vec2 uTexel; uniform float uAspect, uTime, uZoom, uRot, uSwirl, uSwirlFreq, uDecay;
uniform vec2 uShift; uniform int uMode;
float at(vec2 uv) { return (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? 0.0 : texture(uPrev, uv).r; }
void main() {
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  float r = length(p), a = atan(p.y, p.x);
  if (uMode == 1) { a += uRot + uSwirl * 0.08 * sin(r * uSwirlFreq + uTime); r *= uZoom; }
  else if (uMode == 2) { r *= uZoom + 0.015 * sin(r * uSwirlFreq * 2.0 - uTime * 2.0); a += uRot; }
  else if (uMode == 3) { float s = 6.2831853 / 5.0; a = abs(mod(a + uRot, s) - s * 0.5) + uRot; r *= uZoom; }
  else { a += uRot; r *= uZoom; }
  vec2 uv = (vec2(cos(a), sin(a)) * r + uShift) / vec2(uAspect, 1.0) + 0.5;
  float v = at(uv) * 4.0 + at(uv + vec2(uTexel.x, 0.0)) + at(uv - vec2(uTexel.x, 0.0))
          + at(uv + vec2(0.0, uTexel.y)) + at(uv - vec2(0.0, uTexel.y));
  outColor = vec4(max(v / 8.0 * uDecay - 0.006, 0.0), 0.0, 0.0, 1.0);
}`;

const VS_WAVE = `#version 300 es
in vec2 aPos; uniform float uSize;
void main() { gl_PointSize = uSize; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FS_WAVE = `#version 300 es
precision mediump float; uniform float uLevel; out vec4 outColor;
void main() { outColor = vec4(uLevel, 0.0, 0.0, 1.0); }`;

const FS_SHOW = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform sampler2D uPic, uPalA, uPalB; uniform float uMix, uFlash;
void main() {
  float v = clamp(texture(uPic, vUv).r * (1.0 + uFlash), 0.0, 1.0);
  vec2 i = vec2(v * 255.0 / 256.0 + 0.5 / 256.0, 0.5);
  outColor = vec4(mix(texture(uPalA, i).rgb, texture(uPalB, i).rgb, uMix), 1.0);
}`;

type Uniforms = Record<string, WebGLUniformLocation | null>;

function program(gl: WebGL2RenderingContext, vs: string, fs: string, names: string[]) {
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(s) ?? 'shader error');
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, shader(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link error');
  const u: Uniforms = {};
  for (const n of names) u[n] = gl.getUniformLocation(p, n);
  return { p, u };
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export class DriftEngine implements VisEngine {
  private readonly gl: WebGL2RenderingContext;
  private readonly warp;
  private readonly wave;
  private readonly show;
  private readonly quad: WebGLBuffer;
  private readonly waveBuf: WebGLBuffer;
  private readonly waveData = new Float32Array(WAVE_POINTS * 2);
  private pics: { tex: WebGLTexture; fbo: WebGLFramebuffer }[] = [];
  private cur = 0;
  private simW = 1;
  private simH = 1;
  private outW = 1;
  private outH = 1;
  private readonly palA: WebGLTexture;
  private readonly palB: WebGLTexture;
  private palMix = 1;
  private readonly samples: Float32Array<ArrayBuffer>;
  private readonly freq: Uint8Array<ArrayBuffer>;
  private readonly beats = new BeatFinder();
  private flash = 0;
  private readonly t0 = performance.now();
  private lastT = 0;
  /** What is shown now (moves towards `target`). */
  private scene: DriftScene;
  private target: DriftScene;
  private history: DriftScene[] = [];
  private count = 1;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly audio: VisAudio,
    private readonly onScene: (title: string) => void = () => {},
    rnd: () => number = Math.random,
  ) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false });
    if (!gl) throw new Error('WebGL 2 is not available');
    this.gl = gl;
    this.warp = program(gl, VS_QUAD, FS_WARP, [
      'uPrev',
      'uTexel',
      'uAspect',
      'uTime',
      'uZoom',
      'uRot',
      'uSwirl',
      'uSwirlFreq',
      'uDecay',
      'uShift',
      'uMode',
    ]);
    this.wave = program(gl, VS_WAVE, FS_WAVE, ['uSize', 'uLevel']);
    this.show = program(gl, VS_QUAD, FS_SHOW, ['uPic', 'uPalA', 'uPalB', 'uMix', 'uFlash']);
    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.waveBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.waveBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.waveData.byteLength, gl.DYNAMIC_DRAW);
    this.palA = this.paletteTexture();
    this.palB = this.paletteTexture();
    this.samples = new Float32Array(audio.analyser.fftSize);
    this.freq = new Uint8Array(audio.analyser.frequencyBinCount);
    this.scene = randomScene(rnd);
    this.target = this.scene;
    this.setPalette(this.palB, this.scene.palette);
    this.resize(canvas.width || 1, canvas.height || 1);
    this.onScene(this.title);
  }

  get title(): string {
    const s = this.target;
    return `Drift ${this.count}: ${WARP_MODES[s.warp]}, ${WAVE_MODES[s.wave]}`;
  }

  /** The scene being moved towards (tests and the self-test read it). */
  get currentScene(): DriftScene {
    return this.target;
  }

  private paletteTexture(): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return t;
  }

  private setPalette(tex: WebGLTexture, p: number[]): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, paletteBytes(p));
  }

  /** Starts blending from the palette on screen to `p`. */
  private changePalette(p: number[]): void {
    // whatever shows now becomes palette A (when mid-blend, it snaps to the newer one: barely visible)
    const a = this.palMix >= 0.5 ? this.target.palette : this.scene.palette;
    this.setPalette(this.palA, a);
    this.setPalette(this.palB, p);
    this.palMix = 0;
  }

  resize(w: number, h: number): void {
    const gl = this.gl;
    this.outW = Math.max(1, w);
    this.outH = Math.max(1, h);
    const k = Math.min(1, SIM_MAX / this.outW);
    const sw = Math.max(16, Math.round(this.outW * k));
    const sh = Math.max(16, Math.round(this.outH * k));
    if (sw === this.simW && sh === this.simH && this.pics.length) return;
    this.simW = sw;
    this.simH = sh;
    for (const p of this.pics) {
      gl.deleteTexture(p.tex);
      gl.deleteFramebuffer(p.fbo);
    }
    this.pics = [0, 1].map(() => {
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, sw, sh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const fbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return { tex, fbo };
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  next(_random: boolean): void {
    this.history.push(this.target);
    if (this.history.length > 30) this.history.shift();
    this.goTo(randomScene());
    this.count++;
    this.onScene(this.title);
  }

  prev(): void {
    const s = this.history.pop();
    if (!s) return;
    this.goTo(s);
    this.count = Math.max(1, this.count - 1);
    this.onScene(this.title);
  }

  private goTo(s: DriftScene): void {
    this.scene = { ...this.blended(), palette: this.target.palette };
    this.changePalette(s.palette);
    this.target = s;
    this.moved = 0;
  }

  /** 0..1: how far the motion has moved from `scene` to `target`. */
  private moved = 1;
  private blended(): DriftScene {
    const a = this.scene,
      b = this.target,
      k = this.moved;
    return {
      ...b,
      zoom: lerp(a.zoom, b.zoom, k),
      rot: lerp(a.rot, b.rot, k),
      swirl: lerp(a.swirl, b.swirl, k),
      swirlFreq: lerp(a.swirlFreq, b.swirlFreq, k),
      shiftX: lerp(a.shiftX, b.shiftX, k),
      shiftY: lerp(a.shiftY, b.shiftY, k),
      decay: lerp(a.decay, b.decay, k),
    };
  }

  /** Fills `waveData` with clip-space points for the scene's wave shape. */
  private shapeWave(mode: number, t: number, bass: number): void {
    const n = WAVE_POINTS;
    const s = this.samples;
    const step = Math.max(1, Math.floor(s.length / n));
    const d = this.waveData;
    for (let i = 0; i < n; i++) {
      const v = Math.max(-1, Math.min(1, (s[i * step] ?? 0) * 1.6));
      const f = i / (n - 1);
      let x: number, y: number;
      if (mode === 1) {
        const a = f * Math.PI * 2 + t * 0.3;
        const r = 0.32 + bass * 0.15 + v * 0.18;
        x = Math.cos(a) * r * (this.outH / this.outW);
        y = Math.sin(a) * r;
      } else if (mode === 2) {
        x = v * 0.45;
        y = f * 1.6 - 0.8;
      } else if (mode === 3) {
        const a = f * Math.PI * 10 + t;
        const r = f * 0.7 * (0.6 + bass) + v * 0.05;
        x = Math.cos(a) * r * (this.outH / this.outW);
        y = Math.sin(a) * r;
      } else {
        x = f * 1.8 - 0.9;
        y = v * 0.5;
      }
      d[i * 2] = x;
      d[i * 2 + 1] = y;
    }
  }

  render(): void {
    const gl = this.gl;
    const t = (performance.now() - this.t0) / 1000;
    const dt = Math.min(0.1, this.lastT ? t - this.lastT : 1 / 60);
    this.lastT = t;
    const fr = dt * 60; // frames' worth of motion at 60 fps
    // sound
    const an = this.audio.analyser;
    an.getFloatTimeDomainData(this.samples);
    an.getByteFrequencyData(this.freq);
    let bass = 0;
    const bins = Math.max(2, Math.round((150 / (this.audio.context.sampleRate / 2)) * this.freq.length));
    for (let i = 1; i <= bins; i++) bass += this.freq[i] ?? 0;
    bass /= bins * 255;
    if (this.beats.step(bass, t)) {
      this.flash = 0.35;
      // a beat nudges the turning: sometimes the other way round
      if (Math.random() < 0.25) this.target = { ...this.target, rot: -this.target.rot };
    }
    this.flash = Math.max(0, this.flash - 0.04 * fr);
    this.moved = Math.min(1, this.moved + dt / 1.5);
    this.palMix = Math.min(1, this.palMix + dt / 3);
    const s = this.blended();

    // 1. warp the last picture into the other buffer
    const src = this.pics[this.cur]!,
      dst = this.pics[1 - this.cur]!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, this.simW, this.simH);
    gl.disable(gl.BLEND);
    gl.useProgram(this.warp.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    const u = this.warp.u;
    gl.uniform1i(u.uPrev!, 0);
    gl.uniform2f(u.uTexel!, 1 / this.simW, 1 / this.simH);
    gl.uniform1f(u.uAspect!, this.simW / this.simH);
    gl.uniform1f(u.uTime!, t);
    gl.uniform1f(u.uZoom!, Math.pow(s.zoom - bass * 0.01, fr));
    gl.uniform1f(u.uRot!, s.rot * fr);
    gl.uniform1f(u.uSwirl!, s.swirl);
    gl.uniform1f(u.uSwirlFreq!, s.swirlFreq);
    gl.uniform1f(u.uDecay!, Math.pow(s.decay, fr));
    gl.uniform2f(u.uShift!, s.shiftX * fr, s.shiftY * fr);
    gl.uniform1i(u.uMode!, s.warp);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 2. the waveform on top, added
    this.shapeWave(s.wave, t, bass);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(this.wave.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.waveBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.waveData);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1f(this.wave.u.uSize!, Math.max(1.5, this.simW / 320));
    gl.uniform1f(this.wave.u.uLevel!, 0.9);
    gl.drawArrays(gl.LINE_STRIP, 0, WAVE_POINTS);
    gl.uniform1f(this.wave.u.uLevel!, 0.5);
    gl.drawArrays(gl.POINTS, 0, WAVE_POINTS);
    gl.disable(gl.BLEND);
    this.cur = 1 - this.cur;

    // 3. colour it with the palette, onto the canvas
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.outW, this.outH);
    gl.useProgram(this.show.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, dst.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.palA);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.palB);
    gl.uniform1i(this.show.u.uPic!, 0);
    gl.uniform1i(this.show.u.uPalA!, 1);
    gl.uniform1i(this.show.u.uPalB!, 2);
    gl.uniform1f(this.show.u.uMix!, this.palMix);
    gl.uniform1f(this.show.u.uFlash!, this.flash);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
  }

  dispose(): void {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
