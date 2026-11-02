import type { Rng } from './rng';
import {
  CITY_START_ARMY,
  MAP_H,
  MAP_W,
  NEUTRAL_ARMY,
  NEUTRAL_CITY_ARMY,
  SPECIAL_ORDER,
  SPECIAL_REGION_COUNT,
  START_ARMY,
} from './constants';
import { REGION_NAME_ANCHORS, buildLandMask } from './worldmap';
import { NATIONS, nationById } from './nations';
import { scenarioById } from './scenarios';
import type { Cell, GameConfig, MapTemplate, Player, Region, RegionType } from './types';
import { NEUTRAL } from './types';

export interface GeneratedMap {
  regions: Region[];
  players: Player[];
  template: MapTemplate;
}

const DIRS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function dist2(a: Cell, b: Cell): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function weightedPick(rng: Rng, weights: [RegionType, number][]): RegionType {
  const total = weights.reduce((s, [, w]) => s + w, 0);
  let roll = rng.next() * total;
  for (const [t, w] of weights) {
    roll -= w;
    if (roll < 0) return t;
  }
  return weights[weights.length - 1][0];
}

function minCellDist(a: Cell[], b: Cell[]): number {
  let best = Infinity;
  for (const p of a) {
    for (const q of b) {
      const d = dist2(p, q);
      if (d < best) best = d;
    }
  }
  return best;
}

/** 保证区域图连通：不同大陆之间用最短「海路」补边，并记录为海路 */
function connectComponents(regions: Region[]): void {
  const n = regions.length;
  if (n < 2) return;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a: number, b: number): boolean => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return false;
    parent[ra] = rb;
    return true;
  };

  for (const r of regions) for (const nb of r.neighbors) union(r.id, nb);

  const cands: { a: number; b: number; d: number }[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (regions[i].neighbors.includes(j)) continue;
      cands.push({ a: i, b: j, d: minCellDist(regions[i].cells, regions[j].cells) });
    }
  }
  cands.sort((p, q) => p.d - q.d);

  for (const e of cands) {
    if (find(e.a) === find(e.b)) continue;
    union(e.a, e.b);
    regions[e.a].neighbors.push(e.b);
    regions[e.b].neighbors.push(e.a);
    regions[e.a].seaNeighbors.push(e.b);
    regions[e.b].seaNeighbors.push(e.a);
    let allSame = true;
    for (let i = 1; i < n; i++) {
      if (find(i) !== find(0)) {
        allSame = false;
        break;
      }
    }
    if (allSame) break;
  }
}

/** 按地图地理分布就近取真实地名 */
function assignNames(regions: Region[]): void {
  const used = new Set<string>();
  for (const r of regions) {
    const sorted = REGION_NAME_ANCHORS.map((a) => ({ a, d: dist2(r.center, a) })).sort((p, q) => p.d - q.d);
    const pick = sorted.find((s) => !used.has(s.a.name));
    const name = pick ? pick.a.name : `地区${r.id + 1}`;
    used.add(name);
    r.name = name;
  }
}

function assignPlayerCapitals(regions: Region[], totalPlayers: number): void {
  const mapCenter: Cell = { x: MAP_W / 2, y: MAP_H / 2 };
  const byFar = regions
    .map((r) => ({ r, d: dist2(r.center, mapCenter) }))
    .sort((a, b) => b.d - a.d)
    .sort((a, b) => Number(b.r.neighbors.length >= 3) - Number(a.r.neighbors.length >= 3));

  const chosen: Region[] = [];
  const minGap2 = (Math.min(MAP_W, MAP_H) * 0.5) ** 2;
  for (const { r } of byFar) {
    if (chosen.length >= totalPlayers) break;
    if (chosen.some((c) => dist2(c.center, r.center) < minGap2)) continue;
    chosen.push(r);
  }
  for (const { r } of byFar) {
    if (chosen.length >= totalPlayers) break;
    if (!chosen.includes(r)) chosen.push(r);
  }

  chosen.forEach((r, idx) => {
    r.type = 'city';
    r.owner = idx;
    r.army = CITY_START_ARMY;
    r.capital = true; // 初始城即首都
  });

  chosen.forEach((r, idx) => {
    let given = 0;
    const queue: number[] = [...r.neighbors];
    const seen = new Set<number>(queue);
    while (given < 2 && queue.length > 0) {
      const nid = queue.shift()!;
      const n = regions[nid];
      if (n.owner === NEUTRAL && n.id !== r.id) {
        n.owner = idx;
        n.army = START_ARMY;
        given++;
      }
      if (given < 2) {
        for (const m of n.neighbors) {
          if (!seen.has(m)) {
            seen.add(m);
            queue.push(m);
          }
        }
      }
    }
  });
}

function assignNeutralCities(regions: Region[], totalPlayers: number, rng: Rng): void {
  // 密度随区域数缩放：大图 / 多区时中立城也相应变多
  const count = Math.max(2 + Math.floor(totalPlayers / 2), Math.round(regions.length * 0.12));
  const candidates = regions.filter((r) => r.owner === NEUTRAL && r.type === 'plains');
  const shuffled = rng.shuffle(candidates);
  let n = 0;
  for (const r of shuffled) {
    if (n >= count) break;
    r.type = 'city';
    r.army = NEUTRAL_CITY_ARMY;
    n++;
  }
}

function assignSpecials(regions: Region[], rng: Rng): void {
  const limit = Math.max(SPECIAL_REGION_COUNT, Math.round(regions.length * 0.14));
  const candidates = rng.shuffle(regions.filter((r) => r.owner === NEUTRAL && r.type !== 'city'));
  let n = 0;
  for (const r of candidates) {
    if (n >= limit) break;
    // 开局给无主区域随机带一种设施（每种每区仍各限一个）
    r.specials = [SPECIAL_ORDER[n % SPECIAL_ORDER.length]];
    n++;
  }
}

/** 生成不规则区域地图（模板陆地 + 网格 Voronoi） */
export function generateMap(config: GameConfig, rng: Rng): GeneratedMap {
  const scenario = scenarioById(config.scenario ?? 'classic');
  const template: MapTemplate = config.template ?? scenario.template;
  const totalPlayers = config.opponents + 1;
  const count = config.regionCount;

  const land = buildLandMask(template, rng);
  const landCells: Cell[] = [];
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (land[y * MAP_W + x]) landCells.push({ x, y });
    }
  }

  // 1. 陆地上放置种子点
  const seeds: Cell[] = [];
  const minDist = Math.sqrt(landCells.length / count) * 0.75;
  let guard = 0;
  while (seeds.length < count && guard++ < 6000) {
    const p = landCells[Math.floor(rng.next() * landCells.length)];
    if (seeds.some((s) => dist2(s, p) < minDist * minDist)) continue;
    seeds.push(p);
  }
  guard = 0;
  while (seeds.length < count && guard++ < 6000) {
    seeds.push(landCells[Math.floor(rng.next() * landCells.length)]);
  }

  // 2. Voronoi 划分（仅陆地）
  const regionOf = new Map<string, number>();
  const cells: Cell[][] = seeds.map(() => []);
  for (const c of landCells) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < seeds.length; i++) {
      const d = dist2(c, seeds[i]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    regionOf.set(`${c.x},${c.y}`, best);
    cells[best].push(c);
  }

  // 3. 邻接
  const adj: Set<number>[] = seeds.map(() => new Set());
  for (const c of landCells) {
    const id = regionOf.get(`${c.x},${c.y}`)!;
    for (const [dx, dy] of DIRS) {
      const nx = c.x + dx;
      const ny = c.y + dy;
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
      if (!land[ny * MAP_W + nx]) continue;
      const nid = regionOf.get(`${nx},${ny}`)!;
      if (nid !== id) {
        adj[id].add(nid);
        adj[nid].add(id);
      }
    }
  }

  const regions: Region[] = seeds.map((_s, i) => {
    const cx = cells[i].reduce((sum, c) => sum + c.x, 0) / cells[i].length;
    const cy = cells[i].reduce((sum, c) => sum + c.y, 0) / cells[i].length;
    let center = cells[i][0];
    let bestD = Infinity;
    for (const c of cells[i]) {
      const d = dist2(c, { x: cx, y: cy });
      if (d < bestD) {
        bestD = d;
        center = c;
      }
    }
    return {
      id: i,
      name: '',
      type: 'plains' as RegionType,
      owner: NEUTRAL,
      army: NEUTRAL_ARMY,
      cells: cells[i],
      center: { x: center.x + 0.5, y: center.y + 0.5 },
      neighbors: [...adj[i]],
      seaNeighbors: [],
      specials: [],
      pendingBonus: 0,
      capital: false,
      siege: 0,
    };
  });

  // 4. 连通不同大陆（跨海路）
  connectComponents(regions);

  // 5. 区域命名
  assignNames(regions);

  // 6. 玩家首都 / 中立城
  assignPlayerCapitals(regions, totalPlayers);
  assignNeutralCities(regions, totalPlayers, rng);

  // 7. 其余区域随机类型 + 特殊区
  const weights: [RegionType, number][] = [
    ['plains', 30],
    ['forest', 22],
    ['mountain', 16],
    ['farm', 16],
    ['mine', 16],
  ];
  for (const r of regions) {
    if (r.type !== 'plains' || r.owner !== NEUTRAL) continue;
    r.type = weightedPick(rng, weights);
  }
  assignSpecials(regions, rng);

  // 8. 剧本国家池
  const pool = scenario.nationIds
    .map((id) => nationById(id))
    .filter((n): n is NonNullable<typeof n> => !!n);
  const nations = pool.length > 0 ? pool : NATIONS;
  const humanNation = nations.find((n) => n.id === config.nationId) ?? nations[0];
  const others = rng.shuffle(nations.filter((n) => n.id !== humanNation.id));

  const players: Player[] = [
    { id: 0, name: humanNation.name, nationId: humanNation.id, isHuman: true, difficulty: config.difficulty, alive: true, turns: 0, seen: [], intel: {} },
  ];
  for (let i = 1; i <= config.opponents; i++) {
    const n = others.length > 0 ? others[(i - 1) % others.length] : humanNation;
    players.push({ id: i, name: n.name, nationId: n.id, isHuman: false, difficulty: config.difficulty, alive: true, turns: 0, seen: [], intel: {} });
  }

  return { regions, players, template };
}
