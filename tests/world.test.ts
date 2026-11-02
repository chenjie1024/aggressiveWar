import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENTS,
  EVENT_CARDS,
  Game,
  SEASON_TURNS,
  WEATHER_POOL,
  combatMods,
  newProgress,
  noteBattle,
  noteTurn,
  productionModifier,
  satisfiedAchievements,
  seasonAt,
} from '@gongfa-war/core';

function newGame(seed = 1): Game {
  return new Game({ seed, regionCount: 24, opponents: 1, difficulty: 'normal', turnLimit: 100 });
}

describe('季节与天气', () => {
  it('季节按大回合递进，天气只取自当季池子', () => {
    const game = newGame(3);
    const s = game.state;
    expect(s.round).toBe(1);
    expect(s.season).toBe('spring');

    const seen = new Set([s.season]);
    // 跑 2 整年（4 季 × SEASON_TURNS）确认四季都出现过
    for (let i = 0; i < SEASON_TURNS * 8 + 4; i++) {
      game.endTurn();
      seen.add(s.season);
      expect(WEATHER_POOL[s.season]).toContain(s.weather);
      expect(s.season).toBe(seasonAt(s.round));
    }
    expect(seen.size).toBe(4);
  });

  it('季节修正产兵：春 +1、冬 -1、秋收对农场额外 +1', () => {
    expect(productionModifier('spring', 'clear', 'plains')).toBe(1);
    expect(productionModifier('winter', 'clear', 'plains')).toBe(-1);
    expect(productionModifier('autumn', 'clear', 'farm')).toBe(1);
    expect(productionModifier('autumn', 'clear', 'mountain')).toBe(0);
    expect(productionModifier('spring', 'snow', 'plains')).toBe(0);
  });

  it('天时影响战斗骰：大雾削进攻骰、冬雪加防守骰、雨季跨海更吃亏', () => {
    const fog = combatMods('spring', 'fog', false, 0);
    expect(fog.attackDicePenalty).toBe(1);
    expect(fog.notes.length).toBeGreaterThan(0);

    const snow = combatMods('winter', 'snow', false, 0);
    expect(snow.defenseDice).toBe(2); // 冬季 +1 与风雪 +1 叠加
    expect(snow.attackDicePenalty).toBe(0);

    const sea = combatMods('summer', 'rain', true, 1);
    expect(sea.attackDicePenalty).toBeGreaterThanOrEqual(1);
    expect(sea.attackDicePenalty).toBeLessThanOrEqual(2); // 最多扣 2 颗，避免完全打不动
  });

  it('存档往返保留季节 / 天气 / 大回合数；旧存档缺字段也能补齐', () => {
    const game = newGame(5);
    for (let i = 0; i < 9; i++) game.endTurn();
    const round = Game.deserialize(game.serialize());
    expect(round.state.round).toBe(game.state.round);
    expect(round.state.season).toBe(game.state.season);
    expect(round.state.weather).toBe(game.state.weather);

    const raw = JSON.parse(game.serialize());
    delete raw.round;
    delete raw.season;
    delete raw.weather;
    const legacy = Game.deserialize(JSON.stringify(raw));
    expect(legacy.state.round).toBe(1);
    expect(legacy.state.season).toBe('spring');
    expect(legacy.state.weather).toBe('clear');
  });
});

describe('事件卡扩充', () => {
  it('至少 10 张，且新增卡都能实际改变局势', () => {
    expect(EVENT_CARDS.length).toBeGreaterThanOrEqual(10);
    const ids = EVENT_CARDS.map((c) => c.id);
    for (const id of ['tribute', 'militia', 'horsemen', 'deserters', 'golden_age']) {
      expect(ids).toContain(id);
    }
  });

  it('事件卡按「该玩家自己的回合数」触发时不会崩，且战报有记录', () => {
    const game = newGame(11);
    const s = game.state;
    for (let i = 0; i < 40 && !s.gameOver; i++) game.endTurn();
    expect(s.log.length).toBeGreaterThan(0);
    const cardLogs = s.log.filter((l) => l.text.includes('事件卡'));
    expect(cardLogs.length).toBeGreaterThan(0);
  });
});

describe('侦查兵', () => {
  it('派 5 兵 + 1 行动，探明目标及其相邻区域的兵力', () => {
    const game = newGame(21);
    const s = game.state;
    let from: (typeof s.regions)[number] | null = null;
    let target = -1;
    for (const r of s.regions) {
      if (r.owner !== 0) continue;
      r.army = 20;
      const t = game.scoutTargets(r.id).find((id) => !r.neighbors.includes(id));
      if (t != null) {
        from = r;
        target = t;
        break;
      }
    }
    expect(from).toBeTruthy();
    expect(target).toBeGreaterThanOrEqual(0);

    const actions = s.actionsLeft;
    const res = game.scout(from!.id, target);
    expect(res.ok).toBe(true);
    expect(from!.army).toBe(15); // 20 - 5
    expect(s.actionsLeft).toBe(actions - 1);

    const info = game.intelFor(0, target);
    expect(info).toBeTruthy();
    expect(info!.army).toBe(s.regions[target].army);
    expect(info!.turn).toBe(s.turn);
    expect(info!.stale).toBe(false);
    for (const nid of s.regions[target].neighbors) {
      expect(game.intelFor(0, nid)).toBeTruthy();
    }
    expect(s.players[0].seen).toContain(target);
    expect(s.log.some((l) => l.text.includes('侦查兵'))).toBe(true);
  });

  it('兵力不足 / 超出侦查半径 / 行动耗尽 都不能侦查', () => {
    const game = newGame(22);
    const s = game.state;
    const mine = s.regions.find((r) => r.owner === 0)!;
    const far = s.regions.find((r) => r.owner !== 0 && game.regionDistance(mine.id, r.id, 99) > 3);
    if (far) expect(game.scout(mine.id, far.id).ok).toBe(false);

    const near = s.regions.find((r) => r.owner !== 0 && game.regionDistance(mine.id, r.id, 2) >= 0);
    if (near) {
      mine.army = 3; // 不足 6
      expect(game.scout(mine.id, near.id).ok).toBe(false);
      mine.army = 20;
      s.actionsLeft = 0;
      expect(game.scout(mine.id, near.id).ok).toBe(false);
      s.actionsLeft = 10;
      const own = s.regions.find((r) => r.owner === 0 && r.id !== mine.id);
      if (own) expect(game.scout(mine.id, own.id).ok).toBe(false);
    }
  });

  it('存档往返保留侦查情报与已探索区域', () => {
    const game = newGame(23);
    const s = game.state;
    const mine = s.regions.find((r) => r.owner === 0)!;
    mine.army = 20;
    const t = game.scoutTargets(mine.id)[0];
    if (t != null) {
      game.scout(mine.id, t);
      const round = Game.deserialize(game.serialize());
      const info = round.intelFor(0, t);
      expect(info).toBeTruthy();
      expect(info!.army).toBe(game.intelFor(0, t)!.army);
      expect(round.state.players[0].seen.length).toBe(s.players[0].seen.length);
    }
  });
});

describe('锁步确定性（手机热点联机的前提）', () => {
  type Cmd =
    | { k: 'attack'; from: number; to: number; commit: number }
    | { k: 'move'; from: number; to: number; amount: number }
    | { k: 'build'; regionId: number; special: 'barracks' | 'fortress' | 'treasury' }
    | { k: 'scout'; from: number; to: number }
    | { k: 'end' };

  const apply = (g: Game, c: Cmd): void => {
    if (c.k === 'end') g.endTurn();
    else if (c.k === 'attack') g.attack(c.from, c.to, c.commit);
    else if (c.k === 'move') g.moveAmount(c.from, c.to, c.amount);
    else if (c.k === 'build') g.buildSpecial(c.regionId, c.special);
    else g.scout(c.from, c.to);
  };

  const CFG = {
    seed: 4242,
    regionCount: 28,
    opponents: 2,
    difficulty: 'normal' as const,
    template: 'earth' as const,
    scenario: 'earth',
    turnLimit: 100,
  };

  /** 在 a 上"边决策边执行"录一份指令脚本 */
  const record = (): Cmd[] => {
    const g = new Game({ ...CFG });
    const script: Cmd[] = [];
    for (let step = 0; step < 80 && !g.state.gameOver; step++) {
      const s = g.state;
      const pid = s.currentPlayer;
      let cmd: Cmd = { k: 'end' };
      const own = s.regions.filter((r) => r.owner === pid);
      if (s.actionsLeft > 0) {
        outer: for (const r of own) {
          for (const nid of r.neighbors) {
            const n = s.regions[nid];
            if (n.owner !== pid && r.army >= 3) {
              cmd = { k: 'attack', from: r.id, to: nid, commit: r.army - 1 };
              break outer;
            }
          }
        }
        if (cmd.k === 'end') {
          for (const r of own) {
            const dst = r.neighbors.map((n) => s.regions[n]).find((n) => n.owner === pid);
            if (dst && g.availableToMove(r.id) > 1) {
              cmd = { k: 'move', from: r.id, to: dst.id, amount: Math.floor(g.availableToMove(r.id) / 2) };
              break;
            }
          }
        }
        if (cmd.k === 'end') {
          for (const r of own) {
            const t = g.scoutTargets(r.id)[0];
            if (t != null) {
              cmd = { k: 'scout', from: r.id, to: t };
              break;
            }
          }
        }
      }
      apply(g, cmd);
      script.push(cmd);
    }
    return script;
  };

  it('同种子 + 同指令序列 → 逐字节相同的状态（含 AI 回合）', () => {
    const script = record();
    const a = new Game({ ...CFG });
    const b = new Game({ ...CFG });
    for (const c of script) {
      apply(a, c);
      apply(b, c);
    }
    expect(script.length).toBeGreaterThan(20);
    expect(b.serialize()).toBe(a.serialize());
  });

  it('从中途快照接入（后加入的玩家）也能得到相同结果', () => {
    const script = record();
    const half = Math.floor(script.length / 2);
    const host = new Game({ ...CFG });
    for (const c of script) apply(host, c);

    // 后加入者：先应用前半段 → 再序列化/反序列化一次（模拟"从快照接力"）→ 应用后半段
    const joiner = new Game({ ...CFG });
    for (const c of script.slice(0, half)) apply(joiner, c);
    const resumed = Game.deserialize(joiner.serialize());
    for (const c of script.slice(half)) apply(resumed, c);

    expect(resumed.serialize()).toBe(host.serialize());
  });
});

describe('成就', () => {
  it('记录零损失占领 / 占领首都 / 单回合连占', () => {
    const p = newProgress();
    noteBattle(p, { captured: true, attackerLoss: 0, defenderLoss: 2 }, false);
    noteBattle(p, { captured: true, attackerLoss: 3, defenderLoss: 1 }, true);
    noteBattle(p, { captured: true, attackerLoss: 1, defenderLoss: 1 }, false);
    expect(p.wonBattles).toBe(3);
    expect(p.zeroLossCaptures).toBe(1);
    expect(p.capitalsTaken).toBe(1);
    expect(p.maxCapturesInTurn).toBe(3);
  });

  it('满足条件的成就能被判定出来（含一统天下与百日统一）', () => {
    const game = newGame(12);
    const s = game.state;
    const p = newProgress();
    p.wonBattles = 1;
    p.capitalsTaken = 1;
    p.zeroLossCaptures = 1;
    p.maxCapturesInTurn = 3;
    p.wasBehind = true;

    // 全部区域归玩家 → 一统天下
    for (const r of s.regions) r.owner = 0;
    s.gameOver = true;
    s.winner = 0;
    game.endTurn();

    const got = satisfiedAchievements(game, 0, p);
    for (const id of ['first-blood', 'flawless', 'capital-thief', 'blitz', 'unify', 'swift', 'underdog']) {
      expect(got).toContain(id);
    }
    // 成就表本身没有重复 id
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
  });

  it('垫底标记与回合重置按预期工作', () => {
    const game = newGame(13);
    const s = game.state;
    const p = newProgress();
    // 把玩家打成只剩 1 区，AI 拿到其余 → 应标记为曾垫底
    const mine = s.regions.filter((r) => r.owner === 0);
    for (const r of mine.slice(1)) r.owner = 1;
    noteTurn(game, 0, p);
    expect(p.wasBehind).toBe(true);
    expect(p.capturesThisTurn).toBe(0);
  });
});
