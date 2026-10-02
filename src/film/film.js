// 計畫短片：動態圖文 + 字幕 + 配樂 → MP4（與網頁版孔明同一套畫面）
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { ROOT, cfg } from '../config.js';
import { arr, cut, num, pad, logger } from '../util.js';

const log = logger('film');
export const FILM_TYPES = ['title', 'problem', 'stat', 'solution', 'flow', 'demo', 'kpi', 'timeline', 'closing'];
const FW = 1280, FH = 720;
let FAM = '"KM Sans TC","Noto Sans CJK TC","Noto Sans TC","Noto Sans CJK JP",sans-serif';

/* ---------- fonts & portraits ---------- */
let ready = null;
const IM = {};
export function filmInit() {
  return ready ??= (async () => {
    const fdir = [path.join(ROOT, 'fonts'), '/app/fonts'].find(d => fs.existsSync(d));
    let n = 0;
    if (fdir) for (const w of ['Regular', 'Medium', 'Bold', 'Black']) { const p = path.join(fdir, `KMSansTC-${w}.otf`); if (fs.existsSync(p)) { GlobalFonts.registerFromPath(p, 'KM Sans TC'); n++; } }
    if (!n) log.warn('找不到繁體中文字型（fonts/KMSansTC-*.otf），改用系統字型；請執行 npm run fonts');
    for (const [k, f] of [['arms', 'arms.png'], ['chin', 'chin.png'], ['fan', 'fan.jpg']]) IM[k] = await loadImage(fs.readFileSync(path.join(ROOT, 'assets', f)));
  })();
}

/* ---------- drawing helpers ---------- */
const fmtT = s => { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 60)}:${pad(s % 60)}`; };
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const ease = x => 1 - Math.pow(1 - clamp(x), 3);
const ap = (lt, d, dur = 0.6) => ease((lt - d) / dur);
const fnt = (w, px) => `${w} ${px}px ${FAM}`;
function wrapLines(ctx, text, maxW) {
  const tk = String(text || '').match(/[A-Za-z0-9.,%+\-–—/:'’]+|\s+|[\s\S]/gu) || [];
  const lines = []; let line = '';
  for (const t of tk) { const test = line + t; if (ctx.measureText(test).width > maxW && line.trim()) { lines.push(line.trim()); line = t.trimStart(); } else line = test; }
  if (line.trim()) lines.push(line.trim());
  return lines;
}
function tb(ctx, text, x, y, o) {
  ctx.font = fnt(o.w || 700, o.size); ctx.fillStyle = o.color; ctx.textAlign = o.align || 'left'; ctx.textBaseline = 'alphabetic';
  const lines = wrapLines(ctx, text, o.maxW || 1000).slice(0, o.max || 4), lh = o.size * (o.lh || 1.3);
  lines.forEach((l, k) => ctx.fillText(l, x, y + k * lh));
  return lines.length * lh;
}
function rr(ctx, x, y, w, h, r) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); }
function sweeps(ctx, lt, a) {
  ctx.save();
  const cx = FW + 360, cy = FH * 0.52;
  for (let k = 0; k < 5; k++) {
    ctx.beginPath(); ctx.lineWidth = 30 - k * 5;
    ctx.strokeStyle = k % 2 ? `rgba(51,198,234,${a})` : `rgba(21,151,181,${a * 0.9})`;
    ctx.arc(cx, cy, 560 + k * 64 + Math.sin(lt * 0.5 + k) * 5, Math.PI * 0.6, Math.PI * 1.4); ctx.stroke();
  }
  ctx.restore();
}
function bgDark(ctx, lt) { const g = ctx.createLinearGradient(0, 0, FW, FH); g.addColorStop(0, '#061444'); g.addColorStop(1, '#13328A'); ctx.fillStyle = g; ctx.fillRect(0, 0, FW, FH); sweeps(ctx, lt, 0.16); }
function bgLight(ctx, lt) { ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, FW, FH); sweeps(ctx, lt, 0.10); }
function tag(ctx, sb, dark) {
  ctx.fillStyle = dark ? '#33C6EA' : '#0A1E5E'; ctx.fillRect(72, 50, 4, 22);
  ctx.font = fnt(500, 20); ctx.fillStyle = dark ? '#B9C6EA' : '#5B6A8E'; ctx.textAlign = 'left';
  ctx.fillText(`${cut(sb.company || '', 18)}${sb.program ? '｜' + sb.program : ''}`, 88, 69);
  ctx.font = fnt(900, 22); ctx.textAlign = 'right'; ctx.fillStyle = dark ? '#33C6EA' : '#1597B5'; ctx.fillText('Kongming', FW - 72, 69);
}
function heading(ctx, s, lt, dark, maxW = 1100) { ctx.globalAlpha = ap(lt, 0.1); tb(ctx, s.heading || '', 72, 150 + (1 - ap(lt, 0.1)) * 20, { size: 46, w: 900, color: dark ? '#FFFFFF' : '#0B1F5C', maxW, max: 2, lh: 1.2 }); ctx.globalAlpha = 1; }
function portrait(ctx, key, x, h, a, from = 60) {
  const i = IM[key]; if (!i) return;
  const w = h * i.width / i.height;
  ctx.save(); ctx.globalAlpha = a; ctx.drawImage(i, x + (1 - a) * from, FH - h, w, h); ctx.restore();
}
function numParts(v) { const m = /^(\D*?)([\d,]+(?:\.\d+)?)(.*)$/.exec(String(v || '')); if (!m) return null; return { pre: m[1], n: parseFloat(m[2].replace(/,/g, '')), dec: (m[2].split('.')[1] || '').length, comma: m[2].includes(','), post: m[3] }; }

const SCENE = {
  title(ctx, s, lt, sb, o) {
    bgDark(ctx, lt);
    if (o.km) { const g = ctx.createRadialGradient(1010, 380, 40, 1010, 380, 360); g.addColorStop(0, 'rgba(51,198,234,.28)'); g.addColorStop(1, 'rgba(51,198,234,0)'); ctx.fillStyle = g; ctx.fillRect(600, 0, 680, FH); portrait(ctx, 'arms', 830, 680, ap(lt, 0.2, 0.9)); }
    tag(ctx, sb, true);
    ctx.globalAlpha = ap(lt, 0.3); ctx.fillStyle = '#33C6EA'; ctx.fillRect(72, 250, 64, 5);
    const h = tb(ctx, s.heading || sb.title, 72, 330 + (1 - ap(lt, 0.3)) * 24, { size: 62, w: 900, color: '#FFFFFF', maxW: o.km ? 720 : 1100, max: 3, lh: 1.18 });
    ctx.globalAlpha = ap(lt, 0.8); tb(ctx, s.sub || '', 72, 330 + h + 18, { size: 30, w: 500, color: '#9EDDF0', maxW: o.km ? 700 : 1100, max: 2 });
    ctx.globalAlpha = ap(lt, 1.2); ctx.font = fnt(500, 20); ctx.fillStyle = '#B9C6EA'; ctx.textAlign = 'left'; ctx.fillText(cfg.org, 72, 610); ctx.globalAlpha = 1;
  },
  problem(ctx, s, lt, sb) {
    bgLight(ctx, lt); tag(ctx, sb); heading(ctx, s, lt);
    arr(s.points).slice(0, 3).forEach((p, k) => {
      const a = ap(lt, 0.6 + k * 0.7), y = 270 + k * 118;
      ctx.globalAlpha = a; const x = 72 + (1 - a) * -40;
      ctx.fillStyle = '#EAF3FB'; rr(ctx, x, y - 52, 1000, 92, 18); ctx.fill();
      ctx.fillStyle = '#0A1E5E'; ctx.beginPath(); ctx.arc(x + 50, y - 6, 26, 0, Math.PI * 2); ctx.fill();
      ctx.font = fnt(900, 26); ctx.fillStyle = '#FFFFFF'; ctx.textAlign = 'center'; ctx.fillText(String(k + 1), x + 50, y + 3);
      tb(ctx, p, x + 100, y + 6, { size: 32, w: 700, color: '#1B2A4E', maxW: 860, max: 1 });
    });
    ctx.globalAlpha = 1;
  },
  stat(ctx, s, lt, sb, o) {
    bgLight(ctx, lt); tag(ctx, sb); heading(ctx, s, lt, false, o.km ? 760 : 1100);
    if (o.km) portrait(ctx, 'chin', 900, 560, ap(lt, 0.4, 0.9));
    const P = numParts(s.value), k = ease((lt - 0.5) / 1.6);
    let txt = String(s.value || '');
    if (P) { const v = P.n * k; let n = P.dec ? v.toFixed(P.dec) : String(Math.round(v)); if (P.comma) n = Number(n).toLocaleString('en-US', { minimumFractionDigits: P.dec, maximumFractionDigits: P.dec }); txt = P.pre + n + P.post; }
    ctx.globalAlpha = ap(lt, 0.4);
    ctx.font = fnt(900, 150); ctx.textAlign = 'left';
    const g = ctx.createLinearGradient(72, 300, 760, 460); g.addColorStop(0, '#1AA3C0'); g.addColorStop(1, '#0B2A78'); ctx.fillStyle = g;
    ctx.fillText(txt, 72, 450);
    ctx.globalAlpha = ap(lt, 1.2); tb(ctx, s.label || '', 76, 525, { size: 34, w: 700, color: '#1B2A4E', maxW: o.km ? 760 : 1100, max: 2 });
    ctx.globalAlpha = 1;
  },
  solution(ctx, s, lt, sb) {
    bgLight(ctx, lt); tag(ctx, sb); heading(ctx, s, lt);
    const cards = arr(s.cards).slice(0, 3), n = cards.length || 1, w = (FW - 144 - (n - 1) * 28) / n;
    cards.forEach((c, k) => {
      const a = ap(lt, 0.5 + k * 0.45), x = 72 + k * (w + 28), y = 250 + (1 - a) * 50;
      ctx.globalAlpha = a; ctx.save(); ctx.shadowColor = 'rgba(10,30,94,.14)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 8;
      ctx.fillStyle = '#FFFFFF'; rr(ctx, x, y, w, 300, 20); ctx.fill(); ctx.restore();
      ctx.globalAlpha = a; ctx.strokeStyle = '#DCE4EF'; ctx.lineWidth = 2; rr(ctx, x, y, w, 300, 20); ctx.stroke();
      ctx.fillStyle = '#1597B5'; ctx.beginPath(); ctx.arc(x + 52, y + 56, 26, 0, Math.PI * 2); ctx.fill();
      ctx.font = fnt(900, 24); ctx.fillStyle = '#FFFFFF'; ctx.textAlign = 'center'; ctx.fillText(String(k + 1), x + 52, y + 65);
      tb(ctx, c.title || '', x + 30, y + 140, { size: 34, w: 900, color: '#0B1F5C', maxW: w - 60, max: 1 });
      tb(ctx, c.text || '', x + 30, y + 192, { size: 25, w: 500, color: '#3A4A70', maxW: w - 60, max: 3, lh: 1.4 });
    });
    ctx.globalAlpha = 1;
  },
  flow(ctx, s, lt, sb) {
    bgLight(ctx, lt); tag(ctx, sb); heading(ctx, s, lt);
    const st = arr(s.steps).slice(0, 5), n = st.length || 1, x0 = 150, x1 = FW - 150, y = 360, gap = n > 1 ? (x1 - x0) / (n - 1) : 0;
    const prog = ease((lt - 0.4) / (0.6 * n + 0.6));
    ctx.strokeStyle = '#DCE4EF'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    ctx.strokeStyle = '#1597B5'; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + (x1 - x0) * prog, y); ctx.stroke();
    st.forEach((t, k) => {
      const x = n > 1 ? x0 + k * gap : FW / 2, a = ap(lt, 0.4 + k * 0.6, 0.5);
      ctx.globalAlpha = a; ctx.fillStyle = '#0A1E5E'; ctx.beginPath(); ctx.arc(x, y, 44 * (0.6 + 0.4 * a), 0, Math.PI * 2); ctx.fill();
      ctx.font = fnt(900, 32); ctx.fillStyle = '#FFFFFF'; ctx.textAlign = 'center'; ctx.fillText(String(k + 1), x, y + 11);
      tb(ctx, t, x, y + 104, { size: 28, w: 700, color: '#1B2A4E', maxW: Math.min(260, gap - 20 || 400), align: 'center', max: 2 });
    });
    ctx.globalAlpha = 1;
  },
  demo(ctx, s, lt, sb) {
    bgDark(ctx, lt); tag(ctx, sb, true);
    const a = ap(lt, 0.2, 0.8), X = 72, Y = 120 + (1 - a) * 30, W = 780, H = 480;
    ctx.globalAlpha = a;
    ctx.fillStyle = '#0B1A4D'; rr(ctx, X - 10, Y - 10, W + 20, H + 20, 22); ctx.fill();
    ctx.fillStyle = '#F5F8FC'; rr(ctx, X, Y, W, H, 14); ctx.fill();
    ctx.fillStyle = '#0A1E5E'; rr(ctx, X, Y, W, 46, 14); ctx.fill(); ctx.fillRect(X, Y + 30, W, 16);
    ctx.font = fnt(700, 18); ctx.fillStyle = '#FFFFFF'; ctx.textAlign = 'left'; ctx.fillText(cut(s.heading || '產品 Demo', 22), X + 20, Y + 30);
    const labels = arr(s.labels).slice(0, 3); const on = Math.floor(lt / 1.6) % Math.max(1, labels.length);
    labels.forEach((l, k) => { ctx.fillStyle = k === on ? '#EAF3FB' : '#FFFFFF'; rr(ctx, X + 16, Y + 66 + k * 56, 170, 44, 8); ctx.fill(); ctx.strokeStyle = k === on ? '#1597B5' : '#DCE4EF'; ctx.lineWidth = 2; rr(ctx, X + 16, Y + 66 + k * 56, 170, 44, 8); ctx.stroke(); ctx.font = fnt(k === on ? 700 : 500, 18); ctx.fillStyle = '#1B2A4E'; ctx.textAlign = 'left'; ctx.fillText(cut(l, 8), X + 32, Y + 95 + k * 56); });
    const MX = X + 206, MY = Y + 66, MW = W - 222, MH = 250;
    ctx.fillStyle = '#FFFFFF'; rr(ctx, MX, MY, MW, MH, 10); ctx.fill(); ctx.strokeStyle = '#DCE4EF'; rr(ctx, MX, MY, MW, MH, 10); ctx.stroke();
    ctx.fillStyle = '#E3EAF4'; for (let k = 0; k < 4; k++) { rr(ctx, MX + 26 + k * 128, MY + 60, 100, 130, 10); ctx.fill(); }
    const scan = (lt * 0.45) % 1; ctx.fillStyle = 'rgba(51,198,234,.35)'; ctx.fillRect(MX + 10, MY + 10 + scan * (MH - 20), MW - 20, 4);
    for (let k = 0; k < 4; k++) { const b = ap(lt, 1 + k * 0.5, 0.3); if (b <= 0) continue; ctx.globalAlpha = a * b; ctx.strokeStyle = k === 2 ? '#E39A16' : '#27B26A'; ctx.lineWidth = 3; ctx.strokeRect(MX + 20 + k * 128, MY + 54, 112, 142); ctx.fillStyle = k === 2 ? '#E39A16' : '#27B26A'; ctx.fillRect(MX + 20 + k * 128, MY + 30, 82, 24); ctx.font = fnt(700, 14); ctx.fillStyle = '#FFFFFF'; ctx.textAlign = 'left'; ctx.fillText(k === 2 ? '待複檢' : 'OK 9' + (6 + k) + '%', MX + 26 + k * 128, MY + 47); ctx.globalAlpha = a; }
    for (let k = 0; k < 7; k++) { const hh = (40 + ((k * 37) % 70)) * ease((lt - 1.2 - k * 0.12) / 0.8); ctx.fillStyle = k === 6 ? '#1597B5' : '#9FB6DA'; ctx.fillRect(MX + 30 + k * 60, Y + H - 24 - hh, 34, hh); }
    ctx.globalAlpha = ap(lt, 0.6);
    tb(ctx, s.heading || '', 900, 260, { size: 40, w: 900, color: '#FFFFFF', maxW: 320, max: 3, lh: 1.2 });
    tb(ctx, s.caption || '', 900, 420, { size: 25, w: 500, color: '#9EDDF0', maxW: 320, max: 4, lh: 1.4 });
    ctx.globalAlpha = 1;
  },
  kpi(ctx, s, lt, sb) {
    bgLight(ctx, lt); tag(ctx, sb); heading(ctx, s, lt);
    arr(s.items).slice(0, 4).forEach((it, k) => {
      const y = 280 + k * 100, a = ap(lt, 0.5 + k * 0.4); ctx.globalAlpha = a;
      tb(ctx, it.name || '', 72, y + 10, { size: 30, w: 700, color: '#1B2A4E', maxW: 360, max: 1 });
      ctx.fillStyle = '#E3EAF4'; rr(ctx, 460, y - 14, 560, 26, 13); ctx.fill();
      const pct = clamp((num(it.pct) ?? 70) / 100) * ease((lt - 0.7 - k * 0.4) / 1.2);
      const g = ctx.createLinearGradient(460, 0, 1020, 0); g.addColorStop(0, '#1AA3C0'); g.addColorStop(1, '#13328A'); ctx.fillStyle = g; rr(ctx, 460, y - 14, Math.max(26, 560 * pct), 26, 13); ctx.fill();
      tb(ctx, String(it.target ?? ''), 1050, y + 10, { size: 30, w: 900, color: '#1597B5', maxW: 170, max: 1 });
    });
    ctx.globalAlpha = 1;
  },
  timeline(ctx, s, lt, sb) {
    bgLight(ctx, lt); tag(ctx, sb); heading(ctx, s, lt);
    const ms = arr(s.milestones).slice(0, 5), n = ms.length || 1, x0 = 150, x1 = FW - 150, y = 390, gap = n > 1 ? (x1 - x0) / (n - 1) : 0;
    ctx.strokeStyle = '#1597B5'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(x0 - 40, y); ctx.lineTo(x0 - 40 + (x1 - x0 + 80) * ease((lt - 0.3) / 1.4), y); ctx.stroke();
    ms.forEach((m, k) => {
      const x = n > 1 ? x0 + k * gap : FW / 2, a = ap(lt, 0.5 + k * 0.45); ctx.globalAlpha = a;
      ctx.fillStyle = '#0A1E5E'; ctx.beginPath(); ctx.arc(x, y, 16, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 4; ctx.stroke();
      tb(ctx, m.when || '', x, y - 40, { size: 30, w: 900, color: '#1597B5', align: 'center', maxW: 240, max: 1 });
      tb(ctx, m.what || '', x, y + 62, { size: 26, w: 700, color: '#1B2A4E', align: 'center', maxW: Math.min(240, gap - 16 || 400), max: 2 });
    });
    ctx.globalAlpha = 1;
  },
  closing(ctx, s, lt, sb, o) {
    ctx.fillStyle = '#061444'; ctx.fillRect(0, 0, FW, FH);
    const f = IM.fan;
    if (o.km && f) { const h = FH, w = h * f.width / f.height, x0 = -20 + (1 - ap(lt, 0, 3)) * 20, xe = x0 + w; ctx.save(); ctx.globalAlpha = ap(lt, 0, 1.2); ctx.drawImage(f, x0, 0, w, h); ctx.restore(); const g = ctx.createLinearGradient(xe - 300, 0, xe - 4, 0); g.addColorStop(0, 'rgba(6,20,68,0)'); g.addColorStop(1, 'rgba(6,20,68,1)'); ctx.fillStyle = g; ctx.fillRect(xe - 300, 0, 300, FH); ctx.fillStyle = '#061444'; ctx.fillRect(xe - 4, 0, FW, FH); }
    else sweeps(ctx, lt, 0.18);
    const X = o.km ? 700 : 72, W = o.km ? 520 : 1100;
    ctx.globalAlpha = ap(lt, 0.5); ctx.fillStyle = '#33C6EA'; ctx.fillRect(X, 230, 64, 5);
    const h = tb(ctx, s.heading || '', X, 310, { size: 56, w: 900, color: '#FFFFFF', maxW: W, max: 3, lh: 1.2 });
    ctx.globalAlpha = ap(lt, 1); tb(ctx, s.sub || '', X, 310 + h + 14, { size: 28, w: 500, color: '#9EDDF0', maxW: W, max: 2 });
    ctx.globalAlpha = ap(lt, 1.5); ctx.font = fnt(900, 30); ctx.textAlign = 'left';
    const g2 = ctx.createLinearGradient(X, 0, X + 220, 0); g2.addColorStop(0, '#33C6EA'); g2.addColorStop(1, '#9EDDF0'); ctx.fillStyle = g2; ctx.fillText('Kongming', X, 600);
    ctx.font = fnt(500, 20); ctx.fillStyle = '#B9C6EA'; ctx.fillText(cfg.org, X, 636);
    ctx.globalAlpha = 1;
  },
};
function subChunks(text) {
  const parts = String(text || '').split(/(?<=[，。！？；、,.!?;])/).map(x => x.trim()).filter(Boolean);
  const out = []; let cur = '';
  for (const p of parts) { if ((cur + p).length > 24 && cur) { out.push(cur); cur = p; } else cur += p; }
  if (cur) out.push(cur);
  return out.flatMap(c => c.length > 30 ? c.match(/[\s\S]{1,26}/g) : [c]);
}
function drawSub(ctx, s, lt) {
  const ch = subChunks(s.narration); if (!ch.length) return;
  const tot = ch.reduce((n, c) => n + c.length, 0), span = Math.max(1, s.seconds - 0.4);
  let acc = 0, cur = ch[ch.length - 1];
  for (const c of ch) { acc += c.length; if (lt < (acc / tot) * span + 0.2) { cur = c; break; } }
  ctx.font = fnt(500, 28); const w = Math.min(FW - 120, ctx.measureText(cur).width + 56);
  ctx.fillStyle = 'rgba(4,12,40,.72)'; rr(ctx, (FW - w) / 2, FH - 92, w, 54, 12); ctx.fill();
  ctx.fillStyle = '#FFFFFF'; ctx.textAlign = 'center'; ctx.fillText(cur, FW / 2, FH - 55);
}
export const filmPlan = sb => { let t = 0; return sb.scenes.map(s => { const st = t; t += s.seconds; return { s, start: st, end: t }; }); };
export const filmTotal = sb => sb.scenes.reduce((n, s) => n + s.seconds, 0);

function makeDrawer() {
  const offA = createCanvas(FW, FH), offB = createCanvas(FW, FH);
  const A = offA.getContext('2d'), B = offB.getContext('2d');
  const drawScene = (ctx, s, lt, sb, o) => { ctx.save(); ctx.globalAlpha = 1; ctx.clearRect(0, 0, FW, FH); try { (SCENE[s.type] || SCENE.problem)(ctx, s, lt, sb, o); } catch (e) {} ctx.restore(); };
  return (ctx, sb, plan, t, o) => {
    let i = plan.findIndex(p => t < p.end); if (i < 0) i = plan.length - 1;
    const P = plan[i], lt = t - P.start, XF = 0.6;
    drawScene(A, P.s, lt, sb, o); ctx.drawImage(offA, 0, 0);
    if (i > 0 && lt < XF) { const Q = plan[i - 1]; drawScene(B, Q.s, Q.s.seconds, sb, o); ctx.save(); ctx.globalAlpha = 1 - ease(lt / XF); ctx.drawImage(offB, 0, 0); ctx.restore(); }
    const total = plan[plan.length - 1].end;
    if (t < 0.5) { ctx.fillStyle = `rgba(4,10,30,${1 - t / 0.5})`; ctx.fillRect(0, 0, FW, FH); }
    if (o.subs) drawSub(ctx, P.s, lt);
    if (t > total - 0.9) { ctx.fillStyle = `rgba(4,10,30,${clamp((t - (total - 0.9)) / 0.9)})`; ctx.fillRect(0, 0, FW, FH); }
  };
}

/* ---------- music (synthesized pad + arpeggio) ---------- */
function musicWav(total, sr = 44100) {
  const n = Math.ceil(total * sr), L = new Float32Array(n);
  const CH = [[261.63, 329.63, 392.0, 493.88], [220.0, 261.63, 329.63, 392.0], [174.61, 220.0, 261.63, 329.63], [196.0, 246.94, 293.66, 392.0]];
  const bar = 4, TAU = Math.PI * 2;
  const tri = x => 2 / Math.PI * Math.asin(Math.sin(x));
  for (let b = 0; b * bar < total; b++) {
    const ch = CH[b % 4], t0 = b * bar;
    ch.forEach((f, k) => {
      const ff = k ? f : f / 2, amp = k ? 0.05 : 0.075, s0 = Math.floor(t0 * sr), s1 = Math.min(n, Math.floor((t0 + bar + 0.6) * sr));
      for (let i = s0; i < s1; i++) { const t = i / sr - t0; const env = t < 0.9 ? t / 0.9 : Math.max(0, 1 - (t - 0.9) / (bar - 0.3)); L[i] += amp * env * (k ? Math.sin(TAU * ff * t) : tri(TAU * ff * t)); }
    });
    for (let s = 0; s < 8; s++) {
      const at = t0 + s * bar / 8; if (at > total - 0.5) break;
      const f = ch[(s * 3) % 4] * 2, s0 = Math.floor(at * sr), s1 = Math.min(n, s0 + Math.floor(0.45 * sr));
      for (let i = s0; i < s1; i++) { const t = (i - s0) / sr; const env = t < 0.02 ? t / 0.02 : Math.exp(-(t - 0.02) * 9); L[i] += 0.03 * env * tri(TAU * f * t); }
    }
  }
  const fadeIn = 2.2 * sr, fadeOut = 2.6 * sr;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) { let g = 1; if (i < fadeIn) g = i / fadeIn; if (i > n - fadeOut) g = Math.min(g, (n - i) / fadeOut); const v = Math.max(-1, Math.min(1, L[i] * g * 1.6)); buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2); }
  return buf;
}

/** 分鏡 → MP4 Buffer */
export async function renderFilm(sb, { fps = cfg.videoFps, km = true, subs = true, music = true, crf = 27, onProgress, signal } = {}) {
  await filmInit();
  const plan = filmPlan(sb), total = filmTotal(sb), frames = Math.ceil(total * fps);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'km-film-'));
  const out = path.join(tmp, 'film.mp4'), wav = path.join(tmp, 'music.wav');
  if (music) fs.writeFileSync(wav, musicWav(total));
  const args = ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${FW}x${FH}`, '-r', String(fps), '-i', '-'];
  if (music) args.push('-i', wav);
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart');
  if (music) args.push('-c:a', 'aac', '-b:a', '128k', '-shortest');
  args.push(out);
  const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = ''; ff.stderr.on('data', d => { err += d; });
  const done = new Promise((res, rej) => { ff.on('error', e => rej(new Error('找不到 ffmpeg，請安裝後再試（Docker 版已內建）'))); ff.on('close', c => c === 0 ? res() : rej(new Error('ffmpeg 失敗：' + err.slice(0, 300)))); });
  const cv = createCanvas(FW, FH), ctx = cv.getContext('2d'), draw = makeDrawer(), o = { km, subs };
  let last = 0;
  try {
    for (let f = 0; f < frames; f++) {
      if (signal && signal.aborted) { ff.kill('SIGKILL'); throw new Error('已停止'); }
      draw(ctx, sb, plan, f / fps, o);
      if (!ff.stdin.write(cv.data())) await new Promise(r => ff.stdin.once('drain', r));
      if (onProgress && (f - last >= fps * 5)) { last = f; onProgress(f / frames); }
    }
    ff.stdin.end();
    await done;
    return fs.readFileSync(out);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

/** 單張預覽圖（PNG） */
export async function filmPoster(sb, t = 2.2) {
  await filmInit();
  const cv = createCanvas(FW, FH); makeDrawer()(cv.getContext('2d'), sb, filmPlan(sb), t, { km: true, subs: false });
  return cv.toBuffer('image/png');
}

export function storyboardMd(sb) {
  let t = 0;
  return [`# ${sb.title}`, '', `> ${sb.company || ''}${sb.program ? '・' + sb.program : ''}・孔明 Kongming 分鏡稿`, '', '| 時間 | 版型 | 畫面 | 旁白 |', '| --- | --- | --- | --- |',
    ...sb.scenes.map(s => { const a = t; t += s.seconds; const vis = [s.heading, s.sub, s.value && `${s.value} ${s.label || ''}`, arr(s.points).join('／'), arr(s.cards).map(c => c.title).join('／'), arr(s.steps).join(' → '), arr(s.items).map(i => `${i.name} ${i.target}`).join('／'), arr(s.milestones).map(m => `${m.when} ${m.what}`).join('／'), s.caption].filter(Boolean).join('；'); return `| ${fmtT(a)}–${fmtT(t)} | ${s.type} | ${String(vis).replace(/\|/g, '／')} | ${String(s.narration || '').replace(/\|/g, '／')} |`; })].join('\n');
}
