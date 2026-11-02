import Redis from 'ioredis';

export type RedisClient = Redis;

export function createRedis(url: string): RedisClient {
  const client = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    // 离线时不无限重连刷屏（重启服务即可重新连接）
    retryStrategy: () => null,
  });
  client.on('error', () => {
    /* 离线降级：静默处理，避免刷屏 */
  });
  return client;
}

export async function pingRedis(client: RedisClient | null): Promise<boolean> {
  if (!client) return false;
  try {
    await client.ping();
    return true;
  } catch {
    return false;
  }
}
