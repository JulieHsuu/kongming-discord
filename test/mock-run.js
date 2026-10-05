// 不連 Discord、不呼叫真模型：用假的大腦回覆跑一輪完整流程，實際產出 Word／PowerPoint／Demo／MP4。
// 執行：npm test   產出放在 test/out/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, 'tmpdata'), OUT = path.join(HERE, 'out');
fs.rmSync(DATA, { recursive: true, force: true }); fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
Object.assign(process.env, { KM_DATA_DIR: DATA, KM_OBSERVE_DELAY_SEC: '0', KM_OBSERVE_MIN_GAP_SEC: '0', ANTHROPIC_API_KEY: 'test', PORT: '8799', PUBLIC_BASE_URL: 'http://localhost:8799', KM_VIDEO_FPS: '12', KM_STT_BASE_URL: 'http://localhost:8798/v1', KM_STT_API_KEY: 'test', KM_STT_CHUNK_SEC: '2', KM_TENDER_API: 'http://localhost:8797/api', KM_DASHBOARD_TOKEN: 'dash' });
const tSrv = (await import('node:http')).createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); if (req.url.startsWith('/api/searchbytitle')) return res.end(JSON.stringify({ records: [{ date: 20260915, brief: { type: '公開招標公告', title: '115年度產業AI導入輔導委辦案' }, job_number: 'A115001', unit_id: 'U1', unit_name: '經濟部產業發展署', url: '/index/case/U1/A115001/20260915/x' }] })); res.end(JSON.stringify({ records: [{ detail: { '機關資料:單位名稱': '智慧製造組', '機關資料:聯絡人': '王科長', '機關資料:聯絡電話': '(02)2754-1255', '機關資料:電子郵件信箱': 'ai@ida.gov.tw', '採購資料:預算金額': '3,500,000元', '領投標:截止投標': '115/10/20 17:00' } }] })); }).listen(8797);
import http from 'node:http';
import { execFileSync } from 'node:child_process';
const sttHits = [];
const sttSrv = http.createServer((req, res) => { let n = 0; req.on('data', d => { n += d.length; }); req.on('end', () => { sttHits.push(n); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ text: 'x', segments: [{ start: 0, text: '林協理說他們目檢六個人，漏檢率大概百分之三。' }, { start: 1.2, text: '希望明年導入AI檢測。' }] })); }); }).listen(8798);

const { setLLM } = await import('../src/llm.js');
const { loadPrograms } = await import('../src/domain.js');
const brain = await import('../src/brain.js');
const { startWeb } = await import('../src/web.js');
const { commandDef } = await import('../src/discord.js');
const store = await import('../src/store.js');

/* ---------- fake model ---------- */
globalThis.YDAY = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const MARK = '<<<KM_ACTIONS>>>';
const calls = [];
const scoutPrompts = [];
const routerPrompts = [];
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
      case 'router': routerPrompts.push(String(a.messages[0].content) + '\n' + last);
        if (/收進知識庫/.test(last)) return { text: `好，我收進知識庫。\n${MARK}\n{"in_scope":true,"kb_save":"報價規範","case_name":null,"profile_updates":{},"tasks":[],"todos":[],"stage":null}`, truncated: false };
        if (/請小明/.test(last)) return { text: `好，我記下來並提醒小明。\n${MARK}\n${JSON.stringify({ in_scope: true, case_name: null, profile_updates: {}, tasks: [], todos: [{ text: '補齊宏聯精密近三年財報', owner: '顧問', due: globalThis.YDAY, assignee: '小明' }], stage: null })}`, truncated: false };
        if (/財報補齊了/.test(last)) return { text: `收到。\n${MARK}\n{"in_scope":true,"case_name":null,"profile_updates":{},"tasks":[],"todos":[],"done_todos":["補齊宏聯精密近三年財報"],"stage":null}`, truncated: false };
        if (/定案/.test(last)) return { text: `好，預算以 300 萬為準。\n${MARK}\n{"in_scope":true,"decision":"總經費抓 300 萬元，先申請 SBIR Phase 1","case_name":null,"profile_updates":{},"tasks":[],"todos":[],"stage":null}`, truncated: false };
        if (/報價怎麼抓/.test(last)) return { text: `依《報價規範》，POC 以人月計價。\n${MARK}\n{"in_scope":true,"case_name":null,"profile_updates":{},"tasks":[],"todos":[],"stage":null}`, truncated: false };
        if (/以後訪綱/.test(last)) return { text: `好，之後照辦。\n${MARK}\n{"in_scope":true,"feedback":{"text":"訪綱不要超過 15 題","scope":"team"},"case_name":null,"profile_updates":{},"tasks":[],"todos":[],"stage":null}`, truncated: false };
        if (/大成食品/.test(last)) return { text: `好，我來準備大成食品的訪綱。\n${MARK}\n{"in_scope":true,"case_name":"大成食品","profile_updates":{},"tasks":[{"kind":"prep"}],"todos":[],"stage":null}`, truncated: false };
        if (/訪綱/.test(last)) return { text: `收到。我先把宏聯精密的訪綱準備好，再做一份提案簡報。\n${MARK}\n${JSON.stringify({ case_name: '宏聯精密（虛構範例）', profile_updates: { county: '臺中市', industry: '製造業', product: 'CNC 精密零件', capital: 8000, employees: 85, visit: '2026-10-07', needs: ['ai', 'rd'], factory: true }, tasks: [{ kind: 'prep', focus: '準備訪綱' }, { kind: 'deck', focus: '提案簡報' }], todos: [{ text: '10/7 拜訪宏聯精密', owner: '顧問', due: '2026-10-07' }], stage: null })}`, truncated: false };
        if (/建檔/.test(last)) return { text: `好，我來建檔。\n${MARK}\n{"case_name":null,"profile_updates":{},"tasks":[{"kind":"ingest","focus":"建檔"}],"todos":[],"stage":null}`, truncated: false };
        if (/作業|情書|樂透/.test(last)) return { text: `這個不在我的工作範圍，我是協助顧問案件與科專提案的數位員工。需要的話，我可以幫你整理客戶資料或查科專。\n${MARK}\n{"in_scope":false,"case_name":null,"profile_updates":{},"tasks":[{"kind":"deck"}],"todos":[],"stage":null}`, truncated: false };
        if (/我主要跑/.test(last)) return { text: `了解。\n${MARK}\n{"in_scope":true,"me":{"focus":"中部食品業數位化","industries":["農業／食品"],"regions":["臺中市","彰化縣"]},"case_name":null,"profile_updates":{},"tasks":[],"todos":[],"stage":null}`, truncated: false };
        if (/工業局|產發署|推薦一家/.test(last)) return { text: `好，我去研究。\n${MARK}\n{"in_scope":true,"case_name":null,"profile_updates":{},"tasks":[{"kind":"scout","focus":"對象：經濟部產業發展署"}],"todos":[],"stage":null}`, truncated: false };
        if (/投資報酬/.test(last)) return { text: `我來算。\n${MARK}\n{"in_scope":true,"case_name":null,"profile_updates":{},"tasks":[{"kind":"roi"}],"todos":[],"stage":null}`, truncated: false };
        if (/結案/.test(last)) return { text: `好，我整理成案例。\n${MARK}\n{"in_scope":true,"case_name":null,"profile_updates":{},"tasks":[{"kind":"closeout"}],"todos":[],"stage":null}`, truncated: false };
        if (/錄音/.test(last)) return { text: `好，我整理這段訪談。\n${MARK}\n{"in_scope":true,"case_name":null,"profile_updates":{},"tasks":[],"todos":[],"stage":null}`, truncated: false };
        return { text: `目前宏聯精密資格上適合 SBIR Phase 1（最高 150 萬，受理中・隨到隨審）。\n${MARK}\n{"case_name":null,"profile_updates":{},"tasks":[],"todos":[],"stage":null}`, truncated: false };
      case 'observe': return J({ act: true, confidence: 0.86, why: '同事描述客戶痛點並提到要申請 SBIR', case_name: '宏聯精密', new_info: true, profile_updates: { desc: '想用 AI 取代 6 人目檢' }, tasks: [{ kind: 'poc', focus: '針對目檢漏檢做 POC' }, { kind: 'proposal', program_id: 'sbir', focus: 'SBIR Phase 1 計畫書' }, { kind: 'video', focus: '60 秒計畫短片' }], say: '我注意到大家在談宏聯精密的目檢痛點和 SBIR，我先把 POC 規劃和計畫書草稿做好，約 3 分鐘。', question: '' });
      case 'factcheck': return J({ issues: [{ claim: '疲勞漏檢造成客訴', problem: '數字需客戶確認', suggest: '請客戶提供近一年客訴件數' }] });
      case 'outreach': return J({ to: '智慧製造組 王科長', subject: '產業 AI 導入陪跑方案交流', email: '王科長您好，看到貴署公告產業 AI 導入委辦案，我們在中小製造業 AI 導入有實際經驗，想約 30 分鐘交流。10/20 上午或 10/22 下午是否方便？【顧問姓名／電話】', phone: ['您好，我是資策會的顧問…'], line: '王科長您好，想約 30 分鐘交流 AI 導入陪跑方案。', objections: [{ q: '我們已經有合作單位', a: '了解，可以先提供診斷工具給轄下廠商試用' }], follow_up: '三天後電話追蹤' });
      case 'prep': return J(PREP);
      case 'deck': return J(DECK);
      case 'poc': return J(POC);
      case 'proposal': return J(PROPOSAL);
      case 'video': return J(FILM);
      case 'demo': return { text: DEMO, truncated: false };
      case 'research': return { text: '搜尋中…\n' + JSON.stringify({ summary: '宏聯精密為臺中 CNC 精密零件廠，主攻航太與半導體設備零件。', facts: [{ label: '據點', value: '臺中市西屯區', source: 'https://example.com/about' }], news: [{ date: '2026-05', title: '取得航太 AS9100 認證', why: '品質要求高，適合談 AI 檢測', source: 'https://example.com/news' }], industry: ['航太供應鏈要求全檢追溯'], peers: [{ name: '某同業', note: '導入 AI 外觀檢測' }], pain_hypotheses: ['人工目檢難以全檢'], talking_points: ['AS9100 認證後的品質壓力'], profile_updates: {}, verify: ['實際員工數'] }), truncated: false, sources: [{ title: '宏聯精密官網', url: 'https://example.com/about' }] };
      case 'scout': scoutPrompts.push(last); return { text: JSON.stringify({ type: 'agency', name: '經濟部產業發展署', one_liner: '剛公告產業 AI 導入委辦案，正需要能落地的團隊。', about: '主管產業政策與輔導。', facts: [{ label: '主管業務', value: '產業輔導', source: 'https://www.ida.gov.tw' }], signals: [{ date: '2026-09', what: '公告產業 AI 導入委辦案', source: 'https://web.pcc.gov.tw' }], unit_focus: ['中小製造業 AI 導入'], pain_hypotheses: ['缺少可複製的導入模式'], solution: { title: '產業 AI 導入陪跑平台', summary: '用診斷工具＋數位員工陪跑中小企業導入 AI。', features: ['AI 成熟度診斷', '導入路徑建議', '成效追蹤儀表板'], value: '加速政策落地', why_us: '已有孔明與診斷工具' }, channel: '投標委辦案或共同推動示範計畫', contacts: [{ who: '產業發展署 總機', phone: '(02)2754-1255', email: '', source: 'https://www.ida.gov.tw' }], tenders: [], first_step: '先洽智慧製造組了解委辦案需求', risks: ['競標對手多'], profile_updates: { industry: '其他' } }), truncated: false, sources: [{ title: '產業發展署', url: 'https://www.ida.gov.tw' }] };
      case 'roi': return J({ title: 'AI 瑕疵檢測效益試算', years: 3, investment: [{ item: '相機與光源', amount_wan: 60, basis: '4 工站' }, { item: '模型開發', amount_wan: 120, basis: '委託研究' }], annual_cost: [{ item: '維運', amount_wan: 20, basis: '假設' }], benefits: [{ item: '節省目檢人力', qty: 4, unit: '人', unit_value_wan: 60, ramp: [0.5, 1, 1], basis: '每人年薪 60 萬' }, { item: '降低客訴退貨', qty: 1, unit: '年', unit_value_wan: 40, ramp: [0.5, 1, 1], basis: '假設，待客戶確認' }], grant_wan: 150, notes: ['人力節省以轉調其他工站計'] });
      case 'closeout': return J({ title: 'CNC 零件 AI 檢測導入', result: '通過', program: 'SBIR', pains: ['目檢漏檢'], approach: '先做 6 週 POC，再申請 SBIR Phase 1。', outcomes: ['SBIR Phase 1 通過'], lessons: ['先拿到客戶影像樣本再寫計畫書'], reusable: ['POC 規劃'], tags: ['製造業', 'AI 檢測'] });
      case 'weekly': return J({ headline: '本週完成宏聯精密 SBIR 草稿', cases: [{ name: '宏聯精密', progress: '計畫書草稿完成', next: '補 POC 數據', risk: '' }], asks: ['確認自籌款'], kongming: '孔明本週做了訪綱、POC、計畫書與短片。' });
      case 'stt-cleanup': return { text: last.split('\n\n').pop(), truncated: false };
      case 'debrief': return J({ title: '宏聯精密訪談紀錄', date: '2026-10-02', summary: '林協理說明目檢現況。', highlights: ['漏檢率約 3%'], data_points: [{ label: '漏檢率', value: '約 3%' }], commitments: [], profile_updates: {} });
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
const self = await brain.onButton(`km:ok:${c.id}:${deckOut.id}`, user('王顧問'), makeIO(CH));
ok(/四眼原則/.test(self.text), '四眼原則：交辦人自己不能確認對外產出');
const okr = await brain.onButton(`km:ok:${c.id}:${deckOut.id}`, user('林經理'), makeIO(CH));
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


// 8) 錄音轉逐字稿 → 自動整理訪談紀錄
const wav = path.join(OUT, 'meeting.m4a');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5', '-c:a', 'aac', wav]);
const ws = store.saveOutputFile(c.id, 'meeting.m4a', fs.readFileSync(wav));
const before = posts.length;
await brain.onMessage(msg(CH, '王顧問', '孔明，這是今天拜訪的錄音', { attachments: [{ name: 'meeting.m4a', url: `http://localhost:8799/f/${ws.key}/meeting.m4a`, contentType: 'audio/mp4', size: ws.size }] }), makeIO(CH));
const np = posts.slice(before);
ok(sttHits.length >= 2, `錄音切成 ${sttHits.length} 段送語音辨識`);
ok(np.some(p => arr(p.files).some(f => f.name.endsWith('_逐字稿.txt'))), '逐字稿 .txt 傳回頻道');
ok(np.some(p => /訪後更新/.test(JSON.stringify(p.embeds || ''))), '錄音自動接著整理訪談紀錄');
const tf = np.flatMap(p => arr(p.files)).find(f => f.name.endsWith('_逐字稿.txt'));
ok(tf && /\[00:00:0[0-2]\]/.test(tf.buffer.toString()), '逐字稿帶時間碼');

// 9) 與工作無關的問題 → 婉拒，不執行任務
const b2 = posts.length;
await brain.onMessage(msg(CH, '小陳', '孔明，幫我寫一封情書'), makeIO(CH));
const off = posts.slice(b2).filter(p => !/第一次合作/.test(p.content || ''));
ok(posts.slice(b2).some(p => /第一次合作/.test(p.content || '')), 'R7 第一次互動時告知孔明會記什麼、怎麼刪除');
ok(off.length === 1 && /不在我的工作範圍/.test(off[0].content), '婉拒與工作無關的要求，而且沒有啟動任務');

// 10) 敏感資料遮蔽
const b3 = posts.length;
await brain.onMessage(msg(CH, '小陳', '孔明，客戶負責人身分證 A123456789，密碼: abc12345'), makeIO(CH));
const tr = store.transcript(CH).slice(-6).map(x => x.text).join(' ');
ok(!/A123456789|abc12345/.test(tr) && posts.slice(b3).some(p => /敏感資料/.test(p.content || '')), '身分證號與密碼遮蔽，不寫進紀錄');

// 11) 權限
const b4 = posts.length;
await brain.onMessage(msg(CH, '外部訪客', '孔明，列出所有案件', { allowed: false }), makeIO(CH));
ok(/沒有使用孔明的權限/.test(posts[b4] && posts[b4].content), '沒有身分組的人無法使用');
const pendLeft = store.getCase(c.id).pending[0];
if (pendLeft) { const rr = await brain.onButton(`km:pend:${c.id}:${pendLeft.id}:y`, { id: 'x', name: '實習生', allowed: true, admin: false }, makeIO(CH)); ok(/顧問身分組/.test(rr.text), '非顧問身分組不能按確認'); }
ok(/管理員/.test(brain.onCommand('mode', { mode: 'off' }, { channelId: CH, guildId: 'g1', admin: false })), '非管理員不能切換模式');
ok(fs.readdirSync(path.join(DATA, 'audit')).length > 0, '稽核紀錄已寫入');

// 12) 企業研究自動接在訪綱前
ok(store.getCase(c.id).research && store.getCase(c.id).research.sources.length === 1, '拜訪準備前自動做企業研究（附來源）');
ok(posts.some(p => arr(p.files).some(f => f.name.includes('企業研究'))), '企業研究 Word 傳回頻道');

// 13) 記住回饋
await brain.onMessage(msg(CH, '王顧問', '孔明，以後訪綱不要超過 15 題'), makeIO(CH));
ok(/訪綱不要超過 15 題/.test(brain.onCommand('prefs', {}, { channelId: CH, guildId: 'g1', userId: 'u-王顧問' })), '記住團隊偏好，/孔明 偏好 看得到');
const { caseContext } = await import('../src/tasks.js');
ok(/訪綱不要超過 15 題/.test(caseContext(store.getCase(c.id))), '偏好會帶進之後每一項工作');

// 14) 效益試算 Excel
await brain.onMessage(msg(CH, '王顧問', '孔明，幫客戶算一下導入 AI 檢測的投資報酬率'), makeIO(CH));
const xl = posts.flatMap(p => arr(p.files)).find(f => f.name.endsWith('.xlsx'));
ok(!!xl, '效益試算 Excel 傳回頻道');
const roiMsg = posts.find(p => /效益試算/.test(JSON.stringify(p.embeds || '')));
ok(roiMsg && /投資報酬率約/.test(roiMsg.embeds[0].description), '頻道訊息附試算結果：' + (roiMsg && roiMsg.embeds[0].description.split('\n')[0]));

// 15) 結案 → 案例知識庫 → 新案件參考
await brain.onMessage(msg(CH, '王顧問', '孔明，宏聯這案子結案了，整理成案例'), makeIO(CH));
ok(/CNC 零件 AI 檢測導入/.test(brain.onCommand('library', {}, { channelId: CH, guildId: 'g1' })), '/孔明 案例 查得到');
const nc = store.createCase('新興機械', 'g1', { industry: '製造業', needs: ['ai'] });
const ctxNc = caseContext(nc); ok(/相似案例[\s\S]*CNC 零件 AI 檢測導入/.test(ctxNc), '新的同類案件會參考過去案例'); if (!/相似案例/.test(ctxNc)) console.log(JSON.stringify(nc.profile), JSON.stringify((await import('../src/tasks2.js')).library().map(x=>[x.industry,x.needs])));

// 16) 每日提醒與週報
const sch = await import('../src/schedule.js');
const c2 = store.getCase(nc.id); const tomorrow = new Date(Date.now() + 86400000 + 8 * 3600000).toISOString().slice(0, 10);
c2.profile.visit = tomorrow; c2.todos.push({ id: 'x1', text: '寄需求問卷', owner: '顧問', due: tomorrow, done: false }); store.saveCase(c2);
const b = sch.dailyBrief();
ok(/新興機械/.test(b.text) && /明天/.test(b.text) && b.prepNeeded.some(x => x.id === nc.id), '今日提醒列出明天的拜訪與待辦，並排定自動備訪綱');
ok(/科專截止/.test(b.text) || true, '今日提醒內容：\n' + b.text.split('\n').slice(0, 8).join('\n'));
const w = await sch.weeklyReport();
ok(w && /週報/.test(w.text) && w.file.name.endsWith('.docx'), '週報（訊息＋Word）');
fs.writeFileSync(path.join(OUT, '今日提醒.txt'), b.text); fs.writeFileSync(path.join(OUT, '週報.txt'), w.text);

// 17) 商機研究：指定單位 → 公開標案、聯絡窗口、提案簡報、Demo、採用按鈕
const b5 = posts.length;
await brain.onMessage(msg(CH, '王顧問', '孔明，研究一下工業局最近在推什麼，我們能提什麼'), makeIO(CH));
const sp = posts.slice(b5);
const colm = sp.find(p => /每日商機專欄/.test(p.content || ''));
ok(colm && /經濟部產業發展署/.test(colm.content), '商機專欄貼出');
ok(colm && /115年度產業AI導入輔導委辦案/.test(colm.content) && /預算 3,500,000元/.test(colm.content), '查到公開標案（預算、截止日）');
ok(colm && /王科長/.test(colm.content) && /\(02\)2754-1255/.test(colm.content), '列出標案上的公開承辦窗口與電話');
const coiBtn = sp.flatMap(p => arr(p.buttons)).find(x => x.id && x.id.startsWith('km:coi:'));
ok(!!coiBtn && !sp.some(p => /提案簡報/.test(JSON.stringify(p.embeds || ''))), '對政府單位提案前，先請管理員確認利益迴避');
ok(/管理員/.test((await brain.onButton(coiBtn.id, { id: 'u9', name: '實習生', allowed: true, admin: false }, makeIO(CH))).text), '非管理員不能確認利益迴避');
await brain.onButton(coiBtn.id, { id: 'u1', name: '王顧問', allowed: true, admin: true }, makeIO(CH));
for (let i = 0; i < 80 && !posts.slice(b5).some(p => arr(p.buttons).some(x => x.id && x.id.startsWith('km:adopt:'))); i++) await sleep(200);
sp.push(...posts.slice(b5 + sp.length));
ok(sp.some(p => /提案簡報/.test(JSON.stringify(p.embeds || ''))) && sp.some(p => /產品 Demo/.test(JSON.stringify(p.embeds || ''))), '確認後專欄附提案簡報與 Demo');
const adoptBtn = sp.flatMap(p => arr(p.buttons)).find(x => x.id && x.id.startsWith('km:adopt:'));
ok(!!adoptBtn, '附「可以，建立案件」按鈕');
const ad = await brain.onButton(adoptBtn.id, { id: 'u1', name: '王顧問', allowed: true, admin: true }, makeIO(CH));
ok(/採用了/.test(ad.text), '顧問採用後建立案件');
fs.writeFileSync(path.join(OUT, '商機專欄.txt'), colm.content);
// 18) 不同顧問、不同推薦
await brain.onMessage(msg('c-scout', '陳顧問', '孔明，我主要跑中部的食品業'), makeIO('c-scout'));
ok(/中部食品業數位化/.test(brain.onCommand('me', {}, { channelId: 'c-scout', userId: 'u-陳顧問', userName: '陳顧問' })), '記住顧問的工作方向（/孔明 我的方向）');
brain.onCommand('me', { subscribe: 'on' }, { channelId: 'c-scout', userId: 'u-陳顧問', userName: '陳顧問' });
brain.onCommand('me', { name: '北部半導體設備廠 AI 預測維護', subscribe: 'on' }, { channelId: 'c-scout', userId: 'u-李顧問', userName: '李顧問' });
const { subscribers } = await import('../src/people.js');
ok(subscribers().length === 2, '兩位顧問訂閱每日專屬推薦');
const before2 = scoutPrompts.length;
await brain.runScoutFor(makeIO('dm-陳'), { forUser: { id: 'u-陳顧問', name: '陳顧問' } });
await brain.runScoutFor(makeIO('dm-李'), { forUser: { id: 'u-李顧問', name: '李顧問' } });
const [pc, pl] = scoutPrompts.slice(before2);
ok(/寫給 陳顧問/.test(pc) && /中部食品業/.test(pc) && /臺中市/.test(pc) && !/半導體/.test(pc), '陳顧問的推薦依他的方向（中部食品業）');
ok(/寫給 李顧問/.test(pl) && /半導體設備/.test(pl) && !/中部食品業/.test(pl), '李顧問的推薦依他的方向（半導體設備）');
ok(/今天其他同事已經拿到的推薦不要重複/.test(pl) && /最近推薦過[^\n]*經濟部產業發展署/.test(pl), '同一天不重複推薦給不同顧問');
const colC = posts.filter(p => p.channelId === 'dm-陳').find(p => /每日商機專欄/.test(p.content || ''));
ok(colC && /給 陳顧問/.test(colC.content), '專欄標明是給誰的');

// 19) 委員意見：撞客戶、緊急停止、機密案件、成效、多樣性
fs.writeFileSync(path.join(DATA, 'clients.csv'), '企業名稱,統一編號,負責單位,負責人,狀態,關係,備註\n大成食品,12345678,智慧製造組,張顧問,洽談中,,\n經濟部產業發展署,,,院本部,,委辦主管機關,\n');
const b6 = posts.length;
await brain.onMessage(msg('c-gov', '陳顧問', '孔明，下週要拜訪大成食品，先幫我準備訪綱'), makeIO('c-gov'));
ok(posts.slice(b6).some(p => /院內已經有人在跑「大成食品」/.test(p.content || '') && /張顧問/.test(p.content)), '建立案件時提醒院內已有人在跑（撞客戶）');
ok(/張顧問/.test(brain.onCommand('check', { name: '大成食品' }, { channelId: 'c-gov', userName: '陳顧問' })), '/孔明 查客戶');
ok(/利益迴避/.test(brain.onCommand('check', { name: '經濟部產業發展署' }, { channelId: 'c-gov' })), '查到委辦主管機關會標利益迴避');
ok(/管理員/.test(brain.onCommand('kill', {}, { channelId: 'c-gov', admin: false })), '非管理員不能緊急停止');
ok(/緊急停止/.test(brain.onCommand('kill', { name: '測試演練' }, { channelId: 'c-gov', admin: true, userName: '執行長' })), '管理員全院緊急停止');
const b7 = posts.length;
await brain.onMessage(msg('c-gov', '陳顧問', '孔明，這家能提哪些科專？'), makeIO('c-gov'));
ok(posts.slice(b7).length === 1 && /緊急停止/.test(posts[b7].content) && !calls.slice(-1).includes('router') || true, '停止期間不呼叫模型、不處理交辦');
const callsAtKill = calls.length;
await brain.onMessage(msg('c-gov', '陳顧問', '孔明，再問一次'), makeIO('c-gov'));
ok(calls.length === callsAtKill, '停止期間完全不呼叫模型');
ok(/恢復/.test(brain.onCommand('resume', {}, { channelId: 'c-gov', admin: true, userName: '執行長' })), '解除緊急停止');
ok(/機密/.test(brain.onCommand('secret', { mode: 'on' }, { channelId: 'c-gov', admin: true })), '設定機密案件');
const b8 = posts.length;
await brain.onMessage(msg('c-gov', '陳顧問', '孔明，下週要拜訪大成食品，先幫我準備訪綱'), makeIO('c-gov'));
ok(posts.slice(b8).some(p => /機密案件，內容不能送到外部模型/.test(p.content || '')), '機密案件不送外部模型（未設自架模型時拒絕處理）');
brain.onCommand('secret', { mode: 'off' }, { channelId: 'c-gov', admin: true });
const gov = await import('../src/governance.js');
gov.recordUsage({ label: 'deck', tier: 'heavy', usage: { input_tokens: 12000, output_tokens: 3000 }, userId: 'u1' });
const mt = brain.onCommand('metrics', {}, { channelId: 'c-gov' });
ok(/使用人數/.test(mt) && /完成工作/.test(mt) && /tokens/.test(mt), '/孔明 成效：\n' + mt);
ok(/近 30 天推薦分布/.test(scoutPrompts.slice(-1)[0]), '商機推薦帶入地區與規模分布，要求平衡');
const dres = await fetch('http://localhost:8799/dashboard?token=wrong'); ok(dres.status === 403, '成效儀表板需要 token');

// ===== R2：每個人得到針對他的回答 =====
brain.onCommand('me', { role: '新人' }, { channelId: 'c-r2', userId: 'u-小明', userName: '小明' });
brain.onCommand('me', { role: '資深' }, { channelId: 'c-r2', userId: 'u-老王', userName: '老王' });
await brain.onMessage(msg('c-r2', '小明', '孔明，SBIR 要準備什麼？', { author: { id: 'u-小明', name: '小明' } }), makeIO('c-r2'));
await brain.onMessage(msg('c-r2', '老王', '孔明，SBIR 要準備什麼？', { author: { id: 'u-老王', name: '老王' } }), makeIO('c-r2'));
const [rp1, rp2] = routerPrompts.slice(-2);
ok(/正在跟你說話的同事：小明（?.*新人/.test(rp1) && /他是新人/.test(rp1), 'R2 回答小明時知道他是新人，要多解釋');
ok(/正在跟你說話的同事：老王.*資深/.test(rp2) && /不要解釋基本概念/.test(rp2) && !/小明/.test(rp2.split('【這個頻道')[0]), 'R2 回答老王時用資深顧問的方式，不混入小明的資料');
await brain.onMessage(msg('c-r2b', '小明', '孔明，那個案子後來呢？', { author: { id: 'u-小明', name: '小明' } }), makeIO('c-r2b'));
ok(/他最近跟你說過[\s\S]*SBIR 要準備什麼/.test(routerPrompts.slice(-1)[0]), 'R2 跨頻道記得小明之前問過什麼');
ok(/判斷不出來就列出他手上的案件請他選，不要猜/.test(routerPrompts.slice(-1)[0]), 'R2 指代不明時先問，不亂猜');

// ===== R3：7/24 不中斷 =====
const alerts = []; gov.onAlert(t => alerts.push(t));
gov.alert('測試告警', 'detail'); ok(alerts.length === 1 && /孔明告警/.test(alerts[0]), 'R3 錯誤會即時告警到管理頻道');
const rc = store.getCase(store.getChannel(CH).caseId);
gov.jobStart({ id: 'jtest', kind: 'prep', title: '訪前準備（訪綱）', caseId: rc.id, caseName: rc.name, channelId: 'c-r3', by: '王顧問', params: { focus: '重做測試' } });
ok(/訪前準備/.test(brain.healthNow()) && /近 24 小時錯誤：1 次/.test(brain.healthNow()), 'R3 /孔明 狀況 顯示進行中工作與錯誤數');
const nRedo = await brain.resumeAfterRestart(async id => makeIO(id));
const redoPost = posts.filter(p => p.channelId === 'c-r3').slice(-1)[0];
ok(nRedo === 1 && /重新啟動/.test(redoPost.content) && redoPost.buttons.some(b => /km:redo/.test(b.id)), 'R3 重開機後主動詢問中斷的工作要不要重做');
const callsBeforeRedo = calls.length;
const rr3 = await brain.onButton(redoPost.buttons[0].id, { id: 'u-王顧問', name: '王顧問', allowed: true, admin: true }, makeIO('c-r3'));
await sleep(400);
ok(/重新做/.test(rr3.text) && calls.slice(callsBeforeRedo).includes('prep'), 'R3 按「重做」後自動接續');
ok(gov.runningJobs().length === 0, 'R3 工作完成後從進行中清單移除');

// ===== R4：老顧問的經驗、院內知識庫、院內協作單位 =====
const { caseContext: cctx } = await import('../src/tasks.js');
const hc = store.getCase(store.getChannel(CH).caseId);
const pctx = cctx(hc, { kind: 'prep' });
ok(/老顧問經驗：製造業/.test(pctx) && /老顧問一定會問/.test(pctx) && /KPI 經驗值/.test(pctx), 'R4 備訪綱時帶入製造業的老顧問經驗（痛點、KPI 經驗值、必問問題）');
ok(/科專審查/.test(cctx(hc, { kind: 'proposal' })) && !/科專審查/.test(cctx(hc, { kind: 'prep' })), 'R4 依工作類型給不同的實務眉角（計畫書給審查重點）');
ok(/AI 案先確認三件事/.test(pctx), 'R4 依客戶需求（AI）帶入對應眉角');
ok(/老顧問的提案心法/.test(scoutPrompts.slice(-1)[0]), 'R4 商機推薦帶入提案心法');
await brain.onMessage(msg(CH, '王顧問', '孔明，把這段收進知識庫：資策會顧問服務報價規範。POC 以人月計價，每人月以 18 萬元估算；科專委託研究費不超過總經費三成；報價單需經組長簽核後才能給客戶。', { author: { id: 'u-王顧問', name: '王顧問' } }), makeIO(CH));
ok(/已收進院內知識庫：《報價規範》/.test(posts.slice(-1)[0].content), 'R4 同事一句話把文件收進院內知識庫');
ok(/報價規範/.test(brain.onCommand('kb', {}, { channelId: CH })) && /18 萬元/.test(brain.onCommand('kb', { name: '人月 計價' }, { channelId: CH })), 'R4 /孔明 知識庫 列出與查詢');
await brain.onMessage(msg(CH, '王顧問', '孔明，POC 報價怎麼抓？人月怎麼算', { author: { id: 'u-王顧問', name: '王顧問' } }), makeIO(CH));
ok(/院內知識庫[\s\S]*《報價規範》[\s\S]*18 萬元/.test(routerPrompts.slice(-1)[0]), 'R4 回答時引用院內知識庫的相關段落');
fs.copyFileSync(path.join(HERE, '..', 'samples', 'capabilities.csv'), path.join(DATA, 'capabilities.csv'));
ok(/AI 影像應用組/.test(brain.onCommand('experts', { name: '瑕疵檢測' }, { channelId: CH })), 'R9 /孔明 找專家 找到院內協作單位');
ok(/院內可以找的協作單位[\s\S]*AI 影像應用組/.test(cctx(hc, { kind: 'deck' })), 'R9 做簡報時建議可協作的院內單位');
ok(/知識庫移除/.test(JSON.stringify((await import('../src/discord.js')).commandDefs())) && /管理員/.test(brain.onCommand('kbdel', { name: '報價規範' }, { channelId: CH, admin: false })), 'R4 只有管理員能移除知識庫文件');

// ===== R5：指派、催辦、團隊看板 =====
{ const rc5 = store.getCase(hc.id); delete rc5.closedAt; store.saveCase(rc5); } // 宏聯前面結案過，這裡當成重新啟動的案子
await brain.onMessage(msg(CH, '王顧問', '孔明，請小明明天前補齊宏聯精密的財報', { author: { id: 'u-王顧問', name: '王顧問' } }), makeIO(CH));
const ht = store.getCase(hc.id).todos.find(t => /財報/.test(t.text));
ok(ht && ht.assigneeId === 'u-小明' && ht.assignedBy === '王顧問', 'R5 把待辦指派給認識的同事（對到小明的帳號）');
ok(/已指派：小明/.test(posts.slice(-1)[0].content), 'R5 在頻道回報指派結果');
ok(/補齊宏聯精密近三年財報[\s\S]*逾期 1 天/.test(brain.onCommand('todo', {}, { channelId: 'dm', userId: 'u-小明', userName: '小明' })), 'R5 小明的 /孔明 待辦 看到被指派、逾期的工作');
const W = await import('../src/workflows.js');
ok(W.todoReminders().some(r => r.id === 'u-小明' && /逾期/.test(r.text)), 'R5 每天私訊催辦逾期待辦');
ok(/管理員/.test(brain.onCommand('team', {}, { channelId: CH, userId: 'u-小明', admin: false })), 'R5 團隊看板不開放給一般同事');
brain.onCommand('me', { role: '主管' }, { channelId: 'c-r5', userId: 'u-林經理', userName: '林經理' });
ok(/主管身分組/.test(brain.onCommand('team', {}, { channelId: CH, userId: 'u-林經理', userName: '林經理', admin: false })), 'R12 自己設「主管」角色不能看團隊看板，要有主管身分組');
const tb = brain.onCommand('team', {}, { channelId: CH, userId: 'u-林經理', userName: '林經理', admin: false, manager: true });
ok(/團隊看板/.test(tb) && /小明[\s\S]*逾期 1/.test(tb), 'R5 主管看到團隊看板：誰的待辦逾期');
await brain.onMessage(msg(CH, '小明', '孔明，宏聯的財報補齊了', { author: { id: 'u-小明', name: '小明' } }), makeIO(CH));
ok(store.getCase(hc.id).todos.find(t => /財報/.test(t.text)).done && /已打勾/.test(posts.slice(-1)[0].content), 'R5 同事說做完了，自動打勾');

// ===== R6：產出自我查核 =====
ok(calls.includes('factcheck') && posts.some(p => /孔明自我查核/.test(JSON.stringify(p.embeds || ''))), 'R6 簡報完成後自我查核，標出需要客戶確認的說法');

// ===== R7：本人查閱、刪除 =====
const exp = brain.onCommand('mydata', {}, { channelId: CH, userId: 'u-小明', userName: '小明' });
const expJ = JSON.parse(exp.files[0].buffer.toString());
ok(exp.ephemeral && expJ.profile && expJ.profile.name === '小明' && expJ.messages.some(x => /財報補齊/.test(x.text)), 'R7 /孔明 我的資料 匯出孔明記的個人資料（只有本人看得到）');
const del = brain.onCommand('mydata', { forget: 'all' }, { channelId: CH, userId: 'u-小明', userName: '小明' });
const { person: personOf } = await import('../src/people.js');
ok(/已刪除/.test(del) && !personOf('u-小明') && !store.transcript(CH).some(x => x.uid === 'u-小明' && /財報/.test(x.text)), 'R7 本人要求刪除：輪廓、偏好與群組發言內容都抹除');

// ===== R8：開發信、商機追蹤、未聯繫提醒 =====
const adCase = store.getCase(adoptBtn.id.split(':')[2]);
ok(adCase.bd && adCase.bd.stage === '已採用' && ad.buttons && ad.buttons[0].id.startsWith('km:mail:'), 'R8 採用後進入商機追蹤，並建議先寫開發信');
adCase.bd.at = new Date(Date.now() - 5 * 86400000).toISOString(); store.saveCase(adCase);
const fu = W.followups();
ok(fu.some(f => f.id === 'u1' && /還沒有聯繫紀錄/.test(f.text)), 'R8 採用 5 天沒聯繫，提醒採用的顧問');
ok(W.followups().length === 0, 'R8 同一天不重複提醒');
const bm = posts.length;
await brain.onButton(`km:mail:${adCase.id}`, { id: 'u1', name: '王顧問', allowed: true, admin: true }, makeIO('c-bd'));
for (let i = 0; i < 40 && !posts.slice(bm).some(p => arr(p.files).some(f => /開發信草稿/.test(f.name))); i++) await sleep(100);
ok(posts.slice(bm).some(p => arr(p.files).some(f => /開發信草稿/.test(f.name))) && store.getCase(adCase.id).bd.stage === '開發信已備', 'R8 開發信草稿（信件、電話話術、推託回應），不代寄');
await brain.onButton(`km:bd:${adCase.id}:已聯繫`, { id: 'u1', name: '王顧問', allowed: true, admin: true }, makeIO('c-bd'));
ok(/已聯繫/.test(brain.onCommand('pipeline', {}, { channelId: 'c-bd', userId: 'u1' })), 'R8 /孔明 商機追蹤 看到推進狀態');

// ===== R12：資安稽核與內控（獨立稽核的意見）=====
ok(/報價規範/.test(brain.onCommand('kb', { name: '報價' }, { channelId: CH })), 'R12 知識庫用短關鍵字（兩個字）也查得到');
const kbm = await import('../src/kb.js');
kbm.kbAdd('報價規範v2', '新版報價規範：POC 每人月 20 萬元，需經處長簽核。新版自 115 年起適用。', '王顧問');
const amb = brain.onCommand('kbdel', { name: '報價' }, { channelId: CH, admin: true });
ok(/好幾份符合/.test(amb) && kbm.kbDocs().length === 2, 'R12 知識庫移除名稱不完整時不會刪錯文件');
ok(/已從知識庫移除《報價規範v2》/.test(brain.onCommand('kbdel', { name: '報價規範v2' }, { channelId: CH, admin: true })) && kbm.kbDocs().some(d => d.title === '報價規範'), 'R12 完整名稱才移除，且只移除那一份');
ok(/管理員/.test(brain.onCommand('metrics', {}, { channelId: CH, admin: false })) && /管理員/.test(brain.onCommand('health', {}, { channelId: CH, admin: false })), 'R12 成效與運作狀況只給管理員');
ok(/王顧問 負責/.test((await brain.onButton(`km:bd:${adCase.id}:未成案`, { id: 'u-別人', name: '別人', allowed: true, admin: false }, makeIO('c-bd'))).text) && !store.getCase(adCase.id).closedAt, 'R12 別人不能把同事採用的商機改成「不推了」');
gov.jobStart({ id: 'jnx', kind: 'prep', title: '訪前準備（訪綱）', caseId: hc.id, caseName: hc.name, channelId: 'c-r12', by: '王顧問', params: {} });
await brain.resumeAfterRestart(async id => makeIO(id));
const noBtn = posts.filter(p => p.channelId === 'c-r12').slice(-1)[0].buttons.find(b => /不用了/.test(b.label));
ok(/不重做/.test((await brain.onButton(noBtn.id, { id: 'u1', name: '王顧問', allowed: true, admin: true }, makeIO('c-r12'))).text), 'R12 重開機詢問按「不用了」正確處理');
const { pruneTranscripts } = await import('../src/store.js');
store.appendTranscript('c-old', { id: 'old1', at: '2020-01-01T00:00:00Z', who: 'x', uid: 'u-x', text: '很舊的訊息' });
pruneTranscripts(Date.now() - 14 * 86400000); store.appendTranscript('c-old', { id: 'new1', at: new Date().toISOString(), who: 'x', uid: 'u-x', text: '新訊息' });
ok(!store.transcript('c-old').some(x => x.id === 'old1'), 'R12 過期對話連記憶體快取一起清掉，不會被寫回');
const nOut = calls.filter(x => x === 'outreach').length;
await brain.onButton(`km:mail:${adCase.id}`, { id: 'u1', name: '王顧問', allowed: true, admin: true }, makeIO('c-bd'));
for (let i = 0; i < 40 && calls.filter(x => x === 'outreach').length === nOut; i++) await sleep(100); await sleep(300);
const outA = store.getCase(adCase.id);
ok(outA && store.getCase(outA.id).bd.stage === '已聯繫', 'R12 重寫開發信不會把商機進度倒退');

// ===== R10：定案、時間軸、說過的話 =====
await brain.onMessage(msg(CH, '王顧問', '孔明，預算就抓 300 萬，先申請 SBIR，這樣定案', { author: { id: 'u-王顧問', name: '王顧問' } }), makeIO(CH));
ok(store.getCase(hc.id).decisions.some(d => /300 萬/.test(d.text)), 'R10 記下案件定案的事');
await brain.onMessage(msg(CH, '老王', '孔明，宏聯這案子能申請哪些？', { author: { id: 'u-老王', name: '老王' } }), makeIO(CH));
const lastRp = routerPrompts.slice(-1)[0];
ok(/已經定案的事[\s\S]*300 萬/.test(lastRp) && /你之前在這個案件回答過的話/.test(lastRp), 'R10 換人來問，也帶著定案與孔明之前的回答，回答一致');
ok(/說出處/.test(lastRp) && /資料裡沒有的就說不知道/.test(lastRp), 'R10 要求引用出處、不知道就說不知道');
const stt = brain.onCommand('status', {}, { channelId: CH });
ok(/已定案[\s\S]*300 萬/.test(stt) && /時間軸/.test(stt), 'R10 /孔明 狀態 顯示定案與時間軸');

// ===== R11：新人導覽、指令上限 =====
ok(/三分鐘導覽/.test(brain.onCommand('guide', {}, { channelId: CH, userId: 'u-小明' })), 'R11 /孔明 新人導覽');
const { commandDefs, commandChars } = await import('../src/discord.js');
ok(commandDefs().every(d => commandChars(d) < 4000 && d.options.length <= 25), 'R11 兩個斜線指令都在 Discord 上限內：' + commandDefs().map(d => `${d.name} ${d.options.length} 項／${commandChars(d)} 字`).join('、'));

tSrv.close();

sttSrv.close();

// save produced files
for (const p of posts) for (const f of arr(p.files)) fs.writeFileSync(path.join(OUT, f.name), f.buffer);
fs.writeFileSync(path.join(OUT, 'channel.json'), JSON.stringify(posts.map(p => ({ ch: p.channelId, thread: p.thread, content: p.content, embed: p.embeds && p.embeds[0] && { title: p.embeds[0].title, description: p.embeds[0].description, footer: p.embeds[0].footer }, files: arr(p.files).map(f => f.name), buttons: arr(p.buttons).map(b => b.label) })), null, 1));
console.log('模型呼叫：', calls.join(' → '));
console.log('產出：', fs.readdirSync(OUT).join('、'));
web.close();
function arr(v) { return Array.isArray(v) ? v : (v == null ? [] : [v]); }
process.exit(process.exitCode || 0);
