// Mulberry32 种子随机数（确定性、可复现）

export interface Rng {
  next(): number; // [0,1)
  int(min: number, max: number): number; // [min, max] 闭区间
  pick<T>(arr: readonly T[]): T;
  shuffle<T>(arr: T[]): T[];
  getState(): number;
}

export function createRng(seed: number): Rng {
  return createRngFromState(seed >>> 0);
}

/** 用指定状态恢复（供存档读取后继续确定性） */
export function createRngFromState(initialState: number): Rng {
  let state = initialState >>> 0;

  const next = (): number => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    int(min, max) {
      return Math.floor(next() * (max - min + 1)) + min;
    },
    pick(arr) {
      return arr[Math.floor(next() * arr.length)];
    },
    shuffle(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
    getState() {
      return state;
    },
  };
}
