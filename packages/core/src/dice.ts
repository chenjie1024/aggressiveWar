// ===== 骰子战斗的精确概率分布（用于战斗预览） =====

export interface DiceOutcome {
  /** 攻方赢下的配对数（守方失点） */
  w: number;
  /** 攻方输掉的配对数（攻方失点） */
  l: number;
  /** 概率 */
  p: number;
}

const cache = new Map<string, DiceOutcome[]>();

function enumerate(n: number): number[][] {
  if (n <= 0) return [[]];
  const out: number[][] = [];
  const build = (acc: number[]): void => {
    if (acc.length === n) {
      out.push([...acc]);
      return;
    }
    for (let v = 1; v <= 6; v++) {
      acc.push(v);
      build(acc);
      acc.pop();
    }
  };
  build([]);
  return out;
}

/** 进攻 ad 骰 vs 防守 dd 骰 → (守方失点 w, 攻方失点 l) 的概率分布 */
export function diceOutcomes(ad: number, dd: number): DiceOutcome[] {
  const key = `${ad}:${dd}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const aDice = enumerate(ad);
  const dDice = enumerate(dd);
  const total = aDice.length * dDice.length;
  const counts = new Map<string, number>();
  const pairs = Math.min(ad, dd);

  for (const A of aDice) {
    const a = [...A].sort((x, y) => y - x);
    for (const D of dDice) {
      const d = [...D].sort((x, y) => y - x);
      let w = 0;
      for (let i = 0; i < pairs; i++) if (a[i] > d[i]) w++;
      const k = `${w}:${pairs - w}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }

  const out: DiceOutcome[] = [];
  for (const [k, c] of counts) {
    const [w, l] = k.split(':').map(Number);
    out.push({ w, l, p: c / total });
  }
  cache.set(key, out);
  return out;
}
