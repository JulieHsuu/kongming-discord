// 孔明的「老顧問」經驗：產業打法、常見痛點與 KPI 經驗值、訪談與科專審查的眉角、院內協作單位
// 這些是內建的經驗，不需要從頭教；院內可以修改 data/playbooks.json，或在 state 目錄放同名檔案覆蓋。
import fs from 'node:fs';
import path from 'node:path';
import { cfg, ROOT } from './config.js';
import { arr, cut } from './util.js';

const rdJson = (f, d) => { for (const p of [path.join(cfg.dataDir, f), path.join(ROOT, 'data', f)]) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) {} } return d; };
let PB = null;
export function playbooks() { return PB || (PB = rdJson('playbooks.json', { craft: {}, industries: {}, needs: {} })); }
export function reloadPlaybooks() { PB = null; return playbooks(); }

const pick = (ind) => { const I = playbooks().industries || {}; if (!ind) return null; if (I[ind]) return [ind, I[ind]]; const k = Object.keys(I).find(k => k.startsWith(String(ind).slice(0, 2))); return k ? [k, I[k]] : null; };
// 不同工作需要的經驗不同
const CRAFT_BY_KIND = { prep: ['interview', 'pitfalls'], debrief: ['interview'], research: ['interview'], poc: ['pitfalls'], deck: ['sales', 'review'], proposal: ['review', 'proposal'], match: ['proposal'], scout: ['sales'], roi: ['sales'], router: ['pitfalls'], outreach: ['sales'] };
const CRAFT_LABEL = { interview: '訪談', review: '科專審查', proposal: '計畫書', sales: '提案與成交', pitfalls: '常見地雷' };

/** 給模型的老顧問經驗（依產業、需求與工作類型挑） */
export function expertBrief(c, kind = 'router') {
  const P = playbooks(), L = [];
  const ind = c && c.profile && c.profile.industry, hit = pick(ind);
  if (hit) {
    const [name, x] = hit;
    L.push(`【老顧問經驗：${name}】`);
    if (arr(x.pains).length) L.push(`常見痛點：${x.pains.join('；')}`);
    if (arr(x.plays).length) L.push(`常用打法：${x.plays.join('；')}`);
    if (arr(x.kpis).length && ['prep', 'poc', 'deck', 'proposal', 'roi', 'scout', 'router', 'research'].includes(kind)) L.push(`KPI 經驗值（只能當參考範圍，對外要標「預估」並以客戶資料驗證）：${x.kpis.map(k => `${k.name} ${k.typical}（${k.basis}）`).join('；')}`);
    if (arr(x.questions).length && ['prep', 'research', 'router', 'debrief'].includes(kind)) L.push(`老顧問一定會問：${x.questions.join('；')}`);
    if (arr(x.red_flags).length) L.push(`要警覺的訊號：${x.red_flags.join('；')}`);
  }
  const needs = arr(c && c.profile && c.profile.needs).map(n => P.needs && P.needs[n]).filter(Boolean);
  if (needs.length) L.push(`這類需求的眉角：${needs.join(' ')}`);
  const craft = (CRAFT_BY_KIND[kind] || ['pitfalls']).map(k => arr(P.craft && P.craft[k]).length ? `${CRAFT_LABEL[k]}：${P.craft[k].join(' ')}` : '').filter(Boolean);
  if (craft.length) L.push(`【顧問實務】\n${craft.join('\n')}`);
  return L.join('\n');
}
/** 給新人看的「為什麼」：產業痛點與老顧問會問的問題 */
export function industryCard(ind) {
  const hit = pick(ind); if (!hit) return '';
  const [name, x] = hit;
  return [`**${name}｜老顧問筆記**`, arr(x.pains).length ? `常見痛點：${x.pains.slice(0, 5).join('、')}` : '', arr(x.plays).length ? `常用打法：${x.plays.slice(0, 5).join('、')}` : '', arr(x.questions).length ? `一定要問：\n${x.questions.slice(0, 5).map(q => `• ${q}`).join('\n')}` : '', arr(x.red_flags).length ? `警訊：${x.red_flags.join('、')}` : ''].filter(Boolean).join('\n');
}

/* ============ 院內協作單位（跨部門：誰會什麼、找誰） ============ */
// state/capabilities.csv：單位,專長,聯絡人,關鍵字（關鍵字用 ; 分隔）
function parseCsv(t) {
  const rows = []; for (const line of String(t || '').split(/\r?\n/)) { if (!line.trim() || /^#/.test(line)) continue; const cells = []; let cur = '', q = false; for (const ch of line) { if (ch === '"') q = !q; else if (ch === ',' && !q) { cells.push(cur.trim()); cur = ''; } else cur += ch; } cells.push(cur.trim()); rows.push(cells); }
  return rows;
}
export function capabilities() {
  for (const p of [path.join(cfg.dataDir, 'capabilities.csv'), path.join(ROOT, 'data', 'capabilities.csv')]) {
    try { const R = parseCsv(fs.readFileSync(p, 'utf8')); const h = R[0] && /單位/.test(R[0][0]) ? R.slice(1) : R; return h.filter(r => r[0]).map(r => ({ unit: r[0], skills: r[1] || '', contact: r[2] || '', keys: String(r[3] || '').split(/[;；、]/).map(s => s.trim()).filter(Boolean) })); } catch (e) {}
  }
  return [];
}
const NEED_WORDS = { ai: ['AI', '影像', '機器學習', '生成式'], dx: ['數位轉型', '流程', '系統整合'], rd: ['研發'], green: ['淨零', '碳', '能源'], svc: ['服務', '體驗'], intl: ['國際', '海外'], acad: ['產學'], invest: ['募資', '投資'], tax: ['投抵', '稅'] };
/** 依案件或關鍵字找院內可以協作的單位 */
export function findExperts(q, c = null, n = 4) {
  const C = capabilities(); if (!C.length) return [];
  const words = [...String(q || '').split(/[\s,，、；;]+/), ...(c ? [c.profile.industry, c.profile.product, c.profile.desc, ...arr(c.profile.needs).flatMap(k => NEED_WORDS[k] || [])] : [])].filter(w => w && String(w).length >= 2).map(String);
  const score = x => words.reduce((s, w) => s + (x.keys.some(k => k.includes(w) || w.includes(k)) ? 3 : 0) + ((x.skills + x.unit).includes(w) ? 1 : 0), 0);
  return C.map(x => ({ ...x, s: score(x) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, n);
}
export const expertLines = L => arr(L).map(x => `- ${x.unit}：${cut(x.skills, 80)}${x.contact ? `（窗口：${x.contact}）` : ''}`).join('\n');
