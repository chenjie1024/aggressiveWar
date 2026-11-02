// 锁步联机客户端：连接中继（电脑上的 Node 中继，或手机 App 里的 Java 中继）
//
// 与 net/lan.ts（服务端权威）的区别：
// - 这里**本地跑完整规则**：收到 begin 后自己 new Game(...)，收到 act 后按序应用；
// - 中继只转发不判定，所以任何能跑 WebSocket 服务的设备都能当"服务器"（含手机热点场景）。

export interface LockCmd {
  k: 'attack' | 'move' | 'build' | 'scout' | 'end';
  from?: number;
  to?: number;
  commit?: number;
  amount?: number;
  regionId?: number;
  special?: 'barracks' | 'fortress' | 'treasury';
}

export interface LockPeer {
  seat: number;
  name: string;
  connected: boolean;
}

/** 席位分配（人类 / AI + 国别），各端一致 */
export interface LockSeat {
  seat: number;
  name: string;
  human: boolean;
  nationId?: string;
}

export interface LockHandlers {
  onStatus?: (connected: boolean, note: string) => void;
  onRoom?: (code: string, seat: number, host: boolean, peers: LockPeer[], started: boolean) => void;
  onPeers?: (peers: LockPeer[]) => void;
  /** 开局：各端用同一份 (seed, config, seats) 建游戏 */
  onBegin?: (seed: number, config: unknown, seats: unknown) => void;
  /** 收到一条指令（含自己发的回声），按 seq 顺序应用 */
  onCommand?: (seat: number, cmd: LockCmd) => void;
  onError?: (message: string) => void;
}

function httpBase(): string {
  const env = import.meta.env.VITE_API_URL as string | undefined;
  if (env) return env;
  // 由中继自己托管网页时（手机 App / 电脑 :3000）→ 同源；开发态（Vite :5272）→ 本机后端
  return location.port === '5272' || location.port === '' ? 'http://127.0.0.1:3000' : location.origin;
}

export function defaultRelayUrl(): string {
  return httpBase().replace(/^http/, 'ws') + '/relay';
}

export class LockstepClient {
  private ws: WebSocket | null = null;
  private queue: string[] = [];
  private code: string | null = null;
  private name = '玩家';
  /** 还没确认入房的 join 请求（连接建立后补发；与"断线重连"分开，避免重复占席位） */
  private pendingJoin: { code: string; name: string } | null = null;
  ready = false;
  seat = -1;

  constructor(
    private handlers: LockHandlers,
    private url = defaultRelayUrl(),
  ) {}

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
      this.handlers.onStatus?.(true, '已连接中继');
      // 断线重连才自动 rejoin（首次入房走 pendingJoin，避免同一设备占两个席位）
      if (this.code) ws.send(JSON.stringify({ t: 'join', code: this.code, name: this.name }));
      else if (this.pendingJoin) ws.send(JSON.stringify({ t: 'join', ...this.pendingJoin }));
      const pending = this.queue;
      this.queue = [];
      for (const m of pending) ws.send(m);
    };
    ws.onclose = () => {
      this.ready = false;
      this.handlers.onStatus?.(false, '与中继断开');
    };
    ws.onerror = () => this.handlers.onStatus?.(false, '连不上中继（检查地址 / 是否同一热点）');
    ws.onmessage = (ev) => {
      let msg: any;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      switch (msg.t) {
        case 'room':
          this.code = msg.code;
          this.seat = msg.seat;
          this.handlers.onRoom?.(msg.code, msg.seat, !!msg.host, msg.peers ?? [], !!msg.started);
          break;
        case 'peers':
          this.handlers.onPeers?.(msg.peers ?? []);
          break;
        case 'begin':
          this.handlers.onBegin?.(msg.seed, msg.config, msg.seats);
          break;
        case 'act':
          this.handlers.onCommand?.(msg.seat, msg.cmd as LockCmd);
          break;
        case 'error':
          this.handlers.onError?.(String(msg.message));
          break;
        default:
          break;
      }
    };
  }

  send(msg: unknown): void {
    const raw = JSON.stringify(msg);
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(raw);
      return;
    }
    this.queue.push(raw);
    this.connect();
  }

  create(name: string): void {
    this.name = name;
    this.pendingJoin = null;
    this.connect();
    this.send({ t: 'create', name });
  }

  join(code: string, name: string): void {
    this.name = name;
    this.pendingJoin = { code: code.toUpperCase(), name };
    this.connect();
    this.send({ t: 'join', code: this.pendingJoin.code, name });
  }

  /** 房主开局：把种子 / 配置 / 席位广播出去 */
  begin(seed: number, config: unknown, seats: unknown): void {
    this.send({ t: 'begin', seed, config, seats });
  }

  /** 发一条指令（中继编号后广播，包括回给自己） */
  act(cmd: LockCmd): void {
    this.send({ t: 'act', cmd });
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
    this.queue = [];
    this.ready = false;
    this.code = null;
    this.pendingJoin = null;
    this.seat = -1;
  }
}
