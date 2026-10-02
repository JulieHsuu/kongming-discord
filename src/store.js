// 簡單、可靠的 JSON 檔案儲存：案件、頻道狀態、對話紀錄。全部存在 data/ 底下。
import fs from 'node:fs';
import path from 'node:path';
import { cfg } from './config.js';
import { clone, nowISO, uid } from './util.js';

const dir = (...p) => { const d = path.join(cfg.dataDir, ...p); fs.mkdirSync(d, { recursive: true }); return d; };
function readJson(file, dflt) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return clone(dflt); } }
function writeJson(file, obj) { const tmp = file + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(obj, null, 1)); fs.renameSync(tmp, file); }

/* ---------- cases ---------- */
const caseFile = id => path.join(dir('cases'), `${id}.json`);
export function blankCase(name) {
  return {
    id: 'c' + Date.now().toString(36) + uid(3), name: name || '新案件', createdAt: nowISO(), updatedAt: nowISO(), stage: 0, guildId: null,
    profile: { name: name && name !== '新案件' ? name : '', county: '', industry: '', product: '', capital: null, employees: null, founded: null, budget: null, contact: '', visit: '', needs: [], factory: null, tariff: null, desc: '' },
    src: {}, facts: [], pending: [], todos: [], log: [], prep: null, ingests: [], interviews: [], analysis: null, poc: null, status: null, outputs: [], lastTask: {},
  };
}
export function getCase(id) { if (!id) return null; const c = readJson(caseFile(id), null); return c && c.id ? c : null; }
export function saveCase(c) {
  c.updatedAt = nowISO();
  c.log = (c.log || []).slice(-300); c.facts = (c.facts || []).slice(-120); c.todos = (c.todos || []).slice(-120);
  c.interviews = (c.interviews || []).slice(0, 10); c.ingests = (c.ingests || []).slice(0, 20); c.outputs = (c.outputs || []).slice(0, 80);
  writeJson(caseFile(c.id), c); return c;
}
export function listCases(guildId) {
  return fs.readdirSync(dir('cases')).filter(f => f.endsWith('.json')).map(f => readJson(path.join(dir('cases'), f), null)).filter(c => c && c.id && (!guildId || !c.guildId || c.guildId === guildId))
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}
export function createCase(name, guildId, profile) {
  const c = blankCase(name); c.guildId = guildId || null;
  if (profile) Object.assign(c.profile, clone(profile));
  if (c.profile.name) c.name = c.profile.name;
  return saveCase(c);
}

/* ---------- channels ---------- */
const chanFile = () => path.join(dir(), 'channels.json');
let chans = null;
const allChans = () => (chans ??= readJson(chanFile(), {}));
export function getChannel(id) { const a = allChans(); return (a[id] ??= { mode: null, caseId: null, lastObservedAt: null, lastObservedMsg: null, cooldownUntil: null, proactive: {} }); }
export function saveChannels() { writeJson(chanFile(), allChans()); }

/* ---------- transcripts (what the group said) ---------- */
const trFile = id => path.join(dir('transcripts'), `${id}.json`);
const trCache = new Map();
export function transcript(id) { if (!trCache.has(id)) trCache.set(id, readJson(trFile(id), [])); return trCache.get(id); }
export function appendTranscript(id, m) {
  const t = transcript(id); t.push(m); if (t.length > 300) t.splice(0, t.length - 300);
  clearTimeout(appendTranscript.timers?.[id]); (appendTranscript.timers ??= {})[id] = setTimeout(() => writeJson(trFile(id), t), 1500);
}

/* ---------- output files ---------- */
export function saveOutputFile(caseId, name, buffer) {
  const key = uid(16);
  const d = dir('files', key);
  const p = path.join(d, name);
  fs.writeFileSync(p, buffer);
  return { key, name, path: p, size: buffer.length };
}
export function filePath(key, name) {
  if (!/^[a-z0-9]{10,24}$/.test(key) || name.includes('/') || name.includes('..')) return null;
  const p = path.join(cfg.dataDir, 'files', key, name);
  return fs.existsSync(p) ? p : null;
}

/* ---------- daily counters ---------- */
export function bumpDaily(key, day) {
  const f = path.join(dir(), 'counters.json'); const c = readJson(f, {});
  if (c.day !== day) { c.day = day; c.n = {}; }
  c.n[key] = (c.n[key] || 0) + 1; writeJson(f, c); return c.n[key];
}
export function getDaily(key, day) { const c = readJson(path.join(dir(), 'counters.json'), {}); return c.day === day ? (c.n[key] || 0) : 0; }
