// 治理：回應院方委員的意見
// 撞客戶檢查、全院緊急停止、用量與預算、成效指標、推薦多樣性、四眼原則、機密案件、利益迴避
import fs from 'node:fs';
import path from 'node:path';
import { cfg } from './config.js';
import * as store from './store.js';
import { arr, cut, nowISO, isoDay, logger } from './util.js';
import { sameName } from './domain.js';

const log = logger('gov');
const P = f => path.join(cfg.dataDir, f);
const rd = (f, d) => { try { return JSON.parse(fs.readFileSync(P(f), 'utf8')); } catch (e) { return d; } };
const wr = (f, o) => { fs.mkdirSync(cfg.dataDir, { recursive: true }); fs.writeFileSync(P(f), JSON.stringify(o, null, 1)); };
const month = () => isoDay().slice(0, 7);

/* ============ 1. 全院緊急停止（執行長） ============ */
export function killState() { const k = rd('kill.json', { on: false }); if (cfg.killEnv) return { on: true, by: '環境變數 KM_KILL', at: '' }; return k; }
export const killed = () => killState().on;
export function setKill(on, by, reason = '') { const k = { on, by, reason, at: nowISO() }; wr('kill.json', k); log.warn(on ? `緊急停止（${by}）${reason}` : `解除緊急停止（${by}）`); return k; }

/* ============ 2. 院內客戶名冊與撞客戶檢查（資深顧問） ============ */
// state/clients.csv：企業名稱,統一編號,負責單位,負責人,狀態,關係（例如「委辦主管機關」）,備註 ── 可從院內 CRM 匯出
export function registry() {
  const out = [];
  const csv = P('clients.csv');
  if (fs.existsSync(csv)) {
    const lines = fs.readFileSync(csv, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
    const head = lines.shift().split(',').map(s => s.trim());
    const ix = k => head.findIndex(h => h.includes(k));
    const [n, tax, unit, owner, st, rel, note] = ['名稱', '統編', '單位', '負責人', '狀態', '關係', '備註'].map(ix);
    for (const l of lines) { const c = l.split(','); if (!c[n]) continue; out.push({ name: c[n].trim(), taxId: tax >= 0 ? (c[tax] || '').trim() : '', unit: unit >= 0 ? (c[unit] || '').trim() : '', owner: owner >= 0 ? (c[owner] || '').trim() : '', status: st >= 0 ? (c[st] || '').trim() : '', relation: rel >= 0 ? (c[rel] || '').trim() : '', note: note >= 0 ? (c[note] || '').trim() : '', source: '院內客戶名冊' }); }
  }
  return out;
}
/** 這個名字院內有沒有人在跑？（院內名冊＋孔明裡其他同事的案件） */
export function conflicts(name, { exceptCaseId = null, byName = '' } = {}) {
  if (!name) return [];
  const hits = registry().filter(r => sameName(r.name, name)).map(r => ({ ...r, kind: 'registry' }));
  for (const c of store.listCases()) {
    if (c.id === exceptCaseId || c.closedAt) continue;
    if (!sameName(c.name, name) && !sameName(c.profile.name, name)) continue;
    const owners = [...new Set(arr(c.log).map(l => l.by).filter(b => b && b !== '孔明主動'))].filter(b => b !== byName);
    if (owners.length || c.adoptedBy) hits.push({ name: c.name, unit: '孔明案件', owner: c.adoptedBy || owners.join('、'), status: c.stage != null ? ['訪前準備', '訪談進行', '訪後整理', '提案準備', '送件追蹤'][c.stage] : '', kind: 'case', caseId: c.id });
  }
  return hits;
}
export const conflictText = hs => hs.map(h => `${h.name}｜${h.unit || ''}${h.owner ? '・' + h.owner : ''}${h.status ? '・' + h.status : ''}${h.relation ? '・' + h.relation : ''}`).join('\n');
/** 給商機推薦：院內正在跑的客戶清單（不要推薦） */
export const busyNames = () => [...new Set([...registry().filter(r => !/結案|流失|停止/.test(r.status)).map(r => r.name), ...store.listCases().filter(c => !c.closedAt && (c.adoptedBy || arr(c.log).some(l => l.by && l.by !== '孔明主動'))).map(c => c.name)])];
/** 利益迴避：對象是不是院內委辦案的主管機關／合作單位 */
export const conflictOfInterest = name => registry().filter(r => sameName(r.name, name) && /委辦|主管機關|補助單位|審查/.test(r.relation + r.note));

/* ============ 3. 用量、成本與預算（VP） ============ */
// 單價請依合約填（每百萬 token 美元）；沒填就只記 token 數，不估金額
const price = tier => ({ in: Number(cfg.price[tier + 'In'] || cfg.price.in || 0), out: Number(cfg.price[tier + 'Out'] || cfg.price.out || 0) });
export function recordUsage({ label, tier, usage, userId }) {
  if (!usage) return;
  const inT = (usage.input_tokens ?? usage.prompt_tokens ?? 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0), outT = usage.output_tokens ?? usage.completion_tokens ?? 0;
  const p = price(tier || 'default'), usd = (inT * p.in + outT * p.out) / 1e6;
  const U = rd('usage.json', {}); const m = (U[month()] ??= { calls: 0, in: 0, out: 0, usd: 0, byLabel: {}, byUser: {}, days: {} });
  m.calls++; m.in += inT; m.out += outT; m.usd += usd;
  const L = (m.byLabel[label || 'call'] ??= { calls: 0, usd: 0, in: 0, out: 0 }); L.calls++; L.usd += usd; L.in += inT; L.out += outT;
  if (userId) { const u = (m.byUser[userId] ??= { calls: 0, usd: 0 }); u.calls++; u.usd += usd; }
  const d = isoDay(); m.days[d] = (m.days[d] || 0) + usd;
  wr('usage.json', U);
}
export function usageNow() { return (rd('usage.json', {})[month()]) || { calls: 0, in: 0, out: 0, usd: 0, byLabel: {}, byUser: {}, days: {} }; }
/** 預算檢查：level = ok | warn（80%）| stop（100%：只停高成本的主動工作） */
export function budget() {
  const b = cfg.monthlyBudgetUsd; if (!b) return { level: 'ok', used: usageNow().usd, budget: 0 };
  const used = usageNow().usd, r = used / b;
  return { level: r >= 1 ? 'stop' : r >= 0.8 ? 'warn' : 'ok', used, budget: b, ratio: r };
}
export const HEAVY = ['scout', 'demo', 'video', 'deck', 'proposal', 'research'];

/* ============ 4. 成效指標（VP、執行長） ============ */
export function metrics(days = 30) {
  const since = Date.now() - days * 86400000;
  const dir = P('audit'), ev = [];
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) { if (!f.endsWith('.jsonl')) continue; for (const l of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) { if (!l) continue; try { const e = JSON.parse(l); if (Date.parse(e.at) >= since) ev.push(e); } catch (e) {} } }
  const users = new Set(ev.filter(e => e.event === 'ask').map(e => e.user));
  const tasks = {}, outputs = {}; let confirmed = 0, proactive = 0, done = 0, failed = 0, stageUp = 0;
  const cases = store.listCases();
  for (const c of cases) for (const l of arr(c.log)) {
    if (Date.parse(l.at) < since) continue;
    if (l.kind === 'confirm') { if (/確認：.*(簡報|Demo|短片|計畫書|試算|產出)/.test(l.title) || /對外使用/.test(l.result || '')) confirmed++; if (/案件階段/.test(l.title) || /→/.test(l.result || '') && /階段/.test(l.title)) stageUp++; continue; }
    if (!l.kind || ['edit', 'export', 'ingest'].includes(l.kind) && /從對話/.test(l.title)) continue;
    if (/^未完成/.test(l.result || '')) { failed++; continue; }
    done++; tasks[l.kind] = (tasks[l.kind] || 0) + 1; if (l.proactive) proactive++;
  }
  for (const c of cases) for (const o of arr(c.outputs)) if (Date.parse(o.createdAt) >= since) outputs[o.kind] = (outputs[o.kind] || 0) + 1;
  const H = rd('scout.json', { picks: [], feedback: [] });
  const picks = H.picks.filter(p => Date.parse(p.at) >= since), fb = H.feedback.filter(f => Date.parse(f.at) >= since);
  const adopted = fb.filter(f => f.verdict === '採用').length, rejected = fb.filter(f => f.verdict === '不適合').length;
  const mins = Object.entries(tasks).reduce((s, [k, n]) => s + n * (cfg.minutesSaved[k] || 0), 0);
  const newCases = cases.filter(c => Date.parse(c.createdAt) >= since).length;
  const kz = cases.filter(c => arr(c.outputs).some(o => o.kind === 'proposal' && Date.parse(o.createdAt) >= since)).length;
  return { days, users: users.size, asks: ev.filter(e => e.event === 'ask').length, outOfScope: ev.filter(e => e.event === 'out_of_scope').length, denied: ev.filter(e => e.event === 'denied').length, tasks, done, failed, proactive, outputs, confirmed, picks: picks.length, adopted, rejected, newCases, kzDrafts: kz, minutesSaved: mins, usage: usageNow(), budget: budget() };
}
const KN = { prep: '訪綱', ingest: '建檔', debrief: '訪談紀錄', status: '狀態', match: '科專媒合', poc: 'POC', deck: '簡報', demo: 'Demo', video: '短片', proposal: '計畫書', research: '研究', roi: '試算', closeout: '結案', scout: '商機' };
export function metricsText(days = 30) {
  const m = metrics(days), u = m.usage, b = m.budget;
  return [`**孔明成效（近 ${days} 天）**`,
    `使用人數 ${m.users} 人・交辦 ${m.asks} 次・完成工作 ${m.done} 項（其中主動 ${m.proactive} 項）・失敗 ${m.failed} 項`,
    `工作分布：${Object.entries(m.tasks).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${KN[k] || k} ${n}`).join('、') || '—'}`,
    `對外產出：${Object.entries(m.outputs).map(([k, n]) => `${KN[k] || k} ${n}`).join('、') || '—'}；經顧問確認可對外使用 ${m.confirmed} 份`,
    `商機推薦 ${m.picks} 篇・採用 ${m.adopted}・不適合 ${m.rejected}${m.picks ? `（採用率 ${Math.round(m.adopted / m.picks * 100)}%）` : ''}`,
    `新案件 ${m.newCases} 件・產出科專計畫書草稿的案件 ${m.kzDrafts} 件`,
    `估計節省 ${(m.minutesSaved / 60).toFixed(1)} 小時（依 KM_MINUTES_SAVED 的每項工作分鐘數估算，請依實測校正）`,
    `本月模型用量：${u.calls} 次呼叫、${((u.in + u.out) / 1e6).toFixed(2)}M tokens${u.usd ? `、約 US$${u.usd.toFixed(2)}` : '（未設定單價，不估金額）'}${b.budget ? `｜預算 US$${b.budget}，已用 ${Math.round((b.ratio || 0) * 100)}%` : ''}`,
    `婉拒範圍外要求 ${m.outOfScope} 次・擋下無權限使用 ${m.denied} 次`].join('\n');
}

/* ============ 5. 推薦多樣性（執行長：偏見） ============ */
export function scoutDistribution(days = 30) {
  const since = Date.now() - days * 86400000, H = rd('scout.json', { picks: [] });
  const by = { region: {}, type: {}, size: {} };
  for (const p of H.picks.filter(x => Date.parse(x.at) >= since)) {
    const c = store.getCase(p.caseId); if (!c) continue;
    const reg = /臺北|新北|基隆|桃園|新竹|宜蘭/.test(c.profile.county || '') ? '北部' : /臺中|苗栗|彰化|南投|雲林/.test(c.profile.county || '') ? '中部' : /嘉義|臺南|高雄|屏東|澎湖/.test(c.profile.county || '') ? '南部' : /花蓮|臺東|金門|連江/.test(c.profile.county || '') ? '東部離島' : '未知';
    const size = p.type === 'agency' ? '單位' : (c.profile.employees != null && c.profile.employees < 50) || (c.profile.capital != null && c.profile.capital < 3000) ? '小型' : (c.profile.employees == null && c.profile.capital == null) ? '未知' : '中大型';
    by.region[reg] = (by.region[reg] || 0) + 1; by.type[p.type === 'agency' ? '單位' : '企業'] = (by.type[p.type === 'agency' ? '單位' : '企業'] || 0) + 1; by.size[size] = (by.size[size] || 0) + 1;
  }
  return by;
}
export function diversityHint() {
  if (!cfg.scoutDiversity) return '';
  const d = scoutDistribution(30), fmt = o => Object.entries(o).map(([k, n]) => `${k} ${n}`).join('、') || '尚無';
  return `【近 30 天推薦分布】地區：${fmt(d.region)}；規模：${fmt(d.size)}；類型：${fmt(d.type)}。\n請刻意平衡：優先補足推薦較少的地區（中南部、東部與離島）與小型企業；網路資料少的小企業也值得推，資料不足處標「待查證」即可。`;
}

/* ============ 6. 7/24 維運：工作清單、告警、健康狀態（資訊處、維運） ============ */
const START = Date.now();
let alertFn = null; export function onAlert(fn) { alertFn = fn; }
const errs = [];
export function alert(msg, detail = '') {
  errs.push({ at: nowISO(), msg: cut(msg, 200), detail: cut(detail, 300) }); if (errs.length > 200) errs.shift();
  log.error('ALERT', msg, detail);
  try { alertFn && alertFn(`🚨 **孔明告警**：${msg}${detail ? `\n\`\`\`${cut(detail, 400)}\`\`\`` : ''}`); } catch (e) {}
}
export function jobStart(j) { const J = rd('jobs.json', {}); J[j.id] = { ...j, at: nowISO() }; wr('jobs.json', J); }
export function jobEnd(id) { const J = rd('jobs.json', {}); if (J[id]) { delete J[id]; wr('jobs.json', J); } }
export function leftoverJobs() { const J = rd('jobs.json', {}); wr('jobs.json', {}); return Object.values(J); }
export function runningJobs() { return Object.values(rd('jobs.json', {})); }
export function health(extra = {}) {
  const up = (Date.now() - START) / 3600000, day = Date.now() - 86400000;
  const e24 = errs.filter(e => Date.parse(e.at) >= day);
  return { uptimeH: up, errors24h: e24.length, lastError: e24.slice(-1)[0] || null, running: runningJobs(), killed: killed(), budget: budget(), ...extra };
}
export function healthText(extra) {
  const h = health(extra);
  return [`**孔明狀況**`, `已連續運作 ${h.uptimeH < 48 ? h.uptimeH.toFixed(1) + ' 小時' : (h.uptimeH / 24).toFixed(1) + ' 天'}${h.killed ? '｜🛑 緊急停止中' : ''}`,
    `進行中的工作：${h.running.length ? h.running.map(j => `${j.title}（${j.caseName || ''}，${j.by || '主動'}）`).join('、') : '無'}${extra && extra.waiting ? `｜排隊中 ${extra.waiting}` : ''}`,
    `近 24 小時錯誤：${h.errors24h} 次${h.lastError ? `（最近：${h.lastError.at.slice(11, 16)} ${h.lastError.msg}）` : ''}`,
    `模型預算：${h.budget.budget ? `已用 ${Math.round((h.budget.ratio || 0) * 100)}%` : '未設上限'}`].join('\n');
}
