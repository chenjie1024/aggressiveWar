// ===== 攻伐战争 核心类型（区域版 · 回合制） =====

import type { Season, Weather } from './weather';

export type RegionType = 'city' | 'mine' | 'farm' | 'plains' | 'forest' | 'mountain';
/** 特殊区域加成类型 */
export type SpecialType = 'barracks' | 'fortress' | 'treasury';
/** 地图模板 */
export type MapTemplate = 'earth' | 'world' | 'china' | 'continents' | 'islands' | 'ring';
export type Difficulty = 'easy' | 'normal' | 'hard';

export type PlayerId = number;
/** 中立（无主） */
export const NEUTRAL: PlayerId = -1;
/** 平局标记 */
export const WINNER_DRAW: PlayerId = -2;

export interface Cell {
  x: number;
  y: number;
}

export interface Region {
  id: number;
  /** 真实地名（按地图模板就近命名） */
  name: string;
  type: RegionType;
  owner: PlayerId;
  /** 兵力（数字代替小兵） */
  army: number;
  /** 该区域包含的网格单元（不规则形状） */
  cells: Cell[];
  /** 中心点（网格坐标，用于显示数字） */
  center: Cell;
  /** 相邻区域 id */
  neighbors: number[];
  /** 仅靠海路相连的相邻区域（跨海进攻 -1 骰） */
  seaNeighbors: number[];
  /** 特殊区域加成 */
  /** 特殊设施：每区每种各可建一个（兵营 / 要塞 / 宝库） */
  specials: SpecialType[];
  /** 待结算的额外兵力（如占领宝库后下一回合 +3） */
  pendingBonus: number;
  /** 是否为所属势力的首都（失守则全国产兵 -1） */
  capital: boolean;
  /** 围城值（连续攻城累积：该城产兵 -N、防守骰 -N，易主后清零） */
  siege: number;
}

/** 侦查情报：某区域「第几回合看到过多少兵」 */
export interface IntelEntry {
  army: number;
  turn: number;
}

export interface Player {
  id: PlayerId;
  name: string;
  isHuman: boolean;
  difficulty: Difficulty;
  alive: boolean;
  /** 所选国家 id（见 nations.ts） */
  nationId: string;
  /** 该玩家已进行的回合数（用于事件卡节奏） */
  turns: number;
  /** 战争迷雾：已探索过的区域 id */
  seen: number[];
  /** 侦查情报：区域 id → 上次看到的兵力快照 */
  intel: Record<number, IntelEntry>;
}

export interface PlayerStats {
  regionsCaptured: number;
  regionsLost: number;
}

export interface GameConfig {
  seed: number;
  regionCount: number; // 区域数量
  opponents: number; // AI 数量 1~5
  difficulty: Difficulty;
  turnLimit: number; // 回合上限
  /** 玩家所选国家 id（缺省用第一个） */
  nationId?: string;
  /** 地图模板 */
  template?: MapTemplate;
  /** 剧本 id（决定可选国家池与默认模板） */
  scenario?: string;
}

export type GameEvent =
  | { type: 'regionCaptured'; playerId: PlayerId; regionId: number; from: PlayerId }
  | { type: 'battle'; attacker: PlayerId; defender: PlayerId; regionId: number; won: boolean }
  | { type: 'eliminated'; playerId: PlayerId }
  | { type: 'turn'; playerId: PlayerId }
  | { type: 'card'; playerId: PlayerId; cardId: string; name: string; desc: string; good: boolean; icon: string }
  | { type: 'season'; season: Season; name: string; icon: string; desc: string }
  | { type: 'scout'; playerId: PlayerId; regionIds: number[] }
  | { type: 'achievement'; id: string; name: string; icon: string };

export interface LogEntry {
  turn: number;
  text: string;
  kind: 'battle' | 'capture' | 'eliminate' | 'turn' | 'event';
}

export interface GameState {
  version: number;
  config: GameConfig;
  turn: number;
  /** 大回合数：所有存活势力各走一次为 1 个大回合（季节 / 天气按它推进） */
  round: number;
  /** 当前季节 */
  season: Season;
  /** 当前天气（每个大回合重掷） */
  weather: Weather;
  currentPlayer: PlayerId;
  players: Player[];
  regions: Region[];
  stats: Record<PlayerId, PlayerStats>;
  winner: PlayerId | null;
  gameOver: boolean;
  events: GameEvent[];
  /** 战斗/回合记录（持久） */
  log: LogEntry[];
  /** 本回合剩余行动次数（调兵 / 进攻各消耗 1 次） */
  actionsLeft: number;
  rngState: number;
}
