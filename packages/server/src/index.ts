import { loadConfig } from './config';
import { initDb, type Db } from './db';
import { createRedis, type RedisClient } from './redis';
import { createRepos } from './repos';
import { buildApp } from './app';
import { attachLan } from './lan';
import { attachRelay } from './relay';

async function main(): Promise<void> {
  const cfg = loadConfig();

  let db: Db | null = null;
  let redis: RedisClient | null = null;

  try {
    db = await initDb(cfg.mysql);
    console.log('[db] MySQL 连接成功，已确保表结构');
  } catch (e) {
    console.warn('[db] MySQL 不可用，将以离线模式运行：', (e as Error).message);
  }

  try {
    redis = createRedis(cfg.redisUrl);
    await redis.connect();
    await redis.ping();
    console.log('[redis] Redis 连接成功');
  } catch (e) {
    console.warn('[redis] Redis 不可用，将以离线模式运行：', (e as Error).message);
    redis = null;
  }

  const repos = createRepos(db, redis);
  const app = await buildApp({ repos, db, redis });

  // 局域网联机：WebSocket 挂在同一个 HTTP 服务上
  // /ws    = 服务端权威（电脑做服务器，规则在服务端跑）
  // /relay = 锁步中继（谁都能当"服务器"，包括手机 App 内的 Java 实现）
  attachLan(app.server as never);
  attachRelay(app.server as never);

  app.listen({ port: cfg.port, host: cfg.host }, (err, address) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    console.log(`[server] 攻伐战争后端已启动：${address}`);
    if (cfg.host === '0.0.0.0') {
      console.log('[server] 已监听所有网卡：同一局域网内的手机可直接访问 http://<本机IP>:' + cfg.port + '/');
    }
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
