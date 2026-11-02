// ===== 事件卡：每 EVENT_INTERVAL 回合抽一张，作用于当前玩家 =====

export interface EventCard {
  id: string;
  name: string;
  desc: string;
  good: boolean;
  icon: string;
}

export const EVENT_CARDS: EventCard[] = [
  { id: 'harvest', name: '丰收', desc: '所有区域 +3 兵力', good: true, icon: '🌾' },
  { id: 'conscription', name: '征兵', desc: '首都 +5 兵力', good: true, icon: '📜' },
  { id: 'plague', name: '瘟疫', desc: '所有区域 -2 兵力（至少保留 1）', good: false, icon: '☠️' },
  { id: 'barbarians', name: '蛮族入侵', desc: '随机 2 个区域 -3 兵力（至少保留 1）', good: false, icon: '🪓' },
  { id: 'revolt', name: '叛乱', desc: '兵力最少的区域 -4 兵力（至少保留 1）', good: false, icon: '🔥' },
  // ===== 扩充事件卡 =====
  { id: 'tribute', name: '诸侯来朝', desc: '首都按区域数获得兵力（每区 +1，最多 +8）', good: true, icon: '🎁' },
  { id: 'militia', name: '前线增援', desc: '所有与敌/中立相邻的区域 +3 兵力', good: true, icon: '🛡️' },
  { id: 'horsemen', name: '良马快枪', desc: '本国回合立刻 +3 次行动', good: true, icon: '🐎' },
  { id: 'deserters', name: '逃兵', desc: '随机 3 个区域 -1 兵力（至少保留 1）', good: false, icon: '🏃' },
  { id: 'golden_age', name: '盛世', desc: '每座城池 +3 兵力（没有城池则首都 +3）', good: true, icon: '✨' },
];

export function eventCardById(id: string): EventCard | undefined {
  return EVENT_CARDS.find((c) => c.id === id);
}
