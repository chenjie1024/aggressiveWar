// ===== 季节与天气：给回合制加一层"天时" =====
// 季节按「大回合」（所有势力各走一次）循环，每季 SEASON_TURNS 个大回合；
// 天气每个大回合重掷一次，且只从当季合理的池子里抽（冬天不会下雨、夏天不会下雪）。

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type Weather = 'clear' | 'rain' | 'fog' | 'snow';

export interface SeasonDef {
  id: Season;
  name: string;
  icon: string;
  desc: string;
  /** 每区产兵修正 */
  production: number;
  /** 防守骰修正 */
  defenseDice: number;
  /** 跨海进攻额外 -N 骰 */
  crossSeaPenalty: number;
  /** 农场 / 平原额外 +1 产兵（秋收） */
  harvestBonus: boolean;
}

export const SEASONS: Record<Season, SeasonDef> = {
  spring: {
    id: 'spring',
    name: '春',
    icon: '🌸',
    desc: '万物复苏：每区产兵 +1',
    production: 1,
    defenseDice: 0,
    crossSeaPenalty: 0,
    harvestBonus: false,
  },
  summer: {
    id: 'summer',
    name: '夏',
    icon: '🌊',
    desc: '雨季风浪：跨海进攻 -1 骰',
    production: 0,
    defenseDice: 0,
    crossSeaPenalty: 1,
    harvestBonus: false,
  },
  autumn: {
    id: 'autumn',
    name: '秋',
    icon: '🍂',
    desc: '秋收：农场与平原产兵 +1',
    production: 0,
    defenseDice: 0,
    crossSeaPenalty: 0,
    harvestBonus: true,
  },
  winter: {
    id: 'winter',
    name: '冬',
    icon: '❄️',
    desc: '严冬：每区产兵 -1，防守 +1 骰',
    production: -1,
    defenseDice: 1,
    crossSeaPenalty: 0,
    harvestBonus: false,
  },
};

export const SEASON_ORDER: Season[] = ['spring', 'summer', 'autumn', 'winter'];
/** 每个季节持续多少个大回合 */
export const SEASON_TURNS = 6;

export interface WeatherDef {
  id: Weather;
  name: string;
  icon: string;
  desc: string;
  /** 所有进攻 -N 骰 */
  attackPenalty: number;
  /** 跨海进攻额外 -N 骰 */
  crossSeaPenalty: number;
  /** 防守骰修正 */
  defenseDice: number;
  /** 每区产兵修正 */
  production: number;
}

export const WEATHERS: Record<Weather, WeatherDef> = {
  clear: {
    id: 'clear',
    name: '晴朗',
    icon: '☀️',
    desc: '无影响',
    attackPenalty: 0,
    crossSeaPenalty: 0,
    defenseDice: 0,
    production: 0,
  },
  rain: {
    id: 'rain',
    name: '雨季',
    icon: '🌧️',
    desc: '跨海进攻 -1 骰',
    attackPenalty: 0,
    crossSeaPenalty: 1,
    defenseDice: 0,
    production: 0,
  },
  fog: {
    id: 'fog',
    name: '大雾',
    icon: '🌫️',
    desc: '进攻 -1 骰',
    attackPenalty: 1,
    crossSeaPenalty: 0,
    defenseDice: 0,
    production: 0,
  },
  snow: {
    id: 'snow',
    name: '风雪',
    icon: '🌨️',
    desc: '防守 +1 骰，产兵 -1',
    attackPenalty: 0,
    crossSeaPenalty: 0,
    defenseDice: 1,
    production: -1,
  },
};

/** 各季节的天气池（等概率抽取，季节感更自然） */
export const WEATHER_POOL: Record<Season, Weather[]> = {
  spring: ['clear', 'clear', 'rain', 'fog'],
  summer: ['clear', 'rain', 'rain', 'fog'],
  autumn: ['clear', 'clear', 'fog', 'rain'],
  winter: ['clear', 'snow', 'snow', 'fog'],
};

export function seasonAt(round: number): Season {
  const idx = Math.floor(Math.max(0, round - 1) / SEASON_TURNS) % SEASON_ORDER.length;
  return SEASON_ORDER[idx];
}

export function seasonDef(s: Season): SeasonDef {
  return SEASONS[s] ?? SEASONS.spring;
}

export function weatherDef(w: Weather): WeatherDef {
  return WEATHERS[w] ?? WEATHERS.clear;
}

/** 产兵修正：季节 + 天气 + 秋收（仅农场/平原） */
export function productionModifier(season: Season, weather: Weather, regionType: string): number {
  const sd = seasonDef(season);
  const wd = weatherDef(weather);
  const harvest = sd.harvestBonus && (regionType === 'farm' || regionType === 'plains') ? 1 : 0;
  return sd.production + wd.production + harvest;
}

/** 一次进攻的所有天时修正（集中在这里，战斗与预览共用同一套算法） */
export interface CombatMods {
  /** 进攻骰总数扣减（天气 + 季节跨海） */
  attackDicePenalty: number;
  /** 防守骰加成 */
  defenseDice: number;
  /** 展示用说明 */
  notes: string[];
}

export function combatMods(
  season: Season,
  weather: Weather,
  crossSea: boolean,
  baseCrossSeaPenalty: number,
): CombatMods {
  const sd = seasonDef(season);
  const wd = weatherDef(weather);
  let penalty = wd.attackPenalty;
  let cross = crossSea ? baseCrossSeaPenalty : 0;
  const notes: string[] = [];
  if (crossSea) {
    const extra = sd.crossSeaPenalty + wd.crossSeaPenalty;
    if (extra > 0) {
      cross += extra;
      notes.push(`${wd.crossSeaPenalty > 0 ? wd.name : sd.name} 跨海额外 -${extra} 骰`);
    } else if (baseCrossSeaPenalty > 0) {
      notes.push('跨海 -1 骰');
    }
  }
  if (wd.attackPenalty > 0) notes.push(`${wd.name} 进攻 -${wd.attackPenalty} 骰`);
  const defenseDice = sd.defenseDice + wd.defenseDice;
  if (defenseDice > 0) notes.push(`${defenseDice > sd.defenseDice ? wd.name : sd.name} 防守 +${defenseDice} 骰`);
  penalty = Math.min(2, penalty + cross); // 最多扣 2 颗进攻骰，避免完全打不动
  return { attackDicePenalty: penalty, defenseDice, notes };
}
