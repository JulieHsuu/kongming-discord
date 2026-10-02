// 不連 Discord、不呼叫真模型：用假的大腦回覆跑一輪完整流程，實際產出 Word／PowerPoint／Demo／MP4。
// 執行：npm test   產出放在 test/out/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, 'tmpdata'), OUT = path.join(HERE, 'out');
fs.rmSync(DATA, { recursive: true, force: true }); fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
Object.assign(process.env, { KM_DATA_DIR: DATA, KM_OBSERVE_DELAY_SEC: '0', KM_OBSERVE_MIN_GAP_SEC: '0', ANTHROPIC_API_KEY: 'test', PORT: '8799', PUBLIC_BASE_URL: 'http://localhost:8799', KM_VIDEO_FPS: '12' });

const { setLLM } = await import('../src/llm.js');
const { loadPrograms } = await import('../src/domain.js');
const brain = await import('../src/brain.js');
const { startWeb } = await import('../src/web.js');
const { commandDef } = await import('../src/discord.js');
const store = await import('../src/store.js');

/* ---------- fake model ---------- */
const MARK = '<<<KM_ACTIONS>>>';
const calls = [];
const J = o => ({ text: JSON.stringify(o), truncated: false });
const PREP = { title: '宏聯精密訪前準備', company_brief: ['臺中 CNC 精密零件廠，85 人', '客戶以航太、半導體設備為主', '受美國關稅影響，訂單掉約兩成'], known: [{ label: '資本額', value: '8,000 萬元' }], gaps: [{ item: '目前瑕疵率與漏檢率', why: 'POC 與 KPI 的基準值' }, { item: '可提供的影像樣本數', why: '判斷模型訓練可行性' }], agenda: [{ time: '0–10 分', topic: '開場與確認目的' }, { time: '10–35 分', topic: '產線與品質現況' }], sections: [{ title: '品質檢驗現況', purpose: '量化痛點', questions: ['目前目檢流程怎麼走？', '每天檢多少件？', '漏檢多半發生在哪些零件？'] }, { title: '資料與設備', purpose: '確認可行性', questions: ['產線有沒有相機？', '能提供多少張瑕疵照片？', '誰負責標註？'] }, { title: '科專意願', purpose: '確認自籌與時程', questions: ['今年有沒有預算自籌一半？', '有沒有申請過政府計畫？', '理想的導入時間？'] }, { title: '決策與下一步', purpose: '確認窗口', questions: ['誰能拍板？', '下次可以帶樣品來嗎？', '需要我們準備什麼？'] }], bring: ['製造業 AI 成熟度評量表'], tool_inputs: ['產線工站清單'], kezhuan_angle: '資本額與人數符合中小企業，可先談 SBIR Phase 1。' };
const DECK = { deck_title: '宏聯精密 AI 瑕疵檢測提案', slides: [{ layout: 'title', title: 'AI 影像瑕疵檢測導入提案', subtitle: '宏聯精密 × 資策會' }, { layout: 'bullets', title: '現況與痛點', bullets: ['6 名人力三班目檢', '疲勞漏檢造成客訴【待補：客訴件數】', '美國關稅壓縮毛利'] }, { layout: 'two-col', title: '解決方案', left: { heading: '影像擷取', bullets: ['工站加裝工業相機', '光源標準化'] }, right: { heading: 'AI 判讀', bullets: ['瑕疵分類模型', '可疑件人工複檢'] } }, { layout: 'timeline', title: '時程與查核點', milestones: [{ when: 'M1–M2', what: '收集影像與標註' }, { when: 'M3–M4', what: '模型訓練' }, { when: 'M5–M6', what: '產線驗證' }], bullets: ['每月查核一次'] }, { layout: 'table', title: '經費概估（預估）', table: { headers: ['科目', '金額（萬元）', '說明'], rows: [['人事費', '120', '2 人 × 6 月'], ['設備', '60', '相機與光源'], ['委託研究', '120', '資策會模型開發']] } }, { layout: 'bullets', title: '資策會合作角色與下一步', bullets: ['擔任委託研究單位', '兩週內完成 POC 規劃'] }] };
const POC = { title: 'CNC 零件 AI 外觀檢測 POC', objective: '用 6 週驗證 AI 能否取代 50% 目檢工時', use_cases: ['航太零件刮傷', '毛邊'], scope_in: ['單一工站'], scope_out: ['整廠導入'], data_needed: [{ item: '瑕疵影像 2,000 張', from: '企業提供' }], architecture: ['工業相機', '邊緣運算盒', '瑕疵分類模型', '儀表板'], timeline: [{ week: 'W1', task: '架設相機', deliverable: '影像流程' }, { week: 'W2–W3', task: '標註與訓練', deliverable: '模型 v1' }, { week: 'W4–W5', task: '線上試跑', deliverable: '比對報告' }, { week: 'W6', task: '成果整理', deliverable: '結案簡報' }], success_metrics: [{ metric: '檢出率', baseline: '【待補】', target: '≥95%' }], kpi: [{ name: '目檢工時', target: '-50', unit: '%', basis: '6 人 × 8 小時' }, { name: '漏檢率', target: '<1', unit: '%', basis: '試跑抽樣' }], team: [{ role: '影像工程師', side: '資策會', effort: '4 人週' }], cost_estimate: '約 60 萬元（預估）', risks: [{ risk: '樣本不足', mitigation: '先做資料擴增' }], to_proposal: 'POC 成果作為 SBIR Phase 1 的可行性佐證。' };
const PROPOSAL = { title: 'CNC 精密零件 AI 影像瑕疵檢測系統開發', track: 'Phase 1 先期研究', summary_table: [{ label: '計畫名稱', value: 'CNC 精密零件 AI 影像瑕疵檢測系統開發' }, { label: '計畫期程', value: '6 個月' }, { label: '總經費', value: '300 萬元（補助 150 萬元）' }], sections: [{ heading: '計畫摘要', paragraphs: ['宏聯精密以 6 名人力目檢 CNC 零件，漏檢與工時壓力大。本計畫開發 AI 影像瑕疵檢測，先期驗證技術可行性。'], bullets: ['創新點：小樣本瑕疵分類'] }, { heading: '技術可行性', paragraphs: ['以 POC 結果佐證，檢出率目標 95%。【待補：POC 實測數據】'] }], budget: { rows: [['人事費', '120', '研發人員 2 名'], ['委託研究費', '120', '資策會'], ['設備使用費', '60', '相機與運算盒']], note: '補助款不超過 150 萬元，且不超過總經費 50%。' }, kpi: [{ name: '創新產品', target: '1', unit: '項', basis: 'AI 檢測系統' }], milestones: [{ when: 'M1–M3', what: '模型 v1' }, { when: 'M4–M6', what: '產線驗證' }], checklist: ['最近年度損益及稅額計算表', '勞保投保人數資料', '無欠稅證明'], todo_for_consultant: ['確認客戶自籌 150 萬元', '補 POC 實測數據'], risks_to_avoid: ['創新性寫得像採購設備'] };
const FILM = { title: '宏聯精密 AI 檢測計畫', scenes: [{ type: 'title', heading: '讓每個零件都被看見', sub: 'AI 影像瑕疵檢測', narration: '這是宏聯精密的 AI 檢測計畫。', seconds: 4 }, { type: 'problem', heading: '目檢的瓶頸', points: ['6 人三班目檢', '疲勞漏檢', '關稅壓縮毛利'], narration: '目前靠六個人目檢，容易疲勞漏檢。', seconds: 5 }, { type: 'solution', heading: '三步驟導入', cards: [{ title: '影像擷取', text: '工站加裝相機' }, { title: 'AI 判讀', text: '即時分類瑕疵' }, { title: '品質追溯', text: '批號報表自動產出' }], narration: '用三個步驟導入 AI。', seconds: 5 }, { type: 'kpi', heading: '預期效益', items: [{ name: '目檢工時', target: '-50%', pct: 50 }, { name: '檢出率', target: '95%', pct: 95 }], narration: '目檢工時減半。', seconds: 4 }, { type: 'closing', heading: '智者謀勢，助您成事', sub: '資策會與您同行', narration: '謝謝。', seconds: 4 }] };
const DEMO = '```html\n<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>宏聯精密 AI 檢測 Demo</title></head><body><h1>AI 檢測 Demo</h1><p>概念驗證 Demo・資料為模擬</p><button onclick="document.getElementById(\'r\').textContent=\'OK 97%\'">開始檢測</button><p id="r"></p></body></html>\n```';
setLLM({
  async text(a) {
    calls.push(a.label);
    const last = String(a.messages[a.messages.length - 1].content).split('【附件】')[0];
    switch (a.label) {
      case 'router':
        if (/訪綱/.test(last)) return { text: `收到。我先把宏聯精密的訪綱準備好，再做一份提案簡報。\n${MARK}\n${JSON.stringify({ case_name: '宏聯精密（虛構範例）', profile_updates: { county: '臺中市', industry: '製造業', product: 'CNC 精密零件', capital: 8000, employees: 85, visit: '2026-10-07', needs: ['ai', 'rd'], factory: true }, tasks: [{ kind: 'prep', focus: '準備訪綱' }, { kind: 'deck', focus: '提案簡報' }], todos: [{ text: '10/7 拜訪宏聯精密', owner: '顧問', due: '2026-10-07' }], stage: null })}`, truncated: false };
        if (/建檔/.test(last)) return { text: `好，我來建檔。\n${MARK}\n{"case_name":null,"profile_updates":{},"tasks":[{"kind":"ingest","focus":"建檔"}],"todos":[],"stage":null}`, truncated: false };
        return { text: `目前宏聯精密資格上適合 SBIR Phase 1（最高 150 萬，受理中・隨到隨審）。\n${MARK}\n{"case_name":null,"profile_updates":{},"tasks":[],"todos":[],"stage":null}`, truncated: false };
      case 'observe': return J({ act: true, confidence: 0.86, why: '同事描述客戶痛點並提到要申請 SBIR', case_name: '宏聯精密', new_info: true, profile_updates: { desc: '想用 AI 取代 6 人目檢' }, tasks: [{ kind: 'poc', focus: '針對目檢漏檢做 POC' }, { kind: 'proposal', program_id: 'sbir', focus: 'SBIR Phase 1 計畫書' }, { kind: 'video', focus: '60 秒計畫短片' }], say: '我注意到大家在談宏聯精密的目檢痛點和 SBIR，我先把 POC 規劃和計畫書草稿做好，約 3 分鐘。', question: '' });
      case 'prep': return J(PREP);
      case 'deck': return J(DECK);
      case 'poc': return J(POC);
      case 'proposal': return J(PROPOSAL);
      case 'video': return J(FILM);
      case 'demo': return { text: DEMO, truncated: false };
      case 'ingest': return J({ source_title: '宏聯精密公司簡介', profile_updates: { employees: 92, founded: 2009 }, facts: [{ label: '主要客戶', value: '航太一階供應商' }], missing: ['近三年營收'], doubts: ['簡介寫 92 人，和訪談的 85 人不同'] });
      default: return J({});
    }
  },
});

/* ---------- fake Discord channel ---------- */
const posts = [];
let n = 0;
function makeIO(channelId) {
  const io = {
    channelId,
    async post(o) { const id = `m${++n}`; const rec = { channelId, id, ...o }; posts.push(rec); brain.recordOwn(channelId, id, o.content || ''); return { message: rec, async edit(e) { Object.assign(rec, e); } }; },
    async say(t) { return io.post({ content: t }); },
    typing() { return () => {}; },
    async thread(name) { posts.push({ channelId, thread: name }); return makeIO(channelId + '-t' + (++n)); },
  };
  return io;
}
const user = (name) => ({ id: 'u-' + name, name });
let mid = 0;
const msg = (channelId, who, text, extra = {}) => ({ id: `d${++mid}`, channelId, guildId: 'g1', isDM: false, isOwnThread: false, mentionsMe: false, replyToMe: false, author: user(who), text, attachments: [], at: new Date().toISOString(), ...extra });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (cond, label) => { console.log(`${cond ? '✔' : '✘'} ${label}`); if (!cond) process.exitCode = 1; };

/* ---------- run ---------- */
loadPrograms();
const web = startWeb();
JSON.stringify(commandDef()); ok(true, '斜線指令定義有效');
const CH = 'c-general';

// 1) 同事直接交辦
await brain.onMessage(msg(CH, '王顧問', '孔明，下週二要拜訪宏聯精密，先幫我準備訪綱，順便做一份提案簡報'), makeIO(CH));
let c = store.getCase(store.getChannel(CH).caseId);
ok(c && /宏聯/.test(c.name), `建立案件：${c && c.name}`);
ok(c.prep && c.prep.sections.length === 4, '訪綱完成');
ok(c.todos.some(t => /拜訪/.test(t.text)), '交辦中的拜訪日記成待辦');

// 2) 群組對話（沒有叫孔明）→ 孔明判斷後主動做
await brain.onMessage(msg(CH, '林經理', '剛跟宏聯林協理通電話，他們目檢 6 個人三班，常漏檢被客訴'), makeIO(CH));
await brain.onMessage(msg(CH, '王顧問', '那我們幫他們申請 SBIR 吧，先做個 POC 證明可行'), makeIO(CH));
for (let i = 0; i < 80 && !posts.some(p => /計畫書草稿/.test(JSON.stringify(p.embeds || ''))); i++) await sleep(250);
c = store.getCase(c.id);
ok(c.poc && c.poc.title, '主動做好 POC 規劃');
ok(c.outputs.some(o => o.kind === 'proposal'), '主動做好 SBIR 計畫書草稿');
const ask = posts.find(p => arr(p.buttons).some(b => b.id && b.id.startsWith('km:go:')));
ok(!!ask, '計畫短片先問同事（按鈕）');

// 3) 同事按「好，做短片」
const go = ask.buttons.find(b => b.id.startsWith('km:go:')).id;
const r = await brain.onButton(go, user('王顧問'), makeIO(CH));
ok(/開始做/.test(r.text), '按鈕回覆：' + r.text);
for (let i = 0; i < 240 && !posts.some(p => arr(p.files).some(f => f.name.endsWith('.mp4'))); i++) await sleep(250);
ok(posts.some(p => arr(p.files).some(f => f.name.endsWith('.mp4'))), '計畫短片 MP4 傳回頻道');

// 4) 確認對外使用
c = store.getCase(c.id);
const deckOut = c.outputs.find(o => o.kind === 'deck');
const okr = await brain.onButton(`km:ok:${c.id}:${deckOut.id}`, user('王顧問'), makeIO(CH));
ok(/已確認/.test(okr.text) && store.getCase(c.id).outputs.find(o => o.id === deckOut.id).status === '已確認', '簡報確認可對外使用');

// 5) 上傳檔案建檔（用孔明自己產生的 Word 當附件）
const prepFile = posts.flatMap(p => arr(p.files)).find(f => f.name.includes('訪前資料包'));
const saved = store.saveOutputFile(c.id, 'company.docx', prepFile.buffer);
await brain.onMessage(msg(CH, '林經理', '孔明，這是宏聯的公司簡介，幫我建檔', { attachments: [{ name: 'company.docx', url: `http://localhost:8799/f/${saved.key}/company.docx`, contentType: '', size: saved.size }] }), makeIO(CH));
c = store.getCase(c.id);
ok(c.ingests.length && c.pending.some(p => p.kind === 'field' && p.field === 'employees'), '員工數 85→92 列為待確認，不直接覆蓋');
const pend = c.pending.find(p => p.field === 'employees');
await brain.onButton(`km:pend:${c.id}:${pend.id}:y`, user('王顧問'), makeIO(CH));
ok(store.getCase(c.id).profile.employees === 92, '顧問按「採用」後才更新');

// 6) 指令
const st = brain.onCommand('status', {}, { channelId: CH, guildId: 'g1' });
ok(/宏聯/.test(st), '/孔明 狀態');
ok(/切換|建立/.test(brain.onCommand('use', { name: '大成食品' }, { channelId: 'c2', guildId: 'g1' })), '/孔明 切換');
ok(/主動/.test(brain.onCommand('mode', { mode: 'auto' }, { channelId: CH, guildId: 'g1' })), '/孔明 模式');

// 7) 檔案服務
const demoKey = saved.key;
const res = await fetch(`http://localhost:8799/f/${demoKey}/company.docx`);
ok(res.status === 200, '檔案連結可下載');

// save produced files
for (const p of posts) for (const f of arr(p.files)) fs.writeFileSync(path.join(OUT, f.name), f.buffer);
fs.writeFileSync(path.join(OUT, 'channel.json'), JSON.stringify(posts.map(p => ({ ch: p.channelId, thread: p.thread, content: p.content, embed: p.embeds && p.embeds[0] && { title: p.embeds[0].title, description: p.embeds[0].description, footer: p.embeds[0].footer }, files: arr(p.files).map(f => f.name), buttons: arr(p.buttons).map(b => b.label) })), null, 1));
console.log('模型呼叫：', calls.join(' → '));
console.log('產出：', fs.readdirSync(OUT).join('、'));
web.close();
function arr(v) { return Array.isArray(v) ? v : (v == null ? [] : [v]); }
process.exit(process.exitCode || 0);
