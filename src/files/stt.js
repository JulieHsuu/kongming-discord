// 錄音轉逐字稿：ffmpeg 轉成 16kHz 單聲道、切段，送到 Whisper 相容的語音辨識端點
// 支援：OpenAI（whisper-1／gpt-4o-transcribe）、Groq、Azure OpenAI 相容端點、公司自架 faster-whisper / whisper.cpp server
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cfg } from '../config.js';
import * as LLM from '../llm.js';
import { KmError, logger, cut } from '../util.js';
import { redact } from '../guard.js';

const log = logger('stt');
export const sttEnabled = () => !!cfg.sttBase && (cfg.sttProvider !== 'off');

function run(cmd, args) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }); let out = '', err = '';
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { err += d; });
    p.on('error', () => rej(new KmError('伺服器沒有安裝 ffmpeg，無法處理錄音。')));
    p.on('close', c => c === 0 ? res(out) : rej(new KmError('錄音檔格式無法解析，請改成 mp3、m4a 或 wav。' + (err ? '' : ''))));
  });
}
const fmt = s => { s = Math.floor(s); return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

async function transcribeChunk(file, offset, signal) {
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(file)], { type: 'audio/mpeg' }), path.basename(file));
  fd.append('model', cfg.sttModel);
  fd.append('language', 'zh');
  fd.append('prompt', cfg.sttPrompt);
  const verbose = !/gpt-4o/.test(cfg.sttModel);
  fd.append('response_format', verbose ? 'verbose_json' : 'json');
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(180000)]) : AbortSignal.timeout(180000);
  const r = await fetch(`${cfg.sttBase}/audio/transcriptions`, { method: 'POST', body: fd, signal: requestSignal, headers: cfg.sttKey ? { authorization: `Bearer ${cfg.sttKey}` } : {} });
  if (!r.ok) { const t = (await r.text()).slice(0, 200); log.error('stt', r.status, t); throw new KmError(r.status === 401 ? '語音辨識金鑰無效，請管理員檢查 KM_STT_API_KEY。' : r.status === 429 ? '語音辨識用量已達上限，請稍後再試。' : '語音辨識服務沒有回應，請稍後再試。'); }
  const j = await r.json();
  if (Array.isArray(j.segments) && j.segments.length) return j.segments.map(s => `[${fmt(offset + s.start)}] ${String(s.text).trim()}`).join('\n');
  return `[${fmt(offset)}] ${String(j.text || '').trim()}`;
}

export function splitTranscript(text, limit = 12000) {
  const pieces = []; let part = '';
  for (const line of text.split(/(?<=\n)/)) {
    if (part && part.length + line.length > limit) { pieces.push(part); part = ''; }
    for (let i = 0; i < line.length; i += limit) { const section = line.slice(i, i + limit); if (section.length === limit) { if (part) pieces.push(part); pieces.push(section); part = ''; } else part += section; }
  }
  if (part) pieces.push(part); return pieces;
}

/** 錄音 Buffer → 逐字稿文字 */
export async function transcribe(name, buf, { signal, onProgress, userId = '' } = {}) {
  if (!sttEnabled()) throw new KmError('錄音轉逐字稿尚未啟用：請管理員在 .env 設定 KM_STT_BASE_URL 與 KM_STT_API_KEY（見 README「錄音轉逐字稿」）。');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'km-stt-'));
  const cacheRoot = path.join(cfg.dataDir, 'stt-checkpoints'); fs.mkdirSync(cacheRoot, { recursive: true });
  for (const f of fs.readdirSync(cacheRoot)) { const p = path.join(cacheRoot, f); if (/^[a-f0-9]{64}\.json$/.test(f) && fs.statSync(p).mtimeMs < Date.now() - 7 * 86400000) fs.unlinkSync(p); }
  const cacheFile = path.join(cacheRoot, createHash('sha256').update(buf).update(JSON.stringify([userId, cfg.sttBase, cfg.sttModel, cfg.sttChunkSec, cfg.sttPrompt])).digest('hex') + '.json');
  let checkpoint; try { checkpoint = JSON.parse(fs.readFileSync(cacheFile, 'utf8')).chunks || {}; } catch { checkpoint = {}; }
  try {
    const src = path.join(tmp, 'in' + (path.extname(name) || '.bin'));
    fs.writeFileSync(src, buf);
    const durS = parseFloat(await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src])) || 0;
    if (durS > cfg.sttMaxMinutes * 60) throw new KmError(`錄音長度 ${Math.round(durS / 60)} 分鐘，超過上限 ${cfg.sttMaxMinutes} 分鐘，請分段上傳。`);
    const seg = cfg.sttChunkSec;
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '32k', '-f', 'segment', '-segment_time', String(seg), '-reset_timestamps', '1', path.join(tmp, 'part%03d.mp3')]);
    const parts = fs.readdirSync(tmp).filter(f => /^part\d+\.mp3$/.test(f)).sort();
    if (!parts.length) throw new KmError('錄音未能切出任何音訊段落，請重新上傳。');
    let covered = 0;
    for (const file of parts) covered += parseFloat(await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(tmp, file)])) || 0;
    if (covered + 1 < durS) throw new KmError('錄音分段長度不足，未產生完整逐字稿；請重新上傳。');
    const out = [];
    const empty = []; let resumed = 0;
    for (let i = 0; i < parts.length; i++) {
      if (signal && signal.aborted) throw new KmError('已停止。');
      onProgress && onProgress(`語音辨識中 ${i + 1}/${parts.length} 段（約 ${Math.round(durS / 60)} 分鐘錄音）`);
      let text = checkpoint[i];
      if (typeof text === 'string') resumed++;
      else {
        let lastError;
        for (let attempt = 0; attempt < 2; attempt++) {
          try { text = await transcribeChunk(path.join(tmp, parts[i]), i * seg, signal); break; } catch (e) { lastError = e; if (signal?.aborted) throw e; }
        }
        if (typeof text !== 'string') throw new KmError(`第 ${i + 1}/${parts.length} 段辨識失敗，已保留前面成功的段落；在工作中心重試可接續辨識。${lastError?.message || ''}`);
        text = redact(text).text;
        checkpoint[i] = text;
        const cacheTmp = cacheFile + '.' + process.pid + '.' + Date.now() + '.tmp'; fs.writeFileSync(cacheTmp, JSON.stringify({ userId, chunks: checkpoint })); fs.renameSync(cacheTmp, cacheFile);
      }
      if (!text.replace(/\[[\d:]+\]/g, '').trim()) empty.push(i + 1);
      out.push(text);
    }
    let text = out.join('\n').trim();
    if (!text.replace(/\[[\d:]+\]/g, '').trim()) throw new KmError('錄音裡辨識不到說話內容。');
    if (cfg.sttCleanup) {
      onProgress && onProgress('整理逐字稿（繁體中文、分段）…');
      const pieces = splitTranscript(text), cleaned = [];
      for (const p of pieces) {
        const r = await LLM.text({ label: 'stt-cleanup', tier: 'fast', maxTokens: 8000, signal, system: '你是逐字稿校對員。', messages: [{ role: 'user', content: `把下面語音辨識的逐字稿整理好：轉成台灣繁體中文用語、補上標點、修正明顯的同音錯字（例如公司名、科專、SBIR、POC 等術語）、依說話換人或話題分段；保留每段開頭的時間碼；不要刪減內容、不要摘要、不要加入原文沒有的資訊。只輸出整理後的逐字稿。\n\n${p}` }] });
        const times = p.match(/\[[\d:]+\]/g) || [];
        cleaned.push(r.truncated || r.text.length < p.length * 0.5 || times.some(t => !r.text.includes(t)) ? p : r.text.trim());
      }
      text = cleaned.join('\n');
    }
    log.info(`${name}：${Math.round(durS)} 秒 → ${text.length} 字`);
    return { text, durationSec: durS, coverage: { total: parts.length, completed: out.length, resumed, empty, coveredSeconds: covered } };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
export const transcriptHeader = (name, durS) => `逐字稿：${name}（約 ${Math.round(durS / 60)} 分鐘）\n由孔明自動辨識，人名、數字與專有名詞請顧問核對。\n\n`;
export function deleteTranscriptionCache(userId) {
  const root = path.join(cfg.dataDir, 'stt-checkpoints'); if (!fs.existsSync(root)) return;
  for (const name of fs.readdirSync(root)) { if (!/^[a-f0-9]{64}\.json$/.test(name)) continue; const file = path.join(root, name); try { if (JSON.parse(fs.readFileSync(file, 'utf8')).userId === userId) fs.unlinkSync(file); } catch {} }
}
export { cut };
