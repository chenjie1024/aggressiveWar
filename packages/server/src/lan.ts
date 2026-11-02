// 局域网联机：房间 + WebSocket 同步（服务端权威）
//
// 设计取舍：
// - 服务端持有唯一的 Game 实例，客户端只做"渲染 + 发指令"，因此天然防作弊、也不用处理状态分歧；
// - 每次动作后广播完整状态（存档是 RLE 压缩的 JSON，局域网带宽完全够用，实现最简单可靠）；
// - 人类席位 isHuman=true，AI 席位交给 core 的 endTurn() 自动推进；
// - 断线不踢人：凭 token 可重连回原席位；当前回合的人掉线时，房主可以「跳过」。

import { Game, MAP_TEMPLATES, NATIONS, TURN_LIMIT_DEFAULT, scenarioById } from '@gongfa-war/core';
import type { Difficulty, GameConfig, MapTemplate } from '@gongfa-war/core';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { WebSocket } from 'ws';

export interface Seat {
  seat: number;
  name: string;
  nationId: string;
  ai: boolean;
  token: string;
  ws: WebSocket | null;
  connected: boolean;
}

export interface Room {
  code: string;
  game: Game;
  seats: Seat[];
  started: boolean;
  seq: number;
}

export interface LanConfig {
  regionCount: number;
  opponents: number;
  difficulty: Difficulty;
  template: MapTemplate;
  scenario: string;
  nationId?: string;
  turnLimit?: number;
}

type ClientMsg =
  | { t: 'create'; name?: string; config: LanConfig }
  | { t: 'join'; code: string; name?: string; nationId?: string }
  | { t: 'rejoin'; code: string; token: string }
  | { t: 'start' }
  | { t: 'action'; kind: 'attack'; from: number; to: number; commit?: number }
  | { t: 'action'; kind: 'move'; from: number; to: number; amount?: number }
  | { t: 'action'; kind: 'build'; regionId: number; special: 'barracks' | 'fortress' | 'treasury' }
  | { t: 'action'; kind: 'scout'; from: number; to: number }
  | { t: 'endTurn' }
  | { t: 'skip' }
  | { t: 'ping' };

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混淆的 I/O/0/1
const rooms = new Map<string, Room>();

function newCode(): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(code)) return code;
  }
  return `R${Date.now().toString(36).slice(-3).toUpperCase()}`;
}

function newToken(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function send(ws: WebSocket | null, msg: unknown): void {
  if (!ws || ws.readyState !== 1) return;
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    /* 连接已断，忽略 */
  }
}

function roomSnapshot(room: Room): unknown {
  return {
    code: room.code,
    started: room.started,
    seats: room.seats.map((s) => ({
      seat: s.seat,
      name: s.name,
      nationId: s.nationId,
      ai: s.ai,
      connected: s.connected,
    })),
    turn: room.game.state.turn,
    currentPlayer: room.game.state.currentPlayer,
    gameOver: room.game.state.gameOver,
  };
}

/** 广播房间信息（不含状态） */
function broadcastRoom(room: Room): void {
  for (const s of room.seats) send(s.ws, { t: 'roomInfo', room: roomSnapshot(room) });
}

/** 广播完整游戏状态 */
function broadcastState(room: Room): void {
  room.seq += 1;
  const json = room.game.serialize();
  for (const s of room.seats) {
    if (s.ai) continue;
    send(s.ws, { t: 'state', seq: room.seq, state: json, room: roomSnapshot(room) });
  }
}

function freeNations(room: Room): string[] {
  const used = new Set(room.seats.map((s) => s.nationId));
  const scenario = scenarioById(room.game.state.config.scenario ?? 'classic');
  return scenario.nationIds.filter((id) => !used.has(id));
}

function createRoom(config: LanConfig, name: string, nationId?: string): Room {
  const code = newCode();
  const template: MapTemplate = MAP_TEMPLATES.some((t) => t.id === config.template) ? config.template : 'earth';
  const gc: GameConfig = {
    seed: Math.floor(Math.random() * 2 ** 31),
    regionCount: Math.max(12, Math.min(56, Math.round(config.regionCount || 28))),
    opponents: Math.max(0, Math.min(5, Math.round(config.opponents ?? 1))),
    difficulty: config.difficulty ?? 'normal',
    turnLimit: config.turnLimit ?? TURN_LIMIT_DEFAULT,
    template,
    scenario: config.scenario ?? 'earth',
  };
  const game = new Game(gc);
  const scenario = scenarioById(gc.scenario ?? 'classic');
  const pool = scenario.nationIds.length ? scenario.nationIds : NATIONS.map((n) => n.id);

  const seats: Seat[] = game.state.players.map((p, i) => ({
    seat: i,
    name: i === 0 ? name : `AI ${i}`,
    nationId: i === 0 ? nationId || pool[i % pool.length] : p.nationId,
    ai: i !== 0, // 默认除房主外都是 AI，其他人加入时把 AI 席位换成人类
    token: newToken(),
    ws: null,
    connected: false,
  }));

  const room: Room = { code, game, seats, started: false, seq: 0 };
  applySeats(room);
  rooms.set(code, room);
  return room;
}

/** 把席位信息写回 Game（名字 / 国家 / 是否人类） */
function applySeats(room: Room): void {
  for (const s of room.seats) {
    const p = room.game.state.players[s.seat];
    if (!p) continue;
    p.name = s.name;
    p.nationId = s.nationId;
    p.isHuman = !s.ai;
  }
}

function handleMsg(ws: WebSocket, raw: string, state: { room: Room | null; seat: Seat | null }): void {
  let msg: ClientMsg;
  try {
    msg = JSON.parse(raw) as ClientMsg;
  } catch {
    send(ws, { t: 'error', message: '消息格式错误' });
    return;
  }

  if (msg.t === 'ping') {
    send(ws, { t: 'pong' });
    return;
  }

  if (msg.t === 'create') {
    const room = createRoom(msg.config, (msg.name || '房主').slice(0, 12), msg.config.nationId);
    const seat = room.seats[0];
    seat.ws = ws;
    seat.connected = true;
    state.room = room;
    state.seat = seat;
    send(ws, { t: 'room', code: room.code, seat: seat.seat, token: seat.token, host: true, room: roomSnapshot(room) });
    broadcastRoom(room);
    return;
  }

  if (msg.t === 'join') {
    const room = rooms.get((msg.code || '').toUpperCase());
    if (!room) {
      send(ws, { t: 'error', message: '房间不存在（检查房间码）' });
      return;
    }
    if (room.started) {
      send(ws, { t: 'error', message: '对局已开始，无法加入' });
      return;
    }
    const free = room.seats.find((s) => s.ai && !s.connected);
    if (!free) {
      send(ws, { t: 'error', message: '房间已满' });
      return;
    }
    free.ai = false;
    free.name = (msg.name || `玩家${free.seat + 1}`).slice(0, 12);
    const pool = freeNations(room);
    free.nationId = msg.nationId && pool.includes(msg.nationId) ? msg.nationId : pool[0] ?? free.nationId;
    free.ws = ws;
    free.connected = true;
    applySeats(room);
    state.room = room;
    state.seat = free;
    send(ws, { t: 'room', code: room.code, seat: free.seat, token: free.token, host: false, room: roomSnapshot(room) });
    broadcastRoom(room);
    return;
  }

  if (msg.t === 'rejoin') {
    const room = rooms.get((msg.code || '').toUpperCase());
    if (!room) {
      send(ws, { t: 'error', message: '房间已关闭' });
      return;
    }
    const seat = room.seats.find((s) => s.token === msg.token);
    if (!seat) {
      send(ws, { t: 'error', message: '凭证无效' });
      return;
    }
    seat.ws = ws;
    seat.connected = true;
    state.room = room;
    state.seat = seat;
    send(ws, {
      t: 'room',
      code: room.code,
      seat: seat.seat,
      token: seat.token,
      host: seat.seat === 0,
      room: roomSnapshot(room),
    });
    send(ws, { t: 'state', seq: room.seq, state: room.game.serialize(), room: roomSnapshot(room) });
    broadcastRoom(room);
    return;
  }

  const { room, seat } = state;
  if (!room || !seat) {
    send(ws, { t: 'error', message: '尚未加入房间' });
    return;
  }

  if (msg.t === 'start') {
    if (seat.seat !== 0) {
      send(ws, { t: 'error', message: '只有房主能开始对局' });
      return;
    }
    room.started = true;
    applySeats(room);
    broadcastRoom(room);
    broadcastState(room);
    return;
  }

  if (!room.started) {
    send(ws, { t: 'error', message: '对局还没开始' });
    return;
  }
  if (room.game.state.gameOver) {
    send(ws, { t: 'error', message: '对局已结束' });
    return;
  }

  const current = room.game.state.currentPlayer;
  if (msg.t === 'skip') {
    if (seat.seat !== 0) {
      send(ws, { t: 'error', message: '只有房主能跳过' });
      return;
    }
    const cur = room.seats[current];
    if (cur && !cur.connected && !cur.ai) {
      room.game.endTurn();
      broadcastState(room);
    } else {
      send(ws, { t: 'error', message: '当前玩家在线，不能跳过' });
    }
    return;
  }

  if (seat.seat !== current) {
    send(ws, { t: 'error', message: '还没轮到你' });
    return;
  }

  let ok = false;
  if (msg.t === 'endTurn') {
    room.game.endTurn();
    ok = true;
  } else if (msg.t === 'action') {
    if (msg.kind === 'attack') {
      ok = !!room.game.attack(msg.from, msg.to, msg.commit);
      if (!ok) send(ws, { t: 'error', message: '进攻无效（兵力 / 行动次数 / 目标）' });
    } else if (msg.kind === 'move') {
      ok = room.game.moveAmount(msg.from, msg.to, msg.amount ?? room.game.availableToMove(msg.from));
      if (!ok) send(ws, { t: 'error', message: '调兵无效（行动次数 / 路线 / 兵力）' });
    } else if (msg.kind === 'build') {
      ok = room.game.buildSpecial(msg.regionId, msg.special);
      if (!ok) send(ws, { t: 'error', message: '建造失败（行动次数 / 兵力 / 已有设施）' });
    } else if (msg.kind === 'scout') {
      const res = room.game.scout(msg.from, msg.to);
      ok = res.ok;
      if (!ok) send(ws, { t: 'error', message: `侦查失败：${res.reason ?? '条件不满足'}` });
    }
  }
  if (ok) broadcastState(room);
}

export function attachLan(server: unknown, path = '/ws'): void {
  // 延迟 import，避免在离线环境（未装 ws）时直接崩
  void import('ws')
    .then(({ WebSocketServer }) => {
      const wss = new WebSocketServer({ noServer: true });
      const http = server as {
        on: (event: string, cb: (req: IncomingMessage, socket: Duplex, head: Buffer) => void) => void;
      };
      http.on('upgrade', (req, socket, head) => {
        const url = req.url ?? '';
        // 只处理自己的路径：其它路径（例如锁步中继 /relay）交给别的 upgrade 处理器，
        // 这里**不能** destroy，否则会把别人的连接一起掐掉
        if (!url.startsWith(path)) return;
        wss.handleUpgrade(req, socket, head, (ws) => {
          const state: { room: Room | null; seat: Seat | null } = { room: null, seat: null };
          ws.on('message', (data: Buffer | string) => {
            try {
              handleMsg(ws, data.toString(), state);
            } catch (e) {
              send(ws, { t: 'error', message: (e as Error).message });
            }
          });
          ws.on('close', () => {
            if (state.seat) state.seat.connected = false;
            if (state.room) broadcastRoom(state.room);
          });
        });
      });
      console.log(`[lan] 局域网联机已就绪：ws://<本机IP>:端口${path}`);
    })
    .catch(() => {
      console.warn('[lan] 未安装 ws，联机功能不可用（npm i ws -w @gongfa-war/server）');
    });
}

/** 供 HTTP 接口查询：当前房间数量（调试/展示用） */
export function roomCount(): number {
  return rooms.size;
}
