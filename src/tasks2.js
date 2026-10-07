// 進階職能：企業研究（上網）、效益試算（Excel）、結案與案例知識庫、記住同事的偏好
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import * as LLM from './llm.js';
import { cfg } from './config.js';
import { arr, cut, isoDay, nowISO, uid, num, safeName, parseJsonLoose, KmError } from './util.js';
import { FBY, KZ, NEEDS, applyProfile, profileText, missingFields } from './domain.js';
import { TASKS, EXTRA, CTX, HDR, FIELD_RULES, caseContext, dataSources } from './tasks.js';
import { buildDocx } from './files/docs.js';
import { filterResearchSources } from './web-research.js';

const fileOut = (name, buffer, desc) => ({ name, buffer, desc });
const fn = (c, base, ext) => `${safeName(c.name)}_${base}.${ext}`;
const lis = (a, n = 6) => arr(a).slice(0, n).map(x => `• ${typeof x === 'string' ? x : JSON.stringify(x)}`).join('\n');
const rd = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(cfg.dataDir, f), 'utf8')); } catch (e) { return d; } };
const wr = (f, o) => { fs.mkdirSync(cfg.dataDir, { recursive: true }); fs.writeFileSync(path.join(cfg.dataDir, f), JSON.stringify(o, null, 1)); };

Object.assign(TASKS, {
  research: { title: '企業研究：公司、產業與同業', short: '企業研究', step: 1 },
  roi: { title: '效益試算（Excel）', short: '效益試算', step: 5 },
  closeout: { title: '結案：案例整理與知識庫', short: '結案整理', step: 4 },
});

/* ---------- 案例知識庫 ---------- */
export const library = () => rd('library.json', []);
CTX.similar = c => {
  const L = library().filter(x => x.caseId !== c.id);
  if (!L.length) return '';
  const needs = new Set(arr(c.profile.needs)), ind = c.profile.industry;
  const scored = L.map(x => ({ x, s: (x.industry && x.industry === ind ? 3 : 0) + arr(x.needs).filter(n => needs.has(n)).length * 2 + (x.result === '通過' || x.result === '成案' ? 1 : 0) })).filter(r => r.s > 0).sort((a, b) => b.s - a.s).slice(0, 3);
  return scored.map(({ x }) => `- ${x.title || x.name}｜${x.name}（${x.industry || '—'}，${x.program || '未申請科專'}，結果：${x.result || '—'}）：痛點 ${cut(arr(x.pains).join('、'), 60)}；做法 ${cut(x.approach, 80)}；學到 ${cut(arr(x.lessons).join('；'), 100)}`).join('\n');
};

/* ---------- 同事與團隊的偏好 ---------- */
export const prefsAll = () => rd('prefs.json', { team: [], users: {} });
export function addPref(userId, userName, text, scope = 'user') {
  const P = prefsAll(); const t = cut(String(text).trim(), 120); if (!t) return false;
  if (scope === 'team') { if (!P.team.includes(t)) P.team.push(t); P.team = P.team.slice(-30); }
  else { const u = (P.users[userId] ??= { name: userName, items: [] }); u.name = userName; if (!u.items.includes(t)) u.items.push(t); u.items = u.items.slice(-15); }
  wr('prefs.json', P); return true;
}
export function removePref(userId, idx, scope) {
  const P = prefsAll(); const L = scope === 'team' ? P.team : (P.users[userId] || { items: [] }).items;
  if (idx < 0 || idx >= L.length) return null; const [x] = L.splice(idx, 1); wr('prefs.json', P); return x;
}
CTX.prefs = userId => {
  userId = userId || (LLM.als.getStore() || {}).userId || CTX.user;
  const P = prefsAll(), u = userId && P.users[userId];
  let coach = '';
  try { const pp = JSON.parse(fs.readFileSync(path.join(cfg.dataDir, 'people.json'), 'utf8'))[userId]; if (pp && pp.coach) coach = `- （${pp.name}）開啟新手模式：每個問題、段落或數字後面附一句「為什麼這樣問／這樣寫／這樣估」，並在最後列 3 個請他先自己想清楚、再拿去用的問題。`; } catch (e) {}
  return [...P.team.map(t => `- （團隊）${t}`), ...(u ? u.items.map(t => `- （${u.name}）${t}`) : []), coach].filter(Boolean).join('\n');
};

/* ---------- 企業研究 ---------- */
EXTRA.research = async (c, p, ctl, ui) => {
  const name = c.profile.name || c.name;
  if (!name || name === '新案件') throw new KmError('請先告訴我企業名稱。');
  const web = LLM.canWebSearch();
  ui && ui.progress(web ? '上網查公司官網、新聞與同業…' : '整理已知資料…');
  const r = await LLM.text({ label: 'research', tier: 'default', maxTokens: 8000, signal: ctl.signal, webSearch: web ? 8 : false, webQuery: name + ' 官方網站 公司產品 公開聯絡窗口 近期新聞 產業 同業 政府公告', system: HDR(), messages: [{ role: 'user', content: `顧問要拜訪「${name}」，請做訪前企業研究。${web ? '請用網路搜尋查：公司官網（產品、客戶產業、據點、規模）、近兩年新聞（擴廠、得獎、合作、裁員、訂單、關稅影響）、政府計畫或補助紀錄、主要同業與產業趨勢、公開的聯絡窗口（官網聯絡信箱、公司總機、業務或公關窗口）。如果對象是政府機關、法人或公協會，改查它的業務職掌、組織、年度施政重點與預算、正在推的計畫、近期標案或委辦案（政府電子採購網 web.pcc.gov.tw）、對外合作方式與承辦單位。只採用查得到來源的資訊，查不到的不要猜。' : '目前無法上網，只能根據下方資料整理，並列出需要顧問自己查證的項目。'}

${profileText(c)}
${p.focus ? `交辦重點：${p.focus}` : ''}

最後只輸出一個 JSON 物件（前面可以有搜尋過程，但最後一段必須是 JSON）：
{"summary":"3–4 句企業概況","facts":[{"label":"…","value":"…","source":"網址或「已知資料」"}],"news":[{"date":"YYYY-MM 或空","title":"…","why":"對這次拜訪的意義","source":"網址"}],"industry":["產業趨勢或政策重點"],"peers":[{"name":"同業","note":"做了什麼（例如導入 AI、拿過哪個科專）"}],"pain_hypotheses":["根據研究推測的可能痛點，訪談時要驗證"],"talking_points":["開場可以聊的話題"],"contacts":[{"who":"單位或職稱（公開資料上有寫姓名才寫姓名）","phone":"官方公開的總機或業務電話","email":"官方公開的聯絡信箱","source":"網址"}],"profile_updates":{},"verify":["需要顧問或客戶確認的資訊"]}
規則：${FIELD_RULES}；只放查得到的；繁體中文。` }] });
  const d = parseJsonLoose(r.text);
  if (!d || !d.summary) throw new KmError('研究結果格式不完整，請再交辦一次。');
  const srcs = arr(r.sources).slice(0, 30);
  if (web && cfg.llmProvider === 'openai') filterResearchSources(d, srcs);
  if (r.searchTruncated) (d.verify ??= []).push('搜尋摘要被截斷，請補查來源；本次研究不保證完整。');
  c.research = { ...d, sources: srcs, at: nowISO(), web };
  const up = applyProfile(c, d.profile_updates, '企業研究（網路公開資訊）');
  const B = [{ p: `查詢時間：${new Date().toLocaleString('zh-TW', { timeZone: cfg.timezone })}｜${web ? '公開網頁搜尋' : '僅整理已知資料'}`, muted: true }, { p: d.summary }];
  if (arr(d.facts).length) B.push({ h: '企業基本資訊' }, { table: { headers: ['項目', '內容', '來源'], rows: arr(d.facts).map(f => [f.label, f.value, f.source || '']) } });
  if (arr(d.news).length) B.push({ h: '近期新聞' }, { table: { headers: ['時間', '標題', '對拜訪的意義', '來源'], rows: arr(d.news).map(n => [n.date || '', n.title, n.why, n.source || '']) } });
  if (arr(d.industry).length) B.push({ h: '產業趨勢與政策' }, { ul: d.industry });
  if (arr(d.peers).length) B.push({ h: '同業動態' }, { table: { headers: ['同業', '動態'], rows: arr(d.peers).map(x => [x.name, x.note]) } });
  if (arr(d.pain_hypotheses).length) B.push({ h: '可能痛點（訪談時驗證）' }, { ul: d.pain_hypotheses });
  if (arr(d.talking_points).length) B.push({ h: '開場話題' }, { ul: d.talking_points });
  if (arr(d.contacts).length) B.push({ h: '公開聯絡窗口' }, { table: { headers: ['窗口', '電話', '信箱', '來源'], rows: arr(d.contacts).map(x => [x.who, x.phone || '', x.email || '', x.source || '']) } });
  if (arr(d.verify).length) B.push({ h: '待確認' }, { ul: d.verify });
  if (srcs.length) B.push({ h: '資料來源' }, { ul: srcs.map(s => `${s.title}：${s.url}`) });
  const doc = await buildDocx(`${name} 企業研究`, B);
  return {
    summary: d.summary,
    detail: [arr(d.pain_hypotheses).length ? `**可能痛點（訪談時驗證）**\n${lis(d.pain_hypotheses, 5)}` : '', arr(d.news).length ? `**近期新聞**\n${arr(d.news).slice(0, 4).map(n => `• ${n.date ? n.date + ' ' : ''}${n.title}`).join('\n')}` : '', (() => { const nos = arr(d.facts).filter(f => !/^https?:/.test(String(f.source || ''))); return web && nos.length ? `**沒有網址來源的資訊（請查證後再用）**：${nos.slice(0, 5).map(f => f.label).join('、')}` : ''; })(), srcs.length ? `**來源**\n${srcs.slice(0, 5).map(s => `• [${cut(s.title, 40)}](${s.url})`).join('\n')}` : (web ? '' : '-# 目前的模型設定無法上網，以上只根據已知資料整理。')].filter(Boolean).join('\n\n'),
    files: [fileOut(fn(c, '企業研究', 'docx'), doc)], pending: up.pend, sources: srcs.length ? [`網路公開資訊 ${srcs.length} 個來源`] : dataSources(c),
  };
};

/* ---------- 效益試算（Excel，公式可改） ---------- */
EXTRA.roi = async (c, p, ctl) => {
  const pc = c.poc;
  const d = await LLM.json({ label: 'roi', signal: ctl.signal, system: HDR(), messages: [{ role: 'user', content: `同事交辦：「${p.focus || '做效益試算'}」。請為這個方案做投資效益試算的假設，讓顧問給客戶老闆或審查委員看。試算表會用公式計算，你只要提供假設。

${caseContext(c, { chat: p.chat })}
${pc ? `【POC】${pc.title}：${pc.objective}；KPI：${arr(pc.kpi).map(x => `${x.name} ${x.target}${x.unit || ''}`).join('、')}；成本：${pc.cost_estimate || ''}` : ''}

只回覆一個 JSON 物件：
{"title":"試算名稱","years":3,"investment":[{"item":"一次性投入項目","amount_wan":數字,"basis":"估算依據"}],"annual_cost":[{"item":"每年持續成本","amount_wan":數字,"basis":"…"}],"benefits":[{"item":"效益項目（例如節省人力、降低不良率、增加營收）","qty":數字,"unit":"單位","unit_value_wan":數字,"ramp":[第1年達成比例0到1,第2年,第3年],"basis":"計算依據"}],"grant_wan":數字或0,"notes":["重要假設與風險"]}
規則：金額一律萬元；用上方資料中的數字，沒有的用產業常見值並在 basis 寫「假設，待客戶確認」；效益要保守；grant_wan 是可申請的政府補助（沒有就 0）；繁體中文。` }] });
  if (!d || !arr(d.benefits).length) throw new KmError('試算假設格式不完整，請再交辦一次。');
  const Y = Math.min(5, Math.max(2, num(d.years) || 3));
  const wb = new ExcelJS.Workbook(); wb.creator = '孔明 Kongming';
  const ws = wb.addWorksheet('效益試算', { views: [{ showGridLines: false }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
  const navy = 'FF0A1E5E', soft = 'FFEAF3FB', input = 'FFFFF6D6';
  ws.columns = [{ width: 30 }, { width: 12 }, { width: 10 }, { width: 14 }, ...Array.from({ length: Y }, () => ({ width: 14 })), { width: 44 }];
  const lastCol = 4 + Y + 1;
  const title = ws.addRow([d.title || `${c.name} 效益試算`]); title.font = { bold: true, size: 16, color: { argb: navy } };
  ws.addRow([`${c.name}｜孔明 Kongming 草稿｜${isoDay()}｜單位：萬元｜黃色格是假設，可直接修改`]).font = { color: { argb: 'FF5B6A8E' } };
  ws.addRow([]);
  const hdr = (labels) => { const r = ws.addRow(labels); r.eachCell(x => { x.font = { bold: true, color: { argb: 'FFFFFFFF' } }; x.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: navy } }; }); return r; };
  const yl = Array.from({ length: Y }, (_, i) => `第 ${i + 1} 年`);
  const colL = i => String.fromCharCode(69 + i); // E,F,G...
  // investment
  hdr(['一次性投入', '', '', '金額', ...yl.map(() => ''), '依據']);
  const invStart = ws.rowCount + 1;
  for (const x of arr(d.investment)) { const r = ws.addRow([x.item, '', '', num(x.amount_wan) || 0, ...yl.map(() => ''), x.basis || '']); r.getCell(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: input } }; }
  const invEnd = ws.rowCount;
  const invTot = ws.addRow(['一次性投入合計', '', '', { formula: invEnd >= invStart ? `SUM(D${invStart}:D${invEnd})` : '0' }]); invTot.font = { bold: true };
  ws.addRow([]);
  // annual cost
  hdr(['每年持續成本', '', '', '每年金額', ...yl, '依據']);
  const acStart = ws.rowCount + 1;
  for (const x of arr(d.annual_cost)) { const rn = ws.rowCount + 1; const r = ws.addRow([x.item, '', '', num(x.amount_wan) || 0, ...yl.map((_, i) => ({ formula: `$D${rn}` })), x.basis || '']); r.getCell(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: input } }; }
  const acEnd = ws.rowCount;
  const acTot = ws.addRow(['持續成本合計', '', '', '', ...yl.map((_, i) => ({ formula: acEnd >= acStart ? `SUM(${colL(i)}${acStart}:${colL(i)}${acEnd})` : '0' }))]); acTot.font = { bold: true };
  ws.addRow([]);
  // benefits
  hdr(['效益項目', '數量', '單位', '單位價值', ...yl, '依據（各年為達成比例 × 數量 × 單位價值）']);
  const bStart = ws.rowCount + 1;
  const rampRows = [];
  for (const x of arr(d.benefits)) {
    const rn = ws.rowCount + 1, ramp = arr(x.ramp);
    rampRows.push(ramp);
    const r = ws.addRow([x.item, num(x.qty) || 0, x.unit || '', num(x.unit_value_wan) || 0, ...yl.map((_, i) => ({ formula: `$B${rn}*$D${rn}*${Math.min(1, Math.max(0, num(ramp[i] ?? ramp[ramp.length - 1] ?? 1) ?? 1))}` })), x.basis || '']);
    [2, 4].forEach(k => { r.getCell(k).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: input } }; });
  }
  const bEnd = ws.rowCount;
  const bTot = ws.addRow(['效益合計', '', '', '', ...yl.map((_, i) => ({ formula: `SUM(${colL(i)}${bStart}:${colL(i)}${bEnd})` }))]); bTot.font = { bold: true };
  ws.addRow([]);
  // summary
  hdr(['試算結果', '', '', '', ...yl, '說明']);
  const grantRow = ws.addRow(['政府補助（可申請）', '', '', num(d.grant_wan) || 0, '', '', '', '補助通常分期撥款，這裡簡化為第 1 年']); grantRow.getCell(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: input } };
  const gR = grantRow.number;
  const netR = ws.addRow(['每年淨效益', '', '', '', ...yl.map((_, i) => ({ formula: `${colL(i)}${bTot.number}-${colL(i)}${acTot.number}${i === 0 ? `+$D${gR}` : ''}` }))]);
  const cumR = ws.addRow(['累計現金流（扣一次性投入）', '', '', '', ...yl.map((_, i) => ({ formula: i === 0 ? `${colL(0)}${netR.number}-$D${invTot.number}` : `${colL(i - 1)}${netR.number + 1}+${colL(i)}${netR.number}` }))]);
  const roiR = ws.addRow([`${Y} 年投資報酬率`, '', '', { formula: `IFERROR((SUM(E${netR.number}:${colL(Y - 1)}${netR.number})-D${invTot.number})/D${invTot.number},0)` }]);
  roiR.getCell(4).numFmt = '0.0%'; roiR.font = { bold: true, color: { argb: navy } };
  const pbR = ws.addRow(['回收期（年，概估）', '', '', { formula: `IFERROR(D${invTot.number}/AVERAGE(E${netR.number}:${colL(Y - 1)}${netR.number}),"—")` }]);
  pbR.getCell(4).numFmt = '0.0'; pbR.font = { bold: true, color: { argb: navy } };
  [netR, cumR].forEach(r => { r.font = { bold: true }; r.eachCell(x => { x.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: soft } }; }); });
  ws.addRow([]);
  ws.addRow(['重要假設與風險']).font = { bold: true, color: { argb: navy } };
  for (const n of arr(d.notes)) ws.addRow([`• ${n}`]);
  ws.addRow(['本試算為孔明產生的草稿，對外使用前請顧問與客戶確認假設。']).font = { italic: true, color: { argb: 'FF5B6A8E' } };
  ws.eachRow(r => r.eachCell({ includeEmpty: false }, (x, col) => { if (col >= 4 && col < lastCol && typeof x.value !== 'string') x.numFmt = x.numFmt || '#,##0.0'; }));
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  // quick estimate for the chat message (same formula as the sheet)
  const inv = arr(d.investment).reduce((s, x) => s + (num(x.amount_wan) || 0), 0), ac = arr(d.annual_cost).reduce((s, x) => s + (num(x.amount_wan) || 0), 0);
  const ben = yl.map((_, i) => arr(d.benefits).reduce((s, x, k) => { const ramp = rampRows[k]; return s + (num(x.qty) || 0) * (num(x.unit_value_wan) || 0) * Math.min(1, Math.max(0, num(ramp[i] ?? ramp[ramp.length - 1] ?? 1) ?? 1)); }, 0));
  const net = ben.map((b, i) => b - ac + (i === 0 ? (num(d.grant_wan) || 0) : 0)), tot = net.reduce((a, b) => a + b, 0);
  const roi = inv ? (tot - inv) / inv : 0, pb = inv && tot > 0 ? inv / (tot / Y) : null;
  return {
    summary: `一次性投入 ${inv.toFixed(0)} 萬、每年持續成本 ${ac.toFixed(0)} 萬；${Y} 年淨效益合計 ${tot.toFixed(0)} 萬，投資報酬率約 ${(roi * 100).toFixed(0)}%${pb ? `，回收期約 ${pb.toFixed(1)} 年` : ''}（依目前假設）。`,
    detail: `**效益來源**\n${arr(d.benefits).slice(0, 6).map(x => `• ${x.item}：${x.qty} ${x.unit || ''} × ${x.unit_value_wan} 萬`).join('\n')}\n\n-# 黃色格是假設，可直接在 Excel 裡改，結果會自動重算。`,
    files: [fileOut(fn(c, '效益試算', 'xlsx'), buf)], sources: dataSources(c, pc ? ['POC 規劃'] : []), confirm: '待確認', out: { kind: 'roi', title: d.title || '效益試算' },
  };
};

/* ---------- 結案：整理成案例，存進知識庫 ---------- */
EXTRA.closeout = async (c, p, ctl) => {
  const outs = arr(c.outputs).map(o => `${o.title}（${o.status}）`).join('、');
  const d = await LLM.json({ label: 'closeout', signal: ctl.signal, system: HDR(), messages: [{ role: 'user', content: `顧問要結案，請把這個案件整理成團隊可以重用的案例。

${caseContext(c, { similar: false, chat: p.chat })}
【產出】${outs || '無'}
【POC】${c.poc ? `${c.poc.title}：${c.poc.objective}` : '無'}
【任務紀錄】${arr(c.log).slice(-25).map(l => `${(l.at || '').slice(0, 10)} ${l.title}：${cut(l.result, 50)}`).join('；')}
${p.focus ? `顧問補充：${p.focus}` : ''}

只回覆一個 JSON 物件：
{"title":"案例標題 20 字內","result":"成案|通過|未通過|進行中|未成案（依資料判斷，不確定寫進行中）","program":"申請的計畫簡稱或空字串","pains":["客戶痛點"],"approach":"採取的做法 100 字內","outcomes":["成果或成效（只寫資料有的）"],"lessons":["做得好的、下次要改進的、對類似客戶的建議"],"reusable":["可以重用的產出或模板"],"tags":["產業、技術、計畫等標籤"]}
規則：只根據上方資料；繁體中文、句子簡短。` }] });
  if (!d || !d.title) throw new KmError('案例格式不完整，請再試一次。');
  const L = library().filter(x => x.caseId !== c.id);
  L.unshift({ id: 'k' + uid(6), caseId: c.id, name: c.name, industry: c.profile.industry, needs: arr(c.profile.needs), at: nowISO(), ...d });
  wr('library.json', L.slice(0, 500));
  c.closedAt = nowISO();
  const B = [{ p: `${c.name}｜${c.profile.industry || ''}｜結果：${d.result || '—'}${d.program ? `｜${d.program}` : ''}`, muted: true }, { h: '客戶痛點' }, { ul: d.pains }, { h: '做法' }, { p: d.approach }];
  if (arr(d.outcomes).length) B.push({ h: '成果' }, { ul: d.outcomes });
  if (arr(d.lessons).length) B.push({ h: '經驗與建議' }, { ul: d.lessons });
  if (arr(d.reusable).length) B.push({ h: '可重用的產出' }, { ul: d.reusable });
  const doc = await buildDocx(`案例：${d.title}`, B);
  return {
    summary: `已整理成案例「${d.title}」並存進團隊知識庫（目前 ${L.length} 個案例）。之後遇到類似產業或痛點，我會拿出來參考。`,
    detail: arr(d.lessons).length ? `**經驗與建議**\n${lis(d.lessons, 5)}` : '', files: [fileOut(fn(c, '案例', 'docx'), doc)], sources: dataSources(c, ['任務紀錄', '產出']),
  };
};
