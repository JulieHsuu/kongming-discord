// 每位顧問的工作輪廓：專長產業、地區、偏好的對象、正在跑的案件、對推薦的評價 → 個人化的商機推薦
import fs from 'node:fs';
import path from 'node:path';
import { cfg } from './config.js';
import * as store from './store.js';
import { arr, cut, nowISO } from './util.js';

const f = () => path.join(cfg.dataDir, 'people.json');
const rd = () => { try { return JSON.parse(fs.readFileSync(f(), 'utf8')); } catch (e) { return {}; } };
const wr = o => { fs.mkdirSync(cfg.dataDir, { recursive: true }); fs.writeFileSync(f(), JSON.stringify(o, null, 1)); };

export function person(id) { return rd()[id] || null; }
export function allPeople() { return rd(); }
/** 更新顧問自己說的工作輪廓（只存工作相關資訊） */
export function updatePerson(id, name, patch = {}) {
  const A = rd(); const p = (A[id] ??= { name, focus: '', industries: [], regions: [], targets: '', avoid: '', subscribe: false, deliver: 'dm', updatedAt: null });
  p.name = name || p.name;
  for (const k of ['focus', 'targets', 'avoid']) if (patch[k] != null && String(patch[k]).trim()) p[k] = cut(String(patch[k]).trim(), 200);
  for (const k of ['industries', 'regions']) if (arr(patch[k]).length) p[k] = [...new Set([...arr(p[k]), ...arr(patch[k]).map(String)])].slice(-10);
  if (typeof patch.subscribe === 'boolean') p.subscribe = patch.subscribe;
  if (typeof patch.coach === 'boolean') p.coach = patch.coach;
  if (['新人', '資深', '主管', '專家'].includes(patch.role)) p.role = patch.role;
  if (patch.style != null && String(patch.style).trim()) p.style = cut(String(patch.style).trim(), 120);
  if (patch.title != null && String(patch.title).trim()) p.title = cut(String(patch.title).trim(), 40);
  if (patch.deliver === 'dm' || patch.deliver === 'channel') p.deliver = patch.deliver;
  p.updatedAt = nowISO(); wr(A); return p;
}
export function clearPerson(id) { const A = rd(); delete A[id]; wr(A); }
export const subscribers = () => Object.entries(rd()).filter(([, p]) => p.subscribe).map(([id, p]) => ({ id, ...p }));

/** 從他經手的案件與他對推薦的評價推斷興趣（不需要他填） */
export function inferred(id, history) {
  const mine = store.listCases().filter(c => arr(c.log).some(l => l.by && (l.byId === id || l.by === (person(id) || {}).name)) || c.adoptedById === id);
  const ind = {}, cty = {}, needs = {};
  for (const c of mine) { if (c.profile.industry) ind[c.profile.industry] = (ind[c.profile.industry] || 0) + 1; if (c.profile.county) cty[c.profile.county] = (cty[c.profile.county] || 0) + 1; for (const n of arr(c.profile.needs)) needs[n] = (needs[n] || 0) + 1; }
  const top = o => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0]);
  const fb = arr(history && history.feedback).filter(x => x.byId === id);
  return { cases: mine.slice(0, 8).map(c => c.name), industries: top(ind), counties: top(cty), needs: top(needs), liked: fb.filter(x => x.verdict === '採用').slice(-8).map(x => x.name), disliked: fb.filter(x => x.verdict === '不適合').slice(-8).map(x => `${x.name}${x.reason ? '（' + x.reason + '）' : ''}`), skipped: fb.filter(x => x.verdict === '換一個').slice(-8).map(x => x.name) };
}

/** 給模型看的「這位顧問」描述 */
export function personBrief(id, history) {
  if (!id) return '';
  const p = person(id) || {}, g = inferred(id, history);
  const L = [];
  if (p.focus) L.push(`他說想推的方向：${p.focus}`);
  if (arr(p.industries).length) L.push(`專長產業：${p.industries.join('、')}`);
  if (arr(p.regions).length) L.push(`負責地區：${p.regions.join('、')}`);
  if (p.targets) L.push(`偏好的對象：${p.targets}`);
  if (p.avoid) L.push(`不想要：${p.avoid}`);
  if (g.cases.length) L.push(`經手過的案件：${g.cases.join('、')}`);
  if (g.industries.length) L.push(`經手案件的產業：${g.industries.join('、')}`);
  if (g.counties.length) L.push(`經手案件的地區：${g.counties.join('、')}`);
  if (g.liked.length) L.push(`他採用過的推薦：${g.liked.join('、')}`);
  if (g.disliked.length) L.push(`他說不適合的推薦（避開類似的）：${g.disliked.join('、')}`);
  if (g.skipped.length) L.push(`他跳過的推薦：${g.skipped.join('、')}`);
  return L.length ? `【這篇專欄是寫給 ${p.name || '這位顧問'} 的，請依他的輪廓挑對象】\n${L.join('\n')}` : '';
}

/** 記下這位同事交辦過什麼（跨頻道），讓孔明記得跟每個人談過的事 */
export function noteAsk(id, name, text, caseName, channelId) {
  const A = rd(); const p = (A[id] ??= { name, focus: '', industries: [], regions: [], targets: '', avoid: '', subscribe: false, deliver: 'dm', updatedAt: null });
  p.name = name || p.name;
  p.history = [...arr(p.history), { at: nowISO(), text: cut(text, 160), case: caseName || '', ch: channelId }].slice(-30);
  p.asks = (p.asks || 0) + 1; p.firstSeen = p.firstSeen || nowISO(); p.lastSeen = nowISO();
  wr(A); return p;
}
/** 給「回答這位同事」用的描述：他是誰、手上有什麼、最近問過什麼、要怎麼跟他說話 */
export function speakerBrief(id) {
  const p = person(id); if (!p) return '【正在跟你說話的同事】第一次互動，還不認識他；先依他的問題回答，必要時問一句他負責的範圍。';
  const g = inferred(id, null);
  const role = p.role || (p.asks > 80 ? '' : '');
  const tone = p.role === '新人' ? '他是新人：先講結論，再用一兩句解釋為什麼、提醒常見陷阱，必要時教他下一步怎麼做。' : p.role === '資深' || p.role === '專家' ? '他是資深顧問：直接講重點與數字，不要解釋基本概念，有不同意見可以直接提出。' : p.role === '主管' ? '他是主管：先給全貌與風險，再給需要他決定的事，細節精簡。' : '';
  const L = [`【正在跟你說話的同事：${p.name}${p.title ? `（${p.title}）` : ''}${p.role ? `，${p.role}` : ''}】`];
  if (tone) L.push(tone);
  if (p.style) L.push(`他希望你這樣回答：${p.style}`);
  if (p.focus || arr(p.industries).length || arr(p.regions).length) L.push(`他的工作方向：${[p.focus, arr(p.industries).join('、'), arr(p.regions).join('、')].filter(Boolean).join('；')}`);
  if (g.cases.length) L.push(`他手上或經手過的案件：${g.cases.join('、')}`);
  const h = arr(p.history).slice(-8);
  if (h.length) L.push(`他最近跟你說過：\n${h.map(x => `- ${x.at.slice(5, 16).replace('T', ' ')}${x.case ? `［${x.case}］` : ''} ${x.text}`).join('\n')}`);
  L.push('回答要針對他：他說「這個案子」「那家」「上次那個」時，依上面他的案件與最近對話判斷；判斷不出來就列出他手上的案件請他選，不要猜，也不要拿別人的案件回答他。');
  return L.join('\n');
}
