import fs from 'node:fs';
import path from 'node:path';
import { cfg } from './config.js';
import { uid, nowISO } from './util.js';

const file = () => path.join(cfg.dataDir, 'work-items.json');
const read = () => { try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return []; } };
function write(items) { fs.mkdirSync(cfg.dataDir, { recursive: true }); const active = items.filter(j => ['queued', 'running'].includes(j.status)), recent = items.filter(j => !['queued', 'running'].includes(j.status)).slice(-100); const tmp = file() + '.tmp'; fs.writeFileSync(tmp, JSON.stringify([...active, ...recent], null, 1)); fs.renameSync(tmp, file()); }
export function deleteUserWork(userId) { write(read().filter(j => j.userId !== userId)); }
export function createWork(item) { const job = { ...item, id: 'w' + uid(8), status: 'queued', at: nowISO(), updatedAt: nowISO() }; const items = read(); items.push(job); write(items); return job; }
export function updateWork(id, patch) { const items = read(), job = items.find(j => j.id === id); if (!job) return null; Object.assign(job, patch, { updatedAt: nowISO() }); write(items); return job; }
export const findWork = id => read().find(j => j.id === id);
export const listWork = (guildId, userId, admin) => read().filter(j => j.guildId === (guildId || null) && (admin || j.userId === userId)).sort((a, b) => Number(['queued', 'running'].includes(b.status)) - Number(['queued', 'running'].includes(a.status)) || b.at.localeCompare(a.at));
export function interruptWork() { const items = read(); for (const j of items) if (['queued', 'running'].includes(j.status)) { j.status = 'interrupted'; j.updatedAt = nowISO(); } write(items); }

export function recordChange(c, field, from, to, source, by = '') {
  c.changes ??= [];
  const change = { id: uid(8), field, from: from === undefined ? null : structuredClone(from), to: structuredClone(to), source, by, at: nowISO() };
  c.changes.push(change); c.changes = c.changes.slice(-100); return change;
}
export function undoChange(c, id, by) {
  const change = (c.changes || []).find(x => x.id === id);
  if (!change || change.undoneAt) return '這筆修改不存在或已復原。';
  if (JSON.stringify(c.profile[change.field]) !== JSON.stringify(change.to)) return '這個欄位已有後續修改，請先復原較新的修改。';
  recordChange(c, change.field, c.profile[change.field], change.from, '復原 ' + id, by);
  c.profile[change.field] = structuredClone(change.from); c.src[change.field] = `復原修改（${by}）`;
  if (change.field === 'name') c.name = change.from || '新案件';
  change.undoneAt = nowISO(); change.undoneBy = by;
  return '已復原這筆修改；復原操作也已留下紀錄。';
}
