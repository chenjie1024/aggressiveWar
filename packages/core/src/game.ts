import { createRng, createRngFromState, type Rng } from './rng';
import { generateMap } from './mapgen';
import { checkVictory } from './victory';
import { deserializeState, serializeState } from './serialize';
import { aiDecide } from './ai';
import { EVENT_CARDS } from './eventcards';
import { diceOutcomes } from './dice';
import { hasPolicy, policiesFor, type Policy } from './policies';
import { specialNames, specialSum } from './specials';
import * as C from './constants';
import {
  WEATHER_POOL,
  combatMods,
  productionModifier,
  seasonAt,
  seasonDef,
  weatherDef,
  type Season,
  type Weather,
} from './weather';
import type { GameConfig, GameState, LogEntry, PlayerId, Region, SpecialType } from './types';
import { NEUTRAL } from './types';

export interface BattleResult {
  captured: boolean;
  attackerLoss: number;
  defenderLoss: number;
}

export interface AttackPreview {
  committed: number;
  defenderArmy: number;
  defenderBonus: number;
  maxAttackDice: number;
  /** 攻占概率 0..1（精确枚举掷骰组合得出） */
  winProb: number;
  expectedAttackerLoss: number;
  expectedDefenderLoss: number;
  /** 天时/地形修正说明（跨海、雨季、大雾…），供弹窗展示 */
  notes: string[];
}

export class Game {
  state: GameState;
  private rng: Rng;
  /** 最近一次行军经过的区域 id 序列（供前端画路径动画） */
  lastMarch: number[] = [];

  constructor(config: GameConfig) {
    this.rng = createRng(config.seed);
    const gen = generateMap(config, this.rng);
    const stats: GameState['stats'] = {};
    for (const p of gen.players) stats[p.id] = { regionsCaptured: 0, regionsLost: 0 };

    this.state = {
      version: 2,
      config: { ...config },
      turn: 1,
      round: 1,
      season: seasonAt(1),
      weather: 'clear',
      currentPlayer: 0,
      players: gen.players,
      regions: gen.regions,
      stats,
      winner: null,
      gameOver: false,
      events: [],
      log: [],
      actionsLeft: C.ACTIONS_PER_TURN,
      rngState: this.rng.getState(),
    };

    this.reinforce(0);
    this.updateVision(0);
    if (this.state.players[0]) this.state.players[0].turns = 1;
    this.state.events.push({ type: 'turn', playerId: 0 });
    this.logEvent(`第 1 回合 · ${this.playerName(0)}`, 'turn');
  }

  getState(): GameState {
    return this.state;
  }

  get isHumanTurn(): boolean {
    return this.state.players[this.state.currentPlayer]?.isHuman ?? false;
  }

  regionById(id: number): Region | undefined {
    return this.state.regions.find((r) => r.id === id);
  }

  private playerName(id: PlayerId): string {
    if (id === NEUTRAL) return '中立';
    return this.state.players[id]?.name ?? '?';
  }

  /** 区域标签：地名（类型·设施加成） */
  regionLabel(r: Region): string {
    const names = specialNames(r);
    const sp = names.length ? `·${names.join('/')}` : '';
    return `${r.name}（${C.REGION_NAMES[r.type]}${sp}）`;
  }

  private logEvent(text: string, kind: LogEntry['kind']): void {
    this.state.log.push({ turn: this.state.turn, text, kind });
    if (this.state.log.length > C.LOG_LIMIT) this.state.log.shift();
  }

  drainEvents(): GameState['events'] {
    const ev = this.state.events;
    this.state.events = [];
    return ev;
  }

  serialize(): string {
    this.state.rngState = this.rng.getState();
    return serializeState(this.state);
  }

  static deserialize(json: string): Game {
    const state = deserializeState(json);
    const g = Object.create(Game.prototype) as Game;
    g.state = state;
    g.rng = createRngFromState(state.rngState);
    // 兼容旧存档：缺失视野时用当前领土补一份（己方 + 相邻一圈）
    for (const p of state.players) if (p.alive) g.updateVision(p.id);
    return g;
  }

  /** 建造特殊设施：消耗 1 次行动 + 若干兵力；每区每种各可建一个（兵营 / 要塞 / 宝库） */
  buildSpecial(regionId: number, kind: SpecialType): boolean {
    if (this.state.gameOver) return false;
    const r = this.regionById(regionId);
    if (!r || r.owner !== this.state.currentPlayer || r.owner < 0) return false;
    if (r.specials.includes(kind)) return false; // 该设施本区已有
    if (this.state.actionsLeft <= 0) return false;
    if (r.army < C.BUILD_SPECIAL_COST + 1) return false; // 至少留 1 兵

    r.army -= C.BUILD_SPECIAL_COST;
    r.specials.push(kind);
    r.specials.sort();
    this.state.actionsLeft -= 1;
    this.logEvent(
      `【${this.playerName(r.owner)}】在${this.regionLabel(r)}建造了${C.SPECIAL_BONUS[kind].name}`,
      'event',
    );
    return true;
  }

  /** 中立势力：城池逐步扩军，并周期性向外扩张（第三方压力） */
  private neutralTick(): void {
    const cities = this.state.regions.filter((r) => r.owner === NEUTRAL && r.type === 'city');
    for (const c of cities) {
      c.army = Math.min(C.NEUTRAL_CITY_ARMY_CAP, c.army + C.NEUTRAL_CITY_GROWTH);
    }
    if (this.state.turn % C.NEUTRAL_EXPAND_INTERVAL !== 0) return;
    for (const c of cities) {
      const target = c.neighbors
        .map((nid) => this.regionById(nid))
        .find(
          (n): n is Region =>
            !!n && n.owner === NEUTRAL && n.type !== 'city' && n.army < C.NEUTRAL_CITY_ARMY_CAP,
        );
      if (target) target.army = Math.min(C.NEUTRAL_CITY_ARMY_CAP, target.army + 1);
    }
  }

  /** 战斗预览：精确枚举掷骰组合，算出攻占概率与期望损失（不做任何状态修改） */
  previewAttack(fromId: number, toId: number, commit?: number): AttackPreview | null {
    const from = this.regionById(fromId);
    const to = this.regionById(toId);
    if (!from || !to) return null;
    if (from.owner < 0 || to.owner === from.owner) return null;
    if (!from.neighbors.includes(toId)) return null;

    const maxCommit = from.army - 1;
    if (maxCommit < 1) return null;
    const committed = Math.max(1, Math.min(Math.floor(commit ?? maxCommit), maxCommit));
    const defenderArmy = to.army;
    const fortify = this.hasPolicy(to.owner, 'fortify') ? 1 : 0;
    const crossSea = from.seaNeighbors.includes(toId) && !this.hasPolicy(from.owner, 'navigation');
    // 天时（季节 + 天气）与跨海统一算在这里：战斗与弹窗预览共用，避免"显示与实际不一致"
    const mods = combatMods(
      this.state.season,
      this.state.weather,
      crossSea,
      crossSea ? C.CROSS_SEA_PENALTY : 0,
    );
    const defenderBonus = this.defenseBonusFor(to, to.owner) + mods.defenseDice + fortify;
    const maxAttackDice = Math.max(1, C.MAX_ATTACK_DICE - mods.attackDicePenalty);

    const memo = new Map<string, { win: number; al: number; dl: number }>();
    const solve = (a: number, d: number, bonus: number): { win: number; al: number; dl: number } => {
      if (a <= 0) return { win: 0, al: 0, dl: 0 };
      if (d <= 0) return { win: 1, al: 0, dl: 0 };
      const key = `${a}:${d}:${bonus}`;
      const hit = memo.get(key);
      if (hit) return hit;

      const ad = Math.min(a, maxAttackDice);
      const dd = Math.min(d + bonus, C.MAX_DEFENSE_DICE);
      let win = 0;
      let al = 0;
      let dl = 0;

      for (const o of diceOutcomes(ad, dd)) {
        const na = a - o.l;
        let b = bonus;
        let rem = o.w;
        const bLost = Math.min(b, rem);
        b -= bLost;
        rem -= bLost;
        const nd = Math.max(0, d - rem);
        const dLost = d - nd;

        al += o.p * o.l;
        dl += o.p * dLost;

        if (nd <= 0) {
          win += o.p;
        } else if (na > 0) {
          const sub = solve(na, nd, b);
          win += o.p * sub.win;
          al += o.p * sub.al;
          dl += o.p * sub.dl;
        }
      }

      const res = { win, al, dl };
      memo.set(key, res);
      return res;
    };

    const r = solve(committed, defenderArmy, defenderBonus);
    return {
      committed,
      defenderArmy,
      defenderBonus,
      maxAttackDice,
      winProb: r.win,
      expectedAttackerLoss: r.al,
      expectedDefenderLoss: r.dl,
      notes: mods.notes,
    };
  }

  /** 进攻：from 区域进攻相邻的 to 区域（可指定投入兵力，缺省为全部可调动） */
  attack(fromId: number, toId: number, commit?: number): BattleResult | null {
    if (this.state.gameOver) return null;
    const from = this.regionById(fromId);
    const to = this.regionById(toId);
    if (!from || !to) return null;
    if (from.owner !== this.state.currentPlayer) return null;
    if (to.owner === from.owner) return null;
    if (!from.neighbors.includes(toId)) return null;
    const maxCommit = from.army - 1;
    if (maxCommit < 1) return null;
    if (this.state.actionsLeft <= 0) return null; // 行动次数耗尽
    this.state.actionsLeft -= 1; // 进攻消耗一次行动

    const committed = Math.max(1, Math.min(Math.floor(commit ?? maxCommit), maxCommit));
    from.army -= committed; // 出击兵力离开本区（驻守保留）
    const defenderOwner = to.owner;
    // 防守骰：地形 + 特殊区 + 筑城术政策 + 天时
    const fortify = this.hasPolicy(defenderOwner, 'fortify') ? 1 : 0;
    const crossSea = from.seaNeighbors.includes(toId) && !this.hasPolicy(from.owner, 'navigation');
    const mods = combatMods(
      this.state.season,
      this.state.weather,
      crossSea,
      crossSea ? C.CROSS_SEA_PENALTY : 0,
    );
    const defBonus = this.defenseBonusFor(to, defenderOwner) + mods.defenseDice + fortify;
    const maxAtkDice = Math.max(1, C.MAX_ATTACK_DICE - mods.attackDicePenalty);
    const result = this.battle(committed, to.army, defBonus, maxAtkDice);
    const attackerLoss = committed - result.attackerArmies;
    const defenderLoss = to.army - result.defenderArmies;

    if (result.defenderArmies <= 0) {
      to.owner = from.owner;
      to.siege = 0; // 易主后围城值清零
      // 占领后有额外损耗，抑制「赢家通吃」
      to.army = Math.max(1, result.attackerArmies - C.CAPTURE_ATTRITION);
      to.pendingBonus = specialSum(to, 'captureStock');
      if (defenderOwner !== NEUTRAL && defenderOwner !== from.owner) {
        this.state.stats[from.owner].regionsCaptured += 1;
        this.state.stats[defenderOwner].regionsLost += 1;
      }
      this.state.events.push({ type: 'regionCaptured', playerId: from.owner, regionId: toId, from: defenderOwner });
      this.logEvent(`【${this.playerName(from.owner)}】攻占【${this.playerName(defenderOwner)}】的${this.regionLabel(to)}`, 'capture');
    } else {
      to.army = Math.max(1, result.defenderArmies);
      from.army += result.attackerArmies; // 幸存者撤回本区
      // 围城累积：城池越打越弱（产兵 -1、防守骰 -1），易主后清零
      if (to.type === 'city') to.siege = Math.min(C.SIEGE_MAX, to.siege + 1);
      this.state.events.push({ type: 'battle', attacker: from.owner, defender: defenderOwner, regionId: toId, won: false });
      this.logEvent(
        `【${this.playerName(from.owner)}】进攻【${this.playerName(defenderOwner)}】的${this.regionLabel(to)}受阻（我方损失 ${attackerLoss}，敌方损失 ${defenderLoss}）`,
        'battle',
      );
    }

    checkVictory(this.state);
    this.updateVision(this.state.currentPlayer);
    return { captured: to.owner === from.owner, attackerLoss, defenderLoss };
  }

  /** 某区域本回合可调出的兵力上限（留 1，数量不限） */
  availableToMove(regionId: number): number {
    const r = this.regionById(regionId);
    if (!r) return 0;
    return Math.max(0, r.army - 1);
  }

  /** 本回合是否还有行动次数 */
  canAct(): boolean {
    return this.state.actionsLeft > 0 && !this.state.gameOver;
  }

  /** 沿己方领土的行军路径（最多 MARCH_HOPS 跳），返回区域 id 序列；相邻则返回两元素 */
  marchPath(fromId: number, toId: number, maxHops: number = C.MARCH_HOPS): number[] | null {
    if (fromId === toId) return null;
    const from = this.regionById(fromId);
    const to = this.regionById(toId);
    if (!from || !to) return null;
    if (from.owner < 0 || to.owner !== from.owner) return null;
    if (from.neighbors.includes(toId)) return [fromId, toId];

    const prev = new Map<number, number>();
    const seen = new Set<number>([fromId]);
    const queue: { id: number; d: number }[] = [{ id: fromId, d: 0 }];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur.id === toId) {
        const path: number[] = [];
        let k: number | null = toId;
        while (k !== null) {
          path.unshift(k);
          k = prev.get(k) ?? null;
        }
        return path;
      }
      if (cur.d >= maxHops) continue;
      for (const nid of this.regionById(cur.id)!.neighbors) {
        const n = this.regionById(nid);
        if (!n || n.owner !== from.owner || seen.has(nid)) continue;
        seen.add(nid);
        prev.set(nid, cur.id);
        queue.push({ id: nid, d: cur.d + 1 });
      }
    }
    return null;
  }

  /** 调兵 / 行军：指定数量兵力转移到沿己方领土可达的区域（消耗 1 次行动） */
  moveAmount(fromId: number, toId: number, amount: number): boolean {
    if (this.state.gameOver) return false;
    const from = this.regionById(fromId);
    const to = this.regionById(toId);
    if (!from || !to) return false;
    if (from.owner !== this.state.currentPlayer) return false;
    if (to.owner !== from.owner) return false;
    if (fromId === toId) return false;
    if (this.state.actionsLeft <= 0) return false;

    const path = this.marchPath(fromId, toId);
    if (!path) return false;

    const cap = this.availableToMove(fromId);
    if (cap < 1) return false;
    const n = Math.max(1, Math.min(Math.floor(amount), cap));

    to.army = to.army + n;
    from.army -= n;
    this.state.actionsLeft -= 1;
    this.lastMarch = path;
    this.updateVision(this.state.currentPlayer);
    return true;
  }

  /** 调兵（转移该区域全部可调动兵力） */
  move(fromId: number, toId: number): boolean {
    return this.moveAmount(fromId, toId, this.availableToMove(fromId));
  }

  /**
   * 派侦查兵：从 from 派出 SCOUT_COST 个兵（+1 次行动），
   * 探明 to 以及 to 的所有相邻区域在第几回合有多少兵。
   * 目标必须在 from 的 SCOUT_RANGE 跳以内（不要求沿途是自己的地盘）。
   */
  scout(fromId: number, toId: number): { ok: boolean; regionIds: number[]; reason?: string } {
    const from = this.regionById(fromId);
    const to = this.regionById(toId);
    if (this.state.gameOver) return { ok: false, regionIds: [], reason: '对局已结束' };
    if (!from || !to) return { ok: false, regionIds: [], reason: '区域不存在' };
    if (from.owner !== this.state.currentPlayer) return { ok: false, regionIds: [], reason: '只能从自己的区域派兵' };
    if (to.owner === from.owner) return { ok: false, regionIds: [], reason: '目标已经是自己的地盘' };
    if (this.state.actionsLeft <= 0) return { ok: false, regionIds: [], reason: '本回合行动次数已用完' };
    if (from.army < C.SCOUT_COST + C.SCOUT_MIN_GARRISON) {
      return { ok: false, regionIds: [], reason: `需要至少 ${C.SCOUT_COST + C.SCOUT_MIN_GARRISON} 兵（派 ${C.SCOUT_COST} + 留守 ${C.SCOUT_MIN_GARRISON}）` };
    }
    const dist = this.regionDistance(fromId, toId, C.SCOUT_RANGE);
    if (dist < 0) return { ok: false, regionIds: [], reason: `太远（侦查半径 ${C.SCOUT_RANGE} 格）` };

    from.army -= C.SCOUT_COST;
    this.state.actionsLeft -= 1;

    // 目标 + 相邻一圈，全部记下"当前回合的兵力快照"
    const p = this.state.players[from.owner];
    const ids = new Set<number>([toId, ...to.neighbors]);
    const seen = new Set(p.seen);
    for (const id of ids) {
      const r = this.regionById(id);
      if (!r) continue;
      seen.add(id);
      p.intel[id] = { army: r.army, turn: this.state.turn };
    }
    p.seen = [...seen];

    this.state.events.push({ type: 'scout', playerId: from.owner, regionIds: [...ids] });
    this.logEvent(
      `【${this.playerName(from.owner)}】从${from.name}派出侦查兵，探明${to.name}及周边 ${ids.size - 1} 区的兵力`,
      'event',
    );
    return { ok: true, regionIds: [...ids] };
  }

  /** 两区域间的最短邻接距离（超过 maxHops 返回 -1） */
  regionDistance(fromId: number, toId: number, maxHops: number): number {
    if (fromId === toId) return 0;
    const seen = new Set<number>([fromId]);
    let frontier = [fromId];
    for (let hop = 1; hop <= maxHops; hop++) {
      const next: number[] = [];
      for (const id of frontier) {
        const r = this.regionById(id);
        if (!r) continue;
        for (const nid of [...r.neighbors, ...r.seaNeighbors]) {
          if (seen.has(nid)) continue;
          if (nid === toId) return hop;
          seen.add(nid);
          next.push(nid);
        }
      }
      frontier = next;
    }
    return -1;
  }

  /** 当前玩家从某区域可以侦查到的敌方/中立区域（供 UI 高亮） */
  scoutTargets(fromId: number): number[] {
    const from = this.regionById(fromId);
    if (!from || from.owner !== this.state.currentPlayer) return [];
    if (from.army < C.SCOUT_COST + C.SCOUT_MIN_GARRISON) return [];
    const out: number[] = [];
    for (const r of this.state.regions) {
      if (r.owner === from.owner) continue;
      if (this.regionDistance(fromId, r.id, C.SCOUT_RANGE) >= 0) out.push(r.id);
    }
    return out;
  }

  /** 读取某区域的侦查情报（没有则 null） */
  intelFor(playerId: PlayerId, regionId: number): { army: number; turn: number; stale: boolean } | null {
    const p = this.state.players[playerId];
    const entry = p?.intel?.[regionId];
    if (!entry) return null;
    return { army: entry.army, turn: entry.turn, stale: this.state.turn - entry.turn >= C.INTEL_STALE_TURNS };
  }

  /** 结束当前回合：轮到下一个存活方，AI 自动行动 */
  endTurn(): void {
    if (this.state.gameOver) return;
    this.advanceTurn();
    checkVictory(this.state);

    let guard = 0;
    while (!this.state.gameOver && !this.isHumanTurn && guard++ < 200) {
      aiDecide(this, this.state.currentPlayer);
      if (this.state.gameOver) break;
      this.advanceTurn();
      checkVictory(this.state);
    }
  }

  private advanceTurn(): void {
    const prev = this.state.currentPlayer;
    const next = this.nextAlivePlayer(prev);
    this.state.currentPlayer = next;
    this.state.turn += 1;
    // 轮回到更靠前的势力 = 新的大回合：推进季节 / 重掷天气
    if (next <= prev) this.advanceRound();
    const p = this.state.players[next];
    if (p) p.turns += 1;
    this.state.actionsLeft = this.actionsLimit(next);
    this.reinforce(next);
    this.neutralTick();
    this.updateVision(next);
    this.state.events.push({ type: 'turn', playerId: next });
    this.logEvent(`第 ${this.state.turn} 回合 · ${this.playerName(next)}`, 'turn');
    this.drawEventCard(next);
  }

  /** 新的大回合：季节按 SEASON_TURNS 递进，天气从当季池子里重掷 */
  private advanceRound(): void {
    this.state.round += 1;
    const season = seasonAt(this.state.round);
    const changed = season !== this.state.season;
    this.state.season = season;
    const pool = WEATHER_POOL[season];
    this.state.weather = pool[this.rng.int(0, pool.length - 1)];
    if (changed) {
      const sd = seasonDef(season);
      this.state.events.push({ type: 'season', season, name: sd.name, icon: sd.icon, desc: sd.desc });
      this.logEvent(`${sd.icon} 入${sd.name}：${sd.desc}`, 'event');
    }
  }

  /** 当前天时说明（UI 展示用） */
  environment(): { round: number; season: Season; weather: Weather; notes: string[] } {
    const sd = seasonDef(this.state.season);
    const wd = weatherDef(this.state.weather);
    const notes: string[] = [sd.desc];
    if (wd.id !== 'clear') notes.push(`${wd.icon}${wd.name}：${wd.desc}`);
    return { round: this.state.round, season: this.state.season, weather: this.state.weather, notes };
  }

  /** 每 EVENT_INTERVAL 个「该玩家自己的回合」抽一张事件卡 */
  private drawEventCard(playerId: PlayerId): void {
    const p = this.state.players[playerId];
    if (!p) return;
    if (p.turns % C.EVENT_INTERVAL !== 0) return;
    const mine = this.state.regions.filter((r) => r.owner === playerId);
    if (mine.length === 0) return;
    const card = EVENT_CARDS[this.rng.int(0, EVENT_CARDS.length - 1)];

    if (card.id === 'harvest') {
      for (const r of mine) r.army = r.army + 3;
    } else if (card.id === 'conscription') {
      const cap = mine.find((r) => r.type === 'city') ?? mine[0];
      cap.army = cap.army + 5;
    } else if (card.id === 'plague') {
      for (const r of mine) r.army = Math.max(1, r.army - 2);
    } else if (card.id === 'barbarians') {
      for (const r of this.rng.shuffle([...mine]).slice(0, 2)) r.army = Math.max(1, r.army - 3);
    } else if (card.id === 'revolt') {
      const weakest = [...mine].sort((a, b) => a.army - b.army)[0];
      weakest.army = Math.max(1, weakest.army - 4);
    } else if (card.id === 'tribute') {
      const cap = mine.find((r) => r.capital) ?? mine.find((r) => r.type === 'city') ?? mine[0];
      cap.army = cap.army + Math.min(8, mine.length);
    } else if (card.id === 'militia') {
      for (const r of mine) {
        const front = r.neighbors.some((n) => this.state.regions[n]?.owner !== playerId);
        if (front) r.army = r.army + 3;
      }
    } else if (card.id === 'horsemen') {
      // 只有轮到自己时行动数才有意义（事件卡本就发给当前玩家）
      if (this.state.currentPlayer === playerId) this.state.actionsLeft += 3;
    } else if (card.id === 'deserters') {
      for (const r of this.rng.shuffle([...mine]).slice(0, 3)) r.army = Math.max(1, r.army - 1);
    } else if (card.id === 'golden_age') {
      const cities = mine.filter((r) => r.type === 'city');
      if (cities.length === 0) {
        const cap = mine.find((r) => r.capital) ?? mine[0];
        cap.army = cap.army + 3;
      } else {
        for (const c of cities) c.army = c.army + 3;
      }
    }

    this.state.events.push({
      type: 'card',
      playerId,
      cardId: card.id,
      name: card.name,
      desc: card.desc,
      good: card.good,
      icon: card.icon,
    });
    this.logEvent(`【${this.playerName(playerId)}】事件卡 · ${card.icon}${card.name}：${card.desc}`, 'event');
  }

  private nextAlivePlayer(from: PlayerId): PlayerId {
    const n = this.state.players.length;
    for (let i = 1; i <= n; i++) {
      const id = (from + i) % n;
      if (this.state.players[id]?.alive) return id;
    }
    return from;
  }

  ownedCount(playerId: PlayerId): number {
    return this.state.regions.filter((r) => r.owner === playerId).length;
  }

  /** 领地加成：每 TERRITORY_BONUS_DIVISOR 块 +1 兵力，封顶 TERRITORY_BONUS_CAP */
  territoryBonus(playerId: PlayerId): number {
    const owned = this.ownedCount(playerId);
    return Math.min(
      Math.floor(Math.max(0, owned - 1) / C.TERRITORY_BONUS_DIVISOR),
      C.TERRITORY_BONUS_CAP,
    );
  }

  /** 劣势补贴：只给区域最少的一方，按与领先者的差距缩放（封顶） */
  underdogBonus(playerId: PlayerId): number {
    const alive = this.state.players.filter((p) => p.alive);
    if (alive.length < 2) return 0;
    const counts = alive.map((p) => this.ownedCount(p.id));
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    const mine = this.ownedCount(playerId);
    if (mine !== min || mine >= max) return 0;
    return Math.min(C.UNDERDOG_BONUS_CAP, max - mine);
  }

  /** 已解锁的科技 / 政策 */
  unlockedPolicies(playerId: PlayerId): Policy[] {
    return policiesFor(this.ownedCount(playerId));
  }

  hasPolicy(playerId: PlayerId, id: string): boolean {
    return hasPolicy(this.ownedCount(playerId), id);
  }

  /** 本回合行动次数上限（含后勤 + 帝国政策） */
  actionsLimit(playerId: PlayerId): number {
    return (
      C.ACTIONS_PER_TURN +
      (this.hasPolicy(playerId, 'logistics') ? 3 : 0) +
      (this.hasPolicy(playerId, 'empire') ? 2 : 0)
    );
  }

  /** 战争迷雾：己方区域 + 其相邻一圈视为已探索 */
  private updateVision(playerId: PlayerId): void {
    const p = this.state.players[playerId];
    if (!p) return;
    const seen = new Set(p.seen);
    for (const r of this.state.regions) {
      if (r.owner !== playerId) continue;
      seen.add(r.id);
      for (const nid of r.neighbors) seen.add(nid);
    }
    p.seen = [...seen];
  }

  /** 某势力当前可见的区域（己方 + 相邻一圈） */
  visibleRegions(playerId: PlayerId): number[] {
    const out = new Set<number>();
    for (const r of this.state.regions) {
      if (r.owner !== playerId) continue;
      out.add(r.id);
      for (const nid of r.neighbors) out.add(nid);
    }
    return [...out];
  }

  /** 首都是否失守（失守则该势力每回合每区产兵 -1） */
  capitalLost(playerId: PlayerId): boolean {
    return !this.state.regions.some((r) => r.capital && r.owner === playerId);
  }

  /** 防守骰总加成（地形 + 特殊区 + 筑城术 - 围城） */
  private defenseBonusFor(target: Region, defenseOwner: PlayerId): number {
    const fortify = this.hasPolicy(defenseOwner, 'fortify') ? 1 : 0;
    return Math.max(
      0,
      C.REGION_DEFENSE[target.type] +
        specialSum(target, 'defense') +
        fortify -
        target.siege,
    );
  }

  /** 回合开始增援：按区域加成产兵 */
  private reinforce(playerId: PlayerId): void {
    const p = this.state.players[playerId];
    if (!p) return;
    const bonus = C.DIFFICULTY_CONFIG[p.difficulty].bonus;
    const territory = this.territoryBonus(playerId);
    const underdog = this.underdogBonus(playerId);
    const policyBonus =
      (this.hasPolicy(playerId, 'industry') ? 1 : 0) + (this.hasPolicy(playerId, 'empire') ? 1 : 0);
    const capitalPenalty = this.capitalLost(playerId) ? C.CAPITAL_LOST_PENALTY : 0;
    for (const r of this.state.regions) {
      if (r.owner !== playerId) continue;
      const spReinforce = specialSum(r, 'reinforce');
      const siege = r.type === 'city' ? r.siege : 0; // 被围城池产兵下降
      const gain = Math.max(
        0,
        C.REGION_PRODUCTION[r.type] +
          spReinforce +
          r.pendingBonus +
          bonus +
          territory +
          underdog +
          policyBonus -
          siege -
          capitalPenalty +
          productionModifier(this.state.season, this.state.weather, r.type),
      );
      r.army = r.army + gain;
      r.pendingBonus = 0;
    }
  }

  /** 骰子战斗（Risk 式）：防守加成转化为额外防守骰 */
  private battle(
    attackerArmies: number,
    defenderArmies: number,
    defenseBonus: number,
    maxAttackDice: number = C.MAX_ATTACK_DICE,
  ): { attackerArmies: number; defenderArmies: number } {
    let a = attackerArmies;
    let d = defenderArmies;
    let bonus = defenseBonus;
    let guard = 0;

    while (a > 0 && d > 0 && guard++ < 300) {
      const ad = Math.min(a, maxAttackDice);
      const dd = Math.min(d + bonus, C.MAX_DEFENSE_DICE);
      const aDice = this.roll(ad).sort((x, y) => y - x);
      const dDice = this.roll(dd).sort((x, y) => y - x);
      const pairs = Math.min(ad, dd);
      for (let i = 0; i < pairs; i++) {
        if (aDice[i] > dDice[i]) {
          if (bonus > 0) bonus--;
          else d--;
        } else {
          a--;
        }
        if (a <= 0 || d <= 0) break;
      }
    }
    return { attackerArmies: Math.max(0, a), defenderArmies: Math.max(0, d) };
  }

  private roll(n: number): number[] {
    const res: number[] = [];
    for (let i = 0; i < n; i++) res.push(this.rng.int(1, 6));
    return res;
  }
}
