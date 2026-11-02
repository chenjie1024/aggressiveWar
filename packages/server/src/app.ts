import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { networkInterfaces } from 'node:os';
import type { Repos } from './repos';
import type { Db } from './db';
import { pingDb } from './db';
import type { RedisClient } from './redis';
import { pingRedis } from './redis';
import { roomCount } from './lan';
import { relayRoomCount } from './relay';
import { registerStatic, webDistExists } from './static';

export interface Services {
  repos: Repos;
  db: Db | null;
  redis: RedisClient | null;
}

interface SaveBody {
  slot: number;
  name?: string | null;
  seed: number;
  mapSize: number;
  difficulty: number;
  opponents: number;
  elapsedSeconds: number;
  stateJson: string;
}

interface BattleBody {
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

function fail(reply: FastifyReply, e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  const status = msg.includes('SERVICE_UNAVAILABLE') ? 503 : 500;
  return reply.code(status).send({ error: msg });
}

async function resolvePlayerId(repos: Repos, req: FastifyRequest): Promise<number> {
  const deviceId = (req.headers['x-device-id'] as string) || 'guest';
  const p = await repos.getOrCreatePlayer(deviceId);
  return p.id;
}

function registerRoutes(app: FastifyInstance, services: Services): void {
  const { repos } = services;

  /** 局域网信息：前端用它展示"手机访问 http://<IP>:<port>" */
  app.get('/api/lan-info', async () => {
    const ips: string[] = [];
    const ifaces = networkInterfaces();
    for (const list of Object.values(ifaces)) {
      for (const i of list ?? []) {
        if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
      }
    }
    const port = Number(process.env.PORT ?? 3000);
    return {
      ips,
      port,
      urls: ips.map((ip) => `http://${ip}:${port}/`),
      webHosted: webDistExists(),
      rooms: roomCount(),
      relayRooms: relayRoomCount(),
    };
  });

  app.get('/api/health', async () => {
    const mysql = services.db ? ((await pingDb(services.db)) ? 'ok' : 'down') : 'down';
    const redis = services.redis ? ((await pingRedis(services.redis)) ? 'ok' : 'down') : 'down';
    return { status: mysql === 'ok' || redis === 'ok' ? 'ok' : 'offline', mysql, redis };
  });

  app.post('/api/players', async (req, reply) => {
    try {
      const body = req.body as { deviceId?: string; displayName?: string } | undefined;
      const deviceId = body?.deviceId || (req.headers['x-device-id'] as string) || 'guest';
      const p = await repos.getOrCreatePlayer(deviceId);
      return { playerId: p.id, deviceId: p.deviceId, displayName: p.displayName };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post('/api/saves', async (req, reply) => {
    try {
      const body = req.body as SaveBody;
      const playerId = await resolvePlayerId(repos, req);
      await repos.saveGame(
        playerId,
        body.slot,
        body.name ?? null,
        { seed: body.seed, mapSize: body.mapSize, difficulty: body.difficulty, opponents: body.opponents, elapsedSeconds: body.elapsedSeconds },
        body.stateJson,
      );
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.get('/api/saves', async (req, reply) => {
    try {
      const playerId = await resolvePlayerId(repos, req);
      return { saves: await repos.listSaves(playerId) };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.get<{ Params: { slot: string } }>('/api/saves/:slot', async (req, reply) => {
    try {
      const playerId = await resolvePlayerId(repos, req);
      const save = await repos.getSave(playerId, Number(req.params.slot));
      if (!save) return reply.code(404).send({ error: 'not_found' });
      return { save };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.delete<{ Params: { slot: string } }>('/api/saves/:slot', async (req, reply) => {
    try {
      const playerId = await resolvePlayerId(repos, req);
      await repos.deleteSave(playerId, Number(req.params.slot));
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post('/api/battles', async (req, reply) => {
    try {
      const body = req.body as BattleBody;
      const playerId = await resolvePlayerId(repos, req);
      await repos.addBattle(playerId, body);
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.get('/api/battles', async (req, reply) => {
    try {
      const playerId = await resolvePlayerId(repos, req);
      const limit = Number((req.query as { limit?: string }).limit ?? 20);
      return { battles: await repos.listBattles(playerId, limit) };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.get('/api/leaderboard', async (req, reply) => {
    try {
      const q = req.query as { mapSize?: string; difficulty?: string; top?: string };
      const mapSize = Number(q.mapSize ?? 8);
      const difficulty = Number(q.difficulty ?? 1);
      const top = Number(q.top ?? 10);
      return { entries: await repos.leaderboard(mapSize, difficulty, top) };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.get('/api/settings', async (req, reply) => {
    try {
      const playerId = await resolvePlayerId(repos, req);
      const json = await repos.getSettings(playerId);
      return { settings: json ? JSON.parse(json) : {} };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.put('/api/settings', async (req, reply) => {
    try {
      const playerId = await resolvePlayerId(repos, req);
      await repos.setSettings(playerId, JSON.stringify(req.body ?? {}));
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });
}

export async function buildApp(services: Services): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });
  registerRoutes(app, services);
  // 静态托管前端（手机连本机 IP 即可开玩）；放在 API 路由之后注册，避免抢走 /api/*
  registerStatic(app);
  return app;
}
