// 音效 + 震动：与背景音乐一样全部用 WebAudio 实时合成，不引入任何音频素材。
// 首次调用必须发生在用户手势之后（浏览器自动播放策略），调用方在点击/按键时初始化即可。

export type SfxName =
  | 'tap'
  | 'select'
  | 'attack'
  | 'win'
  | 'lose'
  | 'capture'
  | 'endTurn'
  | 'error'
  | 'achv';

interface SfxDef {
  /** 震动模式（毫秒，Android WebView 支持 navigator.vibrate） */
  vibrate?: number | number[];
  play: (ctx: BaseAudioContext, dest: AudioNode, t: number) => void;
}

function tone(
  ctx: BaseAudioContext,
  dest: AudioNode,
  freq: number,
  t: number,
  dur: number,
  vol: number,
  type: OscillatorType = 'square',
  slideTo?: number,
): void {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(dest);
  osc.start(t);
  osc.stop(t + dur + 0.04);
}

function noise(
  ctx: BaseAudioContext,
  dest: AudioNode,
  t: number,
  dur: number,
  vol: number,
  hp = 900,
): void {
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let s = 0x1234567;
  for (let i = 0; i < len; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    data[i] = ((s / 0xffffffff) * 2 - 1) * (1 - i / len);
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.setValueAtTime(hp, t);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter).connect(g).connect(dest);
  src.start(t);
  src.stop(t + dur + 0.02);
}

function kick(ctx: BaseAudioContext, dest: AudioNode, t: number, vol: number): void {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(150, t);
  osc.frequency.exponentialRampToValueAtTime(48, t + 0.18);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
  osc.connect(g).connect(dest);
  osc.start(t);
  osc.stop(t + 0.3);
}

const SFX: Record<SfxName, SfxDef> = {
  tap: { vibrate: 8, play: (c, d, t) => tone(c, d, 640, t, 0.05, 0.1) },
  select: { vibrate: 10, play: (c, d, t) => tone(c, d, 520, t, 0.08, 0.12, 'square', 720) },
  attack: {
    vibrate: [18, 40, 22],
    play: (c, d, t) => {
      kick(c, d, t, 0.5);
      noise(c, d, t + 0.01, 0.16, 0.22, 700);
      tone(c, d, 220, t + 0.02, 0.1, 0.1, 'sawtooth', 120);
    },
  },
  win: {
    vibrate: [12, 30, 12],
    play: (c, d, t) => {
      [523, 659, 784].forEach((f, i) => tone(c, d, f, t + i * 0.07, 0.16, 0.14, 'triangle'));
    },
  },
  lose: {
    vibrate: 40,
    play: (c, d, t) => {
      [330, 262, 196].forEach((f, i) => tone(c, d, f, t + i * 0.11, 0.24, 0.13, 'triangle'));
    },
  },
  capture: {
    vibrate: [10, 24, 10, 24, 40],
    play: (c, d, t) => {
      tone(c, d, 784, t, 0.12, 0.14, 'triangle');
      tone(c, d, 1046, t + 0.1, 0.22, 0.13, 'triangle');
    },
  },
  endTurn: {
    vibrate: 14,
    play: (c, d, t) => {
      tone(c, d, 140, t, 0.5, 0.14, 'sine', 110);
      tone(c, d, 210, t + 0.01, 0.42, 0.06, 'sine');
    },
  },
  error: { vibrate: 60, play: (c, d, t) => tone(c, d, 150, t, 0.14, 0.16, 'square', 110) },
  achv: {
    vibrate: [16, 40, 16, 40, 60],
    play: (c, d, t) => {
      [659, 784, 988, 1319].forEach((f, i) => tone(c, d, f, t + i * 0.08, 0.2, 0.13, 'triangle'));
    },
  },
};

export class SfxPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  enabled: boolean;
  vibrateEnabled: boolean;
  volume: number;

  constructor(opts: { enabled?: boolean; vibrate?: boolean; volume?: number } = {}) {
    this.enabled = opts.enabled ?? true;
    this.vibrateEnabled = opts.vibrate ?? true;
    this.volume = Math.max(0, Math.min(1, opts.volume ?? 0.6));
  }

  /** 由用户手势触发（与背景音乐一样只创建一次） */
  init(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
    } catch {
      return;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (on) this.init();
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
  }

  play(name: SfxName): void {
    const def = SFX[name];
    if (!def) return;
    if (this.vibrateEnabled && def.vibrate !== undefined) {
      try {
        navigator.vibrate?.(def.vibrate);
      } catch {
        /* 不支持就算了 */
      }
    }
    if (!this.enabled) return;
    if (!this.ctx || !this.master) this.init();
    if (!this.ctx || !this.master) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    try {
      def.play(this.ctx, this.master, this.ctx.currentTime + 0.005);
    } catch {
      /* 合成失败不影响游戏 */
    }
  }
}

export function loadSfxPrefs(): { enabled: boolean; vibrate: boolean; volume: number } {
  let enabled = true;
  let vibrate = true;
  let volume = 0.6;
  try {
    enabled = localStorage.getItem('gongfa-war.sfx') !== '0';
    vibrate = localStorage.getItem('gongfa-war.vibrate') !== '0';
    const raw = localStorage.getItem('gongfa-war.sfxVolume');
    const v = raw == null ? NaN : Number(raw);
    if (Number.isFinite(v) && v >= 0 && v <= 1) volume = v;
  } catch {
    /* 隐私模式忽略 */
  }
  return { enabled, vibrate, volume };
}

export function saveSfxPrefs(enabled: boolean, vibrate: boolean, volume: number): void {
  try {
    localStorage.setItem('gongfa-war.sfx', enabled ? '1' : '0');
    localStorage.setItem('gongfa-war.vibrate', vibrate ? '1' : '0');
    localStorage.setItem('gongfa-war.sfxVolume', String(Math.round(volume * 100) / 100));
  } catch {
    /* 隐私模式忽略 */
  }
}
