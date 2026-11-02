// 一键打包 Android APK：构建 Web 产物 → 拷贝到 assets → Gradle 出包
// 用法：node scripts/build-android.mjs [--release] [--skip-web] [--clean]
import { existsSync, mkdirSync, rmSync, cpSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const webDist = resolve(root, 'packages/web/dist');
const assetsWww = resolve(root, 'android/app/src/main/assets/www');
const androidDir = resolve(root, 'android');
const args = new Set(process.argv.slice(2));
const release = args.has('--release');
const skipWeb = args.has('--skip-web');
const clean = args.has('--clean');

const log = (msg) => console.log(`\x1b[36m[android]\x1b[0m ${msg}`);
const fail = (msg) => {
  console.error(`\x1b[31m[android] ${msg}\x1b[0m`);
  process.exit(1);
};

// 1) Web 产物
if (!skipWeb) {
  log('构建 Web 产物（npm run build -w @gongfa-war/web）…');
  // Windows 上 .cmd 必须经 shell 启动（Node 20+ 禁止直接 spawn .cmd）
  const r = spawnSync('npm run build -w @gongfa-war/web', {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    // Android 包内资源已本地化：关掉 Service Worker，避免升级后命中旧缓存
    env: { ...process.env, VITE_TARGET: 'android' },
  });
  if (r.status !== 0) fail(`Web 构建失败（exit ${r.status}${r.error ? `: ${r.error.message}` : ''}）`);
} else {
  log('跳过 Web 构建（--skip-web）');
}
if (!existsSync(join(webDist, 'index.html'))) fail(`未找到 ${webDist}/index.html，请先构建 Web`);

// 2) 拷贝到 Android assets
log(`拷贝 Web 产物 → ${assetsWww}`);
rmSync(assetsWww, { recursive: true, force: true });
mkdirSync(assetsWww, { recursive: true });
cpSync(webDist, assetsWww, { recursive: true });
const files = readdirSync(assetsWww).length;
log(`assets/www 就绪（${files} 个顶层条目）`);

// 3) local.properties：告知 Gradle SDK 位置
const sdkDir =
  process.env.ANDROID_HOME ||
  process.env.ANDROID_SDK_ROOT ||
  (existsSync(resolve(root, '.android-sdk')) ? resolve(root, '.android-sdk') : '');
if (!sdkDir || !existsSync(sdkDir)) {
  fail('未找到 Android SDK：请设置 ANDROID_HOME，或把 SDK 放到 .android-sdk/');
}
writeFileSync(join(androidDir, 'local.properties'), `sdk.dir=${sdkDir.replace(/\\/g, '\\\\')}\n`, 'utf8');
log(`SDK: ${sdkDir}`);

// 4) 选择 Gradle：wrapper → 本地解压的发行版 → PATH
const gradleCandidates = [
  join(androidDir, 'gradlew.bat'),
  join(root, '.gradle-dist/gradle-8.11.1/bin/gradle.bat'),
];
const gradle = gradleCandidates.find((p) => existsSync(p)) ?? 'gradle';
log(`Gradle: ${gradle}`);

const tasks = [release ? 'assembleRelease' : 'assembleDebug'];
if (clean) tasks.unshift('clean');

const gr = spawnSync(gradle, ['-p', androidDir, ...tasks, '--console=plain'], {
  cwd: androidDir,
  stdio: 'inherit',
  env: { ...process.env, JAVA_HOME: process.env.JAVA_HOME ?? '' },
  shell: gradle.endsWith('.bat'),
});
if (gr.status !== 0) fail(`Gradle 构建失败（exit ${gr.status}）`);

// 5) 汇报产物
const outDir = join(androidDir, 'app/build/outputs/apk', release ? 'release' : 'debug');
if (!existsSync(outDir)) fail(`未找到输出目录 ${outDir}`);
const apks = readdirSync(outDir).filter((f) => f.endsWith('.apk'));
if (apks.length === 0) fail(`${outDir} 下没有 APK`);
for (const apk of apks) {
  const p = join(outDir, apk);
  log(`✅ ${p}  (${(statSync(p).size / 1024 / 1024).toFixed(2)} MB)`);
}
