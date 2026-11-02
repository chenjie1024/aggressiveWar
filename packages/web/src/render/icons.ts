// 地图图标库：全部用 SVG 路径数据（Path2D）绘制，矢量缩放不糊、无需异步加载图片。
// 风格统一：深色描边 + 蓝/金/绿/灰配色（与像素风 UI 一致）。
// 坐标系 24×24，调用方给中心点与尺寸即可。

export type IconName =
  | 'city'
  | 'mine'
  | 'farm'
  | 'plains'
  | 'forest'
  | 'mountain'
  | 'barracks'
  | 'fortress'
  | 'treasury'
  | 'capital'
  | 'siege'
  | 'flag'
  | 'soldier';

interface Layer {
  d: string;
  fill: string;
}

const GOLD = '#F3D24F';
const GOLD_DARK = '#B8901F';
const BLUE = '#9CCDF0';
const BLUE_DARK = '#5DA1D3';
const DARK = '#3B3F46';
const DARKER = '#2A2E34';
const GREEN = '#6FBF73';
const GREEN_DARK = '#3E8E48';
const GRAY = '#B9C2CC';
const GRAY_DARK = '#7C848F';
const RED = '#E2574C';
const ORANGE = '#F08A3C';
const BROWN = '#8A5A2B';
const WHITE = '#EAF2F8';

/** 城堡（城池）：带雉堞的城墙 + 城门 + 旗 */
const CITY: Layer[] = [
  { d: 'M2 7h4v2h2V7h8v2h2V7h4v14H2z', fill: DARK },
  { d: 'M3.4 8.4h1.2v2h3.6v-2h7.6v2h3.6v-2h1.2v11.2H3.4z', fill: BLUE },
  { d: 'M10 19.6v-3.2a2 2 0 0 1 4 0v3.2z', fill: GOLD },
  { d: 'M11.2 2.2h1.4v4.4h-1.4z', fill: DARK },
  { d: 'M12.6 2.2l4.4 1.5-4.4 1.5z', fill: RED },
];

/** 矿场：矿洞 + 金块 */
const MINE: Layer[] = [
  { d: 'M2.6 20.6V12a9.4 9.4 0 0 1 18.8 0v8.6z', fill: DARK },
  { d: 'M6.4 20.6V12a5.6 5.6 0 0 1 11.2 0v8.6z', fill: DARKER },
  { d: 'M8.6 18.4a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0z', fill: GOLD },
  { d: 'M13.2 16.4a1.3 1.3 0 1 1 2.6 0 1.3 1.3 0 0 1-2.6 0z', fill: GOLD },
  { d: 'M3.6 20.6h16.8v1.6H3.6z', fill: GRAY_DARK },
];

/** 农场：麦穗 */
const FARM: Layer[] = [
  { d: 'M11.2 21.6V9h1.6v12.6z', fill: GOLD_DARK },
  { d: 'M12 2.4c1.8 1.8 2.6 3.6 2.6 5.8 0 1.3-1.1 2.4-2.6 3.3-1.5-.9-2.6-2-2.6-3.3 0-2.2.8-4 2.6-5.8z', fill: GOLD },
  { d: 'M12 9.4c1.7 1.6 2.6 3.1 2.6 5 0 1.2-1.1 2.2-2.6 3-1.5-.8-2.6-1.8-2.6-3 0-1.9.9-3.4 2.6-5z', fill: GOLD },
  { d: 'M12 15.6c1.6 1.4 2.4 2.7 2.4 4.4 0 1-1 1.9-2.4 2.6-1.4-.7-2.4-1.6-2.4-2.6 0-1.7.8-3 2.4-4.4z', fill: GOLD },
];

/** 平原：草丛 */
const PLAINS: Layer[] = [
  { d: 'M3.4 20.4c0-4.6 1.7-8.1 4.3-9.7-.9 3.4-1.2 6.6-.4 9.7z', fill: GREEN },
  { d: 'M10 20.4c-.4-5.5.7-9.7 3.7-12.5-1.2 4.2-1.7 8.3-1.1 12.5z', fill: GREEN_DARK },
  { d: 'M17 20.4c.6-4.2.2-7.7-1.4-10.5 2.9 1.8 4.5 5.3 4.7 10.5z', fill: GREEN },
  { d: 'M1.8 20.4h20.4v1.7H1.8z', fill: GREEN_DARK },
];

/** 森林：双松 + 树干 */
const FOREST: Layer[] = [
  { d: 'M8 2.6l4.8 7.6H3.2z', fill: GREEN_DARK },
  { d: 'M8 8.2l5.8 9.2H2.2z', fill: GREEN },
  { d: 'M16.6 6.6l3.8 6.2h-7.6z', fill: GREEN },
  { d: 'M7.2 17.4h1.7v4.2H7.2z', fill: BROWN },
];

/** 山地：雪顶山峰 */
const MOUNTAIN: Layer[] = [
  { d: 'M1.4 20.4L9 6.6l4.1 6.9 2.5-3.3 7.1 10.2z', fill: GRAY },
  { d: 'M6.3 11.2L9 6.6l2.7 4.6-1.4 1.7H7.7z', fill: WHITE },
  { d: 'M1.4 20.4h21.2v1.7H1.4z', fill: GRAY_DARK },
];

/** 兵营：军帐 + 旗 */
const BARRACKS: Layer[] = [
  { d: 'M12 3.6l8.4 17H3.6z', fill: GOLD },
  { d: 'M12 11.6l4.3 9h-8.6z', fill: GOLD_DARK },
  { d: 'M11.2 1h1.6v3.6h-1.6z', fill: DARK },
  { d: 'M12.8 1h4.2l-1.3 1.3 1.3 1.3h-4.2z', fill: RED },
];

/** 要塞：盾牌 + 十字 */
const FORTRESS: Layer[] = [
  { d: 'M12 1.4l9.2 3.3v7.4c0 5.5-4.5 9.2-9.2 11.4-4.7-2.2-9.2-5.9-9.2-11.4V4.7z', fill: DARK },
  { d: 'M12 3.4l7.2 2.6v6c0 4.4-3.5 7.4-7.2 9.2-3.7-1.8-7.2-4.8-7.2-9.2v-6z', fill: BLUE_DARK },
  { d: 'M11 7.2h2v3h3v2h-3v3h-2v-3H8v-2h3z', fill: GOLD },
];

/** 宝库：宝箱 */
const TREASURY: Layer[] = [
  { d: 'M3 10.6h18v10H3z', fill: BROWN },
  { d: 'M3.6 10.7a8.4 4.7 0 0 1 16.8 0z', fill: GOLD },
  { d: 'M3 13.4h18v1.8H3z', fill: GOLD_DARK },
  { d: 'M10.4 11.6h3.2v4.8h-3.2z', fill: GOLD },
  { d: 'M11.4 13.2h1.2v2h-1.2z', fill: DARKER },
];

/** 首都：王冠 */
const CAPITAL: Layer[] = [
  { d: 'M2.4 7.4l4.9 4.1L12 2.8l4.7 8.7 4.9-4.1V19H2.4z', fill: GOLD },
  { d: 'M2.4 19h19.2v2.4H2.4z', fill: GOLD_DARK },
  { d: 'M11 14.4h2v3.4h-2z', fill: RED },
];

/** 围城：火焰 */
const SIEGE: Layer[] = [
  { d: 'M12 1.6c4.7 5.6 7 8.1 7 12.4a7 7 0 0 1-14 0c0-4.3 2.3-6.8 7-12.4z', fill: RED },
  { d: 'M12 8.4c2.5 3.1 3.7 4.6 3.7 6.9a3.7 3.7 0 0 1-7.4 0c0-2.3 1.2-3.8 3.7-6.9z', fill: ORANGE },
  { d: 'M12 13c1.2 1.7 1.9 2.5 1.9 3.8a1.9 1.9 0 0 1-3.8 0c0-1.3.7-2.1 1.9-3.8z', fill: GOLD },
];

/** 国旗：旗杆 + 色块（颜色由国家决定） */
const flagLayers = (color: string): Layer[] => [
  { d: 'M5.4 1.8h1.8v20.4H5.4z', fill: DARK },
  { d: 'M7.2 3.2h11.4l-3.1 3.7 3.1 3.7H7.2z', fill: color },
];

/**
 * 小兵（用户提供的 SVG，viewBox 1206×1024，5 段路径）：整体按归属国家色染色。
 * 单色剪影 + 深色描边，缩到 16px 也能看出是个持矛行军的士兵。
 */
const SOLDIER_PATHS: string[] = [
  'M306.279447 245.014144q100.7201-23.572789 149.294333-44.288271 37.145001-12.857885 69.289714-17.143847 13.572212 0 17.143847-6.428942 2.857308-8.571923-5.714616-18.572501-15.715193-13.572212-51.43154-29.287405-11.429231-7.14327-22.858463-6.428943-6.428943 2.857308-7.143269 11.429232-2.857308 28.573078-159.29491 96.434138c-19.286828 8.571923-10.000577 19.286828 10.714904 14.286539z',
  'M307.708101 325.018762q-0.714327-49.28856 0.714327-62.860771 0.714327-9.28625-2.142981-17.143847c-1.428654-7.857596-1.428654-7.857596-10.714904-14.286539q-20.001155-15.715193-44.288271-21.429809-12.857885-4.285962-20.001155 1.428654-7.14327 5.000289-0.714327 19.286828 20.001155 32.85904 29.287405 69.289714 7.14327 37.145001 24.287116 187.867988c2.142981 21.429809 37.859328 17.858174 35.716348-3.571635q-7.14327-77.861638-10.714904-131.436158l-1.428654-27.144425z',
  'M474.14628 335.01934q98.577119-19.286828 102.863081-23.57279 7.14327-6.428943 3.571635-12.857885-5.000289-9.28625-28.573078-16.42952-19.286828-4.285962-97.148465 17.143847-75.00433 17.858174-147.151352 25.71577c-21.429809 2.142981-20.001155 25.001443 1.428654 27.144425q27.858751 4.285962 97.862792-5.714616 15.715193-2.857308 34.287694-5.714616l32.859039-5.714615z',
  'M474.860607 463.598191q19.286828-75.718657 30.001732-97.148465 2.857308-6.428943-8.571923-17.858174-11.429231-8.571923-22.144136-13.572212c-19.286828-9.28625-41.430963-13.572212-32.859039 5.714615q0 0.714327 1.428653 3.571635 10.714904 17.143847 1.428654 123.578563c-2.142981 21.429809 25.71577 16.42952 30.716059-4.285962z',
  'M284.135311 487.17098q-84.29058 7.14327-175.724429 18.572501-15.715193 0.714327-4.285962 15.000866 11.429231 11.429231 25.001443 15.715193 17.143847 4.285962 29.287405 0.714327 177.867411-45.002598 480.742038-45.716925 17.858174 0 35.716347 0.714327 15.715193 0.714327 20.001155-6.428943 4.285962-9.28625-8.571923-20.001154-41.430963-32.144713-70.718369-25.715771-56.431829 10.714904-140.722409 23.57279l-30.716059 4.285962q-26.430097 2.857308-56.431829 7.143269-32.85904 2.857308-67.86106 8.571923l-35.716348 3.571635zM283.420985 570.747233q-54.288848 54.288848-141.436737 113.577985-10.714904 9.28625 1.428654 14.28654 34.287694 0 135.007794-62.146445 42.859617-32.144713 59.289137-35.716348 15.715193-5.000289 12.143558-20.001154-5.000289-12.857885-30.716059-37.145002-8.571923-8.571923-17.858174-7.143269-12.857885 2.857308-10.000577 14.286539 2.857308 11.429231-7.857596 20.001154zM459.859741 571.46156q50.002887 47.859906 108.577697 117.863947 12.857885 17.143847 25.71577 21.429809 7.14327 0.714327 13.572212-7.14327 11.429231-10.714904 2.142981-47.859906-9.28625-47.145579-147.865679-110.00635-7.14327-5.000289-9.28625 5.714616-0.714327 11.429231 7.143269 20.001154z',
];

const soldierLayers = (color: string): Layer[] => SOLDIER_PATHS.map((d) => ({ d, fill: color }));

type IconDef = Layer[] | ((color: string) => Layer[]);

const ICONS: Record<IconName, IconDef> = {
  city: CITY,
  mine: MINE,
  farm: FARM,
  plains: PLAINS,
  forest: FOREST,
  mountain: MOUNTAIN,
  barracks: BARRACKS,
  fortress: FORTRESS,
  treasury: TREASURY,
  capital: CAPITAL,
  siege: SIEGE,
  flag: flagLayers,
  soldier: soldierLayers,
};

/** 每个图标的原始 viewBox（小兵来自用户提供的 1206×1024 SVG） */
const VIEW_BOX: Partial<Record<IconName, [number, number]>> = {
  soldier: [1206, 1024],
};

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 小兵 SVG 的 1206 宽度里有很大一块是长矛/飘带，实际人形只占中间一部分，
 * 直接按整幅缩放会显得很小 —— 这里用离屏画布量一次实际墨迹范围，之后按它裁剪绘制。
 */
let soldierBox: Box | null = null;

function soldierBounds(): Box {
  if (soldierBox) return soldierBox;
  const W = 128;
  const H = Math.round((W * 1024) / 1206);
  let box: Box = { x: 0, y: 0, w: 1206, h: 1024 };
  try {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    if (g) {
      g.scale(W / 1206, H / 1024);
      g.fillStyle = '#fff';
      for (const d of SOLDIER_PATHS) g.fill(new Path2D(d));
      const data = g.getImageData(0, 0, W, H).data;
      let minX = W;
      let minY = H;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (data[(y * W + x) * 4 + 3] > 24) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX > minX && maxY > minY) {
        const sx = 1206 / W;
        const sy = 1024 / H;
        box = { x: minX * sx, y: minY * sy, w: (maxX - minX + 1) * sx, h: (maxY - minY + 1) * sy };
      }
    }
  } catch {
    /* 量不出来就用整幅 */
  }
  soldierBox = box;
  return box;
}

/** 图标"有效内容"的宽高比（高度 / 宽度），用于排版时预留高度 */
export function iconAspect(name: IconName): number {
  if (name === 'soldier') {
    const b = soldierBounds();
    return b.h / b.w;
  }
  const vb = VIEW_BOX[name];
  if (!vb) return 1;
  return vb[1] / vb[0];
}

const pathCache = new Map<string, Path2D[]>();
const layerCache = new Map<string, Layer[]>();

function layersFor(name: IconName, color: string): Layer[] {
  const def = ICONS[name];
  if (typeof def !== 'function') return def;
  const key = `${name}:${color}`;
  let cached = layerCache.get(key);
  if (!cached) {
    cached = def(color);
    layerCache.set(key, cached);
  }
  return cached;
}

function pathsFor(name: IconName, color: string): Path2D[] {
  const key = name === 'flag' ? `${name}:${color}` : name;
  let paths = pathCache.get(key);
  if (!paths) {
    paths = layersFor(name, color).map((l) => new Path2D(l.d));
    pathCache.set(key, paths);
  }
  return paths;
}

/**
 * 在 (cx, cy) 处以给定尺寸绘制图标（size = 宽度，高度按 viewBox 比例）。
 * @param outlineWidth 深色描边宽度（屏幕像素），小尺寸时加大更清晰
 */
export function drawIcon(
  ctx: CanvasRenderingContext2D,
  name: IconName,
  cx: number,
  cy: number,
  size: number,
  color = '#ffffff',
  outlineWidth = 1.6,
): void {
  const layers = layersFor(name, color);
  const paths = pathsFor(name, color);
  const [vw, vh] = VIEW_BOX[name] ?? [24, 24];
  // 裁剪到实际墨迹范围：小兵按人形、其余按 24×24 全幅
  const box: Box = name === 'soldier' ? soldierBounds() : { x: 0, y: 0, w: vw, h: vh };
  const s = size / box.w;
  ctx.save();
  ctx.translate(cx - (box.w * s) / 2 - box.x * s, cy - (box.h * s) / 2 - box.y * s);
  ctx.scale(s, s);
  if (outlineWidth > 0) {
    ctx.strokeStyle = 'rgba(8,12,18,0.82)';
    ctx.lineWidth = outlineWidth / s;
    ctx.lineJoin = 'round';
    for (const p of paths) ctx.stroke(p);
  }
  for (let i = 0; i < layers.length; i++) {
    ctx.fillStyle = layers[i].fill;
    ctx.fill(paths[i]);
  }
  ctx.restore();
}

/** #rrggbb 提亮（amount 0~1），用于让图标在同类色地块上"跳"出来 */
export function lighten(hex: string, amount: number): string {
  if (!hex.startsWith('#') || hex.length !== 7) return hex;
  const mix = (c: number): number => Math.round(c + (255 - c) * amount);
  const r = mix(parseInt(hex.slice(1, 3), 16));
  const g = mix(parseInt(hex.slice(3, 5), 16));
  const b = mix(parseInt(hex.slice(5, 7), 16));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/** 区域类型 / 特殊设施 → 图标名 */
export const TERRAIN_ICON: Record<string, IconName> = {
  city: 'city',
  mine: 'mine',
  farm: 'farm',
  plains: 'plains',
  forest: 'forest',
  mountain: 'mountain',
};

export const SPECIAL_ICON: Record<string, IconName> = {
  barracks: 'barracks',
  fortress: 'fortress',
  treasury: 'treasury',
};
