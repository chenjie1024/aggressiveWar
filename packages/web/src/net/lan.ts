// 局域网联机客户端：只负责"连接 + 收发消息"，游戏逻辑全在服务端。
// 收到 state 消息后由 main.ts 反序列化并渲染，本端不再自己做规则判定。

export interface LanSeat {
  seat: number;
  name: string;
  nationId: string;
  ai: boolean;
  connected: boolean;
}

export interface LanRoom {
  code: string;
  started: boolean;
  seats: LanSeat[];
  turn: number;
  currentPlayer: number;
  gameOver: boolean;
}

export interface LanConfig {
  regionCount: number;
  opponents: number;
  difficulty: string;
  template: string;
  scenario: string;
  nationId?: string;
  turnLimit?: number;
}

export interface LanHandlers {
  onStatus?: (connected: boolean, note: string) => void;
  onRoom?: (room: LanRoom, seat: number, host: boolean) => void;
  onState?: (stateJson: string, room: LanRoom) => void;
  onError?: (message: string) => void;
}

function httpBase(): string {
  const env = import.meta.env.VITE_API_URL as string | undefined;
  if (env) return env;
  // 由本项目的服务端托管时（:3000）同源即可；开发态（Vite :5272）走本机后端
  return location.port === '3000' ? location.origin : 'http://127.0.0.1:3000';
}

export function defaultWsUrl(): string {
  return httpBase().replace(/^http/, 'ws') + '/ws';
}

export async function fetchLanInfo(): Promise<{ urls: string[]; port: number; webHosted: boolean } | null> {
  try {
    const res = await fetch(httpBase() + '/api/lan-info');
    if (!res.ok) return null;
    return (await res.json()) as { urls: string[]; port: number; webHosted: boolean };
  } catch {
    return null;
  }
}

export class LanClient {
  private ws: WebSocket | null = null;
  private handlers: LanHandlers;
  private url: string;
  /** 断线重连用 */
  private token: string | null = null;
  private code: string | null = null;
  /** 连接就绪前先把消息排队，避免"点了创建房间但消息丢了" */
  private queue: string[] = [];
  ready = false;

  constructor(handlers: LanHandlers, url = defaultWsUrl()) {
    this.handlers = handlers;
    this.url = url;
  }

  connect(): void {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch (e) {
      this.handlers.onStatus?.(false, (e as Error).message);
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.ready = true;
      this.handlers.onStatus?.(true, '已连接');
      // 自动重连回原席位，再补发排队的消息
      if (this.code && this.token) {
        ws.send(JSON.stringify({ t: 'rejoin', code: this.code, token: this.token }));
      }
      const pending = this.queue;
      this.queue = [];
      for (const m of pending) ws.send(m);
    };
    ws.onclose = () => {
      this.ready = false;
      this.handlers.onStatus?.(false, '连接已断开');
    };
    ws.onerror = () => this.handlers.onStatus?.(false, '无法连接后端（先运行 npm run lan）');
    ws.onmessage = (ev) => {
      let msg: any;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.t === 'room') {
        this.code = msg.code;
        this.token = msg.token;
        this.handlers.onRoom?.(msg.room as LanRoom, msg.seat as number, !!msg.host);
      } else if (msg.t === 'roomInfo') {
        this.handlers.onRoom?.(msg.room as LanRoom, -1, false);
      } else if (msg.t === 'state') {
        this.handlers.onState?.(msg.state as string, msg.room as LanRoom);
      } else if (msg.t === 'error') {
        this.handlers.onError?.(String(msg.message));
      }
    };
  }

  send(msg: unknown): void {
    const raw = JSON.stringify(msg);
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(raw);
      return;
    }
    // 还没连上：先排队（connect 时会自动补发）
    this.queue.push(raw);
    this.connect();
  }

  create(config: LanConfig, name: string): void {
    this.connect();
    this.send({ t: 'create', name, config });
  }

  join(code: string, name: string): void {
    this.connect();
    this.send({ t: 'join', code: code.toUpperCase(), name });
  }

  start(): void {
    this.send({ t: 'start' });
  }

  endTurn(): void {
    this.send({ t: 'endTurn' });
  }

  skip(): void {
    this.send({ t: 'skip' });
  }

  action(msg: Record<string, unknown>): void {
    this.send({ t: 'action', ...msg });
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
    this.ready = false;
    this.code = null;
    this.token = null;
    this.queue = [];
  }
}
