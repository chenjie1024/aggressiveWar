import type { GameState, PlayerId } from './types';
import { WINNER_DRAW } from './types';
import { LOG_LIMIT } from './constants';

export function regionCount(state: GameState, playerId: PlayerId): number {
  return state.regions.filter((r) => r.owner === playerId).length;
}

export function computeScore(state: GameState, playerId: PlayerId): number {
  return state.regions.filter((r) => r.owner === playerId).reduce((s, r) => s + 100 + r.army, 0);
}

/**
 * 判定胜负。
 * 唯一胜利条件：**占领全部区域**（含中立区）—— 消灭对手不再直接获胜，
 * 必须把地图上最后一块地也拿下来才算赢。全员出局则平局；到回合上限按积分排名结算。
 */
export function checkVictory(state: GameState): void {
  if (state.gameOver) return;

  const wasAlive = new Set(state.players.filter((p) => p.alive).map((p) => p.id));
  for (const p of state.players) {
    p.alive = state.regions.some((r) => r.owner === p.id);
  }
  for (const p of state.players) {
    if (wasAlive.has(p.id) && !p.alive) {
      state.events.push({ type: 'eliminated', playerId: p.id });
      state.log.push({ turn: state.turn, text: `【${p.name}】被消灭`, kind: 'eliminate' });
      if (state.log.length > LOG_LIMIT) state.log.shift();
    }
  }

  // 胜利条件：全图归一家（中立区也必须拿下）
  const firstOwner = state.regions[0]?.owner ?? -1;
  if (firstOwner >= 0 && state.regions.every((r) => r.owner === firstOwner)) {
    state.winner = firstOwner;
    state.gameOver = true;
    return;
  }

  const alive = state.players.filter((p) => p.alive);
  if (alive.length === 0) {
    state.winner = WINNER_DRAW;
    state.gameOver = true;
    return;
  }
  // 回合上限：只是"到点结算"，不是胜利条件本身
  if (state.turn >= state.config.turnLimit) {
    let best: PlayerId = -1;
    let bestScore = -Infinity;
    let tie = false;
    for (const p of alive) {
      const s = computeScore(state, p.id);
      if (s > bestScore) {
        bestScore = s;
        best = p.id;
        tie = false;
      } else if (s === bestScore) {
        tie = true;
      }
    }
    state.winner = tie ? WINNER_DRAW : best;
    state.gameOver = true;
  }
}
