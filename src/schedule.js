// 孔明的工作節奏：每天早上提醒、拜訪前一天自動備好訪綱、截止日提醒、每週五週報
import fs from 'node:fs';
import path from 'node:path';
import { cfg } from './config.js';
import * as store from './store.js';
import * as LLM from './llm.js';
import { arr, cut, isoDay, local, daysLeft, md2, hhmm, logger } from './util.js';
import { STAGES, KZ, matchAll, missingFields, FBY } from './domain.js';
import { buildDocx } from './files/docs.js';
import { HDR, CTX } from './tasks.js';
import { subscribers } from './people.js';
import { killed, metricsText, healthText } from './governance.js';
import { todoReminders, followups } from './workflows.js';

const log = logger('schedule');
const stFile = () => path.join(cfg.dataDir, 'schedule.json');
const rd = () => { try { return JSON.parse(fs.readFileSync(stFile(), 'utf8')); } catch (e) { return {}; } };
const wr = o => { fs.mkdirSync(cfg.dataDir, { recursive: true }); fs.writeFileSync(stFile(), JSON.stringify(o)); };
const WD = '日一二三四五六';
const atOrAfter = (hm, l) => { const [h, m] = hm.split(':').map(Number); return l.H * 60 + l.M >= h * 60 + m; };
const weekday = () => new Date(new Date().toLocaleString('en-US', { timeZone: cfg.timezone })).getDay();

export function channelOfCase(caseId) {
  try { const all = JSON.parse(fs.readFileSync(path.join(cfg.dataDir, 'channels.json'), 'utf8')); return Object.entries(all).filter(([, v]) => v.caseId === caseId).map(([k]) => k); } catch (e) { return []; }
}
const activeCases = () => store.listCases().filter(c => !c.closedAt);
const when = n => n === 0 ? '今天' : n === 1 ? '明天' : `${n} 天後`;

/** 每日提醒內容（不呼叫模型，零成本） */
export function dailyBrief() {
  const days = cfg.remindDays, maxD = Math.max(...days, 0), L = [], prepNeeded = [];
  const visits = [], due = [], over = [], pend = [];
  for (const c of activeCases()) {
    const v = c.profile.visit, dv = daysLeft(v);
    if (v && dv != null && dv >= 0 && dv <= maxD) { visits.push({ c, dv }); if (dv <= 1 && !c.prep) prepNeeded.push(c); }
    for (const t of arr(c.todos).filter(t => !t.done && t.due)) { const d = daysLeft(t.due); if (d == null) continue; if (d < 0) over.push({ c, t, d }); else if (d <= maxD) due.push({ c, t, d }); }
    if (c.pending.length) pend.push(c);
  }
  // 科專截止：跟進行中案件相關的計畫
  const rel = new Map();
  for (const c of activeCases()) for (const r of matchAll(c).good.slice(0, 5)) for (const d of arr(r.p.deadlines)) { const n = daysLeft(d.date); if (d.kind === '截止' && n != null && n >= 0 && n <= 21) { const k = r.p.id + d.date; if (!rel.has(k)) rel.set(k, { p: r.p, d, n, cases: [] }); rel.get(k).cases.push(c.name); } }
  const l = local();
  L.push(`**孔明的今日提醒｜${l.m}/${l.d}（${WD[weekday()]}）**`);
  if (visits.length) L.push('', '**近期拜訪**', ...visits.sort((a, b) => a.dv - b.dv).map(({ c, dv }) => `• ${when(dv)}：${c.name}${c.profile.contact ? `（${c.profile.contact}）` : ''}${c.prep ? '　訪綱已備' : dv <= 1 ? '　我現在先備訪綱' : '　尚無訪綱'}${missingFields(c).length ? `　缺 ${missingFields(c).length} 項資料` : ''}`));
  if (over.length) L.push('', '**已逾期的待辦**', ...over.slice(0, 10).map(({ c, t, d }) => `• ${c.name}：${t.text}（${t.owner}，逾期 ${-d} 天）`));
  if (due.length) L.push('', '**快到期的待辦**', ...due.sort((a, b) => a.d - b.d).slice(0, 10).map(({ c, t, d }) => `• ${when(d)}：${c.name}｜${t.text}（${t.owner}）`));
  if (rel.size) L.push('', '**科專截止**', ...[...rel.values()].sort((a, b) => a.n - b.n).map(x => `• ${md2(x.d.date)}（剩 ${x.n} 天）${x.p.short || x.p.name}：${x.d.label}　相關案件：${[...new Set(x.cases)].slice(0, 3).join('、')}`));
  if (pend.length) L.push('', '**等你確認**', ...pend.map(c => `• ${c.name}：${c.pending.length} 項`));
  const empty = L.length === 1;
  if (empty) L.push('今天沒有需要特別注意的拜訪、待辦或截止日。');
  return { text: L.join('\n'), prepNeeded, empty };
}

/** 週報（用模型摘要，一週一次） */
export async function weeklyReport() {
  const since = Date.now() - 7 * 86400000, rows = [];
  for (const c of store.listCases()) {
    const logs = arr(c.log).filter(l => Date.parse(l.at) >= since);
    if (!logs.length && !c.todos.some(t => !t.done)) continue;
    rows.push(`【${c.name}｜${STAGES[c.stage]}】本週：${logs.map(l => `${l.title}${l.by ? `（${l.by}）` : ''}：${cut(l.result, 40)}`).join('；') || '無'}｜未完成待辦：${c.todos.filter(t => !t.done).slice(0, 6).map(t => `${t.text}（${t.owner}${t.due ? '，' + t.due : ''}）`).join('；') || '無'}｜待確認 ${c.pending.length} 項｜產出：${arr(c.outputs).filter(o => Date.parse(o.createdAt) >= since).map(o => `${o.title}（${o.status}）`).join('、') || '無'}`);
  }
  if (!rows.length) return null;
  const r = await LLM.json({ label: 'weekly', tier: 'fast', maxTokens: 4000, system: HDR(), messages: [{ role: 'user', content: `請寫本週的顧問團隊案件週報，給主管看。\n\n${rows.join('\n')}\n\n只回覆 JSON：{"headline":"一句話總結本週","cases":[{"name":"案件","progress":"本週進度 40 字內","next":"下週重點 30 字內","risk":"風險或卡關，沒有就空字串"}],"asks":["需要主管協助或決定的事"],"kongming":"孔明本週協作了哪些工作（一句話）"}\n規則：只根據上方資料；繁體中文。` }] });
  const l = local();
  const text = [`**孔明週報｜${l.m}/${l.d}**`, r.headline || '', '', ...arr(r.cases).map(x => `**${x.name}**　${x.progress}\n　下週：${x.next}${x.risk ? `\n　⚠️ ${x.risk}` : ''}`), arr(r.asks).length ? `\n**需要主管協助**\n${arr(r.asks).map(a => `• ${a}`).join('\n')}` : '', r.kongming ? `\n-# ${r.kongming}` : ''].join('\n');
  const doc = await buildDocx(`案件週報 ${isoDay()}`, [{ p: r.headline || '' }, { table: { headers: ['案件', '本週進度', '下週重點', '風險'], rows: arr(r.cases).map(x => [x.name, x.progress, x.next, x.risk || '']) } }, ...(arr(r.asks).length ? [{ h: '需要主管協助' }, { ul: r.asks }] : []), ...(r.kongming ? [{ p: r.kongming, muted: true }] : [])]);
  return { text, file: { name: `案件週報_${isoDay()}.docx`, buffer: doc } };
}

CTX.brief = () => dailyBrief();

/** 每分鐘檢查一次；getIO(channelId) 由 Discord 介面提供，runPrep(caseId, io) 由大腦提供 */
export function startSchedule({ getIO, runPrep, runScout, getDM }) {
  if (!cfg.briefChannel) { log.warn('未設定 KM_BRIEF_CHANNEL：不會發每日提醒與週報（拜訪前自動備訪綱仍會執行，發在案件所在頻道）。'); }
  const tick = async () => {
    try {
      if (killed()) return;
      { const S0 = rd(), l0 = local(), d0 = isoDay(); if (cfg.adminChannel && S0.health !== d0 && atOrAfter(cfg.healthTime, l0)) { S0.health = d0; wr(S0); const io = await getIO(cfg.adminChannel); if (io) await io.post({ content: healthText() }); } }
      const S = rd(), l = local(), day = isoDay(), wd = weekday();
      const workday = !cfg.workdaysOnly || (wd >= 1 && wd <= 5);
      if (workday && S.brief !== day && atOrAfter(cfg.briefTime, l)) {
        S.brief = day; wr(S);
        const b = dailyBrief();
        if (cfg.briefChannel && !b.empty) { const io = await getIO(cfg.briefChannel); if (io) await io.post({ content: b.text }); }
        for (const c of b.prepNeeded) {
          const ch = channelOfCase(c.id)[0] || cfg.briefChannel; if (!ch) continue;
          const io = await getIO(ch); if (!io) continue;
          await io.post({ content: `${c.name} 的拜訪快到了，還沒有訪綱，我先準備好。` });
          await runPrep(c.id, io);
        }
        log.info(`每日提醒已發（拜訪 ${b.prepNeeded.length} 件自動備訪綱）`);
      }
      if (workday && S.todo !== day && atOrAfter(cfg.briefTime, l)) {
        S.todo = day; wr(S);
        if (cfg.todoDM && getDM) for (const r of todoReminders()) { const io = await getDM(r.id).catch(() => null); if (io) await io.post({ content: r.text }).catch(() => {}); }
        for (const f of followups()) { let io = getDM ? await getDM(f.id).catch(() => null) : null; let pre = ''; if (!io && cfg.scoutChannel) { io = await getIO(cfg.scoutChannel); pre = `<@${f.id}> `; } if (io) await io.post({ content: pre + f.text, buttons: f.buttons, mentions: pre ? [f.id] : undefined }).catch(() => {}); }
      }
      if (runScout && cfg.scoutChannel && cfg.scoutWhen !== 'off' && workday && S.scout !== day && atOrAfter(cfg.scoutTime, l)) {
        S.scout = day; wr(S);
        const busy = activeCases().some(c => { const n = daysLeft(c.profile.visit); return n != null && n >= 0 && n <= 3; });
        if (cfg.scoutWhen === 'daily' || !busy) {
          const subs = subscribers().slice(0, cfg.scoutMaxUsers);
          if (subs.length) {
            // 每位訂閱的顧問各一篇專屬推薦，依序產生（避免同時大量呼叫模型）
            (async () => { for (const u of subs) { try {
              const busyU = activeCases().some(c => { const n = daysLeft(c.profile.visit); return n != null && n >= 0 && n <= 3 && arr(c.log).some(l => l.by === u.name); });
              if (busyU && cfg.scoutWhen !== 'daily') continue;
              let io = u.deliver === 'channel' ? null : (getDM ? await getDM(u.id) : null);
              if (!io) { io = await getIO(cfg.scoutChannel); if (io) await io.post({ content: `<@${u.id}> 這是今天給你的商機推薦：`, mentions: [u.id] }); }
              if (io) await runScout(io, { id: u.id, name: u.name });
            } catch (e) { log.error('scout', u.name, e.message); } } })();
            log.info(`寫每日商機專欄：${subs.length} 位顧問`);
          } else { const io = await getIO(cfg.scoutChannel); if (io) { log.info('寫每日商機專欄（團隊）'); runScout(io).catch(e => log.error('scout', e.message)); } }
        }
        else log.info('近 3 天有拜訪，今天不寫商機專欄');
      }
      if (cfg.briefChannel && wd === cfg.weeklyDay && S.weekly !== day && atOrAfter(cfg.weeklyTime, l)) {
        S.weekly = day; wr(S);
        const w = await weeklyReport();
        if (w) { const io = await getIO(cfg.briefChannel); if (io) { await io.post({ content: w.text, files: [w.file] }); await io.post({ content: metricsText(7) }); } log.info('週報已發'); }
      }
    } catch (e) { log.error('tick', e.message); }
  };
  setTimeout(tick, 15000);
  setInterval(tick, 60000).unref();
}
