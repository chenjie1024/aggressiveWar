import type { Game } from './game';
import type { PlayerId, Region, SpecialType } from './types';
import {
  BUILD_SPECIAL_COST,
  CROSS_SEA_PENALTY,
  DIFFICULTY_CONFIG,
  MAX_ATTACK_DICE,
  REGION_DEFENSE,
} from './constants';
import { specialSum } from './specials';
import { combatMods } from './weather';
import { nationTraits } from './nations';

/** 目标区域的有效防守力 */
function effectiveDefense(game: Game, target: Region): number {
  const fortify = game.hasPolicy(target.owner, 'fortify') ? 1 : 0;
  const weatherDef = combatMods(game.state.season, game.state.weather, false, 0).defenseDice;
  return Math.max(
    0,
    target.army +
      REGION_DEFENSE[target.type] +
      specialSum(target, 'defense') +
      fortify +
      weatherDef -
      target.siege,
  );
}

/** 目标价值：城池与带设施的区域更值得打（设施越多越值钱） */
function targetValue(t: Region): number {
  let v = 10 + t.army * 0.4;
  if (t.type === 'city') v += 25;
  const fac = t.specials?.length ?? 0;
  if (fac > 0) v += 18 + 8 * (fac - 1);
  return v;
}

/** 某区域受到的威胁（相邻敌方兵力总和） */
function threat(game: Game, r: Region, playerId: PlayerId): number {
  let t = 0;
  for (const nid of r.neighbors) {
    const n = game.regionById(nid);
    if (n && n.owner !== playerId) t += n.army;
  }
  return t;
}

/** 威胁评估：把后方兵力调到最受威胁的前线（defend 越高越积极回防） */
function reinforceFront(game: Game, playerId: PlayerId, defend = 1): void {
  // 好战国只在大缺口时回防，防守国稍有缺口就回防
  const minGap = Math.max(0, Math.round((1.2 - defend) * 3));
  let guard = 0;
  while (game.state.actionsLeft > 0 && guard++ < 20) {
    const mine = game.state.regions.filter((r) => r.owner === playerId);
    const rear = mine.filter((r) => r.army > 2 && threat(game, r, playerId) === 0).sort((a, b) => b.army - a.army);
    if (rear.length === 0) return;

    let moved = false;
    for (const src of rear) {
      let bestTo = -1;
      let bestGap = minGap;
      for (const nid of src.neighbors) {
        const n = game.regionById(nid);
        if (!n || n.owner !== playerId) continue;
        const gap = threat(game, n, playerId) - n.army; // 缺口越大越需要增援
        if (gap > bestGap) {
          bestGap = gap;
          bestTo = nid;
        }
      }
      if (bestTo >= 0 && game.move(src.id, bestTo)) moved = true;
    }
    if (!moved) return;
  }
}

/** AI 回合：增援（已自动）→ 多点评分进攻 → 威胁评估调兵 */
export function aiDecide(game: Game, playerId: PlayerId): void {
  const player = game.state.players[playerId];
  if (!player) return;
  const cfg = DIFFICULTY_CONFIG[player.difficulty];
  const traits = nationTraits(player.nationId);
  const need = cfg.aggression * traits.aggression;

  // 1. 贪心多路进攻：每轮挑「胜算 × 价值」最高的一路
  let guard = 0;
  while (game.state.actionsLeft > 0 && guard++ < 40) {
    let best: { from: number; to: number; score: number } | null = null;

    for (const r of game.state.regions) {
      if (r.owner !== playerId || r.army < 2) continue;
      for (const nid of r.neighbors) {
        const t = game.regionById(nid);
        if (!t || t.owner === playerId) continue;

        const crossSea = r.seaNeighbors.includes(nid) && !game.hasPolicy(playerId, 'navigation');
        // 天时（雨季 / 大雾）也会削进攻骰，AI 评估必须一致，否则会送人头
        const atkDice = Math.max(
          1,
          MAX_ATTACK_DICE -
            (crossSea ? CROSS_SEA_PENALTY : 0) -
            combatMods(game.state.season, game.state.weather, crossSea, 0).attackDicePenalty,
        );
        const power = (r.army - 1) * atkDice;
        const def = Math.max(1, effectiveDefense(game, t) * 2);
        const ratio = power / def;
        if (ratio < need) continue;

        const score = ratio * 12 + targetValue(t) * traits.expand;
        if (!best || score > best.score) best = { from: r.id, to: nid, score };
      }
    }

    if (!best) break;
    game.attack(best.from, best.to);
    if (game.state.gameOver) return;
  }

  // 2. 威胁评估：所有 AI 都会回防，只是积极性随个性不同
  reinforceFront(game, playerId, traits.defend);

  // 3. 余力建设施：前线补要塞、后方补兵营/宝库（每区每种各一个，所以会逐回合铺开）
  buildFacilities(game, playerId);
}

/**
 * 建造设施：只在行动与兵力都富余时动手，且每个区域按 要塞 → 兵营 → 宝库 的顺序补齐。
 * 保守阈值（>1 行动、留 3 兵余量）是为了不影响正常进攻节奏。
 */
function buildFacilities(game: Game, playerId: PlayerId): void {
  let guard = 0;
  // 保守：每回合最多 1 次，且兵力要明显富余 —— 否则 AI 会把节奏拖成"种田局"
  while (game.state.actionsLeft > 3 && guard++ < 1) {
    const mine = game.state.regions.filter((r) => r.owner === playerId && r.specials.length < 3);
    if (mine.length === 0) return;
    const front = mine
      .filter((r) => threat(game, r, playerId) > 0)
      .sort((a, b) => b.army - a.army)[0];
    const rear = mine
      .filter((r) => threat(game, r, playerId) === 0)
      .sort((a, b) => b.army - a.army)[0];

    let region = front ?? rear;
    let kind: SpecialType | null = null;
    if (front && !front.specials.includes('fortress')) {
      region = front;
      kind = 'fortress'; // 前线先加防守骰
    } else if (rear && !rear.specials.includes('barracks')) {
      region = rear;
      kind = 'barracks'; // 后方先加产兵
    } else if (rear && !rear.specials.includes('treasury')) {
      region = rear;
      kind = 'treasury';
    } else if (region) {
      kind = (['barracks', 'treasury', 'fortress'] as SpecialType[]).find((k) => !region.specials.includes(k)) ?? null;
    }
    if (!region || !kind) return;
    if (region.army < BUILD_SPECIAL_COST + 6) return; // 留出进攻余量
    if (!game.buildSpecial(region.id, kind)) return;
  }
}
