// 第 5–11 輪評審後加上的工作方式：
//   R5 主管：待辦指派、團隊看板、每日催辦      R6 品質：產出完成後自我查核
//   R7 法遵：第一次互動告知、本人查閱與刪除     R8 業務開發：開發信、商機推進、未聯繫提醒
//   R10 一致性：案件決議與時間軸、記得自己說過的話   R11 新人：導覽
import fs from 'node:fs';
import path from 'node:path';
import * as LLM from './llm.js';
import { cfg } from './config.js';
import * as store from './store.js';
import { arr, cut, nowISO, uid, isoDay, daysLeft, hhmm, KmError } from './util.js';
import { STAGES } from './domain.js';
import { TASKS, EXTRA, HDR, caseContext, dataSources } from './tasks.js';
import { person, allPeople, clearPerson, updatePerson } from './people.js';
import { prefsAll } from './tasks2.js';

const rd = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(cfg.dataDir, f), 'utf8')); } catch (e) { return d; } };
const wr = (f, o) => { fs.mkdirSync(cfg.dataDir, { recursive: true }); fs.writeFileSync(path.join(cfg.dataDir, f), JSON.stringify(o, null, 1)); };
const active = (guildId) => store.listCases(guildId).filter(c => !c.closedAt);
const shown = c => c.confidential ? '（機密案件）' : c.name;

/* ============ R5 待辦指派與團隊看板 ============ */
/** 把「請小明…」的名字對到認識的同事 */
export function resolveAssignee(name) {
  const n = String(name || '').replace(/^@/, '').trim(); if (!n || ['顧問', '孔明', '客戶'].includes(n)) return null;
  const P = allPeople(); const e = Object.entries(P);
  const hit = e.find(([, p]) => p.name === n) || e.find(([, p]) => p.name && (p.name.includes(n) || n.includes(p.name)));
  return hit ? { id: hit[0], name: hit[1].name } : { id: null, name: n };
}
export function myTodos(userId, userName) {
  const L = [];
  for (const c of active()) for (const t of arr(c.todos)) if (!t.done && (t.assigneeId === userId || (!t.assigneeId && t.assignee === userName) || (!t.assignee && t.owner === '顧問' && t.source === userName))) L.push({ c, t });
  return L.sort((a, b) => String(a.t.due || '9999').localeCompare(String(b.t.due || '9999')));
}
export function myTodosText(userId, userName) {
  const L = myTodos(userId, userName); if (!L.length) return '你目前沒有未完成的待辦。';
  return `**${userName} 的待辦（${L.length}）**\n` + L.slice(0, 20).map(({ c, t }) => { const d = daysLeft(t.due); return `\`${t.id}\` ${t.text}｜${c.name}${t.due ? `｜${t.due}${d != null && d < 0 ? `（逾期 ${-d} 天）` : d === 0 ? '（今天）' : ''}` : ''}${t.assignedBy ? `｜${t.assignedBy} 交辦` : ''}`; }).join('\n') + '\n-# 做完了：`/孔明 待辦 完成:代碼`（前面的灰色代碼），或直接跟我說「○○做完了」。';
}
export function completeTodo(userId, userName, key) {
  const L = myTodos(userId, userName), k = String(key || '').trim().replace(/`/g, ''); const x = L.find(y => y.t.id === k); if (!x) return null;
  const c = store.getCase(x.c.id), t = c.todos.find(y => y.id === x.t.id); if (!t) return null;
  t.done = true; t.doneAt = nowISO(); t.doneBy = userName; c.log.push({ at: nowISO(), kind: 'todo', title: `待辦完成：${t.text}`, result: `${userName} 完成`, by: userName }); store.saveCase(c); return t;
}
/** 依「○○做完了」的描述把案件裡相符的待辦打勾 */
export function completeByText(c, texts, by) {
  const done = [];
  for (const q of arr(texts).map(String).filter(x => x.length >= 2)) {
    const t = c.todos.find(y => !y.done && (y.text.includes(q) || q.includes(y.text) || overlap(y.text, q) >= 0.5));
    if (t) { t.done = true; t.doneAt = nowISO(); t.doneBy = by; done.push(t.text); }
  }
  return done;
}
const overlap = (a, b) => { const g = s => new Set([...String(s)].map((ch, i, A) => ch + (A[i + 1] || '')).slice(0, -1)); const A = g(a), B = g(b); let n = 0; for (const x of B) if (A.has(x)) n++; return B.size ? n / B.size : 0; };

export function teamBoard(guildId) {
  const P = allPeople(), since = Date.now() - 7 * 86400000, rows = [];
  const open = active(guildId).flatMap(c => arr(c.todos).filter(t => !t.done).map(t => ({ c, t })));
  for (const [id, p] of Object.entries(P)) {
    const mine = open.filter(({ t }) => t.assigneeId === id || (!t.assigneeId && (t.assignee === p.name || (!t.assignee && t.source === p.name && t.owner === '顧問'))));
    const over = mine.filter(({ t }) => { const d = daysLeft(t.due); return d != null && d < 0; });
    const cases = active(guildId).filter(c => arr(c.log).some(l => l.by === p.name) || c.adoptedById === id);
    const asks7 = arr(p.history).filter(h => Date.parse(h.at) >= since).length;
    rows.push({ id, name: p.name, role: p.role || '', cases: cases.map(shown), open: mine.length, over: over.length, overList: over.map(({ c, t }) => c.confidential ? `機密案件待辦 1 項` : `${t.text}（${c.name}）`), asks7, last: p.lastSeen || p.updatedAt });
  }
  const orphan = open.filter(({ t }) => t.owner === '顧問' && !t.assignee && !Object.values(P).some(p => p.name === t.source)).length;
  return { rows: rows.sort((a, b) => b.over - a.over || b.open - a.open), orphan, stuck: active(guildId).filter(c => c.pending.length >= 3 || (Date.now() - Date.parse(c.updatedAt) > 14 * 86400000)).map(c => `${shown(c)}（${c.pending.length ? c.pending.length + ' 項待確認' : '14 天沒有進度'}）`) };
}
export function teamBoardText(guildId) {
  const B = teamBoard(guildId); if (!B.rows.length) return '還沒有同事跟孔明互動過。';
  return ['**團隊看板**', ...B.rows.map(r => `• **${r.name}**${r.role ? `（${r.role}）` : ''}｜案件 ${r.cases.length}｜待辦 ${r.open}${r.over ? `｜⚠️ 逾期 ${r.over}：${r.overList.slice(0, 3).join('、')}` : ''}｜近 7 天交辦孔明 ${r.asks7} 次${r.last ? `｜最近 ${hhmm(r.last)}` : ''}`),
    B.orphan ? `\n沒有指定負責人的顧問待辦：${B.orphan} 項` : '', B.stuck.length ? `\n**卡住的案件**：${B.stuck.slice(0, 8).join('、')}` : ''].filter(Boolean).join('\n');
}
/** 每天私訊：你被指派、今天到期或已逾期的待辦 */
export function todoReminders() {
  const out = new Map();
  for (const c of active()) for (const t of arr(c.todos)) {
    if (t.done || !t.assigneeId || !t.due) continue; const d = daysLeft(t.due); if (d == null || d > 1) continue;
    if (!out.has(t.assigneeId)) out.set(t.assigneeId, []); out.get(t.assigneeId).push(`• ${t.text}｜${c.name}｜${d < 0 ? `逾期 ${-d} 天` : d === 0 ? '今天到期' : '明天到期'}${t.assignedBy ? `（${t.assignedBy} 交辦）` : ''}`);
  }
  return [...out.entries()].map(([id, L]) => ({ id, text: `**孔明提醒你的待辦**\n${L.join('\n')}\n-# 做完了跟我說一聲，或用 \`/孔明 待辦\`。` }));
}

/* ============ R6 自我查核 ============ */
export async function factCheck(c, kind, claims, signal) {
  if (!cfg.factCheck.includes(kind) || !claims || String(claims).length < 40) return [];
  const d = await LLM.json({ label: 'factcheck', tier: 'fast', maxTokens: 2000, signal, system: '你是資深顧問兼品質稽核，專門在產出對外前挑出站不住腳的說法。', messages: [{ role: 'user', content: `下面是孔明剛產出的「${(TASKS[kind] || {}).short || kind}」內容，請對照案件資料與來源逐點查核。

【案件資料】
${caseContext(c, { expert: false, kb: false, experts: false, similar: false })}

【產出內容】
${cut(claims, 6000)}

只回覆 JSON：{"issues":[{"claim":"有問題的那句話（節錄 40 字內）","problem":"無依據|與案件資料不一致|數字需客戶確認|過度承諾|可能過時","suggest":"建議怎麼改或要找誰確認，30 字內"}]}
規則：只列真正會讓顧問在客戶或審查委員面前出糗的問題，最多 6 項；已標「待補」「預估」「待查證」的不用列；沒有問題就回 {"issues":[]}。` }] });
  return arr(d && d.issues).filter(x => x && x.claim).slice(0, 6);
}
export const issuesText = L => arr(L).length ? `**孔明自我查核：${L.length} 處要注意**\n${L.map(x => `• 「${cut(x.claim, 40)}」— ${x.problem}${x.suggest ? `；${x.suggest}` : ''}`).join('\n')}` : '';

/* ============ R7 個資：告知、查閱、刪除 ============ */
export function privacyNotice() {
  return `-# 第一次合作，先說明：我會記下你交辦的工作（最近 30 則）、你說的工作方向與回答偏好，用來針對你回答；群組對話保留 ${cfg.transcriptDays} 天、產出檔案 ${cfg.fileTtlDays} 天；身分證號、卡號、帳密會自動遮蔽不保存。\`/孔明 我的資料\` 可以查看或刪除。`;
}
export function needsNotice(userId) { if (!cfg.privacyNotice) return false; const p = person(userId); return !(p && p.noticed); }
export function markNoticed(userId, name) { updatePerson(userId, name, {}); const A = allPeople(); A[userId].noticed = nowISO(); fs.writeFileSync(path.join(cfg.dataDir, 'people.json'), JSON.stringify(A, null, 1)); }
export function exportMyData(userId, userName) {
  const P = prefsAll(), sc = rd('scout.json', { feedback: [] });
  const auditN = (() => { let n = 0; try { for (const f of fs.readdirSync(path.join(cfg.dataDir, 'audit'))) n += fs.readFileSync(path.join(cfg.dataDir, 'audit', f), 'utf8').split('\n').filter(l => l.includes(`"user":"${userId}"`)).length; } catch (e) {} return n; })();
  const data = { exportedAt: nowISO(), who: userName, profile: person(userId), prefs: (P.users[userId] || {}).items || [], scoutFeedback: arr(sc.feedback).filter(f => f.byId === userId), todos: myTodos(userId, userName).map(({ c, t }) => ({ case: c.name, ...t })), messages: store.transcriptsOf(userId), auditEntries: auditN, note: '稽核紀錄依院內規定保存，不隨本人刪除；如需調閱請洽管理員。' };
  return { content: `這是孔明記的你的資料（工作輪廓、偏好、交辦紀錄、群組發言 ${data.messages.length} 則、稽核紀錄 ${auditN} 筆）。要刪除：\`/孔明 我的資料 刪除:all\`。`, files: [{ name: `孔明_我的資料_${isoDay()}.json`, buffer: Buffer.from(JSON.stringify(data, null, 1), 'utf8') }], ephemeral: true };
}
export function deleteMyData(userId) {
  const who = (person(userId) || {}).name;
  if (who) for (const c of store.listCases()) { const before = arr(c.said).length; c.said = arr(c.said).filter(x => x.who !== who); if (c.said.length !== before) store.saveCase(c); }
  clearPerson(userId);
  const P = prefsAll(); if (P.users[userId]) { delete P.users[userId]; wr('prefs.json', P); }
  const n = store.scrubTranscripts(userId);
  const sc = rd('scout.json', null); if (sc) { sc.feedback = arr(sc.feedback).filter(f => f.byId !== userId); wr('scout.json', sc); }
  return `已刪除你的工作輪廓、偏好與交辦紀錄，並抹除你在群組的 ${n} 則發言內容、你對商機推薦的評價與孔明記下的你的提問。案件資料（含你採用的案件）與稽核紀錄屬於院內工作紀錄，依規定保留。`;
}

/* ============ R8 業務開發：開發信、商機推進、未聯繫提醒 ============ */
export const BD = ['已採用', '開發信已備', '已聯繫', '已約訪', '已提案', '已送件', '成案', '未成案'];
export function setBd(c, stage, by) {
  if (!BD.includes(stage)) return false;
  c.bd = { ...(c.bd || {}), stage, at: nowISO(), by, history: [...arr(c.bd && c.bd.history), { stage, at: nowISO(), by }].slice(-20) };
  return true;
}
export function pipelineText(userId) {
  const L = store.listCases().filter(c => c.adoptedById === userId);
  if (!L.length) return '你還沒有採用的商機。每日商機專欄按「可以，建立案件」就會出現在這裡。';
  return `**我的商機追蹤（${L.length}）**\n` + L.map(c => { const s = (c.bd && c.bd.stage) || '已採用', days = Math.floor((Date.now() - Date.parse((c.bd && c.bd.at) || c.updatedAt)) / 86400000); return `• ${c.name}｜${s}｜${days} 天前更新${['已採用', '開發信已備'].includes(s) && days >= cfg.followupDays ? '｜⚠️ 還沒聯繫' : ''}`; }).join('\n') + '\n-# 跟我說「宏聯已經寄信了」「約到 10/20 拜訪」我就會更新。';
}
/** 採用了卻 N 天沒聯繫：提醒採用的人 */
export function followups() {
  const S = rd('followups.json', {}), day = isoDay(), out = [];
  for (const c of active()) {
    if (!c.adoptedById) continue; const s = (c.bd && c.bd.stage) || '已採用';
    if (!['已採用', '開發信已備'].includes(s)) continue;
    const since = Date.parse((c.bd && c.bd.at) || c.updatedAt); if (Date.now() - since < cfg.followupDays * 86400000) continue;
    if (S[c.id] === day) continue; S[c.id] = day;
    out.push({ id: c.adoptedById, caseId: c.id, text: `「${c.name}」你 ${Math.floor((Date.now() - since) / 86400000)} 天前採用，還沒有聯繫紀錄。要我先寫開發信草稿嗎？或跟我說已經聯繫了。`, buttons: [{ id: `km:mail:${c.id}`, label: '寫開發信草稿', style: 'primary' }, { id: `km:bd:${c.id}:已聯繫`, label: '已經聯繫了', style: 'secondary' }, { id: `km:bd:${c.id}:未成案`, label: '不推了', style: 'secondary' }] });
  }
  wr('followups.json', S); return out;
}
Object.assign(TASKS, { outreach: { title: '開發信與邀約話術', short: '開發信', step: 1 } });
EXTRA.outreach = async (c, p, ctl) => {
  const contacts = [...arr(c.scout && c.scout.contacts), ...arr(c.facts).filter(f => /公開窗口|窗口/.test(f.label)).map(f => ({ who: f.label.replace(/^公開窗口：/, ''), phone: f.value, source: f.source }))].slice(0, 5);
  const by = (LLM.als.getStore() || {}).userId; const me = by && person(by);
  const d = await LLM.json({ label: 'outreach', signal: ctl.signal, system: HDR(), messages: [{ role: 'user', content: `同事交辦：「${p.focus || '幫我寫開發信'}」。請替顧問${me ? `「${me.name}${me.title ? '（' + me.title + '）' : ''}」` : ''}寫第一次接觸這個對象的開發信與電話邀約話術。由顧問本人寄出與撥打，你只寫草稿。

${caseContext(c, { chat: p.chat })}
${c.scout ? `【推薦理由】${c.scout.one_liner}\n【方案方向】${c.scout.solution ? c.scout.solution.title + '：' + c.scout.solution.summary : ''}\n【第一步建議】${c.scout.first_step || ''}` : ''}
【公開窗口】${contacts.map(x => `${x.who} ${x.phone || ''} ${x.email || ''}`).join('；') || '尚無，請在草稿用【窗口】標示'}

只回覆 JSON：{"to":"建議的收件窗口","subject":"信件主旨 25 字內","email":"信件內文 250–400 字：開頭說明為什麼聯繫（引用對方近期動態或公開資訊）、一句話說能帶來的價值、具體的下一步邀請（30 分鐘線上或拜訪、兩個時段選項）、署名留【顧問姓名／電話】","phone":["電話開場 3–5 句"],"line":"簡短訊息版 80 字內","objections":[{"q":"對方可能的推託","a":"回應方式"}],"follow_up":"幾天後怎麼追、說什麼"}
規則：語氣專業、不浮誇、不承諾補助一定通過；不寫對方沒公開的資訊；繁體中文。` }] });
  if (!d || !d.email) throw new KmError('開發信草稿不完整，請再試一次。');
  if (!c.bd || c.bd.stage === '已採用') setBd(c, '開發信已備', me ? me.name : '');
  const txt = [`收件：${d.to || ''}`, `主旨：${d.subject || ''}`, '', d.email, '', '— 電話開場 —', ...arr(d.phone), '', '— 簡短訊息版 —', d.line || '', '', '— 可能的推託與回應 —', ...arr(d.objections).map(o => `Q：${o.q}\nA：${o.a}`), '', `— 追蹤 —\n${d.follow_up || ''}`, '', '（孔明草稿，由顧問確認後本人寄出）'].join('\n');
  return { summary: `開發信草稿「${cut(d.subject, 30)}」與電話話術已備好，收件建議：${d.to || '待確認'}。我不會代為寄出。`, detail: `**主旨**：${d.subject}\n\n${cut(d.email, 1400)}`, files: [{ name: `${c.name}_開發信草稿.txt`, buffer: Buffer.from(txt, 'utf8') }], sources: dataSources(c, contacts.length ? ['公開窗口資料'] : []), confirm: '待確認', out: { kind: 'outreach', title: '開發信草稿' }, claims: d.email };
};

/* ============ R10 一致性：案件決議、時間軸、孔明說過的話 ============ */
export function addDecision(c, text, by) { const t = cut(String(text || '').trim(), 120); if (!t || arr(c.decisions).some(d => d.text === t)) return false; c.decisions = [...arr(c.decisions), { text: t, by, at: nowISO() }].slice(-30); return true; }
export function noteAnswer(c, who, q, a) { if (!c) return; c.said = [...arr(c.said), { at: nowISO(), who, q: cut(q, 80), a: cut(a, 200) }].slice(-12); }
export function memoryContext(c) {
  if (!c) return '';
  const L = [];
  if (arr(c.decisions).length) L.push(`【這個案件已經定案的事（不要推翻；同事說要改才改）】\n${c.decisions.slice(-10).map(d => `- ${d.at.slice(0, 10)} ${d.text}（${d.by}）`).join('\n')}`);
  if (arr(c.said).length) L.push(`【你之前在這個案件回答過的話（保持一致；資料更新而要改口時，明說「之前說○○，因為△△更新為…」）】\n${c.said.slice(-6).map(s => `- ${s.at.slice(5, 16).replace('T', ' ')} ${s.who} 問「${s.q}」→ 你答：${s.a}`).join('\n')}`);
  return L.join('\n\n');
}
export function timelineText(c, n = 12) {
  const E = [...arr(c.log).map(l => ({ at: l.at, t: `${l.title}${l.by ? `（${l.by}）` : ''}` })), ...arr(c.decisions).map(d => ({ at: d.at, t: `📌 定案：${d.text}（${d.by}）` })), ...arr(c.interviews).map(i => ({ at: i.at || i.date, t: `🗣 訪談：${cut(i.summary, 40)}` }))].filter(x => x.at).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  return E.slice(-n).map(x => `${String(x.at).slice(5, 10).replace('-', '/')} ${x.t}`).join('\n');
}

/* ============ R11 新人導覽 ============ */
export function guideText(p) {
  return [`**跟孔明共事的三分鐘導覽**${p && p.name ? `（${p.name}）` : ''}`,
    '**1. 先讓我認識你**：`/孔明 我的方向 角色:新人` 並跟我說「我主要跑中部食品業」。新人可以開 `新手:開`，我的產出會附「為什麼這樣寫」與自我檢核問題。',
    '**2. 交辦就像跟同事說話**：在頻道 @孔明「下週二拜訪宏聯精密，幫我準備訪綱」；附上公司簡介、名片照片、訪談錄音也可以。',
    '**3. 我會主動做**：群組裡談到拜訪、痛點、要申請科專時，我會先備好訪綱、POC、簡報或計畫書草稿（主管可以用 `/孔明管理 模式` 調整）。',
    '**4. 對外的東西一定要人確認**：簡報、計畫書、開發信都是草稿，要由交辦人以外的顧問按「確認可對外使用」。聯絡客戶、送件、簽核永遠由人來做。',
    '**5. 常用指令**：`/孔明 待辦`（我的待辦）、`/孔明 狀態`（案件時間軸）、`/孔明 商機`、`/孔明 找專家`、`/孔明 知識庫`、`/孔明 查客戶`（避免撞客戶）。',
    '**6. 我帶著老顧問的經驗**：產業常見痛點、KPI 經驗值、訪談與科專審查的眉角都在我身上，也會引用院內知識庫與過去案例；但經驗值只是參考，請以客戶資料為準。',
    '-# 不確定怎麼開始？直接問我「這個案子下一步該做什麼」。'].join('\n');
}
