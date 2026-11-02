import {
  Game,
  MAP_H,
  MAP_W,
  REGION_NAMES,
  SCENARIOS,
  SCOUT_COST,
  TURN_LIMIT_DEFAULT,
  computeScore,
  difficultyToInt,
  achievementById,
  newProgress,
  noteBattle,
  noteTurn,
  regionCount,
  satisfiedAchievements,
  type AchvProgress,
  type BattleResult,
  type GameConfig,
} from '@gongfa-war/core';
import { Camera } from './render/camera';
import {
  buildRegionGrid,
  draw,
  drawMinimap,
  CELL,
  type FloatingText,
  type Pulse,
} from './render/mapRenderer';
import { GameInput } from './render/input';
import { Hud } from './ui/hud';
import { showMenu, type MenuController, type StartConfig } from './ui/menu';
import { LanClient, type LanRoom } from './net/lan';
import { LockstepClient, type LockCmd, type LockPeer, type LockSeat } from './net/lockstep';
import { hostBridgeAvailable, joinCodeFromUrl, startHostServer } from './net/hostBridge';
import { showAttackDialog, showConfirm, showEvents, showHelp, showMoveDialog, showResult, toast } from './ui/dialogs';
import { MusicPlayer, loadMusicPrefs, saveMusicPrefs, type Mood } from './audio/music';
import { SfxPlayer, loadSfxPrefs, saveSfxPrefs } from './audio/sfx';
import { api } from './net/apiClient';

const app = document.getElementById('app')!;
app.innerHTML = '';

const canvas = document.createElement('canvas');
canvas.id = 'game';
app.appendChild(canvas);
const toasts = document.createElement('div');
toasts.id = 'toasts';
app.appendChild(toasts);
const ctx = canvas.getContext('2d')!;

const camera = new Camera();

/** 视口尺寸（CSS 像素）与设备像素比：画布按 dpr 放大，保证手机高分屏不糊 */
let viewW = 0;
let viewH = 0;
let dpr = 1;

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (w < 80 || h < 80) return; // 忽略退化尺寸（最小化 / 隐藏 / 视口抖动）
  const prevW = viewW;
  const prevH = viewH;
  viewW = w;
  viewH = h;
  dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  if (prevW > 0 && prevH > 0) {
    // 窗口尺寸变化时保持视图中心不变
    camera.shiftViewport((w - prevW) / 2, (h - prevH) / 2);
  }
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => window.setTimeout(resize, 120));
resize();

let game: Game | null = null;
let lastConfig: StartConfig | null = null;
let regionGrid: Int16Array = new Int16Array(0);
let selection: number | null = null;
let hover: number | null = null;
let gameOverShown = false;
let recorded = false;
/** 我方席位：单机固定 0，联机时由服务器分配（1 起） */
let mySeat = 0;
/** 战争迷雾开关（仅影响人类视野与情报显示，AI 始终全知） */
let fogOn = localStorage.getItem('gongfa-war.fog') !== '0';
const anims: FloatingText[] = [];
const pulses: Pulse[] = [];

function pulseAt(regionId: number, color: string, kind: Pulse['kind']): void {
  pulses.push({ regionId, born: performance.now(), color, kind });
}

/** 在区域中心弹出浮动文字（调兵/战斗动画） */
function floatAt(regionId: number, text: string, color: string): void {
  if (!game) return;
  const r = game.regionById(regionId);
  if (!r) return;
  anims.push({ x: r.center.x * CELL, y: r.center.y * CELL, text, color, born: performance.now() });
}

function centerOnHuman(): void {
  if (!game) return;
  const capital =
    game.state.regions.find((r) => r.owner === mySeat && r.type === 'city') ??
    game.state.regions.find((r) => r.owner === mySeat);
  if (!capital) return;

  // 手机：把「己方领土 + 相邻一圈」整体塞进可视区 —— 开局第一屏就能看清自己的地盘，
  // 而不是只看到一条横带（屏幕高只有 390px，1.25 倍时仅能显示 13 行 / 全图 40 行）。
  if (isCompactLayout()) {
    const ids = new Set<number>();
    for (const r of game.state.regions) {
      if (r.owner !== mySeat) continue;
      ids.add(r.id);
      for (const n of r.neighbors) ids.add(n);
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const id of ids) {
      const r = game.regionById(id);
      if (!r) continue;
      for (const c of r.cells) {
        if (c.x < minX) minX = c.x;
        if (c.y < minY) minY = c.y;
        if (c.x > maxX) maxX = c.x;
        if (c.y > maxY) maxY = c.y;
      }
    }
    if (Number.isFinite(minX)) {
      const worldW = Math.max(1, (maxX - minX + 1) * CELL);
      const worldH = Math.max(1, (maxY - minY + 1) * CELL);
      const scale = Math.min(
        1.35,
        Math.max(MIN_SCALE_HINT, Math.min((viewW * 0.92) / worldW, (viewH * 0.88) / worldH)),
      );      camera.centerOn(
        ((minX + maxX + 1) / 2) * CELL,
        ((minY + maxY + 1) / 2) * CELL,
        viewW,
        viewH,
        scale,
      );
      return;
    }
  }
  // 桌面：定位到首都，1.25 倍（区域与图标都足够大；🗺️ 全图 可一键缩回）
  camera.centerOn(capital.center.x * CELL, capital.center.y * CELL, viewW, viewH, 1.25);
}

/** 手机自动适配时的缩放下限：再小数字与图标就看不清了（宁可视区装不下、让玩家自己平移） */
const MIN_SCALE_HINT = 0.9;

// ===== 局域网联机 =====
let netMode = false;
/** 联机方式：lockstep = 中继转发 + 各端本地跑规则（手机热点用这个）；authoritative = 电脑服务器跑规则 */
let netKind: 'lockstep' | 'authoritative' = 'lockstep';
let lan: LanClient | null = null;
let lock: LockstepClient | null = null;
let menuCtl: MenuController | null = null;
/** 联机时服务端推来的房间信息（用于显示轮到谁 / 房间码） */
let netRoom: LanRoom | null = null;
/** 锁步：中继上的席位（人类 / AI 与国别分配，各端一致） */
let lockSeats: LockSeat[] = [];
let lockCode: string | null = null;
/** 锁步：最近一次房间成员列表（房主开局时用来分配席位） */
let lockPeers: LockPeer[] = [];
/** 手机开房时本机中继的局域网地址（显示在菜单里给其它手机用） */
let hostUrls: string[] = [];
/** 我是不是房主（后续 roomInfo 广播不带 host 字段，需要记住） */
let netIsHost = false;
let netBanner: HTMLElement | null = null;

function playerName(): string {
  let n = '';
  try {
    n = localStorage.getItem('gongfa-war.name') ?? '';
  } catch {
    /* 隐私模式 */
  }
  return n || '玩家';
}

/** 锁步：把中继上的房间席位整理成"人类席位 + 其余交给 AI"的分配表 */
function buildLockSeats(config: StartConfig, peers: LockPeer[]): LockSeat[] {
  const total = config.opponents + 1;
  const pool = (SCENARIOS.find((s) => s.id === config.scenario) ?? SCENARIOS[0]).nationIds.filter(
    (id) => id !== config.nationId,
  );
  const seats: LockSeat[] = [];
  let poolIdx = 0;
  for (let i = 0; i < total; i++) {
    const peer = peers.find((p) => p.seat === i);
    seats.push({
      seat: i,
      name: peer?.name ?? `AI ${i}`,
      human: !!peer,
      nationId: peer ? pool[poolIdx++ % Math.max(1, pool.length)] : undefined,
    });
  }
  seats[0] = {
    seat: 0,
    name: peers.find((p) => p.seat === 0)?.name ?? playerName(),
    human: true,
    nationId: config.nationId,
  };
  return seats;
}

/** 各端一致地把席位信息写回本地 Game */
function applyLockSeats(seats: LockSeat[]): void {
  if (!game) return;
  for (const s of seats) {
    const p = game.state.players[s.seat];
    if (!p) continue;
    p.isHuman = s.human;
    if (s.name) p.name = s.name;
    if (s.nationId) p.nationId = s.nationId;
  }
}

/** 锁步：按中继广播的顺序应用一条指令（各端逻辑必须完全一致，否则状态分叉） */
function applyNetCommand(seat: number, cmd: LockCmd): void {
  if (!game || game.state.gameOver) return;
  // 越权 / 非当前回合：所有端做同样的判定后忽略
  if (seat !== game.state.currentPlayer) return;
  switch (cmd.k) {
    case 'attack': {
      const name = game.regionById(cmd.to ?? -1)?.name ?? '';
      afterBattle(cmd.to ?? -1, cmd.from ?? -1, game.attack(cmd.from!, cmd.to!, cmd.commit), name);
      return;
    }
    case 'move':
      game.moveAmount(cmd.from!, cmd.to!, cmd.amount ?? 1);
      break;
    case 'build':
      if (cmd.special) game.buildSpecial(cmd.regionId!, cmd.special);
      break;
    case 'scout':
      game.scout(cmd.from!, cmd.to!);
      break;
    case 'end':
      game.endTurn();
      noteTurn(game, mySeat, achvProgress);
      selection = null;
      undoStack.length = 0;
      break;
    default:
      return;
  }
  viewCache = null;
  afterAction();
}

/** 联机模式下把动作发出去（返回 true 表示已接管，本地不再自行执行） */
function netSend(cmd: LockCmd): boolean {
  if (!netMode || !game) return false;
  if (game.state.currentPlayer !== mySeat) {
    toast(`等待 ${game.state.players[game.state.currentPlayer]?.name ?? '对手'} 行动`);
    sfx.play('error');
    return true;
  }
  if (netKind === 'lockstep') {
    lock?.act(cmd);
  } else if (cmd.k === 'end') {
    lan?.endTurn();
  } else {
    lan?.action({
      kind: cmd.k,
      from: cmd.from,
      to: cmd.to,
      commit: cmd.commit,
      amount: cmd.amount,
      regionId: cmd.regionId,
      special: cmd.special,
    });
  }
  return true;
}

function updateNetBanner(): void {
  if (!netMode || !game) {
    netBanner?.remove();
    netBanner = null;
    return;
  }
  if (!netBanner) {
    netBanner = document.createElement('div');
    netBanner.id = 'net-banner';
    document.getElementById('app')!.appendChild(netBanner);
  }
  const s = game.state;
  const mine = s.currentPlayer === mySeat;
  netBanner.className = mine ? 'mine' : '';
  const code = lockCode ?? netRoom?.code ?? '';
  netBanner.textContent = mine
    ? `🌐 房间 ${code} · 轮到你了`
    : `🌐 房间 ${code} · 等待 ${s.players[s.currentPlayer]?.name ?? '对手'} 行动…`;
}

/** 锁步房间：中继只转发，规则在各端本地跑 */
function startLockClient(relayUrl?: string): LockstepClient {
  lock?.close();
  netIsHost = false;
  lockCode = null;
  const client = new LockstepClient(
    {
      onStatus: (ok, note) => {
        if (!ok) toast(`🌐 ${note}`);
      },
      onRoom: (code, seat, host, peers, started) => {
        lockCode = code;
        lockPeers = peers;
        if (seat >= 0) mySeat = seat;
        if (host) netIsHost = true;
        renderLockRoom(code, peers, started);
      },
      onPeers: (peers) => {
        lockPeers = peers;
        if (lockCode) renderLockRoom(lockCode, peers, !!game);
      },
      onBegin: (seed, config, seats) => {
        beginLockGame(seed, config as GameConfig, seats as LockSeat[]);
      },
      onCommand: (seat, cmd) => applyNetCommand(seat, cmd),
      onError: (message) => {
        toast(`🌐 ${message}`);
        const box = document.getElementById('lan-box');
        if (box) box.innerHTML = `⚠️ ${message}`;
      },
    },
    relayUrl,
  );
  lock = client;
  return client;
}

function renderLockRoom(code: string, peers: LockPeer[], started: boolean): void {
  const list = peers
    .map(
      (p) =>
        `<div>${p.seat === 0 ? '👑 ' : ''}🧑 ${p.name}${p.seat === mySeat ? '（我）' : ''}${p.connected ? '' : ' · 掉线'}</div>`,
    )
    .join('');
  const rest = Math.max(0, (lastConfig?.opponents ?? 1) + 1 - peers.length);
  const localUrls = hostUrls.length
    ? `<div style="margin-top:6px">其它手机连同一热点，浏览器打开 <b>${hostUrls[0]}</b> 输入房间码（或直接扫/点带 ?join=${code} 的地址）</div>`
    : `<div style="margin-top:6px">其它手机连同一热点 / WiFi，浏览器打开 <b>http://&lt;房主IP&gt;:端口</b> 输入房间码加入</div>`;
  menuCtl?.setRoomInfo(
    `<b>房间码 ${code}</b>${started ? ' · 对局进行中' : ''}<div style="margin-top:4px">${list}` +
      `${rest ? `<div>🤖 ${rest} 个 AI 席位</div>` : ''}</div>${localUrls}`,
    netIsHost && !started,
  );
}

/** 锁步开局：各端用同一份 (seed, config, seats) 建出同一张图 */
function beginLockGame(seed: number, config: GameConfig, seats: LockSeat[]): void {
  gameOverShown = false;
  recorded = false;
  game = new Game({ ...config, seed });
  lockSeats = seats;
  applyLockSeats(seats);
  regionGrid = buildRegionGrid(game.state.regions);
  selection = null;
  hover = null;
  achvProgress = newProgress();
  hud.renderAchievements(unlockedAchv);
  netMode = true;
  netKind = 'lockstep';
  fogOn = lastConfig?.fog !== false;
  menuCtl?.close();
  centerOnHuman();
  updateNetBanner();
}

function startLanClient(): LanClient {
  lan?.close();
  netKind = 'authoritative';
  netIsHost = false;
  const client = new LanClient({
    onStatus: (ok, note) => {
      if (!ok) toast(`🌐 ${note}`);
    },
    onRoom: (room, seat, host) => {
      netRoom = room;
      if (seat >= 0) mySeat = seat;
      if (host) netIsHost = true;
      const list = room.seats
        .map(
          (x) =>
            `<div>${x.seat === 0 ? '👑 ' : ''}${x.ai ? '🤖' : '🧑'} ${x.name}${x.seat === mySeat ? '（我）' : ''}` +
            `${x.connected || x.ai ? '' : ' · 掉线'}</div>`,
        )
        .join('');
      menuCtl?.setRoomInfo(
        `<b>房间码 ${room.code}</b>${room.started ? ' · 对局进行中' : ''}<div style="margin-top:4px">${list}</div>` +
          `<div style="margin-top:6px">手机连同一 WiFi，浏览器打开电脑的 <b>http://&lt;电脑IP&gt;:3000</b>，输入房间码加入</div>`,
        netIsHost && !room.started,
      );
      if (room.started && game) updateNetBanner();
    },
    onState: (json, room) => {
      netRoom = room;
      applyNetState(json);
    },
    onError: (message) => {
      toast(`🌐 ${message}`);
      const box = document.getElementById('lan-box');
      if (box) box.innerHTML = `⚠️ ${message}`;
    },
  });
  client.connect();
  lan = client;
  return client;
}

/** 服务端权威状态：直接反序列化渲染，本地不做规则判定 */
function applyNetState(json: string): void {
  const first = !game;
  game = Game.deserialize(json);
  if (first) {
    regionGrid = buildRegionGrid(game.state.regions);
    achvProgress = newProgress();
    hud.renderAchievements(unlockedAchv);
    netMode = true;
    menuCtl?.close();
    centerOnHuman();
  }
  viewCache = null;
  updateNetBanner();
  // 事件提示（战斗 / 占领 / 季节）用人类视角展示
  const evs = game.drainEvents();
  if (evs.length) showEvents(evs, game.state, mySeat);
  if (game.state.gameOver) handleGameOver();
}

function startGame(config: StartConfig): void {
  netMode = false;
  netRoom = null;
  lan?.close();
  lan = null;
  updateNetBanner();
  gameOverShown = false;
  recorded = false;
  mySeat = 0;
  fogOn = config.fog !== false;
  try {
    localStorage.setItem('gongfa-war.fog', fogOn ? '1' : '0');
  } catch {
    /* 隐私模式下忽略 */
  }
  const gc: GameConfig = {
    seed: Math.floor(Math.random() * 2 ** 31),
    regionCount: config.regionCount,
    opponents: config.opponents,
    difficulty: config.difficulty,
    turnLimit: TURN_LIMIT_DEFAULT,
    nationId: config.nationId,
    template: config.template,
    scenario: config.scenario,
  };
  game = new Game(gc);
  regionGrid = buildRegionGrid(game.state.regions);
  selection = null;
  hover = null;
  achvProgress = newProgress();
  hud.renderAchievements(unlockedAchv);
  centerOnHuman();
}

// ===== 本回合行动撤销栈 =====
const undoStack: string[] = [];

function pushUndo(): void {
  if (!game) return;
  undoStack.push(game.serialize());
  if (undoStack.length > 40) undoStack.shift();
}

function undo(): void {
  const json = undoStack.pop();
  if (!json || !game) {
    toast('没有可撤销的操作');
    return;
  }
  game = Game.deserialize(json);
  selection = null;
  viewCache = null;
  toast('↩️ 已撤销上一步');
}

let shiftHeld = false;

// ===== 可达/威胁区域分色（带缓存，避免每帧重算战斗预览） =====
interface ViewSets {
  attackable: number[];
  movable: number[];
  /** 调兵最大范围（2~3 跳的己方区域） */
  marchable: number[];
  /** 悬停可调兵目标时的行军路径（含起点与终点） */
  marchPath: number[];
  /** 可派侦查兵的目标区域 */
  scoutable: number[];
  threatened: number[];
  hints: Map<number, { commit: number; win: number }>;
}

let viewCache: { key: string; sets: ViewSets } | null = null;

function computeView(): ViewSets {
  const empty: ViewSets = {
    attackable: [],
    movable: [],
    marchable: [],
    marchPath: [],
    scoutable: [],
    threatened: [],
    hints: new Map(),
  };
  if (!game) return empty;
  const s = game.state;
  const key = `${selection}|${s.turn}|${s.currentPlayer}|${s.actionsLeft}|${s.regions.map((r) => r.army).join(',')}`;
  if (viewCache && viewCache.key === key) return viewCache.sets;

  const g = game;
  const own = s.regions.filter((r) => r.owner === mySeat);

  // 受威胁：相邻敌军总兵力 > 自身
  const threatened: number[] = [];
  for (const r of own) {
    const threat = r.neighbors.reduce((sum, nid) => {
      const n = g.regionById(nid);
      return n && n.owner !== mySeat ? sum + n.army : sum;
    }, 0);
    if (threat > r.army) threatened.push(r.id);
  }

  const sets: ViewSets = { ...empty, threatened };
  if (selection == null) {
    viewCache = { key, sets };
    return sets;
  }
  const sel = g.regionById(selection);
  if (!sel || sel.owner !== mySeat) {
    viewCache = { key, sets };
    return sets;
  }

  const movable: number[] = [];
  const direct = new Set<number>();
  for (const nid of sel.neighbors) {
    const n = g.regionById(nid);
    if (n && n.owner === mySeat) {
      movable.push(nid);
      direct.add(nid);
    }
  }
  const marchable: number[] = [];
  for (const r of own) {
    if (r.id === sel.id || direct.has(r.id)) continue;
    if (g.marchPath(sel.id, r.id)) marchable.push(r.id);
  }

  // 悬停在可调兵/可行军目标上时，把行军路径画出来（最多 MARCH_HOPS 跳）
  if (hover != null && hover !== sel.id && (direct.has(hover) || marchable.includes(hover))) {
    sets.marchPath = g.marchPath(sel.id, hover) ?? [];
  }

  const commit = g.availableToMove(sel.id);
  for (const nid of sel.neighbors) {
    const n = g.regionById(nid);
    if (!n || n.owner === mySeat) continue;
    sets.attackable.push(nid);
    const p = commit >= 1 ? g.previewAttack(sel.id, nid, commit) : null;
    if (p) sets.hints.set(nid, { commit: p.committed, win: p.winProb });
  }
  // 侦查范围（青色虚线）：排除已经能直接看到的相邻区
  sets.scoutable = g.scoutTargets(sel.id).filter((id) => !sel.neighbors.includes(id));

  viewCache = { key, sets };
  return sets;
}

function afterAction(): void {
  if (!game) return;
  const evs = game.drainEvents();
  showEvents(evs, game.state, mySeat);
  checkAchievements();
  if (game.state.gameOver || !game.state.players[mySeat].alive) handleGameOver();
}

/** 手机 / 矮屏布局（与 CSS 断点保持一致） */
function isCompactLayout(): boolean {
  return window.matchMedia('(max-width: 900px), (max-height: 520px)').matches;
}

/**
 * 手机端：选中区域后把它挪进"没被面板挡住"的可视区 ——
 * 顶部 52px 是顶栏、右侧 min(30vw,320px) 是详情面板。
 */
function revealRegion(regionId: number): void {
  if (!game || !isCompactLayout()) return;
  const r = game.regionById(regionId);
  if (!r) return;
  const p = camera.worldToScreen(r.center.x * CELL, r.center.y * CELL);
  const panelW = Math.min(viewW * 0.3, 320); // 与 CSS 的 min(30vw, 320px) 保持一致
  const safeLeft = 60;
  const safeRight = viewW - panelW - 60;
  const safeTop = 64;
  const safeBottom = viewH - 60;
  let dx = 0;
  if (safeRight > safeLeft) {
    if (p.x > safeRight) dx = safeRight - p.x;
    else if (p.x < safeLeft) dx = safeLeft - p.x;
  }
  let dy = 0;
  if (p.y > safeBottom) dy = safeBottom - p.y;
  else if (p.y < safeTop) dy = safeTop - p.y;
  if (dx !== 0 || dy !== 0) camera.pan(dx, dy);
}

function handleRegionClick(id: number | null): void {
  if (!game || game.state.gameOver || !game.isHumanTurn) return;
  hud.setDrawer(false); // 手机端：点地图时自动收起战况抽屉
  if (id == null) {
    selection = null;
    return;
  }
  const r = game.regionById(id);
  if (!r) return;

  if (selection == null) {
    selection = id; // 也可直接点选远处区域查看情报（战争迷雾下可能是阴影）
    revealRegion(id);
    sfx.play('select');
    return;
  }
  if (id === selection) {
    selection = null;
    return;
  }
  const sel = game.regionById(selection);
  if (!sel) {
    selection = null;
    return;
  }

  const adjacent = sel.neighbors.includes(id);
  const canMarch = !adjacent && r.owner === mySeat && !!game.marchPath(sel.id, id);
  if (!adjacent && !canMarch) {
    // 2 格内的敌方/中立区域：可以派侦查兵（5 兵 + 1 行动）
    if (r.owner !== mySeat && game.scoutTargets(sel.id).includes(id)) {
      showScoutDialog(sel.id, id);
      return;
    }
    selection = id; // 其它情况 → 切换为查看该区域情报
    revealRegion(id);
    return;
  }

  if (r.owner === mySeat) {
    const source = sel;
    const march = game.marchPath(source.id, id);
    const via = march ? march.length - 2 : 0;
    if (game.state.actionsLeft <= 0) {
      toast('本回合行动次数已用完（调兵 / 行军 / 进攻各消耗 1 次）');
      return;
    }
    const available = game.availableToMove(source.id);
    if (available < 1) {
      toast('该区域没有可调动的兵力');
      return;
    }
    showMoveDialog({
      fromLabel: game.regionLabel(source),
      toLabel: via > 0 ? `${game.regionLabel(r)}（行军 ${via} 格）` : game.regionLabel(r),
      max: available,
      onConfirm: (n) => {
        if (!game) return;
        if (netSend({ k: 'move', from: source.id, to: r.id, amount: n })) {
          toast(via > 0 ? `🚩 行军 ${n} 兵 → ${r.name}（途经 ${via} 区）` : `🚩 调兵 ${n} 兵 → ${r.name}`);
          selection = null;
          return;
        }
        const before = game.regionById(source.id)?.army ?? 0;
        pushUndo();
        if (game.moveAmount(source.id, r.id, n)) {
          toast(via > 0 ? `🚩 行军 ${n} 兵 → ${r.name}（途经 ${via} 区）` : `🚩 调兵 ${n} 兵 → ${r.name}`);
          floatAt(source.id, `-${before - (game.regionById(source.id)?.army ?? 0)}`, '#ffd34d');
          floatAt(r.id, `+${n}`, '#8ce99a');
          pulseAt(r.id, '#ffd34d', 'move');
        }
        const after = game.regionById(source.id);
        if (!after || after.army < 2) selection = null;
        afterAction();
      },
    });
    return;
  }

  if (game.state.actionsLeft <= 0) {
    toast('本回合行动次数已用完（调兵 / 进攻各消耗 1 次）');
    sfx.play('error');
    return;
  }
  const maxCommit = game.availableToMove(sel.id);
  if (maxCommit < 1) {
    toast('兵力不足，无法进攻（需要 ≥ 2）');
    sfx.play('error');
    return;
  }
  if (shiftHeld) {
    // Shift + 点击 = 直接满额出击（跳过弹窗）
    if (netSend({ k: 'attack', from: sel.id, to: id, commit: maxCommit })) return;
    pushUndo();
    afterBattle(id, sel.id, game.attack(sel.id, id, maxCommit), r.name);
    return;
  }
  showAttackDialog({
    targetName: game.regionLabel(r),
    maxCommit,
    initialCommit: maxCommit,
    preview: (commit) => game!.previewAttack(sel.id, id, commit),
    onConfirm: (commit) => {
      if (!game) return;
      if (netSend({ k: 'attack', from: sel.id, to: id, commit })) return;
      pushUndo();
      afterBattle(id, sel.id, game.attack(sel.id, id, commit), r.name);
    },
  });
}

const input = new GameInput(
  canvas,
  camera,
  {
    onRegionClick: handleRegionClick,
    onRegionRightClick() {
      selection = null; // 右键取消当前选中
    },
    onHover(id) {
      hover = id;
    },
  },
  () => regionGrid,
);

// 快捷键：空格结束回合 / Esc 取消选中 / Tab 切换 / 方向键移动光标 / Ctrl+Z 撤销
window.addEventListener('keydown', (e) => {
  if (e.key === 'Shift') shiftHeld = true;
  if (!game || game.state.gameOver) return;
  const tag = (e.target as HTMLElement | null)?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    undo();
    return;
  }
  if (e.code === 'Space') {
    e.preventDefault();
    requestEndTurn();
  } else if (e.key === 'Escape') {
    selection = null;
  } else if (e.key === 'Tab') {
    e.preventDefault();
    const mine = game.state.regions.filter((r) => r.owner === mySeat);
    if (mine.length === 0) return;
    const idx = mine.findIndex((r) => r.id === selection);
    selection = mine[(idx + 1) % mine.length].id;
  } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    moveSelection(e.key);
  }
});

window.addEventListener('keyup', (e) => {
  if (e.key === 'Shift') shiftHeld = false;
});

/** 方向键：把选中光标移到该方向上最近的己方区域 */
function moveSelection(key: string): void {
  if (!game) return;
  const own = game.state.regions.filter((r) => r.owner === mySeat);
  if (own.length === 0) return;
  const cur = selection != null ? game.regionById(selection) : null;
  if (!cur || cur.owner !== mySeat) {
    selection = own[0].id;
    return;
  }
  const dx = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0;
  const dy = key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : 0;
  let best: number | null = null;
  let bestScore = Infinity;
  for (const r of own) {
    if (r.id === cur.id) continue;
    const vx = r.center.x - cur.center.x;
    const vy = r.center.y - cur.center.y;
    const along = vx * dx + vy * dy;
    if (along <= 0.5) continue;
    const perp = Math.abs(vx * dy - vy * dx);
    const score = perp * 3 + along * 0.15;
    if (score < bestScore) {
      bestScore = score;
      best = r.id;
    }
  }
  if (best != null) selection = best;
}

/** 派侦查兵确认框：说明消耗与将探明的范围 */
function showScoutDialog(fromId: number, toId: number): void {
  if (!game) return;
  const from = game.regionById(fromId);
  const to = game.regionById(toId);
  if (!from || !to) return;
  const cost = SCOUT_COST;
  const reveal = [toId, ...to.neighbors].length;
  showConfirm({
    title: '🕵️ 派出侦查兵',
    text:
      `从【${from.name}】派出 ${cost} 名侦查兵（消耗 1 次行动，本地留 ${from.army - cost} 兵）\n` +
      `将探明【${to.name}】及周边共 ${reveal} 个区域的兵力`,
    onConfirm: () => {
      if (!game) return;
      if (netSend({ k: 'scout', from: fromId, to: toId })) {
        toast('🕵️ 侦查指令已发出');
        viewCache = null;
        return;
      }
      pushUndo();
      const res = game.scout(fromId, toId);
      if (res.ok) {
        toast(`🕵️ 侦查完成：探明 ${res.regionIds.length} 个区域的兵力`);
        sfx.play('select');
        for (const rid of res.regionIds) pulseAt(rid, '#6edcff', 'move');
        viewCache = null;
        afterAction();
      } else {
        undoStack.pop();
        toast(`侦查失败：${res.reason ?? '条件不满足'}`);
        sfx.play('error');
      }
    },
  });
}

/** 战斗收尾：动画 + 选中保持（可连续进攻）、事件与胜负检查 */
function afterBattle(targetId: number, sourceId: number, res: BattleResult | null, name: string): void {
  if (!game) return;
  if (res) {
    const cap = res.captured;
    toast(cap ? `⚔️ 攻占 ${name}！` : `⚔️ 进攻 ${name} 受阻`);
    pulseAt(targetId, cap ? '#ffd34d' : '#ff6b6b', cap ? 'capture' : 'hit');
    floatAt(targetId, cap ? `占领 ${name}` : `-${res.defenderLoss}`, cap ? '#ffd34d' : '#ff8a80');
    floatAt(sourceId, `-${res.attackerLoss}`, '#ff8a80');
    // 音效：占领 / 打赢 / 打输 三种听感
    if (cap) sfx.play('capture');
    else if (res.defenderLoss > res.attackerLoss) sfx.play('win');
    else sfx.play('lose');
    // 成就进度：需要知道这一仗是不是打的首都
    const target = game.regionById(targetId);
    noteBattle(achvProgress, res, !!target?.capital && res.captured);
  }
  const src = game.regionById(sourceId);
  if (!src || src.army < 2) selection = null; // 还有兵则保持选中，可继续进攻
  viewCache = null;
  afterAction();
}

/** 结束回合（若还有未用行动，先确认一次） */
function requestEndTurn(): void {
  if (!game || game.state.gameOver || !game.isHumanTurn) return;
  const left = game.state.actionsLeft;
  if (left > 0 && !noActionWarn) {
    showConfirm({
      title: '结束回合',
      text: `本回合还有 ${left} 次行动未使用，确定结束吗？`,
      checkLabel: '不再提醒',
      onConfirm: (checked) => {
        if (checked) noActionWarn = true;
        doEndTurn();
      },
    });
    return;
  }
  doEndTurn();
}

function doEndTurn(): void {
  if (!game) return;
  if (netMode) {
    if (!netSend({ k: 'end' })) return;
    selection = null;
    viewCache = null;
    return;
  }
  game.endTurn();
  noteTurn(game, mySeat, achvProgress); // 新回合：重置本回合占领数并更新"曾垫底"标记
  selection = null;
  undoStack.length = 0; // 新的回合，清空撤销栈
  viewCache = null;
  afterAction();
}

let noActionWarn = false;

// ===== 背景音乐（程序化合成，无音频素材） =====
const musicPrefs = loadMusicPrefs();
// 开发态 HMR 会重新执行本模块：用全局单例复用同一个 AudioContext，避免多路音乐叠加
const musicGlobal = globalThis as unknown as { __gongfaMusic?: MusicPlayer };
const music: MusicPlayer =
  musicGlobal.__gongfaMusic ?? new MusicPlayer({ volume: musicPrefs.volume, muted: musicPrefs.muted });
musicGlobal.__gongfaMusic = music;
music.setVolume(musicPrefs.volume);
music.setMuted(musicPrefs.muted);
music.setMood('menu');
// 浏览器要求用户手势后才能出声：首次点击 / 按键即启动
const kickMusic = (): void => {
  music.start();
  sfx.init();
};
window.addEventListener('pointerdown', kickMusic, { once: true });
window.addEventListener('keydown', kickMusic, { once: true });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) music.suspend();
  else music.resume();
});

// ===== 音效 + 震动 =====
const sfxPrefs = loadSfxPrefs();
const sfx = new SfxPlayer({ enabled: sfxPrefs.enabled, vibrate: sfxPrefs.vibrate, volume: sfxPrefs.volume });

// ===== 成就 =====
const ACHV_KEY = 'gongfa-war.achv';
const unlockedAchv = new Set<string>();
try {
  const raw = localStorage.getItem(ACHV_KEY);
  if (raw) for (const id of JSON.parse(raw) as string[]) unlockedAchv.add(id);
} catch {
  /* 忽略损坏数据 */
}
let achvProgress: AchvProgress = newProgress();
function saveAchv(): void {
  try {
    localStorage.setItem(ACHV_KEY, JSON.stringify([...unlockedAchv]));
  } catch {
    /* 隐私模式忽略 */
  }
}
/** 每次行动后检查成就（满足条件但未解锁的 → 弹提示 + 音效） */
function checkAchievements(): void {
  if (!game || !game.state.players[mySeat]?.alive) return;
  const now = satisfiedAchievements(game, mySeat, achvProgress);
  for (const id of now) {
    if (unlockedAchv.has(id)) continue;
    unlockedAchv.add(id);
    const a = achievementById(id);
    toast(`🏆 成就解锁 · ${a?.icon ?? ''}${a?.name ?? id}：${a?.desc ?? ''}`);
    sfx.play('achv');
  }
  if (now.length) saveAchv();
  hud.renderAchievements(unlockedAchv);
}

let musicMoodAt = 0;
/** 根据局势切换音乐情绪：菜单 / 对局 / 紧张（终局或明显落后） */
function syncMusicMood(now = performance.now()): void {
  if (now - musicMoodAt < 400) return;
  musicMoodAt = now;
  let mood: Mood = 'menu';
  if (game) {
    const s = game.state;
    const me = s.players[mySeat];
    const mine = regionCount(s, mySeat);
    const leader = Math.max(...s.players.filter((p) => p.alive).map((p) => regionCount(s, p.id)), 0);
    mood = s.gameOver || !me.alive || mine * 2 < leader ? 'tense' : 'game';
  }
  music.setMood(mood);
}

// App 外壳标记：Android 包用 index.html?shell=android 加载，方便给刘海留安全边距
if (new URLSearchParams(location.search).get('shell') === 'android') {
  document.documentElement.classList.add('shell-android');
}

// 有弹窗时收起底部信息条 / 竖屏提示，避免它们压住弹窗的确认按钮（z-index 也已置顶）
const overlayWatcher = new MutationObserver(() => {
  document.body.classList.toggle('dialog-open', !!document.querySelector('.overlay'));
});
overlayWatcher.observe(app, { childList: true, subtree: true });

const hud = new Hud({
  onEndTurn() {
    requestEndTurn();
  },
  onSave: saveGame,
  onLoad: loadGame,
  onMenu() {
    location.reload();
  },
  onBuild(regionId, kind) {
    if (!game) return;
    if (netMode) {
      if (netSend({ k: 'build', regionId, special: kind })) {
        toast(`🏗️ 已建造${kind === 'barracks' ? '兵营' : kind === 'fortress' ? '要塞' : '宝库'}`);
        selection = null;
      }
      return;
    }
    pushUndo();
    if (game.buildSpecial(regionId, kind)) {
      toast(`🏗️ 已建造${kind === 'barracks' ? '兵营' : kind === 'fortress' ? '要塞' : '宝库'}（本区三种设施各可建一个）`);
      viewCache = null;
      pulseAt(regionId, '#ffd34d', 'move');
    } else {
      toast('建造失败：需要 1 次行动 + 至少 6 兵，且该设施本区还没建过');
      undoStack.pop();
    }
  },
  onToggleMusic() {
    const muted = music.toggleMute();
    saveMusicPrefs(muted, music.volume);
    if (!muted) music.start();
    toast(muted ? '🔇 背景音乐已关闭' : '🔊 背景音乐已开启');
    return muted;
  },
  onClearSelection() {
    selection = null;
    viewCache = null;
  },
  onHelp() {
    hud.setDrawer(false);
    showHelp();
  },
  onFitMap() {
    camera.fit(MAP_W * CELL, MAP_H * CELL, viewW, viewH);
    sfx.play('tap');
  },
  onHome() {
    centerOnHuman();
    sfx.play('tap');
  },
});

// 顶栏音乐按钮的初始图标与存档偏好一致
if (music.muted) {
  const btn = document.getElementById('btn-music');
  if (btn) btn.textContent = '🔇';
}
// 成就面板先渲染一次（未解锁的显示为锁）
hud.renderAchievements(unlockedAchv);

// 手机默认收起小地图（省 66px 竖向空间给地图），用户展开过就记住
if (isCompactLayout()) {
  let expanded = false;
  try {
    expanded = localStorage.getItem('gongfa-war.minimap') === '1';
  } catch {
    /* 隐私模式 */
  }
  hud.setMinimapCollapsed(!expanded);
}

function saveGame(): void {
  if (!game) return;
  const json = game.serialize();
  localStorage.setItem('gongfa-war:autosave', json);
  const s = game.state;
  api
    .saveGame(
      1,
      '存档1',
      {
        seed: s.config.seed,
        mapSize: s.config.regionCount,
        difficulty: s.config.difficulty,
        opponents: s.config.opponents,
        elapsedSeconds: s.turn,
      },
      json,
    )
    .then(() => toast('✅ 已保存到服务器（存档1）'))
    .catch(() => toast('💾 服务器不可用，已保存到本地'));
}

function loadGame(): void {
  const doLoad = (json: string): void => {
    try {
      game = Game.deserialize(json);
      gameOverShown = false;
      recorded = false;
      selection = null;
      hover = null;
      achvProgress = newProgress();
      regionGrid = buildRegionGrid(game.state.regions);
      centerOnHuman();
      toast('📂 读档成功');
    } catch (e) {
      toast('读档失败：' + (e as Error).message);
    }
  };
  api
    .loadSave(1)
    .then((r) => doLoad(r.save.stateJson))
    .catch(() => {
      const local = localStorage.getItem('gongfa-war:autosave');
      if (local) doLoad(local);
      else toast('没有可用的存档');
    });
}

function handleGameOver(): void {
  if (!game || gameOverShown) return;
  gameOverShown = true;
  const s = game.state;
  const won = s.winner === 0;
  const drawn = s.winner === -2;
  const title = won ? '胜利！' : drawn ? '平局' : '战败…';
  const outOfRegions = !s.players[mySeat]?.alive;
  const subtitle = won
    ? '你占领了全图每一块区域'
    : drawn
      ? '势均力敌'
      : outOfRegions
        ? '你的领地全部沦陷'
        : `回合上限：积分落后（第 ${s.turn} 回合结算）`;
  const st = s.stats[mySeat] ?? { regionsCaptured: 0, regionsLost: 0 };
  const statsText = `回合 ${s.turn} · 领地 ${regionCount(s, mySeat)} · 攻占 ${st.regionsCaptured} 处`;

  if (!recorded) {
    recorded = true;
    api
      .addBattle({
        result: won ? 'win' : drawn ? 'draw' : 'loss',
        winner: s.winner ?? -1,
        mapSize: s.config.regionCount,
        difficulty: difficultyToInt(s.config.difficulty),
        opponents: s.config.opponents,
        durationSeconds: s.turn,
        citiesCaptured: st.regionsCaptured,
        unitsKilled: 0,
        score: computeScore(s, mySeat),
      })
      .catch(() => {});
  }

  showResult({
    title,
    subtitle,
    stats: statsText,
    onRestart: () => {
      if (lastConfig) startGame(lastConfig);
    },
    onMenu: () => location.reload(),
  });
}

let lastFrame = performance.now();
let minimapAt = 0;

/** 小地图：点击 / 触摸即把镜头移过去（保持当前缩放） */
const minimapCanvas = document.getElementById('minimap') as HTMLCanvasElement | null;
const miniCtx = minimapCanvas?.getContext('2d') ?? null;
minimapCanvas?.addEventListener('pointerdown', (e) => {
  if (!minimapCanvas) return;
  e.preventDefault();
  const rect = minimapCanvas.getBoundingClientRect();
  const gx = ((e.clientX - rect.left) / rect.width) * MAP_W;
  const gy = ((e.clientY - rect.top) / rect.height) * MAP_H;
  camera.centerOnKeepScale(gx * CELL, gy * CELL, viewW, viewH);
  minimapAt = 0; // 立刻重绘视口框
  sfx.play('tap');
});

function frame(): void {
  const now = performance.now();
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  camera.update(dt);

  if (game) {
    for (let i = anims.length - 1; i >= 0; i--) {
      if (now - anims[i].born > 1400) anims.splice(i, 1);
    }
    for (let i = pulses.length - 1; i >= 0; i--) {
      if (now - pulses[i].born > 1000) pulses.splice(i, 1);
    }
    const view = computeView();
    // 画布按 dpr 放大，这里把绘制坐标系还原成 CSS 像素（与相机 / 命中检测一致）
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 战争迷雾：己方 + 相邻一圈可见；探索过的显示地形与「?」（有侦查情报则显示看到的兵力）
    const all = new Set(game.state.regions.map((r) => r.id));
    const fogVisible = fogOn ? new Set(game.visibleRegions(mySeat)) : all;
    const fogKnown = fogOn ? new Set([...(game.state.players[mySeat]?.seen ?? []), ...fogVisible]) : all;
    const intel = new Map<number, { army: number; stale: boolean }>();
    if (fogOn) {
      for (const r of game.state.regions) {
        if (fogVisible.has(r.id)) continue;
        const info = game.intelFor(mySeat, r.id);
        if (info) intel.set(r.id, { army: info.army, stale: info.stale });
      }
    }
    draw(ctx, {
      game: game.state,
      camera,
      width: viewW,
      height: viewH,
      selection,
      hover,
      attackable: view.attackable,
      movable: view.movable,
      marchable: view.marchable,
      marchPath: view.marchPath,
      scoutable: view.scoutable,
      intel,
      threatened: view.threatened,
      hint: hover != null ? view.hints.get(hover) ?? null : null,
      visible: fogVisible,
      known: fogKnown,
      regionGrid,
      anims,
      pulses,
      now,
    });
    hud.update(game.state, selection, { on: fogOn, visible: fogVisible, known: fogKnown }, mySeat);
    syncMusicMood(now);
    // 小地图：1 格 1 像素 + ImageData，约 8fps 重绘足够（相机移动时也跟得上）
    if (now - minimapAt > 120 && miniCtx) {
      minimapAt = now;
      drawMinimap(miniCtx, {
        game: game.state,
        regionGrid,
        camera,
        visible: fogVisible,
        known: fogKnown,
        fogOn,
        viewW,
        viewH,
      });
    }
  }
  requestAnimationFrame(frame);
}

menuCtl = showMenu(
  (config) => {
    lastConfig = config;
    startGame(config);
  },  {
    muted: music.muted,
    volume: music.volume,
    setMuted(muted: boolean) {
      music.setMuted(muted);
      music.start();
      saveMusicPrefs(muted, music.volume);
    },
    setVolume(v: number) {
      music.setVolume(v);
      music.start();
      saveMusicPrefs(music.muted, v);
    },
    sfxEnabled: sfx.enabled,
    vibrate: sfx.vibrateEnabled,
    setSfxEnabled(on: boolean) {
      sfx.setEnabled(on);
      saveSfxPrefs(on, sfx.vibrateEnabled, sfx.volume);
      if (on) sfx.play('select');
    },
    setVibrate(on: boolean) {
      sfx.vibrateEnabled = on;
      saveSfxPrefs(sfx.enabled, on, sfx.volume);
      if (on) sfx.play('tap');
    },
  },
  {
    onCreate(config, mode) {
      lastConfig = config;
      fogOn = config.fog !== false;
      netKind = mode === 'authoritative' ? 'authoritative' : 'lockstep';
      if (mode === 'phone') {
        // 手机当房主：先起本机中继（HTTP 静态服务 + WebSocket 转发），再用回环地址连它
        const info = startHostServer(8080);
        if (!info || !info.ok) {
          toast(`📱 本机中继启动失败：${info?.error ?? '未知错误'}`);
          const box = document.getElementById('lan-box');
          if (box) box.innerHTML = `⚠️ 本机中继启动失败：${info?.error ?? '未知错误'}`;
          return;
        }
        hostUrls = info.urls;
        lockPeers = [{ seat: 0, name: playerName(), connected: true }];
        startLockClient(info.relayUrl ?? `ws://127.0.0.1:${info.port}/relay`).create(playerName());
        return;
      }
      if (mode === 'lockstep') {
        // 转发式：中继在电脑（或另一台已开房的手机）上
        lockPeers = [{ seat: 0, name: playerName(), connected: true }];
        startLockClient().create(playerName());
        return;
      }
      const client = startLanClient();
      client.create(
        {
          regionCount: config.regionCount,
          opponents: config.opponents,
          difficulty: config.difficulty,
          template: config.template,
          scenario: config.scenario,
          nationId: config.nationId,
          turnLimit: TURN_LIMIT_DEFAULT,
        },
        playerName(),
      );
    },
    onJoin(code, mode) {
      netKind = mode === 'authoritative' ? 'authoritative' : 'lockstep';
      if (mode === 'authoritative') {
        startLanClient().join(code, playerName());
        return;
      }
      startLockClient().join(code, playerName());
    },
    onStartRoom() {
      if (netKind === 'lockstep' && lock && lastConfig) {
        // 房主开局：生成种子 → 广播 (seed, config, seats)，各端各自建出同一张图
        const seed = Math.floor(Math.random() * 2 ** 31);
        const config: GameConfig = {
          seed,
          regionCount: lastConfig.regionCount,
          opponents: lastConfig.opponents,
          difficulty: lastConfig.difficulty,
          turnLimit: TURN_LIMIT_DEFAULT,
          nationId: lastConfig.nationId,
          template: lastConfig.template,
          scenario: lastConfig.scenario,
        };
        lock.begin(seed, config, buildLockSeats(lastConfig, lockPeers));
        return;
      }
      lan?.start();
    },
  },
  hostBridgeAvailable(),
);

// 其它手机扫/输 http://<房主IP>:8080/?join=ABCD 进来 → 自动入房
const autoJoin = joinCodeFromUrl();
if (autoJoin) {
  lastConfig = lastConfig ?? {
    regionCount: 28,
    opponents: 1,
    difficulty: 'normal',
    nationId: 'qin',
    template: 'earth',
    scenario: 'earth',
    fog: true,
  };
  toast(`🌐 正在加入房间 ${autoJoin}…`);
  window.setTimeout(() => {
    netKind = 'lockstep';
    startLockClient().join(autoJoin, playerName());
  }, 400);
}
requestAnimationFrame(frame);

// 开发期调试钩子（生产构建会被 tree-shake 掉）：便于自动化测试定位命中/相机问题
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__gongfa = {
    getGame: () => game,
    camera,
    viewport: () => ({ viewW, viewH, dpr }),
    selection: () => selection,
    achv: () => ({ unlocked: [...unlockedAchv], progress: achvProgress, satisfied: game ? satisfiedAchievements(game, mySeat, achvProgress) : [] }),
    sfx,
    regionAt: (clientX: number, clientY: number) => {
      const w = camera.screenToWorld(clientX, clientY);
      const gx = Math.floor(w.x / CELL);
      const gy = Math.floor(w.y / CELL);
      if (gx < 0 || gy < 0) return null;
      const id = regionGrid[gy * MAP_W + gx];
      return id >= 0 ? { id, name: game?.state.regions[id]?.name, owner: game?.state.regions[id]?.owner } : null;
    },
  };
}

// PWA：仅生产构建注册 Service Worker（开发时避免干扰 HMR；Android 包内资源已本地化，不需要 SW 缓存）
if (import.meta.env.PROD && import.meta.env.VITE_TARGET !== 'android' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
