// 孔明的設定：全部從環境變數（.env）讀取。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 讀 .env（不另外裝套件）
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
const E = process.env;
const list = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const bool = (v, d) => v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v);

export const cfg = {
  discordToken: E.DISCORD_TOKEN || '',
  guildIds: list(E.KM_GUILD_IDS),            // 只在這些伺服器工作（KM_REQUIRE_GUILD_LIST=true 時必填）
  watchChannels: list(E.KM_WATCH_CHANNELS),  // 主動觀察的頻道 ID；空白＝所有看得到的文字頻道
  defaultMode: (E.KM_DEFAULT_MODE || 'auto').toLowerCase(), // auto｜ask｜off
  autoTasks: list(E.KM_AUTO_TASKS || 'prep,ingest,debrief,status,match,poc,deck,proposal,research,roi'),
  askTasks: list(E.KM_ASK_TASKS || 'demo,video,closeout'),
  observeDelaySec: int(E.KM_OBSERVE_DELAY_SEC, 60),   // 對話停下多久後孔明才判斷要不要動手
  observeMinGapSec: int(E.KM_OBSERVE_MIN_GAP_SEC, 180),
  confidence: Number(E.KM_CONFIDENCE || 0.72),
  dailyProactiveLimit: int(E.KM_DAILY_PROACTIVE_LIMIT, 15),
  dedupeHours: int(E.KM_DEDUPE_HOURS, 12),
  quietHours: E.KM_QUIET_HOURS || '',          // 例如 22-7：這段時間不主動動手
  timezone: E.TZ || 'Asia/Taipei',
  useThreads: bool(E.KM_USE_THREADS, true),
  allowDM: bool(E.KM_ALLOW_DM, true),
  setAvatar: bool(E.KM_SET_AVATAR, false),

  llmProvider: (E.KM_LLM_PROVIDER || 'anthropic').toLowerCase(), // anthropic｜openai
  anthropicKey: E.ANTHROPIC_API_KEY || '',
  openaiBase: (E.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
  openaiKey: E.OPENAI_API_KEY || '',
  model: E.KM_MODEL || (/(openai)/i.test(E.KM_LLM_PROVIDER || '') ? 'gpt-4.1' : 'claude-sonnet-5-5'),
  modelHeavy: E.KM_MODEL_HEAVY || E.KM_MODEL || (/(openai)/i.test(E.KM_LLM_PROVIDER || '') ? 'gpt-4.1' : 'claude-opus-5-5'),
  modelFast: E.KM_MODEL_FAST || E.KM_MODEL || (/(openai)/i.test(E.KM_LLM_PROVIDER || '') ? 'gpt-4.1-mini' : 'claude-haiku-4-5-20251001'),

  port: int(E.PORT, 8787),
  publicBaseUrl: (E.PUBLIC_BASE_URL || '').replace(/\/$/, ''), // 例如 https://kongming.example.com
  dataDir: path.resolve(ROOT, E.KM_DATA_DIR || 'data'),
  uploadLimitMB: Number(E.KM_DISCORD_UPLOAD_MB || 10),
  videoFps: int(E.KM_VIDEO_FPS, 24),
  org: E.KM_ORG || '資策會數位轉型研究院',

  // 錄音轉逐字稿（Whisper 相容端點）
  sttProvider: (E.KM_STT_PROVIDER || 'openai').toLowerCase(),
  sttBase: (E.KM_STT_BASE_URL || (E.KM_STT_API_KEY ? 'https://api.openai.com/v1' : '')).replace(/\/$/, ''),
  sttKey: E.KM_STT_API_KEY || '',
  sttModel: E.KM_STT_MODEL || 'whisper-1',
  sttPrompt: E.KM_STT_PROMPT || '以下是台灣企業顧問訪談的錄音，使用繁體中文。常見詞：資策會、科專、SBIR、SIIR、A+、POC、KPI、AI、數位轉型。',
  sttChunkSec: int(E.KM_STT_CHUNK_SEC, 600),
  sttMaxMinutes: int(E.KM_STT_MAX_MINUTES, 180),
  sttMaxMB: Number(E.KM_STT_MAX_MB || 200),
  sttCleanup: bool(E.KM_STT_CLEANUP, true),

  // 資安
  requireGuildList: bool(E.KM_REQUIRE_GUILD_LIST, true),   // 沒設 KM_GUILD_IDS 時拒絕所有伺服器
  allowedRoles: list(E.KM_ALLOWED_ROLES),                   // 可以使用孔明的身分組 ID；空白＝伺服器內所有成員
  adminRoles: list(E.KM_ADMIN_ROLES),                       // 可切換模式、確認對外產出的身分組 ID；空白＝同 allowedRoles
  excludeChannels: list(E.KM_EXCLUDE_CHANNELS),             // 孔明完全不讀、不回的頻道
  userRatePerHour: int(E.KM_USER_RATE_PER_HOUR, 30),
  maxAttachMB: Number(E.KM_MAX_ATTACH_MB || 25),
  redact: bool(E.KM_REDACT, true),                          // 送模型前遮蔽身分證號、卡號、帳密、金鑰
  fileTtlDays: int(E.KM_FILE_TTL_DAYS, 30),                 // 產出檔案與下載連結保存天數
  transcriptDays: int(E.KM_TRANSCRIPT_DAYS, 14),            // 群組對話保存天數
  strictScope: bool(E.KM_STRICT_SCOPE, true),

  // 工作節奏
  webSearch: bool(E.KM_WEB_SEARCH, true),                  // 企業研究時上網查（Claude API 的 web search 工具）
  briefChannel: E.KM_BRIEF_CHANNEL || '',                    // 每日提醒與週報發到這個頻道
  briefTime: E.KM_BRIEF_TIME || '08:50',                     // 每天早上提醒時間
  weeklyDay: int(E.KM_WEEKLY_DAY, 5),                        // 週報：星期幾（1=一 … 5=五）
  weeklyTime: E.KM_WEEKLY_TIME || '17:00',
  remindDays: list(E.KM_REMIND_DAYS || '3,1,0').map(Number), // 拜訪日、待辦期限、科專截止日前幾天提醒
  workdaysOnly: bool(E.KM_WORKDAYS_ONLY, true),
  // 每日商機專欄
  scoutChannel: E.KM_SCOUT_CHANNEL || E.KM_BRIEF_CHANNEL || '',
  scoutTime: E.KM_SCOUT_TIME || '10:00',
  scoutWhen: (E.KM_SCOUT_WHEN || 'idle').toLowerCase(),     // idle：近 3 天沒有拜訪才寫；daily：每個工作日都寫；off
  scoutFocus: E.KM_SCOUT_FOCUS || '',                        // 團隊這陣子想推的方向，例如「製造業 AI 檢測、餐飲連鎖數位化、地方政府智慧城市」
  scoutDemo: bool(E.KM_SCOUT_DEMO, true),
  scoutMaxUsers: int(E.KM_SCOUT_MAX_USERS, 8),
  scoutDiversity: bool(E.KM_SCOUT_DIVERSITY, true),            // 推薦時平衡地區與企業規模
  scoutAgency: (E.KM_SCOUT_AGENCY || 'ask').toLowerCase(),     // 推薦政府單位：allow｜ask（做簡報前要管理員確認無利益衝突）｜off

  // 治理
  killEnv: bool(E.KM_KILL, false),                             // 設成 true 等於全院緊急停止
  fourEyes: bool(E.KM_FOUR_EYES, true),                        // 對外產出要由「交辦人以外」的顧問確認
  monthlyBudgetUsd: Number(E.KM_MONTHLY_BUDGET_USD || 0),      // 每月模型預算；達 100% 時停止高成本的主動工作
  price: { in: E.KM_PRICE_IN, out: E.KM_PRICE_OUT, heavyIn: E.KM_PRICE_HEAVY_IN, heavyOut: E.KM_PRICE_HEAVY_OUT, fastIn: E.KM_PRICE_FAST_IN, fastOut: E.KM_PRICE_FAST_OUT },
  minutesSaved: Object.fromEntries(String(E.KM_MINUTES_SAVED || 'prep:60,ingest:15,debrief:45,status:15,match:40,poc:120,deck:180,demo:240,video:240,proposal:480,research:60,roi:90,closeout:30,scout:120,outreach:30').split(',').map(x => x.split(':')).filter(x => x.length === 2).map(([k, v]) => [k.trim(), Number(v)])),
  kzStaleDays: int(E.KM_KZ_STALE_DAYS, 14),                    // 科專資料超過幾天沒檢核就在結果上警示
  privateBase: (E.KM_PRIVATE_LLM_BASE || '').replace(/\/$/, ''), // 機密案件改用的自架模型（OpenAI 相容），資料不出公司
  privateKey: E.KM_PRIVATE_LLM_KEY || '',
  privateModel: E.KM_PRIVATE_LLM_MODEL || '',
  dashToken: E.KM_DASHBOARD_TOKEN || '',
  adminChannel: E.KM_ADMIN_CHANNEL || '',                     // 告警、每日健康報告、重啟通知發到這裡
  healthTime: E.KM_HEALTH_TIME || '08:30',                     // 每天幾點在管理頻道發健康報告
  tenderSearch: bool(E.KM_TENDER_SEARCH, true),                // 查政府電子採購網公開標案
  tenderApi: (E.KM_TENDER_API || 'https://pcc-api.openfun.app/api').replace(/\/$/, ''),
  // 第 4–11 輪評審後新增
  factCheck: list(E.KM_FACTCHECK ?? 'deck,proposal,outreach'), // 這些產出完成後自我查核：沒有依據的說法、和案件資料矛盾的數字
  todoDM: bool(E.KM_TODO_DM, true),                            // 每天私訊提醒同事自己被指派、快到期或逾期的待辦
  followupDays: int(E.KM_FOLLOWUP_DAYS, 3),                    // 採用商機後幾天沒有聯繫紀錄就提醒
  privacyNotice: bool(E.KM_PRIVACY_NOTICE, true),
  managerRoles: list(E.KM_MANAGER_ROLES),                      // 可以看團隊看板的身分組 ID（主管）；空白＝只有管理員
  kbWrite: (E.KM_KB_WRITE || 'all').toLowerCase(),             // 誰可以把文件收進知識庫：all（有權限的同事）｜admin              // 第一次互動時說明孔明會記什麼、怎麼查看與刪除
  diagnosisUrl: E.KM_DIAGNOSIS_URL || 'https://ai-advisor-agent.datafabric.iii-ei-stack.com/',
};

export function checkConfig({ needDiscord = true } = {}) {
  const miss = [];
  if (needDiscord && !cfg.discordToken) miss.push('DISCORD_TOKEN');
  if (cfg.llmProvider === 'anthropic' && !cfg.anthropicKey) miss.push('ANTHROPIC_API_KEY');
  if (cfg.llmProvider === 'openai' && !cfg.openaiKey && /api\.openai\.com/.test(cfg.openaiBase)) miss.push('OPENAI_API_KEY');
  return miss;
}
