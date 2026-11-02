import {
  MAP_H,
  MAP_W,
  REGION_ICONS,
  SPECIAL_ICONS,
  nationColor,
  nationEmoji,
  type GameState,
  type PlayerId,
  type Region,
  type RegionType,
} from '@gongfa-war/core';
import { easeOutCubic, type Camera } from './camera';
import { drawIcon, iconAspect, lighten, SPECIAL_ICON, TERRAIN_ICON } from './icons';

export const CELL = 24;
/** 像素放大倍数：先按低分辨率绘制再整数放大，得到明确的大像素颗粒 */
const PX = 2;
const LC = CELL / PX;

const emojiFont = (size: number): string =>
  `${size}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`;

/** 圆角矩形路径（图标底板 / 区域名标签用），以中心点定位 */
function roundPlate(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  h: number,
  r: number,
): void {
  const x = cx - w / 2;
  const y = cy - h / 2;
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

export const REGION_COLORS: Record<RegionType, string> = {
  city: '#9b7fc4',
  mine: '#c2a06a',
  farm: '#8fd18a',
  plains: '#b9d99a',
  forest: '#6fae6a',
  mountain: '#a8adb3',
};

export const NEUTRAL_FILLS: Record<RegionType, string> = {
  city: '#84898f',
  mine: '#8a9096',
  farm: '#939aa1',
  plains: '#9aa1a8',
  forest: '#828990',
  mountain: '#767c83',
};

export function ownerColor(state: GameState, owner: PlayerId): string {
  if (owner < 0) return '#8a8a8a';
  const p = state.players[owner];
  return p ? nationColor(p.nationId) : '#8a8a8a';
}

export function buildRegionGrid(regions: Region[]): Int16Array {
  const grid = new Int16Array(MAP_W * MAP_H).fill(-1);
  for (const r of regions) {
    for (const c of r.cells) {
      if (c.x < 0 || c.y < 0 || c.x >= MAP_W || c.y >= MAP_H) continue;
      grid[c.y * MAP_W + c.x] = r.id;
    }
  }
  return grid;
}

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ar = (pa >> 16) & 255;
  const ag = (pa >> 8) & 255;
  const ab = pa & 255;
  const br = (pb >> 16) & 255;
  const bg = (pb >> 8) & 255;
  const bb = pb & 255;
  return `#${(
    (Math.round(ar + (br - ar) * t) << 16) |
    (Math.round(ag + (bg - ag) * t) << 8) |
    Math.round(ab + (bb - ab) * t)
  )
    .toString(16)
    .padStart(6, '0')}`;
}

function tile(draw: (g: CanvasRenderingContext2D) => void, size = 8): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d')!;
  draw(g);
  return c;
}

// 色盲友好纹理
const patternTiles: HTMLCanvasElement[] = [];
function nationPattern(idx: number): HTMLCanvasElement {
  const kind = ((idx % 6) + 6) % 6;
  if (patternTiles[kind]) return patternTiles[kind];
  const c = tile((g) => {
    g.strokeStyle = 'rgba(0,0,0,0.22)';
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.lineWidth = 1.4;
    if (kind === 0) {
      g.beginPath();
      g.moveTo(-2, 6);
      g.lineTo(6, -2);
      g.moveTo(2, 10);
      g.lineTo(10, 2);
      g.stroke();
    } else if (kind === 1) {
      g.beginPath();
      g.moveTo(-2, 2);
      g.lineTo(6, 10);
      g.moveTo(2, -2);
      g.lineTo(10, 6);
      g.stroke();
    } else if (kind === 2) {
      g.beginPath();
      g.moveTo(0, 4);
      g.lineTo(8, 4);
      g.stroke();
    } else if (kind === 3) {
      g.beginPath();
      g.moveTo(4, 0);
      g.lineTo(4, 8);
      g.stroke();
    } else if (kind === 4) {
      g.beginPath();
      g.arc(4, 4, 1.7, 0, Math.PI * 2);
      g.fill();
    } else {
      g.beginPath();
      g.moveTo(0, 4);
      g.lineTo(8, 4);
      g.moveTo(4, 0);
      g.lineTo(4, 8);
      g.stroke();
    }
  });
  patternTiles[kind] = c;
  return c;
}

// 无主之地的棋盘抖动纹理
let neutralDither: HTMLCanvasElement | null = null;
function ditherFor(base: string): HTMLCanvasElement {
  if (neutralDither) return neutralDither;
  neutralDither = tile((g) => {
    g.fillStyle = base;
    g.fillRect(0, 0, 2, 2);
    g.fillStyle = 'rgba(0,0,0,0.10)';
    g.fillRect(0, 0, 1, 1);
    g.fillRect(1, 1, 1, 1);
  }, 2);
  return neutralDither;
}

export interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: string;
  born: number;
}

export interface Pulse {
  regionId: number;
  born: number;
  color: string;
  kind: 'hit' | 'capture' | 'move';
}

export interface RenderView {
  game: GameState;
  camera: Camera;
  width: number;
  height: number;
  selection: number | null;
  hover: number | null;
  /** 可进攻（红） */
  attackable: number[];
  /** 可调兵（绿） */
  movable: number[];
  /** 可行军（金）：调兵最大范围（2~3 跳） */
  marchable: number[];
  /** 行军路径（悬停可调兵目标时高亮，含起点与终点） */
  marchPath: number[];
  /** 可派侦查兵的目标（青色虚线） */
  scoutable: number[];
  /** 侦查情报：区域 id → 上次看到的兵力（用于替代「?」） */
  intel: Map<number, { army: number; stale: boolean }>;
  /** 己方受威胁区域（红脉冲 + ⚠️） */
  threatened: number[];
  /** 悬停目标的进攻预估（显示在 tooltip） */
  hint: { commit: number; win: number } | null;
  /** 战争迷雾：当前可见区域 */
  visible: Set<number>;
  /** 战争迷雾：已探索（但可能当前不可见）区域 */
  known: Set<number>;
  regionGrid: Int16Array;
  anims: FloatingText[];
  pulses: Pulse[];
  now: number;
}

function cellRegion(grid: Int16Array, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return -1;
  return grid[y * MAP_W + x];
}

/** 沿区域轮廓描边（含海岸线）：路径按世界坐标缓存为 Path2D，每帧只 stroke 一次 */
let outlinePaths: Path2D[] | null = null;
let outlineGrid: Int16Array | null = null;

function getOutlinePaths(regions: Region[], grid: Int16Array): Path2D[] {
  if (outlinePaths && outlineGrid === grid) return outlinePaths;
  const paths: Path2D[] = [];
  for (const r of regions) {
    const path = new Path2D();
    for (const c of r.cells) {
      const x = c.x * CELL;
      const y = c.y * CELL;
      const edges = [
        { nx: c.x + 1, ny: c.y, x1: x + CELL, y1: y, x2: x + CELL, y2: y + CELL },
        { nx: c.x - 1, ny: c.y, x1: x, y1: y, x2: x, y2: y + CELL },
        { nx: c.x, ny: c.y + 1, x1: x, y1: y + CELL, x2: x + CELL, y2: y + CELL },
        { nx: c.x, ny: c.y - 1, x1: x, y1: y, x2: x + CELL, y2: y },
      ];
      for (const e of edges) {
        if (cellRegion(grid, e.nx, e.ny) === r.id) continue;
        path.moveTo(e.x1, e.y1);
        path.lineTo(e.x2, e.y2);
      }
    }
    paths[r.id] = path;
  }
  outlinePaths = paths;
  outlineGrid = grid;
  return paths;
}

function outline(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  regions: Region[],
  region: Region,
  grid: Int16Array,
  color: string,
  lineWidth: number,
  dashed = false,
): void {
  const path = getOutlinePaths(regions, grid)[region.id];
  if (!path) return;
  ctx.save();
  ctx.translate(camera.offsetX, camera.offsetY);
  ctx.scale(camera.scale, camera.scale);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth / camera.scale;
  if (dashed) ctx.setLineDash([6 / camera.scale, 4 / camera.scale]);
  ctx.stroke(path);
  ctx.restore();
}

/** 区域填充（调兵范围底色）：复用同一份缓存路径，开销很低 */
function fillRegion(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  regions: Region[],
  region: Region,
  grid: Int16Array,
  color: string,
): void {
  const path = getOutlinePaths(regions, grid)[region.id];
  if (!path) return;
  ctx.save();
  ctx.translate(camera.offsetX, camera.offsetY);
  ctx.scale(camera.scale, camera.scale);
  ctx.fillStyle = color;
  ctx.fill(path);
  ctx.restore();
}

/** 悬停提示气泡：地名 / 归属 / 兵力（可附带进攻预估） */
function drawTooltip(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  game: GameState,
  region: Region,
  width: number,
  hint: string | null,
  blind?: 'fog' | 'unknown',
): void {
  const p = camera.worldToScreen(region.center.x * CELL, region.center.y * CELL);
  const cs = CELL * camera.scale;
  const owner = region.owner < 0 ? '中立' : game.players[region.owner]?.name ?? '?';
  const sp = (region.specials ?? []).map((s) => SPECIAL_ICONS[s] ?? '').join('');
  const line1 =
    blind === 'unknown'
      ? '🌫 未探索区域'
      : blind === 'fog'
        ? `${REGION_ICONS[region.type]}${sp} ${region.name} · ${owner} · 兵力未知`
        : `${REGION_ICONS[region.type]}${sp} ${region.name} · ${owner} · ${region.army}兵`;
  const size = Math.max(11, Math.round(13 * Math.min(1.4, Math.max(0.7, camera.scale))));
  ctx.font = `bold ${size}px ui-monospace, monospace`;
  const w = Math.round(Math.max(ctx.measureText(line1).width, hint ? ctx.measureText(hint).width : 0) + 34);
  const h = hint ? size * 2 + 20 : size + 14;
  const x = Math.round(Math.min(Math.max(6, p.x - w / 2), width - w - 6));
  const y = Math.round(Math.max(64, p.y - cs * 1.3 - h));

  ctx.fillStyle = 'rgba(10,18,28,0.95)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#05090f';
  ctx.lineWidth = 3;
  ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
  ctx.strokeStyle = ownerColor(game, region.owner);
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 4, y + 4, w - 8, h - 8);

  ctx.fillStyle = ownerColor(game, region.owner);
  ctx.fillRect(x + 9, y + (hint ? 13 : h / 2) - 5, 10, 10);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#e8eef1';
  ctx.fillText(line1, x + 25, y + (hint ? 14 : h / 2 + 1));
  if (hint) {
    ctx.fillStyle = '#ffd34d';
    ctx.fillText(hint, x + 25, y + size + 18);
  }
}

// ===== 低分辨率底图缓存 =====
let baseCanvas: HTMLCanvasElement | null = null;
let baseSig = '';

function baseSignature(game: GameState): string {
  let sig = '';
  for (const r of game.regions) sig += `${r.owner}:${r.type}:${(r.specials ?? []).join('+')}|`;
  for (const p of game.players) sig += `${p.nationId},`;
  return sig;
}

function renderBase(game: GameState, grid: Int16Array): HTMLCanvasElement {
  if (!baseCanvas) {
    baseCanvas = document.createElement('canvas');
    baseCanvas.width = MAP_W * LC;
    baseCanvas.height = MAP_H * LC;
  }
  const sig = baseSignature(game);
  if (sig === baseSig) return baseCanvas;
  baseSig = sig;

  const g = baseCanvas.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, baseCanvas.width, baseCanvas.height);

  // 1. 填充（无主之地用棋盘抖动纹理）
  for (const r of game.regions) {
    if (r.owner < 0) {
      const pat = g.createPattern(ditherFor(NEUTRAL_FILLS[r.type]), 'repeat');
      g.fillStyle = pat ?? NEUTRAL_FILLS[r.type];
    } else {
      g.fillStyle = mix(REGION_COLORS[r.type], ownerColor(game, r.owner), 0.78);
    }
    for (const c of r.cells) g.fillRect(c.x * LC, c.y * LC, LC, LC);
  }

  // 2. 势力纹理
  for (const r of game.regions) {
    if (r.owner < 0) continue;
    const pat = g.createPattern(nationPattern(r.owner), 'repeat');
    if (!pat) continue;
    g.fillStyle = pat;
    for (const c of r.cells) g.fillRect(c.x * LC, c.y * LC, LC, LC);
  }

  // 3. 斜面高光 + 边界
  g.lineCap = 'butt';
  for (const r of game.regions) {
    const ocol = ownerColor(game, r.owner);
    for (const c of r.cells) {
      const x = c.x * LC;
      const y = c.y * LC;
      const nN = cellRegion(grid, c.x, c.y - 1);
      const nW = cellRegion(grid, c.x - 1, c.y);
      const nS = cellRegion(grid, c.x, c.y + 1);
      const nE = cellRegion(grid, c.x + 1, c.y);
      const diff = (n: number): boolean => n !== r.id;

      // 斜面：上/左亮，下/右暗
      g.lineWidth = PX;
      if (diff(nN)) {
        g.strokeStyle = 'rgba(255,255,255,0.16)';
        g.beginPath();
        g.moveTo(x, y + 1);
        g.lineTo(x + LC, y + 1);
        g.stroke();
      }
      if (diff(nW)) {
        g.strokeStyle = 'rgba(255,255,255,0.12)';
        g.beginPath();
        g.moveTo(x + 1, y);
        g.lineTo(x + 1, y + LC);
        g.stroke();
      }
      if (diff(nS)) {
        g.strokeStyle = 'rgba(0,0,0,0.22)';
        g.beginPath();
        g.moveTo(x, y + LC - 1);
        g.lineTo(x + LC, y + LC - 1);
        g.stroke();
      }
      if (diff(nE)) {
        g.strokeStyle = 'rgba(0,0,0,0.18)';
        g.beginPath();
        g.moveTo(x + LC - 1, y);
        g.lineTo(x + LC - 1, y + LC);
        g.stroke();
      }
    }
  }

  // 4. 海岸线 + 归属边界
  for (const r of game.regions) {
    const ocol = ownerColor(game, r.owner);
    for (const c of r.cells) {
      const x = c.x * LC;
      const y = c.y * LC;
      const edges = [
        { nx: c.x + 1, ny: c.y, x1: x + LC, y1: y, x2: x + LC, y2: y + LC },
        { nx: c.x - 1, ny: c.y, x1: x, y1: y, x2: x, y2: y + LC },
        { nx: c.x, ny: c.y + 1, x1: x, y1: y + LC, x2: x + LC, y2: y + LC },
        { nx: c.x, ny: c.y - 1, x1: x, y1: y, x2: x + LC, y2: y },
      ];
      for (const e of edges) {
        const nid = cellRegion(grid, e.nx, e.ny);
        if (nid === r.id) continue;
        if (nid < 0) {
          g.strokeStyle = '#e7d7b0';
          g.lineWidth = PX * 1.5;
        } else if (game.regions[nid]?.owner === r.owner) {
          g.strokeStyle = 'rgba(0,0,0,0.16)';
          g.lineWidth = 1;
        } else {
          g.strokeStyle = ocol;
          g.lineWidth = PX * 1.5;
        }
        g.beginPath();
        g.moveTo(e.x1, e.y1);
        g.lineTo(e.x2, e.y2);
        g.stroke();
      }
    }
  }

  return baseCanvas;
}

export function draw(ctx: CanvasRenderingContext2D, view: RenderView): void {
  const { game, camera, width, height, regionGrid } = view;
  const cs = CELL * camera.scale;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);

  // 0. 海洋背景（渐变 + 波光）
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, '#07182a');
  grad.addColorStop(0.55, '#0e2c45');
  grad.addColorStop(1, '#123a58');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  const step = CELL * camera.scale;
  const t = view.now / 1000;
  const ox = ((camera.offsetX % step) + step) % step;
  const oy = ((camera.offsetY % step) + step) % step;
  ctx.lineWidth = 1;
  for (let i = 0, x = ox; x < width; x += step, i++) {
    ctx.strokeStyle = `rgba(120,190,235,${0.05 + 0.035 * Math.sin(t * 1.4 + i * 0.6)})`;
    ctx.beginPath();
    ctx.moveTo(Math.round(x), 0);
    ctx.lineTo(Math.round(x), height);
    ctx.stroke();
  }
  for (let i = 0, y = oy; y < height; y += step, i++) {
    ctx.strokeStyle = `rgba(120,190,235,${0.05 + 0.035 * Math.sin(t * 1.1 + i * 0.45)})`;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(y));
    ctx.lineTo(width, Math.round(y));
    ctx.stroke();
  }

  // 1. 底图（低分辨率 → 整数放大，得到大像素颗粒）
  const base = renderBase(game, regionGrid);
  const dw = Math.round(base.width * PX * camera.scale);
  const dh = Math.round(base.height * PX * camera.scale);
  ctx.drawImage(base, Math.round(camera.offsetX), Math.round(camera.offsetY), dw, dh);

  // 1.5 战争迷雾：未探索 ≈ 全黑；已探索但当前不可见 = 半透明暗罩
  for (const r of game.regions) {
    if (view.visible.has(r.id)) continue;
    ctx.fillStyle = view.known.has(r.id) ? 'rgba(6,12,20,0.55)' : 'rgba(4,8,14,0.92)';
    for (const c of r.cells) {
      const q = camera.worldToScreen(c.x * CELL, c.y * CELL);
      ctx.fillRect(q.x, q.y, cs + 1, cs + 1);
    }
  }

  // 2. 可达区域分色：红=可进攻 / 绿=可调兵（1 跳）/ 金=可行军（2~3 跳，即调兵最大范围）
  // 先铺底色，再描边，让"能调到哪"一眼看出来
  for (const id of view.marchable) {
    const r = game.regions[id];
    if (r) fillRegion(ctx, camera, game.regions, r, regionGrid, 'rgba(255,211,77,0.16)');
  }
  for (const id of view.movable) {
    const r = game.regions[id];
    if (r) fillRegion(ctx, camera, game.regions, r, regionGrid, 'rgba(120,225,140,0.18)');
  }
  for (const id of view.marchable) {
    const r = game.regions[id];
    if (r) outline(ctx, camera, game.regions, r, regionGrid, 'rgba(255,211,77,0.9)', 3, true);
  }
  for (const id of view.movable) {
    const r = game.regions[id];
    if (r) outline(ctx, camera, game.regions, r, regionGrid, 'rgba(120,225,140,0.95)', 3);
  }
  for (const id of view.attackable) {
    const r = game.regions[id];
    if (r) outline(ctx, camera, game.regions, r, regionGrid, 'rgba(255,90,90,0.95)', 3);
  }
  // 可派侦查兵的目标：青色虚线
  for (const id of view.scoutable) {
    const r = game.regions[id];
    if (r && !view.attackable.includes(id)) {
      outline(ctx, camera, game.regions, r, regionGrid, 'rgba(110,220,255,0.8)', 3, true);
    }
  }

  // 行军路径：悬停某个可调兵区域时，把经过的格子串成金色虚线
  if (view.marchPath.length > 1) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,211,77,0.95)';
    ctx.lineWidth = Math.max(2, CELL * camera.scale * 0.16);
    ctx.setLineDash([CELL * camera.scale * 0.34, CELL * camera.scale * 0.24]);
    ctx.beginPath();
    for (let i = 0; i < view.marchPath.length; i++) {
      const r = game.regions[view.marchPath[i]];
      if (!r) continue;
      const p = camera.worldToScreen(r.center.x * CELL, r.center.y * CELL);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // 受威胁的己方区域：红色脉冲
  const threatAlpha = 0.4 + 0.45 * Math.sin(view.now / 170);
  for (const id of view.threatened) {
    const r = game.regions[id];
    if (r) outline(ctx, camera, game.regions, r, regionGrid, `rgba(255,80,80,${threatAlpha})`, 4);
  }

  if (view.hover != null && game.regions[view.hover]) {
    outline(ctx, camera, game.regions, game.regions[view.hover], regionGrid, 'rgba(255,255,255,0.9)', 2);
  }
  if (view.selection != null && game.regions[view.selection]) {
    outline(ctx, camera, game.regions, game.regions[view.selection], regionGrid, '#ffd34d', 4);
  }

  // 3. 冲击动效（占领闪光 + 扩散环）
  for (const p of view.pulses) {
    const r = game.regions[p.regionId];
    if (!r || !view.known.has(p.regionId)) continue;
    const pt = (view.now - p.born) / (p.kind === 'capture' ? 900 : 620);
    if (pt < 0 || pt > 1) continue;

    ctx.globalAlpha = (1 - pt) * (p.kind === 'capture' ? 0.6 : 0.34);
    ctx.fillStyle = p.color;
    for (const c of r.cells) {
      const q = camera.worldToScreen(c.x * CELL, c.y * CELL);
      ctx.fillRect(q.x, q.y, cs + 1, cs + 1);
    }

    const center = camera.worldToScreen(r.center.x * CELL, r.center.y * CELL);
    ctx.globalAlpha = 1 - pt;
    ctx.beginPath();
    ctx.arc(center.x, center.y, easeOutCubic(pt) * cs * 2.4 + 4, 0, Math.PI * 2);
    ctx.strokeStyle = p.color;
    ctx.lineWidth = Math.max(2, cs * 0.2 * (1 - pt));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // 4. 区域信息：兵力徽章 + 地形/设施/国旗图标 + 区域名（分层排版，矢量图标）
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const r of game.regions) {
    const p = camera.worldToScreen(r.center.x * CELL, r.center.y * CELL);
    // 分级显示：缩得很小时只留兵力数字；放大后是「小兵 + 头顶数量 + 周边标记」
    const tiny = cs < 15;
    // 小兵图标（用户提供的 SVG）：用国家色的"提亮版"，加粗描边，保证在同类色地块上也跳得出来
    const unitW = Math.max(20, Math.min(60, cs * 1.18));
    const unitH = unitW * iconAspect('soldier');
    const baseColor = r.owner < 0 ? '#8f9aa8' : ownerColor(game, r.owner);
    const unitColor = lighten(baseColor, r.owner < 0 ? 0.32 : 0.55);
    const numSize = Math.max(11, Math.min(26, Math.round(cs * 0.55)));
    const small = Math.max(11, Math.round(Math.min(22, cs * 0.46)));

    // 战争迷雾：未知区域不画任何标记；已探索但不可见只显示「?」
    const vis = view.visible.has(r.id);
    const know = vis || view.known.has(r.id);
    if (!know) continue;
    if (!vis) {
      // 有侦查情报：显示"看到的兵力"（过时加 ~ 前缀），否则只显示 ?
      const intel = view.intel.get(r.id);
      if (intel) {
        const numSize = Math.max(11, Math.min(26, Math.round(cs * 0.55)));
        const unitW = Math.max(18, Math.min(60, cs * 1.18));
        const unitH = unitW * iconAspect('soldier');
        const unitY = p.y + unitH * 0.06;
        const ownerTint = r.owner < 0 ? '#8f9aa8' : lighten(ownerColor(game, r.owner), 0.55);
        ctx.globalAlpha = intel.stale ? 0.55 : 0.85;
        ctx.beginPath();
        ctx.ellipse(p.x, unitY + unitH * 0.5, unitW * 0.38, unitH * 0.1, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(6,10,16,0.3)';
        ctx.fill();
        drawIcon(ctx, 'soldier', p.x, unitY, unitW, ownerTint, 2.4);
        const label = `${intel.stale ? '~' : ''}${intel.army}`;
        ctx.font = `bold ${numSize}px ui-monospace, monospace`;
        ctx.lineWidth = Math.max(3, numSize * 0.34);
        ctx.strokeStyle = 'rgba(4,8,14,0.92)';
        ctx.strokeText(label, p.x, unitY - unitH * 0.5 - numSize * 0.62);
        ctx.fillStyle = '#dff3ff';
        ctx.fillText(label, p.x, unitY - unitH * 0.5 - numSize * 0.62);
        ctx.globalAlpha = 1;
      } else {
        const rr = Math.max(9, cs * 0.4);
        ctx.beginPath();
        ctx.arc(p.x, p.y, rr, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(8,14,22,0.85)';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = `bold ${Math.max(11, Math.round(rr * 1.1))}px ui-monospace, monospace`;
        ctx.fillText('?', p.x, p.y + 1);
      }
      continue;
    }

    // ===== 小兵 + 头顶数量 =====
    const unitY = p.y + unitH * 0.06; // 略微下移，给头顶数字留位置
    if (!tiny) {
      // 受威胁：脚下红色脉冲椭圆（替代原来的 ⚠️ emoji）
      if (view.threatened.includes(r.id)) {
        ctx.beginPath();
        ctx.ellipse(p.x, unitY + unitH * 0.5, unitW * 0.5 + Math.sin(t * 4) * 1.5, unitH * 0.16, 0, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,90,90,0.85)';
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }
      // 士兵影子（贴地感）
      ctx.beginPath();
      ctx.ellipse(p.x, unitY + unitH * 0.5, unitW * 0.38, unitH * 0.1, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(6,10,16,0.35)';
      ctx.fill();
      drawIcon(ctx, 'soldier', p.x, unitY, unitW, unitColor, 2.8);
    }

    // 数量：显示在头顶（深色描边保证任何底色上都能看清）
    const numY = tiny ? p.y : unitY - unitH * 0.5 - numSize * 0.62;
    ctx.font = `bold ${numSize}px ui-monospace, "PingFang SC", monospace`;
    ctx.lineWidth = Math.max(3, numSize * 0.34);
    ctx.strokeStyle = 'rgba(4,8,14,0.92)';
    ctx.strokeText(String(r.army), p.x, numY);
    ctx.fillStyle = r.owner < 0 ? '#e6ecf2' : '#ffffff';
    ctx.fillText(String(r.army), p.x, numY);

    // ===== 周边标记（放大后才显示，避免小尺寸糊成一片）=====
    if (!tiny) {
      // 地形图标：左上
      const tx = p.x - unitW * 0.52;
      const ty = numY - numSize * 0.95;
      roundPlate(ctx, tx, ty, small * 1.2, small * 1.2, small * 0.28);
      ctx.fillStyle = 'rgba(8,14,22,0.5)';
      ctx.fill();
      drawIcon(ctx, TERRAIN_ICON[r.type] ?? 'plains', tx, ty, small * 1.05);
      // 国旗：右上
      if (r.owner >= 0) {
        const fx = p.x + unitW * 0.52;
        roundPlate(ctx, fx, ty, small * 1.14, small * 1.26, small * 0.26);
        ctx.fillStyle = 'rgba(8,14,22,0.5)';
        ctx.fill();
        drawIcon(ctx, 'flag', fx, ty, small * 1.16, nationColor(game.players[r.owner]?.nationId ?? ''));
      }
      // 特殊设施：右下竖排（最多 3 个，每个一种）；首都王冠：左下；围城火焰：右上角
      const facs = r.specials ?? [];
      if (facs.length > 0) {
        const sx = p.x + unitW * 0.56;
        const step = small * 1.3;
        const first = unitY + unitH * 0.42;
        for (let i = 0; i < facs.length; i++) {
          const sy = first + i * step;
          roundPlate(ctx, sx, sy, small * 1.24, small * 1.24, small * 0.28);
          ctx.fillStyle = 'rgba(8,14,22,0.55)';
          ctx.fill();
          // 金色脉冲环：设施越多越亮，一眼看出这区被经营过
          ctx.strokeStyle = `rgba(255,211,77,${0.45 + 0.35 * Math.sin(t * 3 + i)})`;
          ctx.lineWidth = 2;
          ctx.stroke();
          drawIcon(ctx, SPECIAL_ICON[facs[i]] ?? 'barracks', sx, sy, small * 1.05);
        }
      }
      if (r.capital) drawIcon(ctx, 'capital', p.x - unitW * 0.56, unitY + unitH * 0.42, small * 1.15);
      if (r.siege > 0) drawIcon(ctx, 'siege', p.x + unitW * 0.62, numY + numSize * 0.1, small * 1.1);
    } else if (r.capital) {
      drawIcon(ctx, 'capital', p.x - Math.max(7, cs * 0.4), p.y - Math.max(7, cs * 0.4), 11);
    }

    // 区域名：放大到一定程度或选中/悬停时显示（避免小尺寸时糊成一片；阈值下调，
    // 因为手机自动适配后的默认缩放约为 1.0~1.3，cs 通常只有 24~31）
    const showName = !tiny && (cs >= 21 || view.selection === r.id || view.hover === r.id);
    if (showName) {
      const label = r.name;
      const fs = Math.max(11, Math.round(Math.min(15, cs * 0.34)));
      ctx.font = `bold ${fs}px ui-monospace, "PingFang SC", monospace`;
      const w = ctx.measureText(label).width + fs * 0.9;
      const ly = unitY + unitH * 0.5 + fs * 0.95;
      roundPlate(ctx, p.x, ly, w, fs * 1.5, fs * 0.35);
      ctx.fillStyle = 'rgba(6,11,18,0.72)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = r.owner < 0 ? '#c8d2dc' : '#ffffff';
      ctx.fillText(label, p.x, ly + 0.5);
    }
  }

  // 5. 浮动文字（缓动上浮 + 缩放弹入）
  for (const a of view.anims) {
    const at = (view.now - a.born) / 1300;
    if (at < 0 || at > 1) continue;
    const e = easeOutCubic(at);
    const p = camera.worldToScreen(a.x, a.y);
    const y = p.y - 46 * e - 6;
    const pop = at < 0.18 ? 0.7 + (at / 0.18) * 0.45 : 1.15 - (at - 0.18) * 0.15;
    const size = Math.max(12, Math.round(18 * camera.scale * pop));
    ctx.globalAlpha = at > 0.7 ? (1 - at) / 0.3 : 1;
    ctx.font = `bold ${size}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(3, size * 0.22);
    ctx.strokeStyle = 'rgba(4,10,18,0.85)';
    ctx.strokeText(a.text, p.x, y);
    ctx.fillStyle = a.color;
    ctx.fillText(a.text, p.x, y);
    ctx.globalAlpha = 1;
  }

  // 6. 威胁标记 + 悬停提示气泡
  for (const id of view.threatened) {
    const r = game.regions[id];
    if (!r || !view.visible.has(id)) continue;
    const p = camera.worldToScreen(r.center.x * CELL, r.center.y * CELL);
    ctx.font = emojiFont(Math.max(14, Math.round(cs * 0.85)));
    ctx.fillText('⚠️', p.x, p.y + cs * 0.95);
  }
  if (view.hover != null && game.regions[view.hover]) {
    ctx.globalAlpha = 1;
    const vis = view.visible.has(view.hover);
    const hint = view.hint && vis ? `进攻 ${view.hint.commit} 兵 · 胜率 ${Math.round(view.hint.win * 100)}%` : null;
    drawTooltip(
      ctx,
      camera,
      game,
      game.regions[view.hover],
      width,
      hint,
      vis ? undefined : view.known.has(view.hover) ? 'fog' : 'unknown',
    );
  }
}

// ===== 小地图：1 格 = 1 像素，重绘用 ImageData，开销极低 =====
let miniImage: ImageData | null = null;

export interface MinimapView {
  game: GameState;
  regionGrid: Int16Array;
  camera: Camera;
  visible: Set<number>;
  known: Set<number>;
  fogOn: boolean;
  viewW: number;
  viewH: number;
}

/** 把 RGB 字符串转成字节（只支持 #rrggbb，其余走默认） */
function rgbOf(color: string): [number, number, number] {
  if (color.startsWith('#') && color.length === 7) {
    return [
      parseInt(color.slice(1, 3), 16),
      parseInt(color.slice(3, 5), 16),
      parseInt(color.slice(5, 7), 16),
    ];
  }
  return [120, 130, 140];
}

export function drawMinimap(ctx: CanvasRenderingContext2D, view: MinimapView): void {
  const { game, regionGrid, camera, visible, known, fogOn, viewW, viewH } = view;
  if (!miniImage || miniImage.width !== MAP_W || miniImage.height !== MAP_H) {
    miniImage = ctx.createImageData(MAP_W, MAP_H);
  }
  const img = miniImage;
  const d = img.data;
  const OCEAN: [number, number, number] = [10, 28, 46];
  const EXPLORED: [number, number, number] = [70, 86, 104];
  const NEUTRAL: [number, number, number] = [107, 118, 132];
  const cache = new Map<number, [number, number, number]>();

  for (let i = 0, p = 0; i < MAP_W * MAP_H; i++, p += 4) {
    const id = regionGrid[i];
    let rgb = OCEAN;
    if (id >= 0) {
      const r = game.regions[id];
      if (r) {
        if (fogOn && !known.has(id)) {
          rgb = OCEAN;
        } else if (fogOn && !visible.has(id)) {
          rgb = EXPLORED;
        } else if (r.owner < 0) {
          rgb = NEUTRAL;
        } else {
          let c = cache.get(r.owner);
          if (!c) {
            c = rgbOf(ownerColor(game, r.owner));
            cache.set(r.owner, c);
          }
          rgb = c;
        }
      }
    }
    d[p] = rgb[0];
    d[p + 1] = rgb[1];
    d[p + 2] = rgb[2];
    d[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  // 当前视口框
  const tl = camera.screenToWorld(0, 0);
  const br = camera.screenToWorld(viewW, viewH);
  const x0 = Math.max(0, Math.min(MAP_W - 2, Math.floor(tl.x / CELL)));
  const y0 = Math.max(0, Math.min(MAP_H - 2, Math.floor(tl.y / CELL)));
  const w = Math.max(2, Math.min(MAP_W - x0, Math.round((br.x - tl.x) / CELL)));
  const h = Math.max(2, Math.min(MAP_H - y0, Math.round((br.y - tl.y) / CELL)));
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.strokeRect(x0 - 0.5, y0 - 0.5, w + 1, h + 1);
}
