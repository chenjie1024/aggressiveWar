// ===== 可选国家 / 势力（历史文明） =====

export interface Nation {
  id: string;
  name: string;
  color: string;
  emoji: string;
}

/** AI 个性：影响进攻倾向 / 扩张倾向 / 防守倾向 */
export interface NationTraits {
  aggression: number;
  expand: number;
  defend: number;
}

export const NATIONS: Nation[] = [
  // 华夏
  { id: 'qin', name: '秦', color: '#d9534f', emoji: '🐉' },
  { id: 'han', name: '汉', color: '#d9a441', emoji: '🐲' },
  { id: 'tang', name: '唐', color: '#e07b39', emoji: '🏯' },
  { id: 'song', name: '宋', color: '#7cb342', emoji: '🎋' },
  { id: 'ming', name: '明', color: '#3d85c6', emoji: '⛩️' },
  // 战国
  { id: 'chu', name: '楚', color: '#2e7d32', emoji: '🦚' },
  { id: 'qi', name: '齐', color: '#1565c0', emoji: '🐟' },
  { id: 'yan', name: '燕', color: '#6a1b9a', emoji: '🕊️' },
  { id: 'zhao', name: '赵', color: '#ef6c00', emoji: '🐴' },
  { id: 'wei', name: '魏', color: '#00838f', emoji: '⚔️' },
  { id: 'han_state', name: '韩', color: '#ad1457', emoji: '🗡️' },
  // 三国
  { id: 'wei3', name: '魏(三国)', color: '#004d99', emoji: '🦅' },
  { id: 'shu', name: '蜀', color: '#c62828', emoji: '🐼' },
  { id: 'wu', name: '吴', color: '#00695c', emoji: '🐎' },
  { id: 'yuan', name: '袁绍', color: '#6d4c41', emoji: '🏹' },
  { id: 'liubiao', name: '刘表', color: '#827717', emoji: '📜' },
  { id: 'gongsun', name: '公孙瓒', color: '#455a64', emoji: '🐺' },
  // 世界
  { id: 'rome', name: '罗马', color: '#8e44ad', emoji: '🦅' },
  { id: 'carthage', name: '迦太基', color: '#7b1fa2', emoji: '⛵' },
  { id: 'greece', name: '希腊', color: '#0288d1', emoji: '🏛️' },
  { id: 'gaul', name: '高卢', color: '#558b2f', emoji: '🐗' },
  { id: 'persia', name: '波斯', color: '#16a085', emoji: '🦁' },
  { id: 'egypt', name: '埃及', color: '#d4b483', emoji: '🐈' },
  { id: 'mongol', name: '蒙古', color: '#795548', emoji: '🐎' },
  { id: 'vikings', name: '维京', color: '#607d8b', emoji: '🛶' },
  { id: 'aztec', name: '阿兹特克', color: '#c2185b', emoji: '🌞' },
  { id: 'india', name: '印度', color: '#f4b400', emoji: '🐘' },
];

const DEFAULT_TRAITS: NationTraits = { aggression: 1, expand: 1, defend: 1 };

export const NATION_TRAITS: Record<string, NationTraits> = {
  // 好战扩张型
  mongol: { aggression: 1.35, expand: 1.2, defend: 0.8 },
  aztec: { aggression: 1.25, expand: 1.1, defend: 0.9 },
  vikings: { aggression: 1.2, expand: 1.15, defend: 1.0 },
  qin: { aggression: 1.2, expand: 1.1, defend: 1.0 },
  zhao: { aggression: 1.15, expand: 1.05, defend: 0.95 },
  wei: { aggression: 1.1, expand: 1.0, defend: 1.05 },
  wei3: { aggression: 1.15, expand: 1.05, defend: 1.0 },
  yuan: { aggression: 1.1, expand: 1.0, defend: 1.0 },
  gongsun: { aggression: 1.2, expand: 1.1, defend: 0.9 },
  gaul: { aggression: 1.15, expand: 1.05, defend: 0.95 },
  // 均衡型
  rome: DEFAULT_TRAITS,
  carthage: DEFAULT_TRAITS,
  han: { aggression: 1.0, expand: 1.0, defend: 1.05 },
  tang: { aggression: 1.05, expand: 1.05, defend: 1.0 },
  ming: { aggression: 0.95, expand: 1.0, defend: 1.15 },
  persia: { aggression: 1.0, expand: 1.0, defend: 1.05 },
  greece: { aggression: 0.95, expand: 1.0, defend: 1.1 },
  chu: { aggression: 1.0, expand: 1.05, defend: 1.0 },
  qi: { aggression: 0.9, expand: 0.95, defend: 1.15 },
  shu: { aggression: 0.9, expand: 0.95, defend: 1.2 },
  wu: { aggression: 0.95, expand: 1.0, defend: 1.15 },
  liubiao: { aggression: 0.75, expand: 0.85, defend: 1.25 },
  // 防守型
  song: { aggression: 0.7, expand: 0.85, defend: 1.3 },
  egypt: { aggression: 0.8, expand: 0.9, defend: 1.15 },
  india: { aggression: 0.85, expand: 0.95, defend: 1.1 },
  yan: { aggression: 0.85, expand: 0.9, defend: 1.15 },
  han_state: { aggression: 0.8, expand: 0.85, defend: 1.2 },
};

export function nationTraits(id: string): NationTraits {
  return NATION_TRAITS[id] ?? DEFAULT_TRAITS;
}

export function nationById(id: string): Nation | undefined {
  return NATIONS.find((n) => n.id === id);
}

export function nationColor(id: string): string {
  return nationById(id)?.color ?? '#8a8a8a';
}

export function nationName(id: string): string {
  return nationById(id)?.name ?? id;
}

export function nationEmoji(id: string): string {
  return nationById(id)?.emoji ?? '🏳️';
}
