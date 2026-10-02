// 案件欄位、科專資料庫與資格初篩（與網頁版孔明同一套規則）
import fs from 'node:fs';
import path from 'node:path';
import { cfg, ROOT } from './config.js';
import { arr, cut, isEmpty, num, pad, wan, nowISO, uid, parseD, todayD, daysLeft, md2 } from './util.js';

export const NEEDS = { rd: '研發新產品／技術', ai: '導入 AI 應用', dx: '數位轉型／營運效率', svc: '服務創新／新模式', green: '淨零減碳／節能', intl: '國際合作／海外', acad: '產學合作', invest: '募資／政府投資', tax: '研發節稅' };
export const INDUSTRIES = ['製造業', '商業服務業（零售、餐飲、物流等）', '資訊服務／軟體', '技術服務業', '生技醫療', '農業／食品', '文化內容', '其他'];
export const COUNTIES = ['臺北市', '新北市', '桃園市', '臺中市', '臺南市', '高雄市', '基隆市', '新竹市', '新竹縣', '苗栗縣', '彰化縣', '南投縣', '雲林縣', '嘉義市', '嘉義縣', '屏東縣', '宜蘭縣', '花蓮縣', '臺東縣', '澎湖縣', '金門縣', '連江縣'];
const SOUTH = ['嘉義市', '嘉義縣', '臺南市', '高雄市', '屏東縣'];
export const STAGES = ['訪前準備', '訪談進行', '訪後整理', '提案準備', '送件追蹤'];
export const FIELDS = [
  { k: 'name', l: '企業名稱' }, { k: 'county', l: '縣市', opts: COUNTIES }, { k: 'industry', l: '產業', opts: INDUSTRIES },
  { k: 'product', l: '主要產品／服務' }, { k: 'capital', l: '實收資本額', unit: '萬元', n: true }, { k: 'employees', l: '員工數', unit: '人', n: true },
  { k: 'founded', l: '成立年（西元）', n: true }, { k: 'budget', l: '預計投入總經費', unit: '萬元', n: true },
  { k: 'contact', l: '客戶窗口' }, { k: 'visit', l: '下次拜訪日', date: true },
  { k: 'needs', l: '想做的事', list: true }, { k: 'factory', l: '工廠登記', b: true }, { k: 'tariff', l: '受美國關稅影響', b: true }, { k: 'desc', l: '需求描述', long: true },
];
export const FBY = Object.fromEntries(FIELDS.map(f => [f.k, f]));
const KEY_FIELDS = ['name', 'county', 'industry', 'product', 'capital', 'employees', 'needs', 'desc'];
const COMPLETE_FIELDS = ['name', 'county', 'industry', 'product', 'capital', 'employees', 'founded', 'budget', 'contact', 'needs', 'factory', 'desc'];

/* ---------- 科專資料 ---------- */
export const KZ = { programs: [], byId: {}, kb: {}, meta: {} };
export function loadPrograms() {
  const rd = (f, d) => { for (const p of [path.join(cfg.dataDir, f), path.join(ROOT, 'data', f)]) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) {} } return d; };
  KZ.programs = rd('programs.json', []).sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  KZ.byId = Object.fromEntries(KZ.programs.map(p => [p.id, p]));
  KZ.kb = rd('kb.json', {}); KZ.meta = rd('meta.json', {});
  return KZ.programs.length;
}
export const kzSrc = () => `科專資料庫 ${KZ.programs.length} 項（檢核 ${KZ.meta.data_verified || '—'}）`;

/* ---------- profile ---------- */
export function normField(k, v) {
  const f = FBY[k]; if (!f || v == null) return null;
  if (f.n) return num(v);
  if (f.b) { if (v === true || /^(true|有|是|yes)$/i.test(String(v))) return true; if (v === false || /^(false|無|否|沒有|no)$/i.test(String(v))) return false; return null; }
  if (f.list) return arr(v).map(x => String(x).trim()).filter(x => NEEDS[x]);
  if (f.opts) {
    const s = String(v).trim().replace(/^台/, '臺'); if (!s) return null;
    return f.opts.find(o => o === s) || f.opts.find(o => o.startsWith(s) || s.startsWith(o.replace(/（.*$/, ''))) || (k === 'industry' ? '其他' : null);
  }
  if (f.date) { const m = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(String(v)); return m ? `${m[1]}-${pad(m[2])}-${pad(m[3])}` : null; }
  const s = String(v).trim(); return s && s !== 'null' ? s : null;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b) || String(a) === String(b);
export function applyProfile(c, upd, source) {
  const applied = [], pend = [];
  if (!upd || typeof upd !== 'object') return { applied, pend };
  for (const [k, raw] of Object.entries(upd)) {
    const f = FBY[k]; if (!f) continue;
    const v = normField(k, raw);
    if (v == null || (Array.isArray(v) && !v.length)) continue;
    const old = c.profile[k];
    if (f.list) { const merged = [...new Set([...arr(old), ...v])]; if (merged.length !== arr(old).length) { c.profile[k] = merged; c.src[k] = source; applied.push(f.l); } continue; }
    if (isEmpty(old)) { c.profile[k] = v; c.src[k] = source; applied.push(f.l); continue; }
    if (same(old, v)) continue;
    if (c.pending.some(p => p.kind === 'field' && p.field === k && same(p.to, v))) continue;
    const p = { id: uid(6), kind: 'field', field: k, from: old, to: v, source, at: nowISO() }; c.pending.push(p); pend.push(p);
  }
  if (c.profile.name && (c.name === '新案件' || !c.name)) c.name = c.profile.name;
  return { applied, pend };
}
export function fmtVal(k, v, ai) {
  const f = FBY[k] || {};
  if (isEmpty(v)) return ai ? '未提供' : '—';
  if (f.b) return v ? '有／是' : '無／否';
  if (f.list) return arr(v).map(n => NEEDS[n] || n).join('、');
  if (f.n) return `${wan(v)}${f.unit ? ' ' + f.unit : ''}`;
  return String(v);
}
export function missingFields(c) { const m = KEY_FIELDS.filter(k => isEmpty(c.profile[k])); if (c.profile.industry === '製造業' && c.profile.factory == null) m.push('factory'); return m; }
export function completeness(c) { const done = COMPLETE_FIELDS.filter(k => !isEmpty(c.profile[k])).length; return { done, total: COMPLETE_FIELDS.length, pct: Math.round(done / COMPLETE_FIELDS.length * 100) }; }
export const profileText = c => FIELDS.map(f => `${f.l}：${fmtVal(f.k, c.profile[f.k], true)}`).join('\n');
export function pendText(p) {
  if (p.kind === 'field') return `${(FBY[p.field] || {}).l || p.field}：${fmtVal(p.field, p.from)} → ${fmtVal(p.field, p.to)}`;
  if (p.kind === 'stage') return `案件階段：${STAGES[p.from] || '—'} → ${STAGES[p.to]}`;
  return p.text || '';
}
export function sameName(a, b) {
  const n = s => String(s || '').replace(/（.*?）|\(.*?\)/g, '').replace(/股份有限公司|有限公司|公司|企業|集團|\s/g, '').toLowerCase();
  const x = n(a), y = n(b); return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
}

/* ---------- eligibility ---------- */
export function stGroup(st = '') { if (st.includes('受理中')) return '受理中'; if (st.includes('截止')) return '已截止'; return '即將開放／待確認'; }
function nextDeadline(p, kinds = ['截止']) { const t = todayD(); return arr(p.deadlines).filter(d => kinds.includes(d.kind) && parseD(d.date) && parseD(d.date) >= t).sort((a, b) => a.date.localeCompare(b.date))[0] || null; }
export function timing(p) {
  const g = stGroup(p.status), d = nextDeadline(p), o = nextDeadline(p, ['開放推估']);
  if (g === '受理中') return d ? `受理中・${md2(d.date)} 截止（剩 ${daysLeft(d.date)} 天）` : (/隨到隨審|隨時/.test((p.application_mode || '') + (p.next_window || '')) ? '受理中・隨到隨審' : '受理中');
  if (o) return `今年已截止・下一梯推估 ${md2(o.date)}`;
  return `${p.status || '待確認'}・${cut(p.next_window, 36)}`;
}
const isSME = c => (c.capital != null && c.capital <= 10000) || (c.employees != null && c.employees < 200);
export function evaluate(p, c) {
  const ok = [], warn = [], block = [];
  const sme = isSME(c), unknownSize = c.capital == null && c.employees == null, ind = c.industry || '';
  const needs = new Set(arr(c.needs));
  if (ind.startsWith('農業')) needs.add('agri');
  if (ind.startsWith('文化')) needs.add('culture');
  for (const r of arr(p.match && p.match.req)) {
    switch (r) {
      case 'sme': if (unknownSize) warn.push('須符合中小企業認定，請補資本額或員工數'); else if (sme) ok.push('符合中小企業認定'); else block.push('限中小企業（資本額 1 億以下或員工未滿 200 人）'); break;
      case 'mfg': ind === '製造業' ? ok.push('製造業') : (ind ? block.push('限製造業') : warn.push('限製造業，請確認產業別')); break;
      case 'mfg_or_tech': (ind === '製造業' || ind === '技術服務業') ? ok.push('製造業或技術服務業') : (ind ? block.push('限製造業或指定技術服務業') : warn.push('限製造業或技術服務業，請確認產業別')); break;
      case 'factory': c.factory ? ok.push('有工廠登記') : (c.factory === false ? block.push('須有工廠登記') : warn.push('須有工廠登記，請向客戶確認')); break;
      case 'tariff': c.tariff ? ok.push('受美國關稅影響（需備佐證）') : (c.tariff === false ? block.push('須能佐證受美國關稅影響') : warn.push('須能佐證受美國關稅影響，請確認')); break;
      case 'service': ind.startsWith('商業服務業') ? ok.push('商業服務業') : (ind ? block.push('限商業服務業') : warn.push('限商業服務業，請確認產業別')); break;
      case 'ict': ind.startsWith('資訊服務') ? ok.push('資服／軟體業') : (ind ? block.push('限資服／軟體業者') : warn.push('限資服／軟體業者，請確認產業別')); break;
      case 'agri': ind.startsWith('農業') ? ok.push('農業／食品相關') : block.push('限農業相關業者'); break;
      case 'culture': ind.startsWith('文化') ? ok.push('文化內容產業') : block.push('限文化內容產業'); break;
      case 'startup': { const age = c.founded ? new Date().getFullYear() - c.founded : null; age == null ? warn.push('限設立未滿 8 年的新創，請補成立年') : (age < 8 ? ok.push(`設立 ${age} 年，符合新創`) : block.push('限設立未滿 8 年的新創')); break; }
      case 'south': SOUTH.includes(c.county) ? ok.push('場域在南部指定縣市') : (c.county ? block.push('場域限嘉義、臺南、高雄、屏東') : warn.push('場域限南部指定縣市，請補縣市')); break;
      case 'taipei': c.county === '臺北市' ? ok.push('設籍臺北市') : (c.county ? block.push('限設籍臺北市') : warn.push('限設籍臺北市，請補縣市')); break;
      case 'local': {
        if (!c.county) { warn.push('請補縣市以判斷地方型 SBIR'); break; }
        if (c.county === '臺北市') { block.push('臺北市沒有地方型 SBIR，改看臺北市 SITI'); break; }
        const row = arr(p.counties).find(x => x.county === c.county);
        if (!row || row.cap_wan == null) warn.push(`${c.county} 是否辦理待確認`); else ok.push(`${c.county} 有辦理，單家上限約 ${row.cap_wan} 萬`);
        break;
      }
    }
  }
  const hit = arr(p.match && p.match.needs).filter(n => needs.has(n));
  let score = hit.length ? 3 + hit.length * 2 : (needs.size ? 0 : 2);
  if (hit.length) ok.push('對應需求：' + hit.map(n => NEEDS[n] || ({ agri: '農業', culture: '文化內容' })[n]).join('、'));
  const g = stGroup(p.status);
  if (g === '受理中') score += 3; else if (g === '已截止') score -= 1;
  if (!sme && !unknownSize && !arr(p.size_fit).includes('中堅/大企業') && !arr(p.match && p.match.req).includes('sme')) warn.push('此計畫以中小企業為主，大型企業請先確認資格');
  if (c.budget && p.max_cap_wan && c.budget * 0.5 > p.max_cap_wan * 1.5) warn.push(`總經費 ${wan(c.budget)} 萬明顯大於單案上限，可拆期或改提較大型計畫`);
  if (p.id === 'aplus' && c.budget >= 1500) score += 2;
  if (p.id === 'rd_tax_credit') score = Math.min(score, 4);
  let phase = '';
  if (p.id === 'sbir' && c.budget) phase = c.budget <= 300 ? '建議從 Phase 1 先期研究（最高 150 萬）起步' : '經費規模可考慮 Phase 2 研究開發（最高 1,200 萬）';
  const fit = score >= 9 ? '高' : score >= 6 ? '中' : '低';
  return { p, score, fit, ok, warn, block, eligible: block.length === 0, relevant: hit.length > 0 || !needs.size, phase };
}
export function matchAll(c) {
  if (!KZ.programs.length || !c) return { good: [], blocked: [] };
  const co = { ...c.profile, needs: arr(c.profile.needs) };
  const all = KZ.programs.map(p => evaluate(p, co));
  return { good: all.filter(r => r.eligible && r.relevant).sort((a, b) => b.score - a.score), blocked: all.filter(r => !r.eligible && r.relevant) };
}
export function compactProgram(p) {
  const tracks = arr(p.tracks).slice(0, 5).map(t => `${t.name}${t.cap_wan != null ? ' 上限' + t.cap_wan + '萬' : ''}${t.ratio ? ' ' + cut(t.ratio, 36) : ''}`).join('；');
  return [`[${p.id}] ${p.name}（${p.short || ''}）｜${p.agency}｜狀態：${p.status}｜${p.application_mode || ''}`,
    `摘要：${cut(p.summary, 150)}`, `額度：${tracks || '—'}｜補助比例：${cut(p.subsidy_ratio, 60)}`,
    `時程：${cut(p.schedule, 160)}｜下一次：${cut(p.next_window, 100)}`,
    `資格：${arr(p.eligibility).slice(0, 4).map(x => cut(x, 80)).join('；')}`,
    `審查重點：${arr(p.review_focus).slice(0, 3).map(x => cut(x, 60)).join('；')}`,
    `資策會角色：${cut(p.iii_role, 160)}`, `常見KPI：${arr(p.kpi_typical).slice(0, 4).join('、')}`].join('\n');
}
export function programFull(p) {
  return [`計畫：${p.name}（${p.short || ''}）｜主管機關：${p.agency}｜執行單位：${p.operator || '—'}`, `摘要：${p.summary}`, `對象：${cut(p.who_can_apply, 300)}`,
    `類別與額度：${arr(p.tracks).map(t => `${t.name}：上限${t.cap_wan ?? '—'}萬，${t.ratio || ''}，${t.duration || ''}`).join('；')}`,
    `補助比例：${p.subsidy_ratio || '—'}｜期程：${p.duration || '—'}`, `資格：${arr(p.eligibility).join('；')}`,
    `時程：${cut(p.schedule, 260)}｜下一次：${cut(p.next_window, 160)}`, `流程：${arr(p.process).join(' → ')}`,
    `需備文件：${arr(p.documents).join('、')}`, `審查重點：${arr(p.review_focus).join('；')}`, `常見 KPI：${arr(p.kpi_typical).join('；')}`,
    `常見不通過：${arr(p.pitfalls).join('；')}`, `資策會角色：${p.iii_role}`].join('\n');
}
export const catalogLine = p => `[${p.id}] ${p.short || ''}｜${p.name}｜${p.agency}｜${p.status}｜上限 ${p.max_cap_wan != null ? wan(p.max_cap_wan) + ' 萬' : '依子計畫'}｜${cut(p.summary, 56)}`;
export function kbBrief() {
  const k = KZ.kb || {};
  return ['【共通資格】' + arr(k.eligibility_common).slice(0, 6).map(x => cut(x, 100)).join('；'),
    '【資策會角色】' + arr(k.iii_roles).slice(0, 4).map(x => cut(typeof x === 'string' ? x : JSON.stringify(x), 140)).join('；'),
    '【常見問答】' + arr(k.faq).slice(0, 8).map(f => `Q:${f.q} A:${cut(f.a, 200)}`).join('\n')].join('\n');
}
export function mentionedPrograms(text) {
  const t = String(text || '').toLowerCase();
  return KZ.programs.filter(p => [p.short, p.name, p.id].filter(Boolean).some(k => { const s = String(k).toLowerCase(); return s.length >= 2 && t.includes(s); })).slice(0, 3);
}
export function analysisRec(c, pid) { return arr(c && c.analysis && c.analysis.recommendations).find(r => r.program_id === pid) || null; }
export function analysisFor(c, pid) { const r = analysisRec(c, pid); return r ? `先前建議：題目「${r.project_idea}」，類別 ${r.track}，補助估計 ${r.grant_estimate_wan ?? '—'} 萬，時機 ${r.timing}，資策會參與：${r.iii_angle}` : ''; }
export function pickProgram(c, pid) {
  if (pid && KZ.byId[pid]) return KZ.byId[pid];
  const r = arr(c.analysis && c.analysis.recommendations)[0]; if (r && KZ.byId[r.program_id]) return KZ.byId[r.program_id];
  const g = matchAll(c).good[0]; return g ? g.p : null;
}
