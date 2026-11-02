import mysql from 'mysql2/promise';
import type { AppConfig } from './config';

export type Db = mysql.Pool;

const TABLE_DDL = [
  `CREATE TABLE IF NOT EXISTS players (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    device_id VARCHAR(64) NOT NULL UNIQUE,
    display_name VARCHAR(32),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS saves (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    player_id BIGINT NOT NULL,
    slot INT NOT NULL,
    name VARCHAR(64),
    seed INT NOT NULL,
    map_size INT NOT NULL,
    difficulty INT NOT NULL,
    opponents INT NOT NULL,
    elapsed_seconds INT NOT NULL DEFAULT 0,
    state_json LONGTEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_player_slot (player_id, slot),
    KEY idx_player (player_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS battles (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    player_id BIGINT NOT NULL,
    result ENUM('win','loss','draw') NOT NULL,
    winner INT NOT NULL DEFAULT -1,
    map_size INT NOT NULL,
    difficulty INT NOT NULL,
    opponents INT NOT NULL,
    duration_seconds INT NOT NULL DEFAULT 0,
    cities_captured INT NOT NULL DEFAULT 0,
    units_killed INT NOT NULL DEFAULT 0,
    score INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY idx_player (player_id),
    KEY idx_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS settings (
    player_id BIGINT PRIMARY KEY,
    json TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

/** 建库（若不存在）+ 建表，返回连接池 */
export async function initDb(cfg: AppConfig['mysql']): Promise<mysql.Pool> {
  const boot = await mysql.createConnection({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
  });
  await boot.query(
    `CREATE DATABASE IF NOT EXISTS \`${cfg.database}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await boot.end();

  const pool = mysql.createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    waitForConnections: true,
    connectionLimit: 10,
    namedPlaceholders: false,
  });
  for (const ddl of TABLE_DDL) {
    await pool.query(ddl);
  }
  return pool;
}

export async function pingDb(pool: mysql.Pool | null): Promise<boolean> {
  if (!pool) return false;
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
