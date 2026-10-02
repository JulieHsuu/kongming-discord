// 讀取同事丟進頻道的檔案：PDF、Word、文字、圖片
import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';
import { KmError } from '../util.js';

const TEXT_EXT = ['txt', 'md', 'csv', 'tsv', 'json', 'html', 'htm', 'srt', 'vtt', 'log'];
const IMG = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

export function kindOf(name, contentType = '') {
  const ext = (String(name).split('.').pop() || '').toLowerCase();
  if (IMG[ext] || /^image\//.test(contentType)) return 'image';
  if (/^(audio|video)\//.test(contentType) || ['mp3', 'm4a', 'wav', 'aac', 'mp4', 'mov', 'webm', 'ogg'].includes(ext)) return 'media';
  if (ext === 'pdf' || ext === 'docx' || TEXT_EXT.includes(ext) || /^text\//.test(contentType)) return 'doc';
  return 'other';
}

/** 下載並讀出內容 → {name, kind:'text'|'image', text?, image?:{mediaType, base64}} */
export async function readAttachment({ name, url, contentType, size }) {
  const k = kindOf(name, contentType);
  if (k === 'media') throw new KmError(`「${name}」是錄音或影片檔，請先用既有診斷工具轉成逐字稿再交給我。`);
  if (k === 'other') throw new KmError(`「${name}」的格式我還讀不了，請改成 PDF、Word、文字或圖片。`);
  if (size && size > 25 * 1024 * 1024) throw new KmError(`「${name}」超過 25 MB，請縮小後再傳。`);
  const r = await fetch(url);
  if (!r.ok) throw new KmError(`「${name}」下載失敗。`);
  const buf = Buffer.from(await r.arrayBuffer());
  return await readBuffer(name, buf, contentType);
}

export async function readBuffer(name, buf, contentType = '') {
  const ext = (String(name).split('.').pop() || '').toLowerCase();
  const k = kindOf(name, contentType);
  if (k === 'image') {
    if (buf.length > 4.5 * 1024 * 1024) throw new KmError(`圖片「${name}」太大，請壓縮到 4.5 MB 以下。`);
    return { name, kind: 'image', image: { mediaType: IMG[ext] || contentType || 'image/png', base64: buf.toString('base64') } };
  }
  if (ext === 'pdf') {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    const t = String(text || '');
    if (!t.replace(/\s/g, '')) throw new KmError(`「${name}」讀不到文字（可能是掃描檔），請改傳圖片或文字檔。`);
    return { name, kind: 'text', text: t };
  }
  if (ext === 'docx') { const r = await mammoth.extractRawText({ buffer: buf }); return { name, kind: 'text', text: r.value || '' }; }
  let t = buf.toString('utf8');
  if (/^html?$/.test(ext)) t = t.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  return { name, kind: 'text', text: t };
}
