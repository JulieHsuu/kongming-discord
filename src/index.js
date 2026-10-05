// 孔明 Kongming：Discord 版數位員工
import { cfg, checkConfig } from './config.js';
import { loadPrograms } from './domain.js';
import { startWeb } from './web.js';
import { startDiscord } from './discord.js';
import { filmInit } from './film/film.js';
import { logger } from './util.js';
import { startSweeper } from './guard.js';
import { sttEnabled } from './files/stt.js';
import { onUsage } from './llm.js';
import { recordUsage } from './governance.js';
onUsage(recordUsage);

const log = logger('main');
const miss = checkConfig();
if (miss.length) { log.error(`缺少設定：${miss.join('、')}。請照 README 把它們寫進 .env 再啟動。`); process.exit(1); }
log.info(`科專資料庫 ${loadPrograms()} 項計畫；模型 ${cfg.llmProvider}：${cfg.model}（重度 ${cfg.modelHeavy}、判斷 ${cfg.modelFast}）`);
filmInit().catch(e => log.warn('短片元件', e.message));
if (cfg.requireGuildList && !cfg.guildIds.length) log.warn('尚未設定 KM_GUILD_IDS：孔明不會回應任何伺服器。請填入公司 Discord 伺服器 ID（或設 KM_REQUIRE_GUILD_LIST=false）。');
log.info(`錄音轉逐字稿：${sttEnabled() ? cfg.sttModel + ' @ ' + cfg.sttBase : '未啟用（設定 KM_STT_BASE_URL／KM_STT_API_KEY）'}；敏感資料遮蔽：${cfg.redact ? '開' : '關'}；工作範圍限制：${cfg.strictScope ? '開' : '關'}`);
startSweeper();
startWeb();
startDiscord().catch(() => process.exit(1));
import('./governance.js').then(g => { process.on('unhandledRejection', e => { log.error('unhandled', e); g.alert('未處理的錯誤', String(e && (e.stack || e.message) || e)); }); process.on('uncaughtException', e => { log.error('uncaught', e); g.alert('程式例外（將由 Docker 自動重啟）', String(e && (e.stack || e.message))); setTimeout(() => process.exit(1), 1500); }); });
