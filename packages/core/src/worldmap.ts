import { MAP_H, MAP_W } from './constants';
import { earthLandMask } from './earth';
import { createRng, type Rng } from './rng';
import type { MapTemplate } from './types';

export const MAP_TEMPLATES: { id: MapTemplate; name: string }[] = [
  { id: 'earth', name: '地球（真实板块）' },
  { id: 'world', name: '世界地图（抽象大陆）' },
  { id: 'china', name: '华夏大陆（战国 / 三国）' },
  { id: 'continents', name: '大陆' },
  { id: 'islands', name: '群岛' },
  { id: 'ring', name: '环形大陆' },
];

/**
 * 世界地图模板：每行给出「陆地列区间 [start, end]（含端点）」
 * 近似等距圆柱投影，包含北美 / 南美 / 欧洲 / 非洲 / 亚洲 / 澳洲等大陆。
 */
const WORLD_ROWS: [number, number][][] = [
  [], // 0
  [], // 1
  [[24, 27]], // 2  格陵兰北端
  [[8, 14], [23, 31]], // 3  北美北部 / 格陵兰-欧洲
  [[7, 16], [23, 33]], // 4
  [[6, 17], [26, 34]], // 5
  [[6, 18], [26, 44]], // 6  北美 / 欧亚
  [[6, 18], [27, 48]], // 7
  [[7, 18], [28, 50]], // 8
  [[7, 17], [28, 51]], // 9
  [[8, 16], [28, 51]], // 10
  [[9, 15], [28, 50]], // 11 欧洲-非洲交界
  [[10, 14], [27, 49]], // 12 非洲 / 印度
  [[11, 13], [27, 48]], // 13
  [[14, 17], [27, 49]], // 14 南美北部
  [[14, 18], [28, 50]], // 15
  [[14, 18], [28, 50]], // 16
  [[14, 19], [28, 35]], // 17 非洲南部 / 东南亚
  [[14, 19], [29, 35]], // 18
  [[14, 19], [29, 35], [37, 38]], // 19 马达加斯加
  [[14, 18], [29, 34], [37, 38]], // 20
  [[14, 18], [30, 34], [46, 52]], // 21 澳洲
  [[14, 18], [45, 53]], // 22
  [[14, 17], [45, 53]], // 23
  [[15, 17], [46, 52]], // 24
  [[15, 16], [47, 51]], // 25
  [[15, 16], [54, 55]], // 26 新西兰
  [], // 27
  [], // 28
  [], // 29
];

/** 华夏大陆模板（用于战国 / 三国剧本） */
const CHINA_ROWS: [number, number][][] = [
  [], // 0
  [], // 1
  [], // 2
  [], // 3
  [[23, 29]], // 4
  [[20, 32]], // 5
  [[18, 34]], // 6
  [[17, 36]], // 7
  [[16, 38]], // 8
  [[16, 39]], // 9
  [[17, 40]], // 10
  [[18, 41]], // 11 东部沿海
  [[19, 41]], // 12
  [[20, 40]], // 13
  [[20, 39]], // 14
  [[20, 38]], // 15
  [[19, 37]], // 16
  [[19, 35]], // 17
  [[20, 33]], // 18
  [[21, 32]], // 19
  [[23, 31]], // 20
  [[24, 30]], // 21
  [[25, 29]], // 22
  [[26, 28]], // 23
  [], // 24
  [], // 25
  [], // 26
  [], // 27
  [], // 28
  [], // 29
];

/** 区域命名锚点：就近取真实地名（按世界地图地理分布） */
export const REGION_NAME_ANCHORS: { name: string; x: number; y: number }[] = [
  { name: '阿拉斯加', x: 8, y: 3 },
  { name: '加拿大', x: 12, y: 5 },
  { name: '五大湖', x: 14, y: 7 },
  { name: '西海岸', x: 8, y: 9 },
  { name: '墨西哥', x: 13, y: 12 },
  { name: '佛罗里达', x: 16, y: 12 },
  { name: '格陵兰', x: 25, y: 3 },
  { name: '冰岛', x: 22, y: 5 },
  { name: '不列颠', x: 26, y: 6 },
  { name: '高卢', x: 28, y: 7 },
  { name: '伊比利亚', x: 27, y: 10 },
  { name: '日耳曼', x: 31, y: 6 },
  { name: '意大利', x: 32, y: 9 },
  { name: '巴尔干', x: 34, y: 10 },
  { name: '北欧', x: 30, y: 4 },
  { name: '东欧', x: 34, y: 6 },
  { name: '安纳托利亚', x: 36, y: 11 },
  { name: '阿拉伯', x: 38, y: 14 },
  { name: '波斯', x: 40, y: 12 },
  { name: '中亚', x: 42, y: 9 },
  { name: '西伯利亚', x: 44, y: 5 },
  { name: '蒙古高原', x: 46, y: 7 },
  { name: '华北', x: 48, y: 9 },
  { name: '江南', x: 49, y: 12 },
  { name: '西域', x: 43, y: 12 },
  { name: '青藏', x: 44, y: 14 },
  { name: '印度', x: 40, y: 15 },
  { name: '德干', x: 40, y: 17 },
  { name: '东南亚', x: 46, y: 15 },
  { name: '朝鲜', x: 51, y: 9 },
  { name: '日本', x: 51, y: 12 },
  { name: '撒哈拉', x: 30, y: 14 },
  { name: '埃及', x: 34, y: 13 },
  { name: '西非', x: 28, y: 16 },
  { name: '刚果', x: 32, y: 18 },
  { name: '东非', x: 35, y: 17 },
  { name: '南非', x: 31, y: 20 },
  { name: '马达加斯加', x: 37, y: 19 },
  { name: '亚马逊', x: 16, y: 19 },
  { name: '安第斯', x: 15, y: 21 },
  { name: '巴西高原', x: 18, y: 17 },
  { name: '巴塔哥尼亚', x: 16, y: 25 },
  { name: '澳洲西部', x: 47, y: 22 },
  { name: '澳洲东部', x: 51, y: 23 },
  { name: '新西兰', x: 54, y: 26 },
  // 华夏（用于华夏模板）
  { name: '关中', x: 28, y: 12 },
  { name: '巴蜀', x: 24, y: 15 },
  { name: '荆楚', x: 30, y: 16 },
  { name: '吴越', x: 36, y: 15 },
  { name: '齐鲁', x: 36, y: 10 },
  { name: '燕赵', x: 33, y: 7 },
  { name: '三晋', x: 30, y: 10 },
  { name: '河套', x: 26, y: 8 },
  { name: '岭南', x: 32, y: 20 },
  { name: '云贵', x: 26, y: 19 },
  { name: '河西', x: 22, y: 12 },
  { name: '辽东', x: 38, y: 6 },
];

/** 把「原生分辨率」的行区间模板等比缩放到当前 MAP_W × MAP_H（模板按 56×30 手绘） */
function maskFromRows(rows: [number, number][][], srcW = 56, srcH = 30): Uint8Array {
  const mask = new Uint8Array(MAP_W * MAP_H);
  for (let y = 0; y < MAP_H; y++) {
    const sy0 = Math.min(rows.length - 1, Math.floor((y * srcH) / MAP_H));
    const sy1 = Math.min(rows.length - 1, Math.max(sy0, Math.floor(((y + 1) * srcH) / MAP_H) - 1));
    for (let s = sy0; s <= sy1; s++) {
      for (const [a, b] of rows[s] ?? []) {
        const x0 = Math.max(0, Math.floor((a * MAP_W) / srcW));
        const x1 = Math.min(MAP_W - 1, Math.floor(((b + 1) * MAP_W) / srcW) - 1);
        for (let x = x0; x <= x1; x++) mask[y * MAP_W + x] = 1;
      }
    }
  }
  return mask;
}

function stampCircle(mask: Uint8Array, cx: number, cy: number, r: number): void {
  for (let y = Math.max(0, cy - r); y <= Math.min(MAP_H - 1, cy + r); y++) {
    for (let x = Math.max(0, cx - r); x <= Math.min(MAP_W - 1, cx + r); x++) {
      const dx = x - cx;
      const dy = (y - cy) * 1.25;
      if (dx * dx + dy * dy <= r * r) mask[y * MAP_W + x] = 1;
    }
  }
}

/** 生成陆地掩码（1 = 陆地，0 = 海洋）；默认抽象世界地图，地球模板需显式传 'earth' */
export function buildLandMask(template: MapTemplate = 'world', rng?: Rng): Uint8Array {
  if (template === 'earth') return earthLandMask();
  if (template === 'world') return maskFromRows(WORLD_ROWS);
  if (template === 'china') return maskFromRows(CHINA_ROWS);

  const mask = new Uint8Array(MAP_W * MAP_H);
  const r = rng ?? createRng(20240101);

  if (template === 'continents') {
    // 坐标按地图比例给出，换分辨率也不需要重画
    const P = (fx: number, fy: number): [number, number] => [fx * MAP_W, fy * MAP_H];
    const [x0, y0] = P(0.25, 0.4);
    const [x1, y1] = P(0.46, 0.57);
    const [x2, y2] = P(0.77, 0.4);
    const [x3, y3] = P(0.54, 0.2);
    const [x4, y4] = P(0.86, 0.77);
    stampCircle(mask, x0 + r.int(-2, 2), y0 + r.int(-2, 2), Math.round(MAP_W * 0.107));
    stampCircle(mask, x1 + r.int(-2, 2), y1 + r.int(-2, 2), Math.round(MAP_W * 0.089));
    stampCircle(mask, x2 + r.int(-2, 2), y2 + r.int(-2, 2), Math.round(MAP_W * 0.125));
    stampCircle(mask, x3 + r.int(-2, 2), y3 + r.int(-2, 2), Math.round(MAP_W * 0.071));
    stampCircle(mask, x4 + r.int(-2, 2), y4 + r.int(-1, 1), Math.round(MAP_W * 0.071));
  } else if (template === 'islands') {
    const count = Math.round((MAP_W * MAP_H) / 90);
    for (let i = 0; i < count; i++) {
      stampCircle(mask, r.int(5, MAP_W - 6), r.int(4, MAP_H - 5), r.int(2, Math.max(3, Math.round(MAP_W * 0.06))));
    }
  } else {
    const cx = MAP_W / 2;
    const cy = MAP_H / 2;
    const inner = MAP_W * 0.143;
    const outer = MAP_W * 0.223;
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const d = Math.hypot(x - cx, (y - cy) * 1.7);
        if (d >= inner && d <= outer) mask[y * MAP_W + x] = 1;
      }
    }
  }
  return mask;
}
