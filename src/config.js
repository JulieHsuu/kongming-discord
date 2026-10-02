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
  guildIds: list(E.KM_GUILD_IDS),            // 只在這些伺服器工作；空白＝所有加入的伺服器
  watchChannels: list(E.KM_WATCH_CHANNELS),  // 主動觀察的頻道 ID；空白＝所有看得到的文字頻道
  defaultMode: (E.KM_DEFAULT_MODE || 'auto').toLowerCase(), // auto｜ask｜off
  autoTasks: list(E.KM_AUTO_TASKS || 'prep,ingest,debrief,status,match,poc,deck,proposal'),
  askTasks: list(E.KM_ASK_TASKS || 'demo,video'),
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
  diagnosisUrl: E.KM_DIAGNOSIS_URL || 'https://ai-advisor-agent.datafabric.iii-ei-stack.com/',
};

export function checkConfig({ needDiscord = true } = {}) {
  const miss = [];
  if (needDiscord && !cfg.discordToken) miss.push('DISCORD_TOKEN');
  if (cfg.llmProvider === 'anthropic' && !cfg.anthropicKey) miss.push('ANTHROPIC_API_KEY');
  if (cfg.llmProvider === 'openai' && !cfg.openaiKey && /api\.openai\.com/.test(cfg.openaiBase)) miss.push('OPENAI_API_KEY');
  return miss;
}
