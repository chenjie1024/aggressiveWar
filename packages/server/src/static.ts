// 把构建好的网页（packages/web/dist）直接托管出来：手机连 http://<电脑IP>:3000 即可开玩，
// 不需要额外跑 Vite（联机场景下这也避免了 dev server 只监听 127.0.0.1 的问题）。
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';

const DIST = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../web/dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

export function webDistExists(): boolean {
  return existsSync(join(DIST, 'index.html'));
}

export function registerStatic(app: FastifyInstance): void {
  if (!webDistExists()) {
    console.warn(`[web] 未找到前端产物（${DIST}），先执行 npm run build 才能用手机访问`);
    return;
  }
  app.get('/', (_req, reply) => reply.type(MIME['.html']).send(createReadStream(join(DIST, 'index.html'))));
  app.get('/*', (req, reply) => {
    const url = (req.params as { '*': string })['*'] ?? '';
    const safe = normalize(url).replace(/^(\.\.[/\\])+/, '');
    let file = join(DIST, safe);
    if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) {
      file = join(DIST, 'index.html'); // SPA 兜底
    }
    const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
    return reply.type(type).send(createReadStream(file));
  });
  console.log(`[web] 已托管前端产物：${DIST}`);
}
