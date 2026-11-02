import { describe, expect, it } from 'vitest';
import { buildApp } from '@gongfa-war/server';
import type { Repos } from '../packages/server/src/repos';

function fakeRepos(): Repos {
  const players = new Map<string, { id: number; deviceId: string; displayName: string | null }>();
  const saves = new Map<string, Record<string, unknown>>();
  let nextId = 1;
  return {
    async getOrCreatePlayer(deviceId) {
      if (!players.has(deviceId)) players.set(deviceId, { id: nextId++, deviceId, displayName: null });
      return players.get(deviceId)!;
    },
    async listSaves() {
      return [];
    },
    async getSave(playerId, slot) {
      return (saves.get(`${playerId}:${slot}`) as any) ?? null;
    },
    async saveGame(playerId, slot, name, meta, stateJson) {
      saves.set(`${playerId}:${slot}`, { slot, name, ...meta, stateJson, updatedAt: new Date().toISOString() });
    },
    async deleteSave(playerId, slot) {
      saves.delete(`${playerId}:${slot}`);
    },
    async addBattle() {},
    async listBattles() {
      return [];
    },
    async leaderboard() {
      return [];
    },
    async getSettings() {
      return null;
    },
    async setSettings() {},
  };
}

describe('后端 API（注入内存仓储，不依赖真实 MySQL/Redis）', () => {
  it('健康检查在无数据库时返回 down', async () => {
    const app = await buildApp({ repos: fakeRepos(), db: null, redis: null });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.mysql).toBe('down');
    expect(body.redis).toBe('down');
  });

  it('存档写入与读取往返', async () => {
    const app = await buildApp({ repos: fakeRepos(), db: null, redis: null });
    const save = await app.inject({
      method: 'POST',
      url: '/api/saves',
      headers: { 'x-device-id': 'test-dev' },
      payload: {
        slot: 1,
        name: '测试存档',
        seed: 1,
        mapSize: 8,
        difficulty: 1,
        opponents: 1,
        elapsedSeconds: 10,
        stateJson: '{"x":1}',
      },
    });
    expect(save.statusCode).toBe(200);

    const load = await app.inject({ method: 'GET', url: '/api/saves/1', headers: { 'x-device-id': 'test-dev' } });
    expect(load.statusCode).toBe(200);
    expect(JSON.parse(load.body).save.stateJson).toBe('{"x":1}');
  });

  it('不存在的存档返回 404', async () => {
    const app = await buildApp({ repos: fakeRepos(), db: null, redis: null });
    const res = await app.inject({ method: 'GET', url: '/api/saves/9', headers: { 'x-device-id': 'nobody' } });
    expect(res.statusCode).toBe(404);
  });
});
