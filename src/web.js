// 小型檔案伺服器：讓手機直接打開孔明做的 Demo、播放影片、下載大檔（連結不可猜，請放在公司網路或 HTTPS 反向代理後面）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { cfg } from './config.js';
import { filePath } from './store.js';
import { KZ } from './domain.js';
import { logger } from './util.js';

const log = logger('web');
const TYPES = { html: 'text/html; charset=utf-8', mp4: 'video/mp4', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', md: 'text/markdown; charset=utf-8', json: 'application/json', png: 'image/png' };

export function startWeb() {
  const srv = http.createServer((req, res) => {
    try {
      const u = new URL(req.url, 'http://x');
      if (u.pathname === '/healthz') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true, programs: KZ.programs.length })); }
      if (u.pathname === '/') { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('孔明 Kongming 在線上。'); }
      const m = /^\/f\/([a-z0-9]+)\/([^/]+)$/.exec(u.pathname);
      if (!m) { res.writeHead(404); return res.end('not found'); }
      const name = decodeURIComponent(m[2]), p = filePath(m[1], name);
      if (!p) { res.writeHead(404); return res.end('not found'); }
      const ext = (name.split('.').pop() || '').toLowerCase(), st = fs.statSync(p);
      const h = { 'content-type': TYPES[ext] || 'application/octet-stream', 'x-content-type-options': 'nosniff', 'cache-control': 'private, max-age=86400', 'referrer-policy': 'no-referrer' };
      if (ext === 'html') h['content-security-policy'] = "sandbox allow-scripts allow-forms; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:";
      if (!['html', 'mp4', 'png', 'md'].includes(ext)) h['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(name)}`;
      // range support so phones can seek videos
      const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
      if (range && ext === 'mp4') {
        const start = range[1] ? +range[1] : 0, end = range[2] ? Math.min(+range[2], st.size - 1) : st.size - 1;
        res.writeHead(206, { ...h, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': end - start + 1 });
        return fs.createReadStream(p, { start, end }).pipe(res);
      }
      res.writeHead(200, { ...h, 'content-length': st.size, 'accept-ranges': 'bytes' });
      fs.createReadStream(p).pipe(res);
    } catch (e) { log.error(e); res.writeHead(500); res.end('error'); }
  });
  srv.listen(cfg.port, () => log.info(`檔案服務 :${cfg.port}${cfg.publicBaseUrl ? `（對外網址 ${cfg.publicBaseUrl}）` : '（未設定 PUBLIC_BASE_URL：大檔與 Demo 只會以附件傳到 Discord）'}`));
  return srv;
}
