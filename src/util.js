// 共用小工具
import { cfg } from './config.js';

export const arr = v => Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]);
export const cut = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + '…' : s; };
export const pad = n => String(n).padStart(2, '0');
export const nowISO = () => new Date().toISOString();
export const uid = (n = 8) => Math.random().toString(36).slice(2, 2 + n) + Math.random().toString(36).slice(2, 4);
export const clone = o => JSON.parse(JSON.stringify(o ?? null));
export const isEmpty = v => v == null || v === '' || (Array.isArray(v) && !v.length);
export const num = v => { if (v == null || v === '' || typeof v === 'boolean') return null; const n = parseFloat(String(v).replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
export const wan = n => (n == null || n === '' || isNaN(n)) ? null : Number(n).toLocaleString('zh-TW');
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const safeName = s => String(s || '').replace(/[\\/:*?"<>|（）()]/g, '').replace(/虛構範例/g, '').replace(/\s+/g, '').slice(0, 40) || '案件';

// 台北時間
export function local(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: cfg.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const g = t => (p.find(x => x.type === t) || {}).value;
  return { y: +g('year'), m: +g('month'), d: +g('day'), H: +(g('hour') === '24' ? 0 : g('hour')), M: +g('minute') };
}
export const isoDay = (d = new Date()) => { const l = local(d); return `${l.y}-${pad(l.m)}-${pad(l.d)}`; };
export const hhmm = iso => { const d = new Date(iso); if (isNaN(d)) return ''; const l = local(d); return `${l.m}/${l.d} ${pad(l.H)}:${pad(l.M)}`; };
export const md2 = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? `${+m[2]}/${+m[3]}` : ''; };
export const parseD = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; };
export const todayD = () => parseD(isoDay());
export const daysLeft = s => { const d = parseD(s); return d ? Math.round((d - todayD()) / 86400000) : null; };

// 寬鬆解析模型回覆的 JSON
export function parseJsonLoose(t) {
  t = String(t || '').trim();
  try { return JSON.parse(t); } catch (e) {}
  const f = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (f) { try { return JSON.parse(f[1]); } catch (e) {} }
  const a = Math.min(...['{', '['].map(c => { const i = t.indexOf(c); return i < 0 ? Infinity : i; }));
  const b = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (a !== Infinity && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) {} }
  return undefined;
}

export class KmError extends Error { constructor(msg) { super(msg); this.km = true; } }

export function logger(scope) {
  const f = (lvl, a) => console[lvl](`[${new Date().toISOString()}] [${scope}]`, ...a);
  return { info: (...a) => f('log', a), warn: (...a) => f('warn', a), error: (...a) => f('error', a) };
}
