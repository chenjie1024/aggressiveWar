// 程序化像素风背景音乐：全部用 WebAudio 振荡器 + 噪声合成，不依赖任何音频素材。
// 结构：16 分音符步进音序器（前瞻调度），8 小节和弦循环，五声音阶旋律（D 小调五声：D F G A C）。

export type Mood = 'menu' | 'game' | 'tense';

interface Chord {
  /** 相对主音 D 的半音偏移（允许负数） */
  root: number;
  minor: boolean;
}

interface TrackSpec {
  bpm: number;
  /** 每个 16 分步的主音音量（0 = 不发声） */
  chords: Chord[];
  /** 低音 16 分节奏：相对和弦根音的半音偏移，null = 休止 */
  bass: (number | null)[];
  /** 旋律：每小节 8 个八分音符，相对主音的五声音阶半音偏移，null = 休止 */
  lead: (number | null)[][];
  /** 0 = 无鼓，1 = 轻鼓，2 = 强鼓 */
  drums: 0 | 1 | 2;
  /** 低音八度（相对主音 Hz 的倍率） */
  bassOctave: number;
}

const D3 = 146.832; // 主音 D3
/** 五声音阶（小调）：D F G A C */
const PENTA = [0, 3, 5, 7, 10];

/** 8 小节循环：Dm – Bb – F – C – Dm – Bb – Gm – A */
const PROG: Chord[] = [
  { root: 0, minor: true },
  { root: -4, minor: false },
  { root: 3, minor: false },
  { root: -2, minor: false },
  { root: 0, minor: true },
  { root: -4, minor: false },
  { root: 5, minor: true },
  { root: 7, minor: false },
];

const MARCH: (number | null)[] = [0, null, null, null, 0, null, 7, null, 0, null, null, null, 0, null, 12, null];
const DRIVE: (number | null)[] = [0, 0, null, 0, 0, null, 0, 0, 0, 0, null, 0, 0, null, 12, 7];

/** 旋律：8 小节 × 8 个八分音符（相对主音的五声偏移） */
const LEAD_A: (number | null)[][] = [
  [0, 3, 5, null, 7, 5, 3, null],
  [5, 7, 10, null, 7, 5, null, 3],
  [3, 5, 7, null, 10, 7, 5, null],
  [5, null, 3, 5, 2, null, 0, null],
  [0, 3, 5, null, 7, 10, 12, null],
  [10, 7, 5, null, 7, 5, 3, null],
  [5, 7, null, 10, 12, 10, 7, null],
  [7, null, 5, 3, 2, 3, 0, null],
];

const LEAD_B: (number | null)[][] = [
  [12, null, 10, 7, 5, null, 3, null],
  [5, null, 7, null, 10, null, 12, null],
  [15, 12, 10, 7, 5, 7, 5, 3],
  [2, null, 0, null, 3, null, 5, null],
  [7, 10, 12, null, 15, 12, 10, null],
  [12, null, 10, 7, 5, null, 3, 5],
  [7, 10, null, 12, 10, 7, 5, null],
  [3, null, 5, 7, 10, 7, 12, null],
];

const TRACKS: Record<Mood, TrackSpec> = {
  // 菜单：慢速、只有铺底与旋律，安静
  menu: { bpm: 72, chords: PROG, bass: MARCH, lead: LEAD_A, drums: 0, bassOctave: 0.5 },
  // 对局：行军感低音 + 轻鼓
  game: { bpm: 92, chords: PROG, bass: MARCH, lead: LEAD_A, drums: 1, bassOctave: 0.5 },
  // 紧张（终局 / AI 回合）：更快、低音驱动、强鼓、换旋律
  tense: { bpm: 108, chords: PROG, bass: DRIVE, lead: LEAD_B, drums: 2, bassOctave: 0.5 },
};

const STEPS_PER_BAR = 16;
const LOOKAHEAD = 0.3; // 秒：提前排程的窗口
const TICK_MS = 25;

function semitone(root: number, semi: number): number {
  return root * Math.pow(2, semi / 12);
}

/** 噪声缓冲（军鼓 / 踩镲用），按 context 缓存 */
const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();
function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const cached = noiseCache.get(ctx);
  if (cached) return cached;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.4), ctx.sampleRate);
  const data = buf.getChannelData(0);
  // 确定性伪随机，保证离线渲染可复现
  let s = 0x9e3779b9;
  for (let i = 0; i < data.length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    data[i] = (s / 0xffffffff) * 2 - 1;
  }
  noiseCache.set(ctx, buf);
  return buf;
}

function env(ctx: BaseAudioContext, t: number, attack: number, decay: number, peak: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  return g;
}

/** 弹拨音色（主旋律）：三角波 + 轻微低通 */
function pluck(ctx: BaseAudioContext, dest: AudioNode, freq: number, t: number, dur: number, vol: number): void {
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq, t);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(Math.min(6000, freq * 6), t);
  const g = env(ctx, t, 0.006, dur, vol);
  osc.connect(lp).connect(g).connect(dest);
  osc.start(t);
  osc.stop(t + dur + 0.06);
}

/** 低音：方波 + 低通，短促有力 */
function bassNote(ctx: BaseAudioContext, dest: AudioNode, freq: number, t: number, dur: number, vol: number): void {
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(freq, t);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(520, t);
  const g = env(ctx, t, 0.01, dur, vol);
  osc.connect(lp).connect(g).connect(dest);
  osc.start(t);
  osc.stop(t + dur + 0.06);
}

/** 铺底和弦：两个失谐三角波，慢起慢落 */
function pad(ctx: BaseAudioContext, dest: AudioNode, freqs: number[], t: number, dur: number, vol: number): void {
  for (const f of freqs) {
    for (const detune of [-6, 7]) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, t);
      osc.detune.setValueAtTime(detune, t);
      const g = env(ctx, t, Math.min(0.5, dur * 0.35), dur, vol);
      osc.connect(g).connect(dest);
      osc.start(t);
      osc.stop(t + dur + 0.3);
    }
  }
}

function kick(ctx: BaseAudioContext, dest: AudioNode, t: number, vol: number): void {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(140, t);
  osc.frequency.exponentialRampToValueAtTime(46, t + 0.16);
  const g = env(ctx, t, 0.004, 0.2, vol);
  osc.connect(g).connect(dest);
  osc.start(t);
  osc.stop(t + 0.3);
}

function snare(ctx: BaseAudioContext, dest: AudioNode, t: number, vol: number): void {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.setValueAtTime(1400, t);
  const g = env(ctx, t, 0.003, 0.14, vol);
  src.connect(hp).connect(g).connect(dest);
  src.start(t);
  src.stop(t + 0.2);
}

function hat(ctx: BaseAudioContext, dest: AudioNode, t: number, vol: number): void {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.setValueAtTime(7000, t);
  const g = env(ctx, t, 0.002, 0.05, vol);
  src.connect(hp).connect(g).connect(dest);
  src.start(t);
  src.stop(t + 0.1);
}

/** 排一个 16 分步；返回该步时长（秒）。可在 OfflineAudioContext 中复用（测试/校验） */
export function scheduleStep(
  ctx: BaseAudioContext,
  dest: AudioNode,
  spec: TrackSpec,
  step: number,
  t: number,
): number {
  const stepDur = 60 / spec.bpm / 4;
  const bar = Math.floor(step / STEPS_PER_BAR) % spec.chords.length;
  const pos = step % STEPS_PER_BAR;
  const barDur = stepDur * STEPS_PER_BAR;
  const chord = spec.chords[bar];
  const root = semitone(D3, chord.root);
  const third = chord.minor ? 3 : 4;

  // 1) 铺底：每小节开头一个和弦（音量很低，做氛围）
  if (pos === 0) {
    const freqs = [root, semitone(D3, chord.root + third), semitone(D3, chord.root + 7)];
    pad(ctx, dest, freqs, t, barDur * 0.95, spec.drums === 0 ? 0.05 : 0.038);
  }

  // 2) 低音：行军节奏
  const bn = spec.bass[pos];
  if (bn != null) {
    bassNote(ctx, dest, semitone(root, bn) * spec.bassOctave, t, stepDur * 1.7, 0.16);
  }

  // 3) 主旋律：每 2 个 16 分一个八分音符
  if (pos % 2 === 0) {
    const leadRow = spec.lead[bar % spec.lead.length];
    const deg = leadRow[pos / 2];
    if (deg != null) {
      // 归一到五声音阶（不在音阶内的装饰音落到下方最近音级），并按八度升降
      const oct = Math.floor(deg / 12);
      const idx = ((deg % 12) + 12) % 12;
      let semi = PENTA[0];
      for (const p of PENTA) if (p <= idx) semi = p;
      pluck(ctx, dest, semitone(D3, semi) * 2 * Math.pow(2, oct), t, stepDur * 1.6, 0.1);
    }
  }

  // 4) 鼓组
  if (spec.drums >= 1) {
    if (pos === 0 || pos === 8 || (spec.drums === 2 && pos === 14)) kick(ctx, dest, t, spec.drums === 2 ? 0.5 : 0.4);
    if (pos === 4 || pos === 12) snare(ctx, dest, t, spec.drums === 2 ? 0.2 : 0.14);
    if (pos % 4 === 2) hat(ctx, dest, t, spec.drums === 2 ? 0.09 : 0.06);
  }

  return stepDur;
}

export interface MusicOptions {
  volume?: number;
  muted?: boolean;
}

/**
 * 背景音乐播放器：所有音乐实时合成，无音频资源。
 * 浏览器自动播放限制 → 必须由用户手势（点击/触摸）触发 start()。
 */
export class MusicPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private timer: number | null = null;
  private nextStepTime = 0;
  private step = 0;
  private pendingMood: Mood | null = null;

  mood: Mood = 'menu';
  volume: number;
  muted: boolean;

  constructor(opts: MusicOptions = {}) {
    this.volume = Math.max(0, Math.min(1, opts.volume ?? 0.55));
    this.muted = opts.muted ?? false;
  }

  get running(): boolean {
    return this.ctx != null && this.ctx.state === 'running';
  }

  /** 由用户手势调用；重复调用无副作用 */
  start(): void {
    if (!this.ctx) {
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return; // 浏览器不支持 WebAudio：静默降级
      try {
        this.ctx = new Ctor();
      } catch {
        return;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
      this.nextStepTime = this.ctx.currentTime + 0.08;
      this.step = 0;
    }
    void this.ctx.resume();
    if (this.timer == null) {
      this.timer = window.setInterval(() => this.tick(), TICK_MS);
    }
  }

  setMood(mood: Mood): void {
    if (mood === this.mood) return;
    this.mood = mood;
    this.pendingMood = mood; // 在小节边界切换，避免突兀
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && this.ctx) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.05);
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.setVolume(this.volume);
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /** 暂停排程并挂起音频上下文（省电）；切回页面时恢复 */
  suspend(): void {
    if (this.timer != null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    void this.ctx?.suspend();
  }

  resume(): void {
    if (!this.ctx) return;
    void this.ctx.resume();
    if (this.timer == null) {
      this.nextStepTime = Math.max(this.nextStepTime, this.ctx.currentTime + 0.08);
      this.timer = window.setInterval(() => this.tick(), TICK_MS);
    }
  }

  private tick(): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    if (ctx.state !== 'running') return;

    while (this.nextStepTime < ctx.currentTime + LOOKAHEAD) {
      if (this.pendingMood && this.step % STEPS_PER_BAR === 0) {
        this.mood = this.pendingMood;
        this.pendingMood = null;
      }
      const stepDur = scheduleStep(ctx, master, TRACKS[this.mood], this.step, this.nextStepTime);
      this.nextStepTime += stepDur;
      this.step = (this.step + 1) % (STEPS_PER_BAR * TRACKS[this.mood].chords.length);
    }
  }
}

/** 离线渲染若干秒，用于校验合成结果（测试 / 浏览器控制台） */
export async function renderOffline(mood: Mood, seconds: number, sampleRate = 44100): Promise<Float32Array> {
  const OfflineCtor: typeof OfflineAudioContext | undefined =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!OfflineCtor) throw new Error('OfflineAudioContext 不可用');
  const ctx = new OfflineCtor(1, Math.ceil(sampleRate * seconds), sampleRate);
  const master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);
  const spec = TRACKS[mood];
  let t = 0;
  const total = Math.ceil((seconds * spec.bpm * 4) / 60) + STEPS_PER_BAR;
  for (let step = 0; step < total; step++) t += scheduleStep(ctx, master, spec, step, t);
  const buf = await ctx.startRendering();
  return buf.getChannelData(0);
}

/** 读取配置（localStorage），失败时用默认值 */
export function loadMusicPrefs(): { muted: boolean; volume: number } {
  let muted = false;
  let volume = 0.55;
  try {
    muted = localStorage.getItem('gongfa-war.music') === '0';
    const raw = localStorage.getItem('gongfa-war.volume');
    const v = raw == null ? NaN : Number(raw); // 注意：键不存在时 Number(null) === 0，必须显式判空
    if (Number.isFinite(v) && v >= 0 && v <= 1) volume = v;
  } catch {
    /* 隐私模式忽略 */
  }
  return { muted, volume };
}

export function saveMusicPrefs(muted: boolean, volume: number): void {
  try {
    localStorage.setItem('gongfa-war.music', muted ? '0' : '1');
    localStorage.setItem('gongfa-war.volume', String(Math.round(volume * 100) / 100));
  } catch {
    /* 隐私模式忽略 */
  }
}
