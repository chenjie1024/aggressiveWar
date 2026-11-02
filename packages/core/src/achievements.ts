// ===== 成就：局内进度跟踪 + 解锁判定 =====
// core 只负责"什么条件算解锁"，持久化与展示由各端负责（web 存 localStorage，未来可上报服务端）。

import type { Game } from './game';
import { NEUTRAL } from './types';

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  icon: string;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-blood', name: '首战告捷', desc: '赢得第一场进攻', icon: '⚔️' },
  { id: 'flawless', name: '兵不血刃', desc: '零损失占领一块区域', icon: '🕊️' },
  { id: 'capital-thief', name: '擒贼擒王', desc: '占领一座首都', icon: '👑' },
  { id: 'blitz', name: '闪电战', desc: '单个回合内占领 3 块区域', icon: '⚡' },
  { id: 'warlord', name: '一方霸主', desc: '同时拥有 8 块区域', icon: '🏴' },
  { id: 'collector', name: '富甲一方', desc: '同时拥有 3 座特殊设施', icon: '🏛️' },
  { id: 'metropolis', name: '大都会', desc: '同时拥有 4 座城池', icon: '🏙️' },
  { id: 'underdog', name: '绝地翻盘', desc: '区域数一度垫底，最终仍统一全图', icon: '🐢' },
  { id: 'unify', name: '一统天下', desc: '占领全图每一块区域', icon: '🌍' },
  { id: 'swift', name: '百日统一', desc: '在 60 回合内统一全图', icon: '⏱️' },
];

export function achievementById(id: string): Achievement | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}

/** 一局之内的成就进度（不写进 GameState，由各端自己保存） */
export interface AchvProgress {
  wonBattles: number;
  zeroLossCaptures: number;
  capitalsTaken: number;
  capturesThisTurn: number;
  maxCapturesInTurn: number;
  /** 是否曾经区域数垫底（比所有存活对手都少） */
  wasBehind: boolean;
}

export function newProgress(): AchvProgress {
  return {
    wonBattles: 0,
    zeroLossCaptures: 0,
    capitalsTaken: 0,
    capturesThisTurn: 0,
    maxCapturesInTurn: 0,
    wasBehind: false,
  };
}

/** 记录一次进攻结果（由前端在战斗结束后调用） */
export function noteBattle(
  p: AchvProgress,
  res: { captured: boolean; attackerLoss: number; defenderLoss: number },
  targetWasCapital: boolean,
): void {
  if (!res.captured) return;
  p.wonBattles += 1;
  if (res.attackerLoss === 0) p.zeroLossCaptures += 1;
  if (targetWasCapital) p.capitalsTaken += 1;
  p.capturesThisTurn += 1;
  if (p.capturesThisTurn > p.maxCapturesInTurn) p.maxCapturesInTurn = p.capturesThisTurn;
}

/** 换回合时重置"本回合占领数"，并更新垫底标记 */
export function noteTurn(game: Game, playerId: number, p: AchvProgress): void {
  p.capturesThisTurn = 0;
  const alive = game.state.players.filter((x) => x.alive && x.id !== playerId);
  if (alive.length === 0) return;
  const mine = game.state.regions.filter((r) => r.owner === playerId).length;
  if (alive.every((x) => game.state.regions.filter((r) => r.owner === x.id).length > mine)) {
    p.wasBehind = true;
  }
}

/**
 * 当前已满足的成就（每次行动后调用即可，返回的是"满足条件"的完整集合，
 * 由调用方与已解锁集合求差，得到新解锁的条目）。
 */
export function satisfiedAchievements(game: Game, playerId: number, p: AchvProgress): string[] {
  const s = game.state;
  const mine = s.regions.filter((r) => r.owner === playerId);
  const out: string[] = [];

  if (p.wonBattles > 0) out.push('first-blood');
  if (p.zeroLossCaptures > 0) out.push('flawless');
  if (p.capitalsTaken > 0) out.push('capital-thief');
  if (p.maxCapturesInTurn >= 3) out.push('blitz');
  if (mine.length >= 8) out.push('warlord');
  // 富甲一方：名下特殊设施总数 ≥ 3（每区可建三种，所以按设施数而不是区域数）
  if (mine.reduce((n, r) => n + (r.specials?.length ?? 0), 0) >= 3) out.push('collector');
  if (mine.filter((r) => r.type === 'city').length >= 4) out.push('metropolis');

  const unified = s.gameOver && s.winner === playerId && s.regions.every((r) => r.owner === playerId);
  if (unified) {
    out.push('unify');
    if (s.turn <= 60) out.push('swift');
    if (p.wasBehind) out.push('underdog');
  }
  return out;
}

/** 中立区域数量（战报展示用） */
export function neutralCount(game: Game): number {
  return game.state.regions.filter((r) => r.owner === NEUTRAL).length;
}
