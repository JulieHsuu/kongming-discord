// 公開標案查詢：政府電子採購網的公開資料（透過 g0v 開放 API），找單位最近在採購什麼、承辦單位與聯絡方式
import { cfg } from './config.js';
import { arr, cut, logger } from './util.js';

const log = logger('tenders');
const BASE = () => cfg.tenderApi;

async function get(url, ms = 12000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': 'Kongming/2.0 (III consultant assistant)' } }); return r.ok ? await r.json() : null; }
  catch (e) { return null; } finally { clearTimeout(t); }
}
const rocToIso = d => { const s = String(d || ''); return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s; };

/** 依關鍵字找近期標案；unit 有值時只留該機關的 */
export async function searchTenders(query, { unit = '', limit = 8 } = {}) {
  if (!cfg.tenderSearch || !query) return [];
  const j = await get(`${BASE()}/searchbytitle?query=${encodeURIComponent(query)}`);
  let rows = arr(j && j.records).map(x => ({ date: rocToIso(x.date), title: x.brief && x.brief.title, type: x.brief && x.brief.type, unit: x.unit_name, unitId: x.unit_id, jobNo: x.job_number, url: x.url ? `https://pcc-api.openfun.app${x.url}` : '' }));
  if (unit) rows = rows.filter(r => String(r.unit || '').includes(unit.replace(/^(行政院|經濟部|臺北市政府|新北市政府)/, '')) || unit.includes(String(r.unit || '')));
  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return rows.slice(0, limit);
}

/** 標案詳細：預算、截止日、承辦單位聯絡方式（政府公告上公開的公務聯絡資訊） */
export async function tenderDetail(row) {
  if (!row || !row.unitId || !row.jobNo) return null;
  const j = await get(`${BASE()}/tender?unit_id=${encodeURIComponent(row.unitId)}&job_number=${encodeURIComponent(row.jobNo)}`);
  const rec = arr(j && j.records).slice(-1)[0]; const D = (rec && rec.detail) || {};
  const pick = re => { const k = Object.keys(D).find(k => re.test(k)); return k ? String(D[k]).trim() : ''; };
  return {
    ...row,
    budget: pick(/預算金額$/), deadline: pick(/截止投標/), status: pick(/^招標方式|標案狀態/),
    contact: { unit: pick(/機關資料:單位名稱|機關資料:機關名稱/), person: pick(/聯絡人/), phone: pick(/聯絡電話/), email: pick(/電子郵件/) },
    link: row.url || 'https://web.pcc.gov.tw/',
  };
}

/** 給模型的提示文字＋給顧問看的清單 */
export async function tendersFor(name, keywords = []) {
  const qs = [...new Set([name, ...arr(keywords)].filter(Boolean))].slice(0, 4);
  const seen = new Set(), rows = [];
  for (const q of qs) for (const r of await searchTenders(q, { unit: q === name ? name : '' })) { const k = r.unitId + r.jobNo; if (!seen.has(k)) { seen.add(k); rows.push(r); } }
  const top = rows.sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 6);
  const det = [];
  for (const r of top.slice(0, 4)) det.push((await tenderDetail(r)) || r);
  for (const r of top.slice(4)) det.push(r);
  if (det.length) log.info(`${name}：找到 ${det.length} 筆公開標案`);
  return det;
}
export const tenderLines = list => arr(list).map(t => `- ${t.date || ''}｜${t.unit || ''}｜${cut(t.title, 60)}${t.budget ? `｜預算 ${t.budget}` : ''}${t.deadline ? `｜截止 ${t.deadline}` : ''}${t.contact && (t.contact.phone || t.contact.email) ? `｜承辦：${[t.contact.unit, t.contact.person, t.contact.phone, t.contact.email].filter(Boolean).join(' ')}` : ''}`).join('\n');
