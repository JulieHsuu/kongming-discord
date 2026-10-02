// 孔明 Kongming：Discord 版數位員工
import { cfg, checkConfig } from './config.js';
import { loadPrograms } from './domain.js';
import { startWeb } from './web.js';
import { startDiscord } from './discord.js';
import { filmInit } from './film/film.js';
import { logger } from './util.js';

const log = logger('main');
const miss = checkConfig();
if (miss.length) { log.error(`缺少設定：${miss.join('、')}。請照 README 把它們寫進 .env 再啟動。`); process.exit(1); }
log.info(`科專資料庫 ${loadPrograms()} 項計畫；模型 ${cfg.llmProvider}：${cfg.model}（重度 ${cfg.modelHeavy}、判斷 ${cfg.modelFast}）`);
filmInit().catch(e => log.warn('短片元件', e.message));
startWeb();
startDiscord().catch(() => process.exit(1));
process.on('unhandledRejection', e => log.error('unhandled', e));
