// 锁步联机中继（"手机当服务器"用的就是这个协议）
//
// 与 lan.ts 的"服务端权威"不同：中继**不跑游戏规则**，只做三件事
//   1. 分配房间码与席位；
//   2. 把 begin（种子 + 配置 + 席位）广播给所有人 —— 各端各自 new Game(...) 得到同一张图；
//   3. 把 act（指令）按到达顺序编号并广播回所有人（含发送者）。
// 各端按同一顺序应用同一批指令，加上核心是种子随机（见 tests 的锁步确定性用例），
// 状态就完全一致。协议故意做得极简，方便之后用 Java 在手机 App 里实现同样的一份。
//
// 消息（客户端 → 中继）
//   { t:'create', name }                      创建房间（自己坐 0 号位 = 房主）
//   { t:'join',   code, name }                加入（分配下一个空位；已开局则补发 begin + 全部历史指令）
//   { t:'begin',  seed, config, seats }       房主开局：广播给所有人
//   { t:'act',    cmd }                       发一条指令（中继编号后广播）
//   { t:'ping' }
// 消息（中继 → 客户端）
//   { t:'room', code, seat, host, peers, started }
//   { t:'begin', seed, config, seats }
//   { t:'act', seat, seq, cmd }
//   { t:'error', message }

import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { WebSocket } from 'ws';

interface Peer {
  seat: number;
  name: string;
  ws: WebSocket | null;
  connected: boolean;
}

interface RelayRoom {
  code: string;
  peers: Peer[];
  started: boolean;
  seed: number;
  config: unknown;
  seats: unknown;
  /** 已广播过的指令（后加入 / 断线重连时补发） */
  log: { seat: number; cmd: unknown }[];
  seq: number;
}

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rooms = new Map<string, RelayRoom>();

function newCode(): string {
  for (let i = 0; i < 50; i++) {
    let c = '';
    for (let j = 0; j < 4; j++) c += CHARS[Math.floor(Math.random() * CHARS.length)];
    if (!rooms.has(c)) return c;
  }
  return `R${Date.now().toString(36).slice(-3).toUpperCase()}`;
}

function send(ws: WebSocket | null, msg: unknown): void {
  if (!ws || ws.readyState !== 1) return;
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    /* 已断开 */
  }
}

function peersOf(room: RelayRoom): unknown[] {
  return room.peers.map((p) => ({ seat: p.seat, name: p.name, connected: p.connected }));
}

function roomInfo(room: RelayRoom, seat: number, host: boolean): unknown {
  return { t: 'room', code: room.code, seat, host, peers: peersOf(room), started: room.started };
}

function broadcast(room: RelayRoom, msg: unknown, except?: WebSocket | null): void {
  for (const p of room.peers) {
    if (p.ws && p.ws !== except) send(p.ws, msg);
  }
}

function handle(
  ws: WebSocket,
  raw: string,
  ctx: { room: RelayRoom | null; seat: number },
): void {
  let msg: { t?: string; [k: string]: unknown };
  try {
    msg = JSON.parse(raw) as { t?: string };
  } catch {
    send(ws, { t: 'error', message: '消息格式错误' });
    return;
  }
  if (msg.t === 'ping') {
    send(ws, { t: 'pong' });
    return;
  }

  if (msg.t === 'create') {
    const room: RelayRoom = {
      code: newCode(),
      peers: [{ seat: 0, name: String(msg.name ?? '房主').slice(0, 12), ws, connected: true }],
      started: false,
      seed: 0,
      config: null,
      seats: null,
      log: [],
      seq: 0,
    };
    rooms.set(room.code, room);
    ctx.room = room;
    ctx.seat = 0;
    send(ws, roomInfo(room, 0, true));
    return;
  }

  if (msg.t === 'join') {
    const code = String(msg.code ?? '').toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      send(ws, { t: 'error', message: '房间不存在（检查房间码）' });
      return;
    }
    // 同一条连接重复 join（例如重连补发）：沿用原席位，不要再占一个新位子
    if (ctx.room === room && ctx.seat >= 0) {
      send(ws, roomInfo(room, ctx.seat, ctx.seat === 0));
      if (room.started) {
        send(ws, { t: 'begin', seed: room.seed, config: room.config, seats: room.seats });
        for (const entry of room.log) send(ws, { t: 'act', seat: entry.seat, seq: ++room.seq, cmd: entry.cmd });
      }
      return;
    }
    // 这条连接已经加入过别的房间：先退出
    if (ctx.room && ctx.room !== room) {
      const old = ctx.room.peers.find((p) => p.ws === ws);
      if (old) {
        old.connected = false;
        old.ws = null;
        broadcast(ctx.room, { t: 'peers', peers: peersOf(ctx.room) });
      }
    }
    let peer = room.peers.find((p) => !p.connected);
    if (!peer && room.peers.length < 6) {
      peer = { seat: room.peers.length, name: String(msg.name ?? `玩家${room.peers.length}`).slice(0, 12), ws, connected: true };
      room.peers.push(peer);
    } else if (peer) {
      peer.ws = ws;
      peer.connected = true;
      peer.name = String(msg.name ?? peer.name).slice(0, 12);
    }
    if (!peer) {
      send(ws, { t: 'error', message: '房间已满（最多 6 方）' });
      return;
    }
    peer.ws = ws;
    peer.connected = true;
    ctx.room = room;
    ctx.seat = peer.seat;
    send(ws, roomInfo(room, peer.seat, peer.seat === 0));
    // 已开局：补发 begin + 历史指令，让新加入者追上进度
    if (room.started) {
      send(ws, { t: 'begin', seed: room.seed, config: room.config, seats: room.seats });
      for (const entry of room.log) send(ws, { t: 'act', seat: entry.seat, seq: ++room.seq, cmd: entry.cmd });
    }
    broadcast(room, { t: 'peers', peers: peersOf(room) });
    return;
  }

  const room = ctx.room;
  if (!room) {
    send(ws, { t: 'error', message: '尚未加入房间' });
    return;
  }

  if (msg.t === 'begin') {
    if (ctx.seat !== 0) {
      send(ws, { t: 'error', message: '只有房主能开局' });
      return;
    }
    room.started = true;
    room.seed = Number(msg.seed ?? 0);
    room.config = msg.config ?? null;
    room.seats = msg.seats ?? null;
    room.log = [];
    broadcast(room, { t: 'begin', seed: room.seed, config: room.config, seats: room.seats });
    return;
  }

  if (msg.t === 'act') {
    if (!room.started) {
      send(ws, { t: 'error', message: '对局还没开始' });
      return;
    }
    const entry = { seat: ctx.seat, cmd: msg.cmd };
    room.log.push(entry);
    room.seq += 1;
    // 广播给所有人（含发送者）：各端按同一个 seq 顺序应用，状态才一致
    broadcast(room, { t: 'act', seat: ctx.seat, seq: room.seq, cmd: entry.cmd });
    return;
  }

  send(ws, { t: 'error', message: `未知消息：${String(msg.t)}` });
}

/** 挂到同一个 HTTP 服务的另一个路径（默认 /relay） */
export function attachRelay(server: unknown, path = '/relay'): void {
  void import('ws')
    .then(({ WebSocketServer }) => {
      const wss = new WebSocketServer({ noServer: true });
      const http = server as {
        on: (event: string, cb: (req: IncomingMessage, socket: Duplex, head: Buffer) => void) => void;
      };
      http.on('upgrade', (req, socket, head) => {
        const url = req.url ?? '';
        if (!url.startsWith(path)) return; // 交给别的 upgrade 处理器（例如服务端权威的 /ws）
        wss.handleUpgrade(req, socket, head, (ws) => {
          const ctx: { room: RelayRoom | null; seat: number } = { room: null, seat: -1 };
          ws.on('message', (data: Buffer | string) => {
            try {
              handle(ws, data.toString(), ctx);
            } catch (e) {
              send(ws, { t: 'error', message: (e as Error).message });
            }
          });
          ws.on('close', () => {
            const p = ctx.room?.peers.find((x) => x.seat === ctx.seat);
            if (p) p.connected = false;
            if (ctx.room) broadcast(ctx.room, { t: 'peers', peers: peersOf(ctx.room) });
          });
        });
      });
      console.log(`[relay] 锁步中继已就绪：ws://<本机IP>:端口${path}`);
    })
    .catch(() => {
      console.warn('[relay] 未安装 ws，锁步中继不可用');
    });
}

export function relayRoomCount(): number {
  return rooms.size;
}
