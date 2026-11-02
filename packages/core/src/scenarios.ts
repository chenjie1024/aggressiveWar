import type { MapTemplate } from './types';

export interface Scenario {
  id: string;
  name: string;
  desc: string;
  template: MapTemplate;
  nationIds: string[];
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'earth',
    name: '地球 · 列国争霸',
    desc: '七大洲真实板块，跨海争夺',
    template: 'earth',
    nationIds: ['qin', 'han', 'tang', 'rome', 'persia', 'egypt', 'mongol', 'vikings', 'aztec', 'india', 'carthage', 'greece'],
  },
  {
    id: 'classic',
    name: '经典 · 世界地图',
    desc: '十二文明争夺世界',
    template: 'world',
    nationIds: ['qin', 'han', 'tang', 'song', 'ming', 'rome', 'persia', 'egypt', 'mongol', 'vikings', 'aztec', 'india'],
  },
  {
    id: 'warring',
    name: '战国七雄',
    desc: '秦楚齐燕赵魏韩',
    template: 'china',
    nationIds: ['qin', 'chu', 'qi', 'yan', 'zhao', 'wei', 'han_state'],
  },
  {
    id: 'three-kingdoms',
    name: '三国',
    desc: '魏蜀吴与群雄',
    template: 'china',
    nationIds: ['wei3', 'shu', 'wu', 'yuan', 'liubiao', 'gongsun'],
  },
  {
    id: 'mediterranean',
    name: '地中海',
    desc: '罗马与迦太基争霸',
    template: 'continents',
    nationIds: ['rome', 'carthage', 'greece', 'egypt', 'persia', 'gaul'],
  },
];

export function scenarioById(id: string): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
}
