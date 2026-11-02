// 特殊设施的加成求和 / 展示辅助
//
// 规则：每个区域「兵营 / 要塞 / 宝库」各可建一个（互不影响，可叠加）。
// 建造消耗 1 次行动 + BUILD_SPECIAL_COST 兵，各区独立计算。

import { SPECIAL_BONUS, SPECIAL_ORDER } from './constants';
import type { Region, SpecialType } from './types';

type BonusKey = 'reinforce' | 'defense' | 'captureStock';

/** 某区域所有设施在某一项加成上的合计 */
export function specialSum(region: Region, key: BonusKey): number {
  let sum = 0;
  for (const s of region.specials ?? []) sum += SPECIAL_BONUS[s]?.[key] ?? 0;
  return sum;
}

export function hasSpecial(region: Region, kind: SpecialType): boolean {
  return (region.specials ?? []).includes(kind);
}

/** 该区域还没建过的设施（给建造按钮用） */
export function missingSpecials(region: Region): SpecialType[] {
  return SPECIAL_ORDER.filter((k) => !hasSpecial(region, k));
}

/** 设施名列表，如 ['兵营', '宝库'] */
export function specialNames(region: Region): string[] {
  return (region.specials ?? []).map((s) => SPECIAL_BONUS[s]?.name ?? s);
}

/** 设施的展示描述（侧栏用）：兵营｜每回合额外 +2 兵力 */
export function specialDesc(kind: SpecialType): string {
  const b = SPECIAL_BONUS[kind];
  return `${b.name}｜${b.desc}`;
}
