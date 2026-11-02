// 手机当房主：调用 Android 外壳注入的桥（window.AndroidHost）
//
// App 里由 MainActivity 通过 addJavascriptInterface 注入；浏览器里不存在 → 相关入口自动隐藏。

interface AndroidHostBridge {
  available(): string;
  start(port?: number): string;
  info(): string;
  stop(): void;
}

declare global {
  interface Window {
    AndroidHost?: AndroidHostBridge;
  }
}

export interface HostInfo {
  ok: boolean;
  port: number;
  urls: string[];
  /** 房主自己（WebView 内）用它连中继 */
  relayUrl?: string;
  localUrl?: string;
  clients?: number;
  error?: string;
}

function bridge(): AndroidHostBridge | null {
  const b = typeof window === 'undefined' ? undefined : window.AndroidHost;
  try {
    return b && b.available() === '1' ? b : null;
  } catch {
    return null;
  }
}

export function hostBridgeAvailable(): boolean {
  return bridge() !== null;
}

/** 启动本机中继（HTTP 静态服务 + WebSocket 转发），返回局域网地址供其它手机访问 */
export function startHostServer(port = 8080): HostInfo | null {
  const b = bridge();
  if (!b) return null;
  try {
    return JSON.parse(b.start(port)) as HostInfo;
  } catch (e) {
    return { ok: false, port, urls: [], error: (e as Error).message };
  }
}

export function hostServerInfo(): HostInfo | null {
  const b = bridge();
  if (!b) return null;
  try {
    return JSON.parse(b.info()) as HostInfo;
  } catch {
    return null;
  }
}

export function stopHostServer(): void {
  const b = bridge();
  if (!b) return;
  try {
    b.stop();
  } catch {
    /* 忽略 */
  }
}

/** 从 URL 里取加入码（其它手机扫/输 http://<ip>:8080/?join=ABCD） */
export function joinCodeFromUrl(): string | null {
  try {
    const code = new URLSearchParams(location.search).get('join');
    return code && code.trim().length >= 4 ? code.trim().toUpperCase() : null;
  } catch {
    return null;
  }
}
