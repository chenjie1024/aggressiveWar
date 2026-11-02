import type { Db } from './db';
import type { RedisClient } from './redis';

export interface PlayerRow {
  id: number;
  deviceId: string;
  displayName: string | null;
}

export interface SaveMeta {
  slot: number;
  name: string | null;
  seed: number;
  mapSize: number;
  difficulty: number;
  opponents: number;
  elapsedSeconds: number;
  updatedAt: string;
}

export interface SaveRow extends SaveMeta {
  stateJson: string;
}

export interface BattleRecord {
  playerId: number;
  result: 'win' | 'loss' | 'draw';
  winner: number;
  mapSize: number;
  difficulty: number;
  opponents: number;
  durationSeconds: number;
  citiesCaptured: number;
  unitsKilled: number;
  score: number;
  createdAt: string;
}

export interface LeaderboardEntry {
  playerId: number;
  displayName: string | null;
  score: number;
}

export interface Repos {
  getOrCreatePlayer(deviceId: string): Promise<PlayerRow>;
  listSaves(playerId: number): Promise<SaveMeta[]>;
  getSave(playerId: number, slot: number): Promise<SaveRow | null>;
  saveGame(
    playerId: number,
    slot: number,
    name: string | null,
    meta: { seed: number; mapSize: number; difficulty: number; opponents: number; elapsedSeconds: number },
    stateJson: string,
  ): Promise<void>;
  deleteSave(playerId: number, slot: number): Promise<void>;
  addBattle(
    playerId: number,
    battle: {
      result: 'win' | 'loss' | 'draw';
      winner: number;
      mapSize: number;
      difficulty: number;
      opponents: number;
      durationSeconds: number;
      citiesCaptured: number;
      unitsKilled: number;
      score: number;
    },
  ): Promise<void>;
  listBattles(playerId: number, limit?: number): Promise<BattleRecord[]>;
  leaderboard(mapSize: number, difficulty: number, top?: number): Promise<LeaderboardEntry[]>;
  getSettings(playerId: number): Promise<string | null>;
  setSettings(playerId: number, json: string): Promise<void>;
}

function requireDb(pool: Db | null): Db {
  if (!pool) throw new Error('SERVICE_UNAVAILABLE: 数据库不可用');
  return pool;
}

export function createRepos(pool: Db | null, redis: RedisClient | null): Repos {
  const cacheKey = (playerId: number, slot: number) => `save:${playerId}:${slot}`;
  const settingsKey = (playerId: number) => `settings:${playerId}`;
  const leaderboardKey = (mapSize: number, difficulty: number) => `leaderboard:${mapSize}:${difficulty}`;

  return {
    async getOrCreatePlayer(deviceId) {
      const db = requireDb(pool);
      const [rows] = await db.query<any[]>(
        'SELECT id, device_id AS deviceId, display_name AS displayName FROM players WHERE device_id = ?',
        [deviceId],
      );
      if (rows[0]) return rows[0] as PlayerRow;
      await db.query('INSERT INTO players (device_id) VALUES (?)', [deviceId]);
      const [inserted] = await db.query<any[]>(
        'SELECT id, device_id AS deviceId, display_name AS displayName FROM players WHERE device_id = ?',
        [deviceId],
      );
      return inserted[0] as PlayerRow;
    },

    async listSaves(playerId) {
      const db = requireDb(pool);
      const [rows] = await db.query<any[]>(
        `SELECT slot, name, seed, map_size AS mapSize, difficulty, opponents,
                elapsed_seconds AS elapsedSeconds, updated_at AS updatedAt
         FROM saves WHERE player_id = ? ORDER BY slot ASC`,
        [playerId],
      );
      return rows as SaveMeta[];
    },

    async getSave(playerId, slot) {
      const db = requireDb(pool);
      if (redis) {
        const cached = await redis.get(cacheKey(playerId, slot));
        if (cached) return JSON.parse(cached) as SaveRow;
      }
      const [rows] = await db.query<any[]>(
        `SELECT slot, name, seed, map_size AS mapSize, difficulty, opponents,
                elapsed_seconds AS elapsedSeconds, state_json AS stateJson, updated_at AS updatedAt
         FROM saves WHERE player_id = ? AND slot = ?`,
        [playerId, slot],
      );
      const row = rows[0] as SaveRow | undefined;
      if (row && redis) {
        await redis.set(cacheKey(playerId, slot), JSON.stringify(row), 'EX', 60);
      }
      return row ?? null;
    },

    async saveGame(playerId, slot, name, meta, stateJson) {
      const db = requireDb(pool);
      await db.query(
        `INSERT INTO saves (player_id, slot, name, seed, map_size, difficulty, opponents, elapsed_seconds, state_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), seed = VALUES(seed), map_size = VALUES(map_size),
           difficulty = VALUES(difficulty), opponents = VALUES(opponents),
           elapsed_seconds = VALUES(elapsed_seconds), state_json = VALUES(state_json)`,
        [playerId, slot, name, meta.seed, meta.mapSize, meta.difficulty, meta.opponents, meta.elapsedSeconds, stateJson],
      );
      if (redis) await redis.del(cacheKey(playerId, slot));
    },

    async deleteSave(playerId, slot) {
      const db = requireDb(pool);
      await db.query('DELETE FROM saves WHERE player_id = ? AND slot = ?', [playerId, slot]);
      if (redis) await redis.del(cacheKey(playerId, slot));
    },

    async addBattle(playerId, battle) {
      const db = requireDb(pool);
      await db.query(
        `INSERT INTO battles (player_id, result, winner, map_size, difficulty, opponents,
          duration_seconds, cities_captured, units_killed, score)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          playerId,
          battle.result,
          battle.winner,
          battle.mapSize,
          battle.difficulty,
          battle.opponents,
          battle.durationSeconds,
          battle.citiesCaptured,
          battle.unitsKilled,
          battle.score,
        ],
      );
      if (redis) {
        await redis.zincrby(leaderboardKey(battle.mapSize, battle.difficulty), battle.score, String(playerId));
      }
    },

    async listBattles(playerId, limit = 20) {
      const db = requireDb(pool);
      const [rows] = await db.query<any[]>(
        `SELECT id, player_id AS playerId, result, winner, map_size AS mapSize, difficulty, opponents,
                duration_seconds AS durationSeconds, cities_captured AS citiesCaptured,
                units_killed AS unitsKilled, score, created_at AS createdAt
         FROM battles WHERE player_id = ? ORDER BY id DESC LIMIT ?`,
        [playerId, limit],
      );
      return rows as BattleRecord[];
    },

    async leaderboard(mapSize, difficulty, top = 10) {
      if (redis) {
        const items = await redis.zrevrange(leaderboardKey(mapSize, difficulty), 0, top - 1, 'WITHSCORES');
        const entries: LeaderboardEntry[] = [];
        const db = pool;
        for (let i = 0; i < items.length; i += 2) {
          const playerId = Number(items[i]);
          const score = Number(items[i + 1]);
          let displayName: string | null = null;
          if (db) {
            const [rows] = await db.query<any[]>(
              'SELECT display_name AS displayName FROM players WHERE id = ?',
              [playerId],
            );
            displayName = rows[0]?.displayName ?? null;
          }
          entries.push({ playerId, displayName, score });
        }
        return entries; // Redis 可用时直接返回（即使为空）
      }

      const db = requireDb(pool);
      const [rows] = await db.query<any[]>(
        `SELECT b.player_id AS playerId, p.display_name AS displayName, SUM(b.score) AS score
         FROM battles b LEFT JOIN players p ON p.id = b.player_id
         WHERE b.map_size = ? AND b.difficulty = ?
         GROUP BY b.player_id, p.display_name
         ORDER BY score DESC LIMIT ?`,
        [mapSize, difficulty, top],
      );
      return rows.map((r) => ({ playerId: Number(r.playerId), displayName: r.displayName, score: Number(r.score) }));
    },

    async getSettings(playerId) {
      if (redis) {
        const cached = await redis.get(settingsKey(playerId));
        if (cached) return cached;
      }
      const db = requireDb(pool);
      const [rows] = await db.query<any[]>('SELECT json FROM settings WHERE player_id = ?', [playerId]);
      const json = rows[0]?.json ?? null;
      if (json && redis) await redis.set(settingsKey(playerId), json, 'EX', 300);
      return json;
    },

    async setSettings(playerId, json) {
      const db = requireDb(pool);
      await db.query(
        'INSERT INTO settings (player_id, json) VALUES (?, ?) ON DUPLICATE KEY UPDATE json = VALUES(json)',
        [playerId, json],
      );
      if (redis) await redis.del(settingsKey(playerId));
    },
  };
}
