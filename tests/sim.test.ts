import { describe, expect, it } from 'vitest';
import { Game, aiDecide } from '@gongfa-war/core';

describe('无头模拟（AI vs AI 回合制）', () => {
  it('在回合上限内分出胜负且不抛异常', () => {
    const game = new Game({ seed: 99, regionCount: 24, opponents: 1, difficulty: 'normal', turnLimit: 60 });
    let guard = 0;
    while (!game.state.gameOver && guard++ < 500) {
      if (game.isHumanTurn) aiDecide(game, 0); // 让“人类”也自动行动
      game.endTurn();
    }
    expect(game.state.gameOver).toBe(true);
    expect(game.state.winner).not.toBeNull();
  }, 20000);
});
