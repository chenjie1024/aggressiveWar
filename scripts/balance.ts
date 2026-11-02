/**
 * 平衡性批量模拟：跑 N 局全 AI 对局，输出各难度的胜率 / 回合数 / 先手优势 / 滚雪球指标。
 * 用法：npm run balance -- 200
 */
import {
  DIFFICULTY_ORDER,
  Game,
  TURN_LIMIT_DEFAULT,
  aiDecide,
  regionCount,
  type Difficulty,
} from '@gongfa-war/core';

const GAMES = Number(process.argv[2] ?? 200);
const REGIONS = Number(process.argv[3] ?? 28);
const OPPONENTS = Number(process.argv[4] ?? 2);
const SCENARIO = process.argv[5] ?? 'classic';
const TURN_LIMIT = Number(process.argv[6] ?? TURN_LIMIT_DEFAULT);
const SNAPSHOT_TURN = 10;

interface Outcome {
  winner: number;
  turns: number;
  leaderAt10: number;
  finished: boolean;
}

function runGame(seed: number, difficulty: Difficulty): Outcome {
  const game = new Game({
    seed,
    regionCount: REGIONS,
    opponents: OPPONENTS,
    difficulty,
    turnLimit: TURN_LIMIT,
    scenario: SCENARIO,
  });

  let leaderAt10 = -1;
  let guard = 0;
  while (!game.state.gameOver && guard++ < 800) {
    if (leaderAt10 < 0 && game.state.turn >= SNAPSHOT_TURN) {
      let best = -1;
      let bestN = -1;
      for (const p of game.state.players) {
        const n = regionCount(game.state, p.id);
        if (n > bestN) {
          bestN = n;
          best = p.id;
        }
      }
      leaderAt10 = best;
    }
    if (game.isHumanTurn) aiDecide(game, 0); // 把「人类」也交给 AI
    game.endTurn();
  }

  return {
    winner: game.state.winner ?? -2,
    turns: game.state.turn,
    leaderAt10,
    finished: game.state.gameOver,
  };
}

interface Row {
  难度: string;
  局数: number;
  先手胜率: string;
  AI胜率: string;
  平局: string;
  平均回合: string;
  超时率: string;
  '领先者夺冠率': string;
  '领先者夺冠率(仅征服局)': string;
}

const rows: Row[] = [];

for (const diff of DIFFICULTY_ORDER) {
  let firstWin = 0;
  let aiWin = 0;
  let draws = 0;
  let turnsSum = 0;
  let timeouts = 0;
  let leaderKnown = 0;
  let leaderWin = 0;
  let conquestDecided = 0;
  let leaderWinConquest = 0;

  for (let i = 0; i < GAMES; i++) {
    const r = runGame(1000 + i * 7919, diff);
    if (r.winner === 0) firstWin++;
    else if (r.winner >= 1) aiWin++;
    else draws++;
    turnsSum += r.turns;
    const isTimeout = !r.finished || r.turns >= TURN_LIMIT;
    if (isTimeout) timeouts++;
    if (r.leaderAt10 >= 0) {
      leaderKnown++;
      if (r.leaderAt10 === r.winner) leaderWin++;
      if (!isTimeout) {
        conquestDecided++;
        if (r.leaderAt10 === r.winner) leaderWinConquest++;
      }
    }
  }

  const pct = (n: number, d: number): string => (d === 0 ? '-' : `${((n / d) * 100).toFixed(1)}%`);
  rows.push({
    难度: diff,
    局数: GAMES,
    先手胜率: pct(firstWin, GAMES),
    AI胜率: pct(aiWin, GAMES),
    平局: pct(draws, GAMES),
    平均回合: (turnsSum / GAMES).toFixed(1),
    超时率: pct(timeouts, GAMES),
    领先者夺冠率: pct(leaderWin, leaderKnown),
    '领先者夺冠率(仅征服局)': pct(leaderWinConquest, conquestDecided),
  });
}

console.log(
  `\n攻伐战争 · 平衡性模拟（${GAMES} 局/难度 · ${REGIONS} 区 · ${OPPONENTS} AI · 剧本 ${SCENARIO} · 上限 ${TURN_LIMIT} 回合）\n`,
);
console.table(rows);
console.log(
  '\n说明：先手胜率 = 玩家0（先手）夺冠比例；第10回合领先者夺冠率越高，说明滚雪球越强（理想 40%~65%）。\n',
);
