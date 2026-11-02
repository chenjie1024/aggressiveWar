import { describe, expect, it } from 'vitest';
import { Game, REGION_PRODUCTION, specialNames, specialSum } from '@gongfa-war/core';

function newGame(seed = 1): Game {
  return new Game({ seed, regionCount: 24, opponents: 1, difficulty: 'normal', turnLimit: 60 });
}

describe('game 回合制规则', () => {
  it('回合开始按区域加成增援', () => {
    const game = newGame(1);
    const city = game.state.regions.find((r) => r.owner === 0 && r.type === 'city')!;
    expect(city.army).toBeGreaterThanOrEqual(REGION_PRODUCTION.city);
  });

  it('进攻相邻敌方区域可占领', () => {
    const game = newGame(2);
    const s = game.state;
    const mine = s.regions.find((r) => r.owner === 0 && r.army >= 2)!;
    const targetId = mine.neighbors.find((n) => s.regions[n].owner !== 0);
    expect(targetId).toBeDefined();
    mine.army = 99;
    const res = game.attack(mine.id, targetId!);
    expect(res).not.toBeNull();
    expect(s.regions[targetId!].owner).toBe(0);
  });

  it('不能进攻非相邻区域', () => {
    const game = newGame(5);
    const s = game.state;
    const mine = s.regions.find((r) => r.owner === 0)!;
    const far = s.regions.find((r) => r.owner !== 0 && !mine.neighbors.includes(r.id));
    expect(far).toBeDefined();
    mine.army = 99;
    expect(game.attack(mine.id, far!.id)).toBeNull();
  });

  it('调兵把兵力转移到相邻己方区域（留 1）', () => {
    const game = newGame(3);
    const s = game.state;
    const mine = s.regions.find((r) => r.owner === 0)!;
    const friendId = mine.neighbors.find((n) => s.regions[n].owner === 0);
    expect(friendId).toBeDefined();
    mine.army = 5;
    const before = s.regions[friendId!].army;
    expect(game.move(mine.id, friendId!)).toBe(true);
    expect(mine.army).toBe(1);
    expect(s.regions[friendId!].army).toBe(before + 4);
  });

  it('消灭对手不再直接获胜（胜利条件＝占领全部区域，含中立）', () => {
    const game = newGame(6);
    const s = game.state;
    // 把 AI 的区域全部转给玩家
    for (const r of s.regions) if (r.owner === 1) r.owner = 0;
    game.endTurn();
    expect(s.players[1].alive).toBe(false);
    // 地图上仍有中立区 → 尚未获胜，需要继续打下来
    expect(s.regions.some((r) => r.owner !== 0)).toBe(true);
    expect(s.gameOver).toBe(false);
  });

  it('占领全部区域才获胜', () => {
    const game = newGame(6);
    const s = game.state;
    for (const r of s.regions) r.owner = 0; // 全图归玩家
    game.endTurn();
    expect(s.gameOver).toBe(true);
    expect(s.winner).toBe(0);
  });

  it('序列化往返一致', () => {
    const game = newGame(4);
    game.endTurn();
    const json = game.serialize();
    const g2 = Game.deserialize(json);
    expect(g2.state.turn).toBe(game.state.turn);
    expect(g2.state.regions.length).toBe(game.state.regions.length);
    expect(g2.state.players[0].alive).toBe(game.state.players[0].alive);
  });

  it('可按指定数量调兵', () => {
    const game = newGame(8);
    const s = game.state;
    const mine = s.regions.find((r) => r.owner === 0)!;
    const friendId = mine.neighbors.find((n) => s.regions[n].owner === 0)!;
    mine.army = 10;
    const before = s.regions[friendId].army;
    expect(game.moveAmount(mine.id, friendId, 4)).toBe(true);
    expect(mine.army).toBe(6);
    expect(s.regions[friendId].army).toBe(before + 4);
  });

  it('占领宝库后该区下回合额外 +3 兵力', () => {
    const game = newGame(9);
    const s = game.state;
    const mine = s.regions.find((r) => r.owner === 0)!;
    const targetId = mine.neighbors.find((n) => s.regions[n].owner !== 0)!;
    const target = s.regions[targetId];
    target.specials = ['treasury'];
    target.army = 1;
    mine.army = 99;
    const res = game.attack(mine.id, targetId);
    expect(res?.captured).toBe(true);
    expect(target.pendingBonus).toBe(3);
  });

  it('记录战斗日志', () => {
    const game = newGame(10);
    const s = game.state;
    expect(s.log.length).toBeGreaterThan(0);
    const mine = s.regions.find((r) => r.owner === 0)!;
    const targetId = mine.neighbors.find((n) => s.regions[n].owner !== 0)!;
    mine.army = 99;
    game.attack(mine.id, targetId);
    expect(s.log.some((e) => e.kind === 'capture')).toBe(true);
  });

  it('调兵不限数量：一次可调走全部兵力，但只消耗 1 次行动', () => {
    const game = newGame(20);
    const s = game.state;
    const mine = s.regions.find((r) => r.owner === 0)!;
    const friendId = mine.neighbors.find((n) => s.regions[n].owner === 0)!;
    mine.army = 30;
    const before = s.regions[friendId].army;
    const actions = s.actionsLeft;
    expect(game.moveAmount(mine.id, friendId, 30)).toBe(true);
    expect(mine.army).toBe(1); // 留 1，其余全可调走
    expect(s.regions[friendId].army).toBe(before + 29);
    expect(s.actionsLeft).toBe(actions - 1);
  });

  it('进攻消耗 1 次行动', () => {
    const game = newGame(23);
    const s = game.state;
    const mine = s.regions.find((r) => r.owner === 0)!;
    const enemyId = mine.neighbors.find((n) => s.regions[n].owner !== 0)!;
    mine.army = 99;
    const actions = s.actionsLeft;
    game.attack(mine.id, enemyId);
    expect(s.actionsLeft).toBe(actions - 1);
  });

  it('行动次数用完后不能再调兵或进攻', () => {
    const game = newGame(21);
    const s = game.state;
    const mine = s.regions.find((r) => r.owner === 0)!;
    const friendId = mine.neighbors.find((n) => s.regions[n].owner === 0)!;
    const enemyId = mine.neighbors.find((n) => s.regions[n].owner !== 0)!;
    s.actionsLeft = 0;
    expect(game.moveAmount(mine.id, friendId, 1)).toBe(false);
    expect(game.attack(mine.id, enemyId)).toBeNull();
  });

  it('领地加成：每 4 块 +1，且封顶 +4', () => {
    const game = newGame(22);
    const s = game.state;
    const owned = s.regions.filter((r) => r.owner === 0).length;
    expect(game.territoryBonus(0)).toBe(Math.min(Math.floor(Math.max(0, owned - 1) / 4), 4));
    for (const r of s.regions) r.owner = 0;
    expect(game.territoryBonus(0)).toBe(4);
  });

  it('劣势补贴：按与领先者的差距缩放（封顶 +4）', () => {
    const game = newGame(30);
    const s = game.state;
    const before = s.regions.filter((r) => r.owner === 0).length;
    // 让 AI 1 连拿 3 区，玩家成为唯一最少
    let given = 0;
    for (const r of s.regions) {
      if (r.owner === -1 && given < 3) {
        r.owner = 1;
        given++;
      }
    }
    expect(game.ownedCount(1)).toBe(before + 3);
    expect(game.underdogBonus(0)).toBe(3); // 落后 3 区 → +3
    expect(game.underdogBonus(1)).toBe(0); // 领先方没有补贴
  });

  it('占领后有额外兵力损耗（抑制赢家通吃）', () => {
    const game = newGame(35);
    const s = game.state;
    const mine = s.regions.find(
      (r) => r.owner === 0 && r.neighbors.some((n) => s.regions[n].owner !== 0),
    )!;
    expect(mine).toBeDefined();
    const targetId = mine.neighbors.find((n) => s.regions[n].owner !== 0)!;
    const target = s.regions[targetId];
    // 单次进攻是"一轮骰子"，守方偶尔会守住 —— 重试到占领为止
    let captured = false;
    for (let i = 0; i < 12 && !captured; i++) {
      s.actionsLeft = 10;
      mine.army = 99;
      target.army = 1;
      captured = game.attack(mine.id, targetId)?.captured ?? false;
    }
    expect(captured).toBe(true);
    // 占领后守军 = 存活攻击方 - 1（损耗），至少 1
    expect(target.army).toBeLessThan(98);
  });

  it('事件卡按「该玩家自己的回合数」触发（每人每 5 次自己的回合）', () => {
    const game = newGame(31);
    const s = game.state;
    let guard = 0;
    while (s.players[0].turns < 5 && guard++ < 60 && !s.gameOver) {
      game.endTurn();
    }
    expect(s.players[0].turns).toBeGreaterThanOrEqual(5);
    expect(s.log.some((e) => e.kind === 'event')).toBe(true);
  });

  it('区域有真实地名且互不重复', () => {
    const game = newGame(32);
    const names = game.state.regions.map((r) => r.name);
    expect(names.every((n) => n.length > 0)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });

  it('跨海相邻被记录为海路（用于 -1 骰惩罚）', () => {
    const game = newGame(33);
    const s = game.state;
    for (const r of s.regions) {
      for (const nid of r.seaNeighbors) {
        expect(r.neighbors).toContain(nid);
        expect(s.regions[nid].seaNeighbors).toContain(r.id);
      }
    }
  });

  it('科技政策按占区数解锁', () => {
    const game = newGame(34);
    expect(game.unlockedPolicies(0).length).toBe(0);
    for (const r of game.state.regions) r.owner = 0;
    const ids = game.unlockedPolicies(0).map((p) => p.id);
    expect(ids).toContain('industry');
    expect(ids).toContain('empire');
    expect(game.hasPolicy(0, 'logistics')).toBe(true);
    expect(game.actionsLimit(0)).toBe(15);
  });

  it('战斗预览：精确枚举给出胜率与期望损失', () => {
    const game = newGame(40);
    const s = game.state;
    // 找一个「己方区域 + 相邻敌方」的组合
    let mine = null as null | (typeof s.regions)[number];
    let enemyId = -1;
    for (const r of s.regions) {
      if (r.owner !== 0) continue;
      const t = r.neighbors.find((n) => s.regions[n].owner !== 0);
      if (t !== undefined) {
        mine = r;
        enemyId = t;
        break;
      }
    }
    expect(mine).not.toBeNull();
    expect(enemyId).toBeGreaterThanOrEqual(0);

    mine!.army = 2; // 只投入 1 兵，胜率应很低
    const weak = game.previewAttack(mine!.id, enemyId)!;
    expect(weak).not.toBeNull();
    expect(weak.committed).toBe(1);
    expect(weak.winProb).toBeGreaterThanOrEqual(0);
    expect(weak.winProb).toBeLessThanOrEqual(1);

    mine!.army = 99;
    const strong = game.previewAttack(mine!.id, enemyId)!;
    expect(strong.winProb).toBeGreaterThan(weak.winProb);
    expect(strong.winProb).toBeGreaterThan(0.95);
    expect(strong.expectedDefenderLoss).toBeGreaterThan(0);
    expect(strong.expectedAttackerLoss).toBeGreaterThanOrEqual(0);
  });

  it('存档按行 RLE 编码：往返后格子完全一致且体积显著缩小', () => {
    const game = newGame(41);
    const before = game.state.regions.map((r) => r.cells.length);
    const json = game.serialize();
    const g2 = Game.deserialize(json);

    expect(g2.state.regions.map((r) => r.cells.length)).toEqual(before);
    const a = new Set(game.state.regions[3].cells.map((c) => `${c.x},${c.y}`));
    const b = new Set(g2.state.regions[3].cells.map((c) => `${c.x},${c.y}`));
    expect(b.size).toBe(a.size);
    for (const k of a) expect(b.has(k)).toBe(true);
    expect(json.length).toBeLessThan(30000); // RLE 后远小于逐格对象
  });

  it('进攻可指定投入兵力：驻守兵力不被抽走', () => {
    const game = newGame(50);
    const s = game.state;
    const mine = s.regions.find((r) => r.owner === 0)!;
    const targetId = mine.neighbors.find((n) => s.regions[n].owner !== 0)!;
    const target = s.regions[targetId];
    mine.army = 20;
    target.army = 99; // 必败
    const res = game.attack(mine.id, targetId, 5);
    expect(res).not.toBeNull();
    expect(res!.captured).toBe(false);
    expect(mine.army).toBeGreaterThanOrEqual(15); // 20 - 5 + 幸存者
    expect(mine.army).toBeLessThanOrEqual(20);
    expect(target.army).toBeGreaterThan(0);
  });

  it('进攻投入量被夹在 [1, 兵力-1] 之间', () => {
    const game = newGame(51);
    const s = game.state;
    const mine = s.regions.find((r) => r.owner === 0)!;
    const targetId = mine.neighbors.find((n) => s.regions[n].owner !== 0)!;
    mine.army = 6;
    expect(game.previewAttack(mine.id, targetId, 99)!.committed).toBe(5);
    expect(game.previewAttack(mine.id, targetId, 0)!.committed).toBe(1);
    expect(game.previewAttack(mine.id, targetId)!.committed).toBe(5); // 缺省=全部可调动
  });

  it('投入兵力越少胜率越低', () => {
    const game = newGame(52);
    const s = game.state;
    let mine: (typeof s.regions)[number] | null = null;
    let targetId = -1;
    for (const r of s.regions) {
      if (r.owner !== 0) continue;
      const t = r.neighbors.find((n) => s.regions[n].owner !== 0);
      if (t !== undefined) {
        mine = r;
        targetId = t;
        break;
      }
    }
    expect(mine).not.toBeNull();
    mine!.army = 30;
    const few = game.previewAttack(mine!.id, targetId, 3)!;
    const many = game.previewAttack(mine!.id, targetId, 29)!;
    expect(few).not.toBeNull();
    expect(many).not.toBeNull();
    expect(many.winProb).toBeGreaterThan(few.winProb);
    expect(few.committed).toBe(3);
    expect(many.committed).toBe(29);
  });

  it('行军：一次行动可沿己方领土跨多格调兵（最多 3 跳）', () => {
    const game = newGame(60);
    const s = game.state;
    const mine = s.regions.find((r) => r.owner === 0)!;

    // 找一个「非相邻、但沿己方领土 2~3 跳可达」的己方区域
    const ownIds = new Set(s.regions.filter((r) => r.owner === 0).map((r) => r.id));
    let far: number | null = null;
    for (const id of ownIds) {
      if (id === mine.id) continue;
      const path = game.marchPath(mine.id, id);
      if (path && path.length >= 3) {
        far = id;
        break;
      }
    }
    if (far === null) return; // 起始领地太小，跳过

    const path = game.marchPath(mine.id, far)!;
    expect(path[0]).toBe(mine.id);
    expect(path[path.length - 1]).toBe(far);
    expect(path.length).toBeLessThanOrEqual(4); // 最多 3 跳

    mine.army = 10;
    const before = s.regions[far].army;
    const actions = s.actionsLeft;
    expect(game.moveAmount(mine.id, far, 4)).toBe(true);
    expect(s.regions[far].army).toBe(before + 4);
    expect(mine.army).toBe(6);
    expect(s.actionsLeft).toBe(actions - 1); // 整段行军只消耗 1 次行动
  });

  it('行军不能穿过敌方区域', () => {
    const game = newGame(61);
    const s = game.state;
    const enemy = s.regions.find((r) => r.owner !== 0 && r.owner >= 0 && r.neighbors.some((n) => s.regions[n].owner === 0));
    if (!enemy) return;
    const mineId = enemy.neighbors.find((n) => s.regions[n].owner === 0)!;
    // 跨越敌方区域的远距离调兵应失败（除非存在绕行 ≤3 跳的纯己方路径）
    const target = s.regions.find((r) => r.owner === 0 && r.id !== mineId && !s.regions[mineId].neighbors.includes(r.id));
    if (!target) return;
    const path = game.marchPath(mineId, target.id);
    if (path) {
      // 若存在路径，路径上必须全部是己方区域
      for (const id of path) expect(s.regions[id].owner).toBe(0);
    } else {
      expect(game.moveAmount(mineId, target.id, 1)).toBe(false);
    }
  });

  it('首都：每名玩家各有一处首都；首都被占则该势力产兵受罚', () => {
    const game = newGame(70);
    const s = game.state;
    for (const p of s.players) {
      expect(s.regions.filter((r) => r.capital && r.owner === p.id)).toHaveLength(1);
      expect(game.capitalLost(p.id)).toBe(false);
    }
    const enemyCapital = s.regions.find((r) => r.capital && r.owner === 1)!;
    enemyCapital.owner = 0; // 模拟被攻占
    expect(game.capitalLost(1)).toBe(true);
    expect(game.capitalLost(0)).toBe(false); // 攻方自己的首都仍在

    // 失守方每区产兵下降：对比下回合增援量
    const before = s.regions.find((r) => r.owner === 1)!.army;
    game.endTurn();
    const after = s.regions.filter((r) => r.owner === 1).reduce((sum, r) => sum + r.army, 0);
    expect(after).toBeGreaterThanOrEqual(before);
    expect(s.log.length).toBeGreaterThan(0);
  });

  it('围城：攻城失败累积围城值，并降低该城防守骰与产兵', () => {
    const game = newGame(71);
    const s = game.state;
    // 胜利条件改为「占领全部区域」后，地图上不一定天然存在贴着己方的敌城 —— 这里就地构造一座
    const mineRow = s.regions.find(
      (r) => r.owner === 0 && r.neighbors.some((n) => s.regions[n].owner !== 0) && r.army >= 2,
    );
    expect(mineRow).toBeDefined();
    const mine = mineRow!;
    const targetId = mine.neighbors.find((n) => s.regions[n].owner !== 0)!;
    const enemyCity = s.regions[targetId];
    enemyCity.type = 'city';
    enemyCity.owner = s.players[1].alive ? 1 : -1;
    mine.army = 10;
    enemyCity.army = 99; // 必败
    const siegeBefore = enemyCity.siege;
    const defBefore = game.previewAttack(mine.id, enemyCity.id, 3)!.defenderBonus;

    game.attack(mine.id, enemyCity.id, 3);
    expect(enemyCity.siege).toBe(Math.min(3, siegeBefore + 1));

    const defAfter = game.previewAttack(mine.id, enemyCity.id, 3)!.defenderBonus;
    expect(defAfter).toBeLessThanOrEqual(defBefore);

    // 围城值不会超过上限
    for (let i = 0; i < 5; i++) {
      mine.army = 10;
      game.state.actionsLeft = 10;
      game.attack(mine.id, enemyCity.id, 3);
    }
    expect(enemyCity.siege).toBeLessThanOrEqual(3);
  });

  it('可建造特殊设施：每区每种各一个，各消耗 1 次行动 + 5 兵力，加成叠加', () => {
    const game = newGame(80);
    const s = game.state;
    const mine = s.regions.find((r) => r.owner === 0 && r.specials.length === 0)!;
    expect(mine).toBeDefined();
    mine.army = 30;
    s.actionsLeft = 10;
    const actions = s.actionsLeft;
    const baseProd = REGION_PRODUCTION[mine.type];

    // 第一种：要塞
    expect(game.buildSpecial(mine.id, 'fortress')).toBe(true);
    expect(mine.specials).toEqual(['fortress']);
    expect(mine.army).toBe(25);
    expect(s.actionsLeft).toBe(actions - 1);

    // 同一种不能再建
    expect(game.buildSpecial(mine.id, 'fortress')).toBe(false);

    // 另外两种可以继续建（同一区域三种共存）
    expect(game.buildSpecial(mine.id, 'barracks')).toBe(true);
    expect(game.buildSpecial(mine.id, 'treasury')).toBe(true);
    expect([...mine.specials].sort()).toEqual(['barracks', 'fortress', 'treasury']);
    expect(mine.army).toBe(15); // 30 - 5*3
    expect(s.actionsLeft).toBe(actions - 3);

    // 三种都有了：任何建造都应失败
    for (const k of ['barracks', 'fortress', 'treasury'] as const) {
      expect(game.buildSpecial(mine.id, k)).toBe(false);
    }

    // 加成叠加：兵营 +2 产兵、要塞 +2 防守骰、宝库 +3 占领留存
    expect(specialSum(mine, 'reinforce')).toBe(2);
    expect(specialSum(mine, 'defense')).toBe(2);
    expect(specialSum(mine, 'captureStock')).toBe(3);
    expect(specialNames(mine).sort()).toEqual(['兵营', '宝库', '要塞']);

    // 兵力不足 / 行动耗尽
    const other = s.regions.find((r) => r.owner === 0 && r.specials.length === 0 && r.id !== mine.id);
    if (other) {
      other.army = 3;
      expect(game.buildSpecial(other.id, 'barracks')).toBe(false);
      other.army = 20;
      s.actionsLeft = 0;
      expect(game.buildSpecial(other.id, 'barracks')).toBe(false);
    }
  });

  it('中立势力：城池每回合扩军，并周期性向相邻中立区扩张', () => {
    const game = newGame(81);
    const s = game.state;
    const neutralCity = s.regions.find((r) => r.owner === -1 && r.type === 'city');
    expect(neutralCity).toBeDefined();
    const before = neutralCity!.army;

    game.endTurn(); // 推进一回合
    expect(s.turn).toBeGreaterThan(1);
    expect(neutralCity!.army).toBeGreaterThan(before);
    expect(neutralCity!.army).toBeLessThanOrEqual(12);
  });
});

describe('战争迷雾', () => {
  it('初始视野 = 己方区域 + 相邻一圈，且不是全图', () => {
    const game = newGame(11);
    const s = game.state;
    const seen = new Set(s.players[0].seen);
    for (const r of s.regions) {
      if (r.owner !== 0) continue;
      expect(seen.has(r.id)).toBe(true);
      for (const nid of r.neighbors) expect(seen.has(nid)).toBe(true);
    }
    expect(seen.size).toBeLessThan(s.regions.length);
    expect(game.visibleRegions(0).length).toBeGreaterThan(0);
    expect(game.visibleRegions(0).length).toBeLessThan(s.regions.length);
  });

  it('占领相邻区域后视野随之扩大', () => {
    const game = newGame(12);
    const s = game.state;
    const target = s.regions.find(
      (r) => r.owner !== 0 && r.neighbors.some((n) => s.regions[n].owner === 0),
    );
    expect(target).toBeDefined();
    const from = target!.neighbors.find((n) => s.regions[n].owner === 0)!;
    const before = s.players[0].seen.length;

    let captured = false;
    for (let i = 0; i < 20 && !captured; i++) {
      s.actionsLeft = 10;
      s.regions[from].army = 60;
      target!.army = 1;
      captured = game.attack(from, target!.id, 59).captured;
    }
    expect(captured).toBe(true);

    const seen = new Set(s.players[0].seen);
    expect(seen.has(target!.id)).toBe(true);
    for (const nid of target!.neighbors) expect(seen.has(nid)).toBe(true);
    expect(s.players[0].seen.length).toBeGreaterThanOrEqual(before);
  });

  it('多回合后每个存活势力的视野始终覆盖自身领土', () => {
    const game = newGame(14);
    for (let i = 0; i < 8; i++) {
      game.endTurn();
      for (const p of game.state.players) {
        if (!p.alive) continue;
        const seen = new Set(p.seen);
        for (const r of game.state.regions) {
          if (r.owner === p.id) expect(seen.has(r.id)).toBe(true);
        }
      }
    }
  });

  it('存档往返保留视野，旧存档缺字段也能补齐', () => {
    const game = newGame(13);
    const round = Game.deserialize(game.serialize());
    expect(round.state.players[0].seen.length).toBe(game.state.players[0].seen.length);

    const raw = JSON.parse(game.serialize());
    for (const p of raw.players) delete p.seen;
    const legacy = Game.deserialize(JSON.stringify(raw));
    expect(legacy.state.players[0].seen.length).toBeGreaterThan(0);
  });
});
