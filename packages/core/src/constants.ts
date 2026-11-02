import type { Difficulty, RegionType, SpecialType } from './types';

// ===== 区域加成：每回合产兵 / 防守骰加成 =====
export const REGION_PRODUCTION: Record<RegionType, number> = {
  city: 4,
  mine: 2,
  farm: 1,
  plains: 1,
  forest: 0,
  mountain: 0,
};

/** 地形防守骰加成（额外防守骰，受 MAX_DEFENSE_DICE 限制） */
export const REGION_DEFENSE: Record<RegionType, number> = {
  city: 1,
  mine: 0,
  farm: 0,
  plains: 0,
  forest: 1,
  mountain: 1,
};

export const REGION_NAMES: Record<RegionType, string> = {
  city: '城池',
  mine: '矿区',
  farm: '农场',
  plains: '平原',
  forest: '森林',
  mountain: '山地',
};

/** 区域类型图标（绘制在区域上） */
export const REGION_ICONS: Record<RegionType, string> = {
  city: '🏰',
  mine: '⛏️',
  farm: '🌾',
  plains: '🌿',
  forest: '🌲',
  mountain: '⛰️',
};

// ===== 特殊区域加成 =====
export interface SpecialConfig {
  name: string;
  /** 每回合额外兵力 */
  reinforce: number;
  /** 防守骰额外加成 */
  defense: number;
  /** 被占领后下一回合该区额外兵力 */
  captureStock: number;
  desc: string;
}

export const SPECIAL_BONUS: Record<SpecialType, SpecialConfig> = {
  barracks: { name: '兵营', reinforce: 2, defense: 0, captureStock: 0, desc: '每回合额外 +2 兵力' },
  fortress: { name: '要塞', reinforce: 0, defense: 2, captureStock: 0, desc: '防守额外 +2 骰' },
  treasury: { name: '宝库', reinforce: 0, defense: 0, captureStock: 3, desc: '占领后下一回合该区 +3 兵力' },
};

export const SPECIAL_ORDER: SpecialType[] = ['barracks', 'fortress', 'treasury'];
export const SPECIAL_REGION_COUNT = 4;
export const LOG_LIMIT = 160;

/** 特殊区域图标（绘制在区域上） */
export const SPECIAL_ICONS: Record<SpecialType, string> = {
  barracks: '🏛️',
  fortress: '🛡️',
  treasury: '💰',
};

// ===== 战斗 =====
export const MAX_ATTACK_DICE = 3;
export const MAX_DEFENSE_DICE = 3;
/** 跨海进攻惩罚：进攻骰 -1 */
export const CROSS_SEA_PENALTY = 1;
// 单区兵力不再设上限（早期为 99，现已取消）

// ===== 初始兵力 =====
export const CITY_START_ARMY = 5;
export const START_ARMY = 3;
export const NEUTRAL_ARMY = 1;
export const NEUTRAL_CITY_ARMY = 3;

// ===== 侦查 =====
/** 派侦查兵：消耗兵力 */
export const SCOUT_COST = 5;
/** 派出区域至少还要留 1 兵 */
export const SCOUT_MIN_GARRISON = 1;
/** 侦查半径（按区域邻接跳数）：1 = 只能查相邻，2 = 可查"相邻的相邻" */
export const SCOUT_RANGE = 2;
/** 情报有效期：超过这么多回合标记为「过时」 */
export const INTEL_STALE_TURNS = 5;

// ===== 回合 =====
/**
 * 回合上限：胜利条件改成「占领全部区域」后需要更长时间（60 → 100）；
 * 特殊设施改成「每区每种各一个」后防守方变强、局更长，再提到 130。
 */
export const TURN_LIMIT_DEFAULT = 130;
export const MIN_REGIONS = 14;
export const MAX_REGIONS = 56;

/** 地图网格尺寸（模板会按此分辨率等比缩放）；比早期 56×30 放大 1.7 倍，单块区域更大 */
export const MAP_W = 72;
export const MAP_H = 40;

/** 每人每回合的行动次数上限（调兵 1 次 / 进攻 1 次，兵力数量不限） */
export const ACTIONS_PER_TURN = 10;

/** 行军：一次行动沿己方领土最多移动几格 */
export const MARCH_HOPS = 3;

/** 围城值上限（每点使该城产兵 -1、防守骰 -1） */
export const SIEGE_MAX = 3;

/** 首都被占领后，该势力每回合每区产兵惩罚 */
export const CAPITAL_LOST_PENALTY = 1;

/** 建造特殊设施的兵力成本（另消耗 1 次行动） */
export const BUILD_SPECIAL_COST = 5;

/** 中立势力：城池每回合扩军，每 N 回合向外扩张 */
export const NEUTRAL_CITY_GROWTH = 1;
export const NEUTRAL_CITY_ARMY_CAP = 12;
export const NEUTRAL_EXPAND_INTERVAL = 3;

/** 领地加成：每 TERRITORY_BONUS_DIVISOR 块区域 +1 兵力，且封顶 TERRITORY_BONUS_CAP */
export const TERRITORY_BONUS_DIVISOR = 4;
export const TERRITORY_BONUS_CAP = 4;

/** 劣势补贴：只给区域最少的一方，按与领先者的差距每落后 1 区 +1，封顶 */
export const UNDERDOG_BONUS_CAP = 4;

/** 占领后的额外兵力损耗（抑制赢家通吃） */
export const CAPTURE_ATTRITION = 1;

/** 领地加成公式（供 UI 复用） */
export function territoryBonusFor(owned: number): number {
  return Math.min(Math.floor(Math.max(0, owned - 1) / TERRITORY_BONUS_DIVISOR), TERRITORY_BONUS_CAP);
}

/** 劣势补贴公式（供 UI 复用） */
export function underdogBonusFor(owned: number, minOwned: number, maxOwned: number): number {
  if (owned !== minOwned || owned >= maxOwned) return 0;
  return Math.min(UNDERDOG_BONUS_CAP, maxOwned - owned);
}

/** 每多少回合抽一张事件卡 */
export const EVENT_INTERVAL = 5;

// ===== 难度 =====
export interface DifficultyConfig {
  name: string;
  /** 攻击倾向：进攻兵力 >= 敌方有效兵力 * aggression 才进攻 */
  aggression: number;
  /** 每回合每个区域额外增援 */
  bonus: number;
}

export const DIFFICULTY_CONFIG: Record<Difficulty, DifficultyConfig> = {
  easy: { name: '简单', aggression: 1.3, bonus: 0 },
  normal: { name: '普通', aggression: 1.0, bonus: 0 },
  hard: { name: '困难', aggression: 0.75, bonus: 1 },
};

export const DIFFICULTY_ORDER: Difficulty[] = ['easy', 'normal', 'hard'];
export function difficultyToInt(d: Difficulty): number {
  return DIFFICULTY_ORDER.indexOf(d);
}
export function difficultyFromInt(n: number): Difficulty {
  return DIFFICULTY_ORDER[n] ?? 'normal';
}
