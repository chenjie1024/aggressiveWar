import type { Cell, GameState, Region, SpecialType } from './types';
import { ACTIONS_PER_TURN } from './constants';
import { seasonAt } from './weather';

export const STATE_VERSION = 8;

/** 区域格子按行 RLE 编码，显著压缩存档体积 */
export function encodeCells(cells: Cell[]): string {
  const byY = new Map<number, number[]>();
  for (const c of cells) {
    const arr = byY.get(c.y);
    if (arr) arr.push(c.x);
    else byY.set(c.y, [c.x]);
  }
  const parts: string[] = [];
  for (const y of [...byY.keys()].sort((a, b) => a - b)) {
    const xs = byY.get(y)!.sort((a, b) => a - b);
    const runs: string[] = [];
    let start = xs[0];
    let prev = xs[0];
    for (let i = 1; i <= xs.length; i++) {
      if (i < xs.length && xs[i] === prev + 1) {
        prev = xs[i];
        continue;
      }
      runs.push(start === prev ? `${start}` : `${start}-${prev}`);
      if (i < xs.length) {
        start = xs[i];
        prev = xs[i];
      }
    }
    parts.push(`${y}:${runs.join(',')}`);
  }
  return parts.join(';');
}

export function decodeCells(rle: string): Cell[] {
  const cells: Cell[] = [];
  if (!rle) return cells;
  for (const part of rle.split(';')) {
    if (!part) continue;
    const [ys, runs] = part.split(':');
    const y = Number(ys);
    if (!runs) continue;
    for (const run of runs.split(',')) {
      const [a, b] = run.split('-');
      const from = Number(a);
      const to = b === undefined ? from : Number(b);
      for (let x = from; x <= to; x++) cells.push({ x, y });
    }
  }
  return cells;
}

export function serializeState(state: GameState): string {
  state.version = STATE_VERSION;
  const regions = state.regions.map((r) => {
    const { cells, ...rest } = r;
    return { ...rest, rle: encodeCells(cells) };
  });
  return JSON.stringify({ ...state, regions });
}

export function deserializeState(json: string): GameState {
  const raw = JSON.parse(json) as Record<string, unknown> & {
    regions: (Omit<Region, 'cells'> & { cells?: Cell[]; rle?: string })[];
  };
  if (!raw || raw.version !== STATE_VERSION) {
    throw new Error('存档版本不兼容或数据损坏');
  }

  const regions: Region[] = (raw.regions ?? []).map((r) => {
    const { rle, cells, ...rest } = r;
    return {
      ...(rest as Omit<Region, 'cells'>),
      cells: cells ?? decodeCells(rle ?? ''),
      seaNeighbors: (rest as Region).seaNeighbors ?? [],
      name: (rest as Region).name ?? `地区${(rest as Region).id + 1}`,
      pendingBonus: (rest as Region).pendingBonus ?? 0,
      capital: (rest as Region).capital ?? false,
      siege: (rest as Region).siege ?? 0,
      // v7 → v8：早期每区只有单个 special 字段，迁移成数组
      specials:
        (rest as Region).specials ??
        ((rest as unknown as { special?: SpecialType | null }).special
          ? [(rest as unknown as { special: SpecialType }).special]
          : []),
    } as Region;
  });

  const state = { ...(raw as unknown as GameState), regions };
  state.events = state.events ?? [];
  state.log = state.log ?? [];
  state.stats = state.stats ?? {};
  state.actionsLeft = state.actionsLeft ?? ACTIONS_PER_TURN;
  // 季节 / 天气（旧存档补齐默认值）
  state.round = state.round ?? 1;
  state.season = state.season ?? seasonAt(state.round);
  state.weather = state.weather ?? 'clear';
  for (const p of state.players) {
    p.turns = p.turns ?? 0;
    p.seen = p.seen ?? [];
    p.intel = p.intel ?? {};
  }
  return state;
}
