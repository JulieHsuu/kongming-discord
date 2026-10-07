// 孔明的十項職能：每一項把案件資料變成可以直接用的成果（文字、Word、PowerPoint、Demo、影片）
import * as LLM from './llm.js';
import { cfg } from './config.js';
import { arr, cut, isoDay, hhmm, nowISO, uid, num, safeName, KmError } from './util.js';
import { FBY, FIELDS, STAGES, KZ, NEEDS, applyProfile, profileText, missingFields, completeness, fmtVal, pendText, matchAll, compactProgram, programFull, analysisFor, pickProgram, kzSrc, timing, normField } from './domain.js';
import { buildDocx, buildPptx } from './files/docs.js';
import { expertBrief, findExperts, expertLines } from './expertise.js';
import { kbContext } from './kb.js';
import { renderFilm, storyboardMd, FILM_TYPES, filmTotal } from './film/film.js';

export const HDR = () => `你是「孔明」（Kongming），${cfg.org}的顧問協作型數位員工，承接顧問同事的交辦、協作案件的數位工作；顧問負責面對客戶、專業判斷與最終決策。你不是新人：你帶著院內累積的產業輔導、訪談與科專審查經驗（見下方「老顧問經驗」「顧問實務」「院內知識庫」），會主動指出風險、提出判斷與依據；但經驗值只是參考範圍，對外一律以客戶實際資料為準，資料裡沒有的事要說「不知道／待查證」，不可編造。今天是 ${isoDay()}。`;
export const FIELD_RULES = 'profile_updates 只放有明確依據的欄位（沒有就給 {}）：name 企業名稱、county（臺灣縣市全名，用「臺」字）、industry（只能是：製造業｜商業服務業（零售、餐飲、物流等）｜資訊服務／軟體｜技術服務業｜生技醫療｜農業／食品｜文化內容｜其他）、product 主要產品或服務、capital（實收資本額，換算成萬元的數字）、employees（員工數字）、founded（西元成立年）、budget（預計投入總經費，萬元數字）、contact（客戶窗口姓名職稱）、visit（下次拜訪日 YYYY-MM-DD）、needs（陣列，值只能是 rd=研發新產品或技術、ai=導入AI、dx=數位轉型或營運效率、svc=服務創新、green=淨零節能、intl=國際合作、acad=產學合作、invest=募資、tax=研發節稅）、factory（有無工廠登記 true/false）、tariff（是否受美國關稅影響 true/false）、desc（需求描述 80 字內）';

export const TASKS = {
  prep: { title: '訪前準備：訪前資料包與訪綱', short: '訪綱', step: 1 },
  ingest: { title: '資料建檔：辨識欄位與補齊資訊', short: '資料建檔', step: 2 },
  debrief: { title: '訪後更新：訪談紀錄與案件資料', short: '訪談紀錄', step: 3 },
  status: { title: '流程銜接：案件狀態與後續事項', short: '案件狀態', step: 4 },
  match: { title: '科專媒合：可申請計畫與時程', short: '科專媒合', step: 5 },
  deck: { title: '提案簡報（PowerPoint）', short: '提案簡報', step: 5 },
  poc: { title: 'POC 規劃與 KPI', short: 'POC 規劃', step: 5 },
  demo: { title: '可操作的產品 Demo', short: 'Demo', step: 5 },
  video: { title: '計畫短片（MP4）', short: '計畫短片', step: 5 },
  proposal: { title: '科專計畫書草稿（Word）', short: '計畫書', step: 5 },
};

/* ---------- context ---------- */
export const CTX = { similar: null, prefs: null };
export function caseContext(c, o = {}) {
  const L = [`【企業資料】\n${profileText(c)}`];
  if (c.facts.length) L.push('【已建檔資訊】\n' + c.facts.slice(-14).map(f => `- ${f.label}：${f.value}${f.source ? `（${f.source}）` : ''}`).join('\n'));
  const iv = c.interviews[0];
  if (iv && o.interview !== false) L.push(`【最近一次訪談（${iv.date || hhmm(iv.at)}）】${cut(iv.summary, 300)}\n需求：${arr(iv.needs).slice(0, 6).join('；')}\n痛點：${arr(iv.pain_points).slice(0, 6).join('；')}\n數據：${arr(iv.data_points).slice(0, 10).map(d => `${d.label} ${d.value}`).join('；')}`);
  if (c.analysis && o.analysis !== false) L.push(`【科專分析】${cut(c.analysis.summary, 240)}\n建議：${arr(c.analysis.recommendations).map(r => `${(KZ.byId[r.program_id] || {}).short || r.program_id}（題目：${r.project_idea}；${r.track}）`).join('；')}`);
  if (c.research) L.push(`【企業研究（${c.research.at ? c.research.at.slice(0, 10) : ''}，來源見研究報告）】${cut(c.research.summary, 400)}\n${arr(c.research.facts).slice(0, 8).map(f => `- ${f.label}：${f.value}${f.source ? '（來源：' + f.source + '）' : ''}`).join('\n')}${arr(c.research.pain_hypotheses).length ? '\n可能痛點：' + arr(c.research.pain_hypotheses).slice(0, 5).join('；') : ''}`);
  const sim = CTX.similar ? CTX.similar(c) : '';
  if (sim && o.similar !== false) L.push(`【團隊過去的相似案例（參考做法，不要照抄數字）】\n${sim}`);
  const kind = o.kind || (LLM.als.getStore() || {}).kind || 'router';
  if (o.expert !== false) { const ex = expertBrief(c, kind); if (ex) L.push(ex); }
  if (o.kb !== false) { const kq = [c.profile.industry, c.profile.product, c.profile.desc, o.focus || (LLM.als.getStore() || {}).focus, ...arr(c.profile.needs)].filter(Boolean).join(' '); const kc = kbContext(kq, 3); if (kc) L.push(kc); }
  if (o.experts !== false && ['poc', 'deck', 'proposal', 'scout', 'demo'].includes(kind)) { const E = findExperts(o.focus || '', c, 3); if (E.length) L.push(`【院內可以找的協作單位（提到時寫「建議洽○○」，由顧問決定是否邀請）】\n${expertLines(E)}`); }
  const pref = CTX.prefs ? CTX.prefs(o.userId) : '';
  if (pref) L.push(`【團隊與同事的偏好（照做）】\n${pref}`);
  if (o.chat) L.push(`【群組裡同事最近的相關對話】\n${o.chat}`);
  return L.join('\n\n');
}
export function dataSources(c, extra = []) {
  const s = ['企業資料'];
  if (c.facts.length) s.push(`已建檔資訊 ${c.facts.length} 筆`);
  if (c.interviews.length) s.push(`訪談紀錄 ${c.interviews.length} 份`);
  return [...s, ...extra];
}
const addTodo = (c, text, owner, due, source) => { if (!text || c.todos.some(t => t.text === text)) return 0; c.todos.push({ id: uid(6), text: String(text), owner: ['顧問', '孔明', '客戶'].includes(owner) ? owner : '顧問', due: normField('visit', due), done: false, at: nowISO(), source }); return 1; };
const proposeStage = (c, to, source) => { if (c.stage >= to || c.pending.some(p => p.kind === 'stage' && p.to === to)) return null; const p = { id: uid(6), kind: 'stage', from: c.stage, to, source, at: nowISO() }; c.pending.push(p); return p; };
const fileOut = (name, buffer, desc) => ({ name, buffer, desc });
const fn = (c, base, ext) => `${safeName(c.name)}_${base}.${ext}`;
const lis = (a, n = 6) => arr(a).slice(0, n).map(x => `• ${typeof x === 'string' ? x : JSON.stringify(x)}`).join('\n');

/* ---------- 1 訪前準備 ---------- */
async function prep(c, p, ctl) {
  const ev = matchAll(c).good.slice(0, 4);
  const d = await LLM.json({ label: 'prep', signal: ctl.signal, system: HDR(), messages: [{ role: 'user', content: `顧問交辦：「${p.focus || '幫我準備這次拜訪'}」。請準備這次拜訪的訪前資料包與訪綱。

${caseContext(c, { chat: p.chat })}
缺漏的關鍵欄位：${missingFields(c).map(k => FBY[k].l).join('、') || '無'}
${ev.length ? '\n【可能適用的政府科專（資格初篩，供訪談時切入）】\n' + ev.map(r => `- ${r.p.short || r.p.name}：${cut(r.p.summary, 60)}；${timing(r.p)}`).join('\n') : ''}

只回覆一個 JSON 物件：
{"title":"〇〇訪前準備","company_brief":["企業概況重點 3–5 點"],"known":[{"label":"…","value":"…"}],"gaps":[{"item":"待補充資訊","why":"為什麼重要"}],"agenda":[{"time":"0–10 分","topic":"…"}],"sections":[{"title":"訪談段落","purpose":"這段要得到什麼","questions":["問題"]}],"bring":["建議帶去的資料或工具"],"tool_inputs":["既有顧問工具（例如製造業 AI 成熟度評量）需要先準備的資料"],"kezhuan_angle":"適合談科專時一兩句切入建議；不適合就空字串"}
規則：訪談以 60 分鐘設計；sections 4–6 段、每段 3–5 題，問題口語、具體、可追問；gaps 要涵蓋判斷科專資格與提案需要、但目前沒有的資訊；known 只放上方資料有的事實；不可編造；繁體中文。` }] });
  if (!d || !arr(d.sections).length) throw new KmError('訪綱格式不完整，請再交辦一次。');
  c.prep = { ...d, at: nowISO() };
  const q = arr(d.sections).reduce((n, s) => n + arr(s.questions).length, 0);
  const B = [];
  if (arr(d.company_brief).length) B.push({ h: '企業概況' }, { ul: d.company_brief });
  if (arr(d.known).length) B.push({ h: '已知資訊' }, { table: { headers: ['項目', '內容'], rows: arr(d.known).map(k => [k.label, k.value]) } });
  if (arr(d.agenda).length) B.push({ h: '訪談流程（60 分鐘）' }, { table: { headers: ['時間', '主題'], rows: arr(d.agenda).map(a => [a.time, a.topic]) } });
  arr(d.sections).forEach((s, i) => { B.push({ h: `訪綱 ${i + 1}：${s.title}` }); if (s.purpose) B.push({ p: `目的：${s.purpose}`, muted: true }); B.push({ ol: s.questions }); });
  if (arr(d.gaps).length) B.push({ h: '待補充資訊' }, { table: { headers: ['資訊', '為什麼重要'], rows: arr(d.gaps).map(g => [g.item, g.why]) } });
  const tools = [...arr(d.tool_inputs), ...arr(d.bring)]; if (tools.length) B.push({ h: '顧問工具所需資料與要帶的東西' }, { ul: tools });
  if (d.kezhuan_angle) B.push({ h: '科專切入建議' }, { p: d.kezhuan_angle });
  if (c.research && arr(c.research.sources).length) B.push({ h: '訪前企業研究來源', muted: true }, { p: `研究時間：${c.research.at}`, muted: true }, { ul: c.research.sources.map(s => `${s.title}：${s.url}`) });
  const doc = await buildDocx(d.title || `${c.name} 訪前準備`, B);
  return {
    summary: `訪綱 ${arr(d.sections).length} 段、${q} 題；待補充資訊 ${arr(d.gaps).length} 項。`,
    detail: [arr(d.company_brief).length ? `**企業概況**\n${lis(d.company_brief, 4)}` : '', `**訪談段落**\n${arr(d.sections).map((s, i) => `${i + 1}. ${s.title}（${arr(s.questions).length} 題）`).join('\n')}`, arr(d.gaps).length ? `**這次要問到的**\n${lis(arr(d.gaps).map(g => g.item), 5)}` : '', d.kezhuan_angle ? `**科專切入**：${d.kezhuan_angle}` : ''].filter(Boolean).join('\n\n'),
    files: [fileOut(fn(c, '訪前資料包', 'docx'), doc)], sources: dataSources(c, ev.length ? [kzSrc()] : []),
  };
}

/* ---------- 2 資料建檔 ---------- */
async function ingest(c, p, ctl) {
  const atts = arr(p.atts), texts = atts.filter(a => a.kind === 'text' && a.text), imgs = atts.filter(a => a.kind === 'image').map(a => a.image).slice(0, 4);
  const pasted = (!atts.length && p.text && p.text.length > 40) ? p.text : '';
  if (!texts.length && !imgs.length && !pasted) throw new KmError('沒有收到要建檔的資料，請附檔案或貼上內容。');
  const body = [...texts.map(a => `《${a.name}》\n${a.text}`), pasted ? `《同事貼上的內容》\n${pasted}` : ''].filter(Boolean).join('\n\n');
  if (body.length > 24000) throw new KmError('來源全文已讀取，但超過單次建檔的 24,000 字上限；請分檔建檔，避免漏掉後半段。');
  const d = await LLM.json({ label: 'ingest', signal: ctl.signal, images: imgs, system: HDR(), messages: [{ role: 'user', content: `同事交給你下列${p.tool ? '既有顧問工具的產出結果' : '資料'}${imgs.length ? '（含圖片，例如名片、型錄、簡報截圖）' : ''}，請建檔到案件。

【目前案件資料】
${profileText(c)}

【新資料】
${body || '（見圖片）'}

只回覆一個 JSON 物件：
{"source_title":"資料名稱 12 字內","profile_updates":{},"facts":[{"label":"…","value":"…"}],"missing":["提案或診斷還缺的資訊"],"doubts":["資料互相矛盾、和目前案件資料不一致或可疑之處"]}
規則：${FIELD_RULES}；不確定的不要放進 profile_updates，改放 facts 或 doubts；facts 是案件有用但不屬於上述欄位的資訊，最多 12 筆，value 60 字內；金額一律換成萬元；繁體中文。` }] });
  const src = cut(d.source_title || (atts[0] && atts[0].name) || '同事提供的資料', 24);
  const r = applyProfile(c, d.profile_updates, src);
  let nf = 0;
  for (const f of arr(d.facts)) if (f && f.label && f.value && !c.facts.some(x => x.label === f.label && x.value === f.value)) { c.facts.push({ label: String(f.label), value: String(f.value), source: src, at: nowISO() }); nf++; }
  const doubts = arr(d.doubts).slice(0, 5).map(q => { const x = { id: uid(6), kind: 'doubt', text: String(q), source: src, at: nowISO() }; c.pending.push(x); return x; });
  c.ingests.unshift({ at: nowISO(), title: src, files: atts.map(a => a.name), applied: r.applied, missing: arr(d.missing), doubts: arr(d.doubts), tool: !!p.tool });
  if (p.tool) c.toolResultAt = nowISO();
  const comp = completeness(c);
  return {
    summary: `建檔 ${r.applied.length} 個欄位${r.applied.length ? `（${r.applied.slice(0, 5).join('、')}）` : ''}、${nf} 筆資訊；資料完整度 ${comp.pct}%。`,
    detail: [arr(d.missing).length ? `**還缺**\n${lis(d.missing, 6)}` : '', missingFields(c).length ? `**關鍵欄位待補**：${missingFields(c).map(k => FBY[k].l).join('、')}` : '**關鍵欄位齊全**'].filter(Boolean).join('\n\n'),
    pending: [...r.pend, ...doubts], files: [], sources: [`${p.tool ? '既有工具產出' : '同事提供'}：${atts.map(a => a.name).join('、') || '貼上的內容'}`], confirm: (r.pend.length + doubts.length) ? '待確認' : '不需',
  };
}

/* ---------- 3 訪後更新 ---------- */
async function debrief(c, p, ctl) {
  const atts = arr(p.atts).filter(a => a.kind === 'text' && a.text);
  let notes = atts.map(a => `《${a.name}》\n${a.text}`).join('\n\n');
  if (p.notes) notes = p.notes + (notes ? '\n\n' + notes : '');
  else if (p.text && p.text.length > 60) notes = `《同事的訪談筆記》\n${p.text}` + (notes ? '\n\n' + notes : '');
  if (!notes.trim()) throw new KmError('請貼上訪談筆記或附上逐字稿（錄音請先用既有診斷工具轉成逐字稿）。');
  if (notes.length > 36000) throw new KmError('完整逐字稿已保留，但超過單次訪談整理的 36,000 字上限；請分成多份整理，避免漏掉後半段。');
  const gaps = arr(c.prep && c.prep.gaps).map(g => g.item).join('；');
  const d = await LLM.json({ label: 'debrief', signal: ctl.signal, system: HDR(), messages: [{ role: 'user', content: `這是顧問交給你的筆記或逐字稿。先依內容判斷是否屬於目前案件的訪談；私人對話、課堂、論文討論等無關內容不可套用案件背景。若明顯無關，只回 {"case_relevant":false,"reason":"內容與案件不符，請確認附件；未建立紀錄或更新案件。"}。相關內容才整理成訪談紀錄並更新案件，JSON 加上 "case_relevant":true。

【訪前列出的待補充資訊】${gaps || '無'}
【目前案件資料】
${profileText(c)}

【訪談內容】
${cut(notes, 36000)}

只回覆一個 JSON 物件：
{"title":"〇〇訪談紀錄","date":"YYYY-MM-DD 或 null","attendees":["…"],"summary":"3–4 句摘要","highlights":["重點"],"needs":["客戶需求"],"pain_points":["痛點"],"data_points":[{"label":"…","value":"…"}],"commitments":[{"who":"顧問|客戶|孔明","what":"…","due":"YYYY-MM-DD 或 null"}],"answered_gaps":["訪前待補充、這次已取得的資訊"],"open_questions":["仍待確認的事"],"profile_updates":{},"next_steps":["建議下一步"],"tool_fields":[{"field":"既有顧問工具或評量表需要的欄位","value":"從訪談擷取的內容"}]}
規則：只寫訪談內容有提到的事，數字照原文；逐字稿的口語要整理成書面句；${FIELD_RULES}；繁體中文。` }] });
  if (d && d.case_relevant === false) throw new KmError(d.reason || '訪談內容與目前案件無關，未建立訪談紀錄或更新案件；請確認附件。');
  if (!d || !d.summary) throw new KmError('訪談紀錄格式不完整，請再試一次。');
  const src = `訪談紀錄 ${d.date || isoDay()}`;
  const r = applyProfile(c, d.profile_updates, src);
  d.applied = r.applied; d.at = nowISO(); d.files = atts.map(a => a.name);
  c.interviews.unshift(d);
  for (const x of arr(d.data_points)) if (x && x.label && x.value) c.facts.push({ label: String(x.label), value: String(x.value), source: src, at: nowISO() });
  let nt = 0; for (const m of arr(d.commitments)) if (m && m.what) nt += addTodo(c, m.what, m.who, m.due, src);
  const st = proposeStage(c, 2, src);
  const B = [{ p: `日期：${d.date || '—'}${arr(d.attendees).length ? `　與會：${d.attendees.join('、')}` : ''}`, muted: true }, { h: '摘要' }, { p: d.summary }];
  if (arr(d.highlights).length) B.push({ h: '重點' }, { ul: d.highlights });
  if (arr(d.needs).length) B.push({ h: '客戶需求' }, { ul: d.needs });
  if (arr(d.pain_points).length) B.push({ h: '痛點' }, { ul: d.pain_points });
  if (arr(d.data_points).length) B.push({ h: '數據' }, { table: { headers: ['項目', '內容'], rows: arr(d.data_points).map(x => [x.label, x.value]) } });
  if (arr(d.tool_fields).length) B.push({ h: '系統所需內容' }, { table: { headers: ['系統欄位', '內容'], rows: arr(d.tool_fields).map(x => [x.field, x.value]) } });
  if (arr(d.commitments).length) B.push({ h: '承諾事項' }, { table: { headers: ['誰', '做什麼', '期限'], rows: arr(d.commitments).map(m => [m.who, m.what, m.due || '—']) } });
  if (arr(d.open_questions).length) B.push({ h: '仍待確認' }, { ul: d.open_questions });
  if (arr(d.next_steps).length) B.push({ h: '建議下一步' }, { ul: d.next_steps });
  const doc = await buildDocx(d.title || `${c.name} 訪談紀錄`, B);
  return {
    summary: `${arr(d.highlights).length} 個重點、${arr(d.data_points).length} 筆數據；更新 ${r.applied.length} 個欄位；新增 ${nt} 項待辦。`,
    detail: [`**摘要**\n${d.summary}`, arr(d.pain_points).length ? `**痛點**\n${lis(d.pain_points, 5)}` : '', arr(d.commitments).length ? `**承諾事項**\n${arr(d.commitments).slice(0, 6).map(m => `• ${m.who}：${m.what}${m.due ? `（${m.due}）` : ''}`).join('\n')}` : ''].filter(Boolean).join('\n\n'),
    files: [fileOut(fn(c, `訪談紀錄_${d.date || isoDay()}`, 'docx'), doc)], pending: [...r.pend, ...(st ? [st] : [])],
    sources: [`訪談內容：${atts.map(a => a.name).join('、') || '同事筆記'}`], confirm: r.pend.length ? '待確認' : '不需',
  };
}

/* ---------- 4 流程銜接 ---------- */
async function status(c, p, ctl) {
  const outs = arr(c.outputs);
  const d = await LLM.json({ label: 'status', tier: 'default', signal: ctl.signal, system: HDR(), messages: [{ role: 'user', content: `同事交辦：「${p.focus || '幫我確認這個案件接下來還缺什麼'}」。請檢查案件狀態，找出缺漏並排出後續事項。

【案件】${c.name}｜階段：${STAGES[c.stage]}
${caseContext(c, { chat: p.chat })}
缺漏的關鍵欄位：${missingFields(c).map(k => FBY[k].l).join('、') || '無'}
已完成：訪前資料包 ${c.prep ? '有' : '無'}；訪談紀錄 ${c.interviews.length} 份；科專分析 ${c.analysis ? '有' : '無'}；POC 規劃 ${c.poc ? '有' : '無'}
待顧問確認：${c.pending.map(pendText).join('；') || '無'}
待辦：${c.todos.filter(t => !t.done).map(t => `${t.text}（${t.owner}${t.due ? '，' + t.due : ''}）`).join('；') || '無'}
已有產出：${outs.map(o => `${o.title}（${o.status}）`).join('；') || '無'}

只回覆一個 JSON 物件：
{"summary":"一兩句說明案件目前狀態","done":["已完成的事"],"missing":[{"item":"缺什麼","why":"為什麼需要","how":"誰、怎麼補"}],"next":[{"text":"後續事項","owner":"顧問|孔明|客戶","due":"YYYY-MM-DD 或 null"}],"report":"可以直接傳給主管或團隊的狀態回報，3–5 句"}
規則：missing 依重要性排序、最多 6 項；next 最多 6 項，具體可執行；只根據上方資料，不可編造；繁體中文。` }] });
  if (!d || !d.summary) throw new KmError('狀態回報格式不完整，請再試一次。');
  c.status = { ...d, at: nowISO() };
  let nt = 0; for (const n of arr(d.next)) if (n && n.text) nt += addTodo(c, n.text, n.owner, n.due, '案件狀態檢查');
  return {
    summary: d.summary,
    detail: [arr(d.missing).length ? `**還缺**\n${arr(d.missing).slice(0, 6).map(m => `• ${m.item}：${m.how || m.why || ''}`).join('\n')}` : '', arr(d.next).length ? `**後續事項**\n${arr(d.next).slice(0, 6).map(n => `• ${n.text}（${n.owner || '顧問'}${n.due ? '，' + n.due : ''}）`).join('\n')}` : '', d.report ? `**可直接轉傳的回報**\n> ${String(d.report).replace(/\n/g, '\n> ')}` : ''].filter(Boolean).join('\n\n'),
    files: [], sources: dataSources(c, ['待辦與產出']),
  };
}

/* ---------- 5a 科專媒合 ---------- */
async function match(c, p, ctl) {
  if (!KZ.programs.length) throw new KmError('科專資料庫沒有載入。');
  const R = matchAll(c);
  if (!R.good.length) throw new KmError('依目前企業資料找不到資格相符的計畫；請先補齊產業、資本額、員工數與想做的事。');
  const cands = R.good.slice(0, 10).map(r => compactProgram(r.p) + `\n初篩：符合度${r.fit}；${[...r.ok, ...r.warn].join('；')}`).join('\n\n');
  const d = await LLM.json({ label: 'match', signal: ctl.signal, system: HDR(), messages: [{ role: 'user', content: `請幫顧問判斷這家企業該提哪些政府科專或補助計畫。

${caseContext(c, { analysis: false, chat: p.chat })}

【候選計畫（已依資格初篩）】
${cands}

只回覆一個 JSON 物件：
{"summary":"2–3 句總結這家企業最該走的路線","recommendations":[{"program_id":"候選清單中的 id","fit":"高|中|低","why":"為什麼適合，扣緊企業需求，60 字內","project_idea":"建議的計畫題目 20 字內","track":"建議申請的類別或 Phase","grant_estimate_wan":數字或null,"timing":"何時送件，推估要標明","iii_angle":"資策會可以怎麼參與（符合該計畫限制），40 字內","risks":["主要風險或待確認事項"]}],"roadmap":[{"when":"YYYY-MM","action":"要做的事"}],"ask_client":["下次拜訪要問客戶、用來確認資格或強化提案的問題"]}
規則：recommendations 最多 4 筆、依優先順序；program_id 只能用候選清單的 id；補助估計不得超過該計畫上限，原則上不超過總經費 50%（萬元）；roadmap 4–6 步、涵蓋未來 12 個月；ask_client 5–7 題；資料標示推估或待確認的照實說；不要編造企業沒提供的事實；繁體中文，句子簡短。` }] });
  if (!d || !Array.isArray(d.recommendations)) throw new KmError('分析結果格式不完整，請再試一次。');
  d.recommendations = d.recommendations.filter(r => KZ.byId[r.program_id]);
  c.analysis = { ...d, at: nowISO() };
  const recs = d.recommendations.map((r, i) => { const P = KZ.byId[r.program_id]; return `**${i + 1}. ${P.short || P.name}**（符合度 ${r.fit}）\n題目：${r.project_idea}・${r.track}\n補助估計：${r.grant_estimate_wan != null ? r.grant_estimate_wan + ' 萬' : '—'}・${r.timing}\n資策會：${r.iii_angle}`; }).join('\n\n');
  return {
    summary: d.summary,
    detail: [recs, arr(d.roadmap).length ? `**12 個月時程**\n${arr(d.roadmap).map(x => `• ${x.when}：${x.action}`).join('\n')}` : '', arr(d.ask_client).length ? `**下次拜訪要問**\n${lis(d.ask_client, 7)}` : ''].filter(Boolean).join('\n\n'),
    files: [], sources: dataSources(c, [kzSrc()]),
  };
}

/* ---------- 5b POC ---------- */
async function poc(c, p, ctl) {
  const P = pickProgram(c, p.program_id);
  const d = await LLM.json({ label: 'poc', signal: ctl.signal, system: HDR(), messages: [{ role: 'user', content: `同事交辦：「${p.focus || '規劃 POC'}」。請針對客戶痛點規劃一個 4–8 週可完成的概念驗證（POC），驗證技術可行性${P ? `，並作為申請「${P.name}」的前期成果與佐證` : ''}。資策會團隊會協助執行。

${caseContext(c, { chat: p.chat })}
${P ? `【計畫重點】${cut(P.summary, 200)}｜審查重點：${arr(P.review_focus).join('；')}｜常見 KPI：${arr(P.kpi_typical).join('、')}｜資策會角色：${cut(P.iii_role, 200)}\n${analysisFor(c, P.id)}` : ''}

只回覆一個 JSON 物件：
{"title":"POC 名稱","objective":"一句話目標","use_cases":["驗證情境"],"scope_in":["做什麼"],"scope_out":["不做什麼"],"data_needed":[{"item":"資料或設備","from":"企業提供或資策會準備"}],"architecture":["系統組成，一行一個元件"],"timeline":[{"week":"W1","task":"…","deliverable":"…"}],"success_metrics":[{"metric":"…","baseline":"現況或【待補】","target":"…"}],"kpi":[{"name":"計畫 KPI","target":"目標值","unit":"單位","basis":"計算依據"}],"team":[{"role":"…","side":"企業|資策會","effort":"人週"}],"cost_estimate":"概估與假設","risks":[{"risk":"…","mitigation":"…"}],"to_proposal":"POC 結果怎麼寫進計畫書（2–3 句）"}
規則：週計畫 4–8 週；企業沒提供的數字用【待補：…】；kpi 4–6 項並附計算依據；不要承諾無法驗證的成效；繁體中文、句子簡短。` }] });
  if (!d || !d.title) throw new KmError('POC 規劃格式不完整，請再試一次。');
  c.poc = { ...d, at: nowISO(), programId: P ? P.id : null };
  const B = [{ p: d.objective }, P ? { p: `對應計畫：${P.name}`, muted: true } : null].filter(Boolean);
  if (arr(d.use_cases).length) B.push({ h: '驗證情境' }, { ul: d.use_cases });
  if (arr(d.scope_in).length) B.push({ h: '做什麼' }, { ul: d.scope_in });
  if (arr(d.scope_out).length) B.push({ h: '不做什麼' }, { ul: d.scope_out });
  if (arr(d.data_needed).length) B.push({ h: '需要的資料與設備' }, { table: { headers: ['資料或設備', '來源'], rows: arr(d.data_needed).map(x => [x.item, x.from]) } });
  if (arr(d.architecture).length) B.push({ h: '系統組成' }, { ul: d.architecture });
  if (arr(d.timeline).length) B.push({ h: '週計畫' }, { table: { headers: ['週', '工作', '產出'], rows: arr(d.timeline).map(t => [t.week, t.task, t.deliverable]) } });
  if (arr(d.success_metrics).length) B.push({ h: '驗證指標' }, { table: { headers: ['指標', '現況', '目標'], rows: arr(d.success_metrics).map(m => [m.metric, m.baseline, m.target]) } });
  if (arr(d.kpi).length) B.push({ h: '計畫 KPI' }, { table: { headers: ['KPI', '目標', '計算依據'], rows: arr(d.kpi).map(k => [k.name, `${k.target ?? ''}${k.unit ? ' ' + k.unit : ''}`, k.basis]) } });
  if (arr(d.team).length) B.push({ h: '分工' }, { table: { headers: ['角色', '單位', '人力'], rows: arr(d.team).map(t => [t.role, t.side, t.effort]) } });
  if (d.cost_estimate) B.push({ h: '成本概估' }, { p: d.cost_estimate });
  if (arr(d.risks).length) B.push({ h: '風險與因應' }, { table: { headers: ['風險', '因應'], rows: arr(d.risks).map(r => [r.risk, r.mitigation]) } });
  if (d.to_proposal) B.push({ h: '怎麼寫進計畫書' }, { p: d.to_proposal });
  const doc = await buildDocx(d.title, B);
  return {
    summary: `「${d.title}」：${arr(d.timeline).length} 週計畫、${arr(d.success_metrics).length} 項驗證指標、${arr(d.kpi).length} 項 KPI。`,
    detail: [`**目標**：${d.objective}`, arr(d.timeline).length ? `**週計畫**\n${arr(d.timeline).slice(0, 8).map(t => `• ${t.week}：${t.task}`).join('\n')}` : '', arr(d.kpi).length ? `**KPI**\n${arr(d.kpi).slice(0, 6).map(k => `• ${k.name}：${k.target ?? ''}${k.unit ? ' ' + k.unit : ''}`).join('\n')}` : ''].filter(Boolean).join('\n\n'),
    files: [fileOut(fn(c, 'POC規劃', 'docx'), doc)], sources: dataSources(c, P ? [kzSrc()] : []), out: { kind: 'poc', title: d.title, programId: P ? P.id : null },
  };
}

/* ---------- 5c 提案簡報 ---------- */
async function deck(c, p, ctl) {
  const P = pickProgram(c, p.program_id), k = KZ.kb || {};
  const d = await LLM.json({ label: 'deck', tier: 'heavy', maxTokens: 10000, signal: ctl.signal, system: HDR(), messages: [{ role: 'user', content: `同事交辦：「${p.focus || '做一份提案簡報'}」。請為這家企業產生一份提案簡報草稿${P ? `，針對「${P.name}」` : ''}，讓顧問修改後能拿給客戶討論${P ? '或作為計畫書骨架' : ''}。

${caseContext(c, { chat: p.chat })}
${P ? `\n【計畫】\n${programFull(P)}\n${analysisFor(c, P.id)}\n【計畫書常見章節】${arr(k.proposal_outline).map(s => s.section).join('、')}\n【共通審查重點】${arr(k.review_focus).slice(0, 6).map(x => cut(x, 60)).join('；')}` : ''}
${c.poc ? `【已規劃的 POC】${c.poc.title}；目標：${c.poc.objective}；${arr(c.poc.timeline).length} 週；KPI：${arr(c.poc.kpi).map(x => `${x.name} ${x.target}${x.unit || ''}`).join('、')}` : ''}

規則：
- 10–14 張，繁體中文；${P ? '結構對應該計畫的審查重點（創新性、可行性、團隊、市場、效益、經費）' : '結構：現況與問題、解決方案、做法與時程、效益、合作方式與下一步'}。
- 第一張 layout 為 "title"；包含一張 "timeline"（時程與查核點）${P ? '、一張 "table"（經費概估：科目、金額萬元、說明；補助款不超過計畫上限且原則不超過總經費 50%）、一張 KPI 頁（可用 table）' : ''}；最後一張為「資策會合作角色與下一步」。
- 每張 bullets 3–5 點，每點 40 字內；數字標「預估」；企業沒提供的事實用【待補：…】標示，不可編造。
- notes 寫 1–3 句講者備註。
只回覆一個 JSON 物件：
{"deck_title":"…","slides":[{"layout":"title|bullets|two-col|table|timeline","title":"…","subtitle":"…","bullets":["…"],"left":{"heading":"…","bullets":["…"]},"right":{"heading":"…","bullets":["…"]},"table":{"headers":["…"],"rows":[["…"]]},"milestones":[{"when":"M1–M2","what":"…"}],"notes":"…"}]}` }] });
  if (!d || !arr(d.slides).length) throw new KmError('簡報格式不完整，請再試一次。');
  const title = d.deck_title || `${c.name} 提案簡報`;
  const buf = await buildPptx(d, { company: c.name, program: P ? (P.short || P.name) : '' });
  return {
    summary: `${arr(d.slides).length} 張簡報「${cut(title, 30)}」，可直接用 PowerPoint 編輯。`,
    detail: `**內容**\n${arr(d.slides).map((s, i) => `${i + 1}. ${s.title || ''}`).join('\n')}`,
    files: [fileOut(fn(c, safeName(title), 'pptx'), buf)], sources: dataSources(c, P ? [kzSrc()] : []), confirm: '待確認', out: { kind: 'deck', title, programId: P ? P.id : null },
    claims: arr(d.slides).map(s => [s.title, ...arr(s.bullets), ...arr(s.left && s.left.bullets), ...arr(s.right && s.right.bullets), ...arr(s.table && s.table.rows).map(r => arr(r).join(' ')), ...arr(s.milestones).map(m => `${m.when} ${m.what}`)].filter(Boolean).join('；')).join('\n'),
  };
}

/* ---------- 5d 產品 Demo ---------- */
function extractHtml(t) {
  const m = /```html\s*([\s\S]*?)```/i.exec(t);
  let h = m ? m[1] : null;
  if (!h) { const a = t.search(/<!doctype html|<html/i), b = t.lastIndexOf('</html>'); if (a >= 0 && b > a) h = t.slice(a, b + 7); }
  return h && /<\/html>/i.test(h) && /<body/i.test(h) ? h.trim() : null;
}
async function demo(c, p, ctl) {
  const P = pickProgram(c, p.program_id), pc = c.poc;
  const r = await LLM.text({ label: 'demo', tier: 'heavy', maxTokens: 24000, signal: ctl.signal, system: HDR(), messages: [{ role: 'user', content: `同事交辦：「${p.focus || '做一個可以實際操作的產品 Demo'}」。請做出這個解決方案的「可實際操作的產品 Demo」，讓顧問在客戶或審查委員面前展示（多半用手機或筆電打開）。

${caseContext(c, { chat: p.chat })}
${pc ? `【POC 規劃】${pc.title}｜目標：${pc.objective}｜情境：${arr(pc.use_cases).join('；')}｜系統組成：${arr(pc.architecture).join('；')}｜驗證指標：${arr(pc.success_metrics).map(m => `${m.metric} ${m.target}`).join('；')}` : ''}
${P ? `【申請計畫】${P.name}（${P.short || ''}）` : ''}

輸出一個完整、單一檔案的 HTML 文件（<!doctype html> 開頭），用 \`\`\`html 包起來，前後不要其他文字。要求：
- 全部 CSS 與 JavaScript 內嵌；不得載入任何外部資源（字型、圖片、CDN、API 都不行），圖像用 CSS、SVG 或 canvas 畫。
- 介面繁體中文，手機與桌機都能用；頂部有產品名稱與「概念驗證 Demo・資料為模擬」標示。
- 3–4 個可切換的畫面（例如：總覽儀表板、核心功能操作、結果與報表），核心功能要能互動：按下按鈕後模擬 AI 處理（進度動畫 1–2 秒），再顯示合理的結果（例如影像檢測用 canvas 畫出物件與標框和信心分數、預測類畫出圖表、客服類顯示對話）。
- 用符合這家企業情境的擬真範例資料，數字合理並標示為模擬；圖表自己用 canvas 或 SVG 畫。
- 視覺乾淨專業：淺色底、深藍為主色、清楚的層級與間距。
- 控制在 650 行以內；不要用 alert、confirm、prompt、fetch；程式不可有錯誤。` }] });
  const html = extractHtml(r.text);
  if (!html) throw new KmError(r.truncated ? 'Demo 內容太長被截斷，請縮小範圍再交辦一次。' : 'Demo 的格式不完整，請再交辦一次。');
  const tm = /<title>([^<]{1,80})<\/title>/i.exec(html);
  const title = (tm && tm[1].trim()) || `${c.name} 產品 Demo`;
  return {
    summary: `「${cut(title, 30)}」已做好：下載後用瀏覽器打開就能操作${cfg.publicBaseUrl ? '，手機也可以直接點連結' : ''}。`,
    detail: '', files: [fileOut(fn(c, safeName(title), 'html'), Buffer.from(html, 'utf8'), 'demo')], sources: dataSources(c, pc ? ['POC 規劃'] : []), confirm: '待確認', out: { kind: 'demo', title, programId: P ? P.id : null },
  };
}

/* ---------- 5e 計畫短片 ---------- */
async function video(c, p, ctl, ui) {
  const P = pickProgram(c, p.program_id), pc = c.poc;
  const m = /(\d{2,3})\s*秒/.exec(p.focus || ''); const dur = Math.min(120, Math.max(45, m ? +m[1] : 75));
  const d = await LLM.json({ label: 'video', signal: ctl.signal, system: HDR(), messages: [{ role: 'user', content: `同事交辦：「${p.focus || '做一支計畫短片'}」。請為這個案件規劃一支約 ${dur} 秒的「計畫短片」分鏡，用途是向${P ? '審查委員與' : ''}客戶說明這個計畫。影片由程式自動產生動態圖文、字幕與配樂，每個畫面只能用下列版型：
- title：{"type":"title","heading":"片名 18 字內","sub":"副標 24 字內"}
- problem：{"type":"problem","heading":"…","points":["3 點，各 18 字內"]}
- stat：{"type":"stat","heading":"…","value":"關鍵數字，例如 30%、6 人、2,400 萬","label":"數字說明 20 字內"}
- solution：{"type":"solution","heading":"…","cards":[{"title":"8 字內","text":"20 字內"}]}（3 張）
- flow：{"type":"flow","heading":"…","steps":["3–5 步，各 8 字內"]}
- demo：{"type":"demo","heading":"…","caption":"畫面說明 24 字內","labels":["畫面上 3 個功能標籤，各 6 字內"]}
- kpi：{"type":"kpi","heading":"…","items":[{"name":"10 字內","target":"目標值","pct":0到100的示意進度}]}（3–4 項）
- timeline：{"type":"timeline","heading":"…","milestones":[{"when":"M1–M3","what":"10 字內"}]}（3–5 個）
- closing：{"type":"closing","heading":"結語 16 字內","sub":"24 字內"}
每個畫面都要有 "narration"（旁白字幕，口語，每秒約 4 個字）與 "seconds"（4–12 的整數）。

${caseContext(c, { chat: p.chat })}
${P ? `【計畫】${P.name}（${P.short || ''}）：${cut(P.summary, 160)}\n${analysisFor(c, P.id)}` : ''}
${pc ? `【POC】${pc.title}：${pc.objective}；KPI：${arr(pc.kpi).map(x => `${x.name} ${x.target}${x.unit || ''}`).join('、')}` : ''}

只回覆一個 JSON 物件：{"title":"影片名稱","scenes":[…]}
規則：7–9 個畫面，第一個 title、最後一個 closing，中間要有 problem 與 solution；seconds 加總約 ${dur}；數字只能用上方資料中有的，沒有的改用質化描述或標「預估」；繁體中文。` }] });
  const sc = arr(d && d.scenes).filter(s => s && FILM_TYPES.includes(s.type));
  if (sc.length < 3) throw new KmError('分鏡格式不完整，請再交辦一次。');
  sc.forEach(s => { s.seconds = Math.min(14, Math.max(3, Math.round(num(s.seconds) || 7))); });
  const sb = { title: d.title || `${c.name} 計畫短片`, scenes: sc, company: c.name, program: P ? (P.short || P.name) : '' };
  ui && ui.progress('分鏡完成，開始算圖與配樂…');
  let mp4 = await renderFilm(sb, { signal: ctl.signal, onProgress: f => ui && ui.progress(`影片算圖中 ${Math.round(f * 100)}%`) });
  if (mp4.length > cfg.uploadLimitMB * 1024 * 1024 * 0.95 && !cfg.publicBaseUrl) mp4 = await renderFilm(sb, { signal: ctl.signal, crf: 33, fps: 20 });
  const total = filmTotal(sb);
  return {
    summary: `「${cut(sb.title, 30)}」${sc.length} 個畫面、約 ${total} 秒，含字幕與配樂。`,
    detail: `**分鏡**\n${sc.map((s, i) => `${i + 1}. ${s.heading || s.type}（${s.seconds} 秒）`).join('\n')}`,
    files: [fileOut(fn(c, safeName(sb.title), 'mp4'), mp4, 'video'), fileOut(fn(c, '分鏡稿', 'md'), Buffer.from(storyboardMd(sb), 'utf8'))],
    sources: dataSources(c, pc ? ['POC 規劃'] : []), confirm: '待確認', out: { kind: 'video', title: sb.title, programId: P ? P.id : null, storyboard: sb },
  };
}

/* ---------- 5f 科專計畫書草稿 ---------- */
async function proposal(c, p, ctl) {
  const P = pickProgram(c, p.program_id);
  if (!P) throw new KmError('還不知道要申請哪個計畫。請先說計畫名稱，或讓我先做科專媒合。');
  const k = KZ.kb || {};
  const d = await LLM.json({ label: 'proposal', tier: 'heavy', maxTokens: 14000, signal: ctl.signal, system: HDR(), messages: [{ role: 'user', content: `同事交辦：「${p.focus || '幫忙申請科專'}」。請依「${P.name}」的審查重點，為這家企業撰寫計畫書草稿，讓顧問與客戶修改後送件。送件與簽核由顧問和客戶負責，你只寫草稿。

${caseContext(c, { chat: p.chat })}
${c.poc ? `【POC 規劃】${c.poc.title}：${c.poc.objective}；KPI：${arr(c.poc.kpi).map(x => `${x.name} ${x.target}${x.unit || ''}`).join('、')}` : ''}

【計畫】
${programFull(P)}
${analysisFor(c, P.id)}
【計畫書常見章節與要點】
${arr(k.proposal_outline).map(s => `- ${s.section}：${arr(s.points).join('；')}`).join('\n')}
【共通審查重點】${arr(k.review_focus).slice(0, 8).map(x => cut(x, 80)).join('；')}
【常見不通過原因】${arr(k.rejection_reasons).slice(0, 8).map(x => cut(x, 70)).join('；')}
【經費科目說明】${arr(k.budget_items).slice(0, 8).map(b => `${b.item}：${cut(b.note, 80)}`).join('；')}

只回覆一個 JSON 物件：
{"title":"計畫名稱（題目）","track":"申請類別或 Phase","summary_table":[{"label":"計畫名稱|申請單位|計畫期程|總經費|申請補助|自籌款|核心 KPI","value":"…"}],"sections":[{"heading":"章節名稱","paragraphs":["段落"],"bullets":["要點"]}],"budget":{"rows":[["科目","金額（萬元）","說明"]],"note":"補助比例與上限說明"},"kpi":[{"name":"…","target":"…","unit":"…","basis":"計算依據"}],"milestones":[{"when":"M1–M3","what":"查核點"}],"checklist":["申請前要準備的文件與資格檢查"],"todo_for_consultant":["顧問要補的資訊或要做的決定"],"risks_to_avoid":["這份計畫最容易被扣分的地方與寫法建議"]}
規則：sections 依上方常見章節排序，每章 1–3 段、每段 80–200 字，具體寫出這家企業的問題、做法與效益；金額用萬元，補助款不得超過計畫上限且符合補助比例；企業沒提供的事實一律寫【待補：…】，不可編造；checklist 依計畫需備文件；繁體中文、公文語氣但好讀。` }] });
  if (!d || !arr(d.sections).length) throw new KmError('計畫書格式不完整，請再交辦一次。');
  const B = [{ p: `申請計畫：${P.name}${d.track ? `・${d.track}` : ''}`, muted: true }, { p: `受理狀態：${timing(P)}`, muted: true }];
  if (arr(d.summary_table).length) B.push({ h: '計畫摘要' }, { table: { headers: ['項目', '內容'], rows: arr(d.summary_table).map(x => [x.label, x.value]) } });
  arr(d.sections).forEach((s, i) => { B.push({ h: `${i + 1}. ${s.heading}` }); arr(s.paragraphs).forEach(t => B.push({ p: t })); if (arr(s.bullets).length) B.push({ ul: s.bullets }); });
  if (d.budget && arr(d.budget.rows).length) { const rows = arr(d.budget.rows).filter(r => arr(r).length >= 2 && !/科目/.test(String(r[0]))); B.push({ h: '經費概估' }, { table: { headers: ['科目', '金額（萬元）', '說明'], rows } }); if (d.budget.note) B.push({ p: d.budget.note, muted: true }); }
  if (arr(d.kpi).length) B.push({ h: '預期效益與 KPI' }, { table: { headers: ['KPI', '目標', '計算依據'], rows: arr(d.kpi).map(x => [x.name, `${x.target ?? ''}${x.unit ? ' ' + x.unit : ''}`, x.basis]) } });
  if (arr(d.milestones).length) B.push({ h: '執行時程與查核點' }, { table: { headers: ['時間', '查核點'], rows: arr(d.milestones).map(m => [m.when, m.what]) } });
  if (arr(d.checklist).length) B.push({ h: '申請文件檢核表' }, { ul: d.checklist.map(x => `☐ ${x}`) });
  if (arr(d.risks_to_avoid).length) B.push({ h: '審查扣分風險與寫法建議' }, { ul: d.risks_to_avoid });
  if (arr(d.todo_for_consultant).length) B.push({ h: '顧問待補與待決定' }, { ul: d.todo_for_consultant });
  B.push({ p: '本文件為孔明產生的草稿，送件、簽核與對外使用前須經顧問與客戶確認。', muted: true });
  const doc = await buildDocx(`${d.title || c.name}｜${P.short || P.name} 計畫書草稿`, B);
  return {
    summary: `「${cut(d.title || P.name, 30)}」計畫書草稿 ${arr(d.sections).length} 章，含經費、KPI、查核點與申請文件檢核表。受理狀態：${timing(P)}。`,
    detail: [arr(d.todo_for_consultant).length ? `**需要你補或決定**\n${lis(d.todo_for_consultant, 6)}` : '', `**送件提醒**：送件與簽核由顧問和客戶處理，我只負責草稿。`].filter(Boolean).join('\n\n'),
    files: [fileOut(fn(c, `${safeName(P.short || P.name)}_計畫書草稿`, 'docx'), doc)], sources: dataSources(c, [kzSrc()]), confirm: '待確認', out: { kind: 'proposal', title: `${P.short || P.name} 計畫書草稿`, programId: P.id },
    claims: [...arr(d.summary_table).map(x => `${x.label}：${x.value}`), ...arr(d.sections).map(x => `${x.heading}：${arr(x.paragraphs).join(' ')} ${arr(x.bullets).join('；')}`), ...arr(d.kpi).map(x => `KPI ${x.name} ${x.target}${x.unit || ''}（${x.basis || ''}）`), ...arr(d.budget && d.budget.rows).map(r => arr(r).join(' '))].join('\n'),
  };
}

const RUN = { prep, ingest, debrief, status, match, poc, deck, demo, video, proposal };
export const EXTRA = {};
export async function runTask(kind, c, params, ctl, ui) {
  const f = RUN[kind] || EXTRA[kind];
  if (!f) throw new KmError('我還不會這項工作。');
  return await f(c, params || {}, ctl, ui);
}
