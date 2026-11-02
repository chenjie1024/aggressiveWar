// 生成本地自签名 release keystore（JDK keytool），已存在则跳过
import { existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = resolve(root, 'android/keystore');
const file = join(dir, 'gongfa.jks');

if (existsSync(file)) {
  console.log('keystore 已存在：', file);
  process.exit(0);
}
mkdirSync(dir, { recursive: true });

const javaHome = process.env.JAVA_HOME;
if (!javaHome) {
  console.error('未设置 JAVA_HOME，无法调用 keytool');
  process.exit(1);
}
const keytool = join(javaHome, 'bin', process.platform === 'win32' ? 'keytool.exe' : 'keytool');
const r = spawnSync(
  keytool,
  [
    '-genkeypair',
    '-v',
    '-keystore', file,
    '-alias', 'gongfa',
    '-keyalg', 'RSA',
    '-keysize', '2048',
    '-validity', '10000',
    '-storepass', 'gongfa2026',
    '-keypass', 'gongfa2026',
    '-dname', 'CN=GongfaWar, OU=Local, O=GongfaWar, L=Local, ST=Local, C=CN',
  ],
  { stdio: 'inherit' },
);
if (r.status !== 0) process.exit(1);
console.log('已生成 keystore：', file, '（别名 gongfa / 口令 gongfa2026，仅本地自签名用）');
