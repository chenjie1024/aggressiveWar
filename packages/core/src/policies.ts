// ===== 科技 / 政策：按占区数自动解锁 =====

export interface Policy {
  id: string;
  name: string;
  desc: string;
  /** 需要拥有的区域数 */
  requireRegions: number;
  icon: string;
}

export const POLICIES: Policy[] = [
  { id: 'industry', name: '工坊', desc: '每回合每区额外 +1 兵力', requireRegions: 5, icon: '⚒️' },
  { id: 'navigation', name: '航海术', desc: '跨海进攻不再 -1 骰', requireRegions: 8, icon: '⛵' },
  { id: 'fortify', name: '筑城术', desc: '所有区域防守 +1 骰', requireRegions: 11, icon: '🏯' },
  { id: 'logistics', name: '后勤', desc: '每回合行动次数 +3', requireRegions: 14, icon: '🐎' },
  { id: 'empire', name: '帝国', desc: '每回合每区额外 +1 兵力，行动 +2', requireRegions: 18, icon: '👑' },
];

export function policiesFor(ownedRegions: number): Policy[] {
  return POLICIES.filter((p) => ownedRegions >= p.requireRegions);
}

export function hasPolicy(ownedRegions: number, id: string): boolean {
  return POLICIES.some((p) => p.id === id && ownedRegions >= p.requireRegions);
}
