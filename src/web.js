// 小型檔案伺服器：讓手機直接打開孔明做的 Demo、播放影片、下載大檔（連結不可猜，請放在公司網路或 HTTPS 反向代理後面）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { cfg } from './config.js';
import { filePath } from './store.js';
import { KZ } from './domain.js';
import { logger } from './util.js';
import { metrics, scoutDistribution, killState } from './governance.js';

const log = logger('web');
const TYPES = { html: 'text/html; charset=utf-8', mp4: 'video/mp4', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', md: 'text/markdown; charset=utf-8', json: 'application/json', png: 'image/png' };

export function startWeb() {
  const srv = http.createServer((req, res) => {
    try {
      const u = new URL(req.url, 'http://x');
      if (u.pathname === '/healthz') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true, programs: KZ.programs.length })); }
      if (u.pathname === '/') { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('孔明 Kongming 在線上。'); }
      if (u.pathname === '/dashboard' || u.pathname === '/metrics.json') {
        if (!cfg.dashToken || u.searchParams.get('token') !== cfg.dashToken) { res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('需要 KM_DASHBOARD_TOKEN'); }
        const days = Math.min(365, Number(u.searchParams.get('days')) || 30), M = metrics(days), D = scoutDistribution(days), K = killState();
        if (u.pathname === '/metrics.json') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ...M, distribution: D, kill: K })); }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(dash(M, D, K, days));
      }
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

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const KN = { prep: '訪綱', ingest: '建檔', debrief: '訪談紀錄', status: '案件狀態', match: '科專媒合', poc: 'POC', deck: '提案簡報', demo: 'Demo', video: '計畫短片', proposal: '計畫書', research: '企業研究', roi: '效益試算', closeout: '結案', scout: '商機推薦' };
function bars(o) { const e = Object.entries(o).sort((a, b) => b[1] - a[1]), mx = Math.max(1, ...e.map(x => x[1])); return e.length ? e.map(([k, n]) => `<div class="b"><span>${esc(KN[k] || k)}</span><i style="width:${(n / mx * 100).toFixed(0)}%"></i><b>${n}</b></div>`).join('') : '<p class="m">尚無資料</p>'; }
function dash(M, D, K, days) {
  const tile = (v, l) => `<div class="t"><b>${v}</b><span>${l}</span></div>`;
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>孔明成效</title><style>
body{margin:0;font:15px/1.6 "Noto Sans TC","Microsoft JhengHei",sans-serif;background:#F5F8FC;color:#1B2A4E}header{background:#0A1E5E;color:#fff;padding:18px 24px}header b{font-size:20px}main{max-width:1100px;margin:0 auto;padding:20px 16px;display:grid;gap:18px}
.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px}.t{background:#fff;border:1px solid #DCE4EF;border-radius:12px;padding:14px}.t b{display:block;font-size:26px;color:#0A1E5E;font-variant-numeric:tabular-nums}.t span{color:#5B6A8E;font-size:13px}
section{background:#fff;border:1px solid #DCE4EF;border-radius:12px;padding:16px}h2{font-size:16px;margin:0 0 10px;color:#0B1F5C}.b{display:grid;grid-template-columns:110px 1fr 40px;gap:10px;align-items:center;margin:5px 0}.b i{height:10px;background:linear-gradient(90deg,#1597B5,#13328A);border-radius:6px;display:block}.b b{text-align:right;font-variant-numeric:tabular-nums}.m{color:#5B6A8E}.two{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px}.k{padding:10px 14px;border-radius:10px;background:${K.on ? '#FBE6E4' : '#E3F4EA'};color:${K.on ? '#C4372E' : '#1F8A4C'};font-weight:700}
</style></head><body><header><b>孔明 Kongming 成效</b>　<span>近 ${days} 天・${new Date().toLocaleString('zh-TW', { timeZone: cfg.timezone })}</span></header><main>
<div class="k">${K.on ? `🛑 已緊急停止（${esc(K.by)}${K.reason ? '：' + esc(K.reason) : ''}）` : '運作中'}</div>
<div class="g">${tile(M.users, '使用人數')}${tile(M.asks, '交辦次數')}${tile(M.done, '完成工作')}${tile(M.proactive, '主動完成')}${tile(M.confirmed, '確認可對外使用的產出')}${tile((M.minutesSaved / 60).toFixed(0) + ' 小時', '估計節省時間')}${tile(M.newCases, '新案件')}${tile(M.kzDrafts, '產出科專計畫書的案件')}${tile(M.picks ? Math.round(M.adopted / M.picks * 100) + '%' : '—', `商機採用率（${M.adopted}/${M.picks}）`)}${tile(M.usage.usd ? 'US$' + M.usage.usd.toFixed(0) : ((M.usage.in + M.usage.out) / 1e6).toFixed(1) + 'M', M.usage.usd ? '本月模型費用' : '本月 tokens（未設單價）')}</div>
<div class="two"><section><h2>完成的工作</h2>${bars(M.tasks)}</section><section><h2>對外產出</h2>${bars(M.outputs)}</section></div>
<div class="two"><section><h2>商機推薦：地區分布</h2>${bars(D.region)}</section><section><h2>商機推薦：規模分布</h2>${bars(D.size)}</section></div>
<section><h2>治理</h2><p>婉拒範圍外要求 ${M.outOfScope} 次・擋下無權限使用 ${M.denied} 次・失敗 ${M.failed} 次${M.budget.budget ? `・預算 US$${M.budget.budget}，已用 ${Math.round((M.budget.ratio || 0) * 100)}%` : ''}</p><p class="m">節省時間依 KM_MINUTES_SAVED 的每項工作分鐘數估算，請用實測資料校正後再對外報告。</p></section>
</main></body></html>`;
}
