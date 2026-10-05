// 每日商機專欄：沒有拜訪行程時，孔明自己研究可以去推的廠商或單位，備好提案方向
import fs from 'node:fs';
import path from 'node:path';
import * as LLM from './llm.js';
import { cfg } from './config.js';
import * as store from './store.js';
import { arr, cut, isoDay, nowISO, parseJsonLoose, KmError, logger } from './util.js';
import { KZ, applyProfile, stGroup, timing, catalogLine } from './domain.js';
import { HDR, FIELD_RULES } from './tasks.js';
import { library } from './tasks2.js';
import { tendersFor, tenderLines } from './tenders.js';
import { personBrief } from './people.js';
import { busyNames, diversityHint } from './governance.js';
import { playbooks, capabilities, expertLines } from './expertise.js';
import { kbContext } from './kb.js';

const log = logger('scout');
const hFile = () => path.join(cfg.dataDir, 'scout.json');
export const scoutHistory = () => { try { return JSON.parse(fs.readFileSync(hFile(), 'utf8')); } catch (e) { return { picks: [], feedback: [] }; } };
const saveH = h => { fs.mkdirSync(cfg.dataDir, { recursive: true }); fs.writeFileSync(hFile(), JSON.stringify(h, null, 1)); };

export function recordFeedback(caseId, verdict, by, reason = '', byId = '') {
  const h = scoutHistory(); const p = h.picks.find(x => x.caseId === caseId);
  if (p) { p.verdict = verdict; p.by = by; p.reason = reason; p.at2 = nowISO(); }
  h.feedback.push({ caseId, name: p && p.name, verdict, reason, by, byId, forUser: p && p.forUser, at: nowISO() }); h.feedback = h.feedback.slice(-100);
  saveH(h);
  return p;
}

/** 選對象＋研究對象。target 有值時直接研究指定的單位 */
export async function scoutPick({ target = '', focus = '', signal, forUser = null } = {}) {
  const h = scoutHistory();
  const uid = forUser && forUser.id;
  const today = isoDay();
  const mineOrToday = h.picks.filter(p => !uid || p.forUser === uid || p.day === today);
  const recent = mineOrToday.slice(-40).map(p => `${p.name}（${p.type === 'agency' ? '單位' : '企業'}${p.verdict ? '，顧問評價：' + p.verdict + (p.reason ? '／' + p.reason : '') : ''}）`).join('、');
  const fbBase = uid ? h.feedback.filter(f => f.byId === uid || !f.byId) : h.feedback;
  const liked = fbBase.filter(f => f.verdict === '採用').slice(-10).map(f => f.name).join('、');
  const disliked = fbBase.filter(f => f.verdict === '不適合').slice(-10).map(f => `${f.name}${f.reason ? '（' + f.reason + '）' : ''}`).join('、');
  const cases = store.listCases().slice(0, 30).map(c => c.name).join('、');
  const openKz = KZ.programs.filter(p => stGroup(p.status) === '受理中' || arr(p.deadlines).length).map(p => `${p.short || p.name}：${timing(p)}`).join('；');
  const won = library().slice(0, 8).map(x => `${x.title}（${x.industry || ''}，${x.program || ''}，${x.result || ''}）`).join('；');
  const web = LLM.canWebSearch();
  let tz = [];
  if (target) { try { tz = await tendersFor(target); } catch (e) {} }
  const r = await LLM.text({ label: 'scout', tier: 'heavy', maxTokens: 9000, signal, webSearch: web ? 10 : false, system: HDR(), messages: [{ role: 'user', content: `${target ? `顧問要你研究「${target}」，評估團隊可以怎麼去提案。` : '今天你要替顧問團隊寫「每日商機專欄」：自己挑一個團隊值得主動去推的對象（企業，或政府機關／法人／公協會等單位），研究清楚，提出一個可以去提案的方案方向。'}

【團隊定位】${cfg.org}：協助企業與單位做 AI 導入、數位轉型、數據應用，並協助申請政府科專與補助。${cfg.scoutFocus ? `\n【團隊這陣子想推的方向】${cfg.scoutFocus}` : ''}${focus ? `\n【這次的指定方向】${focus}` : ''}${uid ? '\n' + personBrief(uid, h) + '\n（以這位顧問的輪廓為主，團隊方向為輔；今天其他同事已經拿到的推薦不要重複）' : ''}
【目前受理中或即將開放的政府計畫】${openKz || '—'}
【團隊做過的成功案例】${won || '尚無'}
【已有案件，不要重複】${cases || '無'}
【院內已經有人在跑的客戶，不要推薦】${busyNames().slice(0, 80).join('、') || '無'}
${target ? '' : diversityHint()}
【老顧問的提案心法】${arr((playbooks().craft || {}).sales).join(' ')}
${capabilities().length ? `【院內協作單位（方案需要時可寫進 why_us，例如「可結合○○的能力」）】\n${expertLines(capabilities().slice(0, 12))}` : ''}
${kbContext([target, focus, cfg.scoutFocus].filter(Boolean).join(' ') || '提案 商機 合作', 2)}
${tz.length ? `【政府電子採購網查到的相關公開標案（已查證，可直接引用）】\n${tenderLines(tz)}\n` : ''}${target ? '' : `【最近推薦過，不要重複】${recent || '無'}\n【顧問喜歡的推薦】${liked || '尚無'}\n【顧問覺得不適合的推薦】${disliked || '尚無'}（避開類似的）`}

${web ? `請用網路搜尋做研究。${target ? '' : '挑對象的原則：近期有明確動機（擴廠、新產線、缺工、出口受關稅衝擊、ESG／碳盤查壓力、得到政府計畫、單位剛公布新政策或預算），規模適合（中小企業或中堅企業；單位則是有相關業務的機關、法人或公協會），而且團隊的能力幫得上。'}
如果對象是企業：查公司官網、產品與客戶、規模、據點、近兩年新聞、同業動態。
如果對象是政府機關、法人或公協會：查它的業務職掌、組織與轄下單位、年度施政重點與預算、正在推的計畫、近期標案或委辦案、對外合作方式，弄清楚它在做什麼、要的是什麼。
也要找出可以接觸的公開窗口：企業官網的聯絡我們、業務或公關信箱、公司總機；單位的承辦科室、業務聯絡電話與信箱、標案公告上的承辦人（政府公告公開的公務聯絡資訊）。只採用官方網站、政府公告等公開來源，每一筆都要附來源網址；不要用個人社群帳號、私人手機、推測出來的信箱格式。查不到就寫查不到。
只採用查得到來源的資訊，查不到的不要猜。` : '目前無法上網，請只根據你確定的公開常識挑選，所有細節標「待查證」。'}

最後只輸出一個 JSON 物件（前面可以有搜尋過程，最後一段必須是 JSON）：
{"type":"company|agency","name":"對象名稱","one_liner":"一句話說明為什麼現在是推它的好時機","about":"對象在做什麼，3–4 句","facts":[{"label":"…","value":"…","source":"網址"}],"signals":[{"date":"YYYY-MM 或空","what":"近期動態或動機","source":"網址"}],"unit_focus":["（單位才填）它目前的施政重點、正在推的計畫、預算或標案方向"],"pain_hypotheses":["推測的痛點或需求，要驗證"],"solution":{"title":"方案名稱 20 字內","summary":"方案在做什麼，2–3 句","features":["核心功能 3–5 項"],"value":"對對象的價值，一兩句","why_us":"為什麼團隊適合做，一兩句"},"channel":"提案管道：企業寫可以搭配的政府計畫或直接合作；單位寫可能的合作方式（委辦、標案、共同推動計畫、示範場域）","contacts":[{"who":"單位、科室或職稱（公開資料上有姓名才寫）","phone":"公開的總機或業務電話","email":"公開的聯絡信箱","source":"網址"}],"tenders":[{"date":"YYYY-MM-DD","title":"標案名稱","budget":"預算","deadline":"截止日","contact":"承辦單位與聯絡方式","source":"網址"}],"first_step":"顧問第一步可以怎麼接觸（找哪個窗口、用什麼理由開口）","risks":["風險或不確定"],"profile_updates":{}}
規則：${FIELD_RULES}；單位的 industry 填「其他」、capital 與 employees 留空；繁體中文。` }] });
  const d = parseJsonLoose(r.text);
  if (!d || !d.name || !d.solution) throw new KmError('今天的研究結果不完整，請稍後再請我推薦一次。');
  d.sources = arr(r.sources).slice(0, 15); d.web = web;
  // 沒指定對象時，選好之後再補查標案
  if (!target && d.name) { try { tz = await tendersFor(d.name, arr(d.solution && d.solution.features).slice(0, 1)); } catch (e) {} }
  if (tz.length) d.tenders = [...tz.map(t => ({ date: t.date, title: t.title, budget: t.budget, deadline: t.deadline, contact: t.contact ? [t.contact.unit, t.contact.person, t.contact.phone, t.contact.email].filter(Boolean).join(' ') : '', source: t.link || '' })), ...arr(d.tenders)].slice(0, 8);
  for (const t of tz) if (t.contact && (t.contact.phone || t.contact.email) && !arr(d.contacts).some(x => (t.contact.email && x.email === t.contact.email) || (t.contact.person && String(x.who || '').includes(t.contact.person)))) (d.contacts ??= []).unshift({ who: [t.contact.unit, t.contact.person ? t.contact.person + '（標案承辦）' : '標案承辦'].filter(Boolean).join(' '), phone: t.contact.phone, email: t.contact.email, source: t.link });
  return d;
}

/** 把研究結果建成一個「孔明推薦」案件 */
export function scoutCase(d, guildId, forUser = null) {
  const c = store.createCase(d.name, guildId);
  c.scout = { at: nowISO(), type: d.type, one_liner: d.one_liner, solution: d.solution, channel: d.channel, first_step: d.first_step, unit_focus: arr(d.unit_focus) };
  c.profile.desc = cut(`${d.solution.title}：${d.solution.summary}`, 120);
  applyProfile(c, d.profile_updates, '孔明主動研究（網路公開資訊）');
  if (d.type === 'agency') c.profile.industry = c.profile.industry || '其他';
  c.research = { summary: d.about, facts: arr(d.facts), news: arr(d.signals).map(s => ({ date: s.date, title: s.what, source: s.source })), pain_hypotheses: arr(d.pain_hypotheses), sources: d.sources, at: nowISO(), web: d.web, unit_focus: arr(d.unit_focus), type: d.type };
  c.facts.push({ label: '孔明推薦理由', value: cut(d.one_liner, 80), source: '每日商機專欄', at: nowISO() });
  if (d.channel) c.facts.push({ label: '提案管道', value: cut(d.channel, 80), source: '每日商機專欄', at: nowISO() });
  for (const x of arr(d.contacts).slice(0, 5)) c.facts.push({ label: `公開窗口：${cut(x.who, 30)}`, value: [x.phone, x.email].filter(Boolean).join('｜') || '—', source: x.source || '公開資料', at: nowISO() });
  for (const t of arr(d.tenders).slice(0, 5)) c.facts.push({ label: `公開標案 ${t.date || ''}`, value: cut(`${t.title}${t.budget ? `（${t.budget}）` : ''}`, 80), source: t.source || '政府電子採購網', at: nowISO() });
  c.scout.contacts = arr(d.contacts); c.scout.tenders = arr(d.tenders);
  store.saveCase(c);
  const h = scoutHistory(); h.picks.push({ caseId: c.id, name: d.name, type: d.type, at: nowISO(), day: isoDay(), forUser: forUser && forUser.id });
  if (forUser) { c.scout.forUser = forUser.id; c.scout.forName = forUser.name; store.saveCase(c); } h.picks = h.picks.slice(-200); saveH(h);
  log.info(`今日推薦：${d.name}（${d.type}）`);
  return c;
}

export function columnText(d, c, extra = {}) {
  const s = d.solution || {};
  const L = [`**孔明的每日商機專欄｜${isoDay().slice(5).replace('-', '/')}${extra.forName ? `｜給 ${extra.forName}` : ''}**`, `## ${d.name}${d.type === 'agency' ? '（單位）' : ''}`, d.one_liner, '',
    `**它在做什麼**\n${d.about}`];
  if (arr(d.unit_focus).length) L.push('', `**它現在在推**\n${arr(d.unit_focus).slice(0, 5).map(x => `• ${x}`).join('\n')}`);
  if (arr(d.signals).length) L.push('', `**近期動態**\n${arr(d.signals).slice(0, 4).map(x => `• ${x.date ? x.date + ' ' : ''}${x.what}`).join('\n')}`);
  if (arr(d.pain_hypotheses).length) L.push('', `**可能的需求**\n${arr(d.pain_hypotheses).slice(0, 4).map(x => `• ${x}`).join('\n')}`);
  L.push('', `**提案方向：${s.title}**\n${s.summary}${arr(s.features).length ? '\n' + arr(s.features).slice(0, 5).map(x => `• ${x}`).join('\n') : ''}${s.value ? `\n價值：${s.value}` : ''}`);
  if (extra.kz) L.push('', `**可以搭配的科專**\n${extra.kz}`);
  else if (d.channel) L.push('', `**提案管道**\n${d.channel}`);
  if (arr(d.tenders).length) L.push('', `**相關公開標案**\n${arr(d.tenders).slice(0, 4).map(t => `• ${t.date || ''} ${cut(t.title, 40)}${t.budget ? `（預算 ${t.budget}）` : ''}${t.deadline ? `・截止 ${t.deadline}` : ''}`).join('\n')}`);
  if (arr(d.contacts).length) L.push('', `**公開聯絡窗口**\n${arr(d.contacts).slice(0, 4).map(x => `• ${x.who}${x.phone ? `｜${x.phone}` : ''}${x.email ? `｜${x.email}` : ''}`).join('\n')}\n-# 來自官網或政府公告的公開資訊，聯絡前請再確認。`);
  if (d.first_step) L.push('', `**第一步**：${d.first_step}`);
  if (arr(d.sources).length) L.push('', `-# 來源：${arr(d.sources).slice(0, 4).map(x => `[${cut(x.title, 24)}](${x.url})`).join('・')}`);
  else if (!d.web) L.push('', '-# 目前的模型設定無法上網，細節請查證。');
  return L.join('\n');
}
export { catalogLine };
