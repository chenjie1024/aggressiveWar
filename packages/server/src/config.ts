import 'dotenv/config';

export interface AppConfig {
  port: number;
  host: string;
  mysql: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  };
  redisUrl: string;
}

export function loadConfig(): AppConfig {
  return {
    port: Number(process.env.PORT ?? 3000),
    // 默认监听所有网卡，手机才能通过局域网 IP 连进来（只在本机玩也安全：局域网内可见）
    host: process.env.HOST ?? '0.0.0.0',
    mysql: {
      host: process.env.MYSQL_HOST ?? '127.0.0.1',
      port: Number(process.env.MYSQL_PORT ?? 3306),
      user: process.env.MYSQL_USER ?? 'root',
      password: process.env.MYSQL_PASSWORD ?? '',
      database: process.env.MYSQL_DATABASE ?? 'gongfa_war',
    },
    redisUrl: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
  };
}
