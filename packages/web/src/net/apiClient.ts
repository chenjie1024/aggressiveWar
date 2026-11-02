import { difficultyFromInt, difficultyToInt, type Difficulty } from '@gongfa-war/core';

// 局域网联机时手机访问的是 http://<电脑IP>:3000（由本项目服务端托管），此时必须同源请求；
// 开发态（Vite :5272）才回落到本机后端。
const API_BASE =
  import.meta.env.VITE_API_URL ?? (location.port === '3000' ? location.origin : 'http://127.0.0.1:3000');

function getDeviceId(): string {
  let id = localStorage.getItem('gongfa-war:deviceId');
  if (!id) {
    id = 'dev-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('gongfa-war:deviceId', id);
  }
  return id;
}

async function request(path: string, opts: RequestInit = {}): Promise<any> {
  const res = await fetch(API_BASE + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'X-Device-Id': getDeviceId(),
      ...(opts.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export interface SaveMeta {
  slot: number;
  name: string | null;
  seed: number;
  mapSize: number;
  difficulty: number;
  opponents: number;
  elapsedSeconds: number;
  stateJson?: string;
  updatedAt?: string;
}

export interface BattleInput {
  result: 'win' | 'loss' | 'draw';
  winner: number;
  mapSize: number;
  difficulty: number;
  opponents: number;
  durationSeconds: number;
  citiesCaptured: number;
  unitsKilled: number;
  score: number;
}

export const api = {
  health: () => request('/api/health'),

  saveGame(
    slot: number,
    name: string | null,
    meta: { seed: number; mapSize: number; difficulty: Difficulty; opponents: number; elapsedSeconds: number },
    stateJson: string,
  ) {
    return request('/api/saves', {
      method: 'POST',
      body: JSON.stringify({
        slot,
        name,
        seed: meta.seed,
        mapSize: meta.mapSize,
        difficulty: difficultyToInt(meta.difficulty),
        opponents: meta.opponents,
        elapsedSeconds: Math.round(meta.elapsedSeconds),
        stateJson,
      }),
    });
  },

  listSaves: (): Promise<{ saves: SaveMeta[] }> => request('/api/saves'),

  loadSave: (slot: number): Promise<{ save: SaveMeta & { stateJson: string } }> => request(`/api/saves/${slot}`),

  deleteSave: (slot: number) => request(`/api/saves/${slot}`, { method: 'DELETE' }),

  addBattle: (battle: BattleInput) => request('/api/battles', { method: 'POST', body: JSON.stringify(battle) }),

  leaderboard: (mapSize: number, difficulty: Difficulty, top = 10) =>
    request(`/api/leaderboard?mapSize=${mapSize}&difficulty=${difficultyToInt(difficulty)}&top=${top}`),
};

export { difficultyFromInt };
