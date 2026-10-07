import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { KmError } from '../util.js';

export const xmlEscape = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const xmlText = text => String(text).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&');
const texts = (xml, prefix) => [...xml.matchAll(new RegExp(`<${prefix}:t(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${prefix}:t>`, 'g'))].map(m => xmlText(m[1])).join('');
export async function inspectOffice(buffer, ext) {
  const zip = await JSZip.loadAsync(buffer), parts = [];
  const names = ext === 'docx' ? ['word/document.xml'] : Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => +a.match(/slide(\d+)/)[1] - +b.match(/slide(\d+)/)[1]);
  for (const name of names) {
    if (!zip.file(name)) continue; const xml = await zip.file(name).async('string'), prefix = ext === 'docx' ? 'w' : 'a'; let index = 0;
    const paragraphs = [...xml.matchAll(new RegExp(`<${prefix}:p(?:\\s[^>]*)?>[\\s\\S]*?<\\/${prefix}:p>`, 'g'))].map(m => ({ index: index++, text: texts(m[0], prefix) }));
    parts.push({ name, paragraphs });
  }
  return { zip, parts };
}
export async function readPptx(buffer) {
  const { parts } = await inspectOffice(buffer, 'pptx');
  return parts.map((part, i) => `【投影片 ${i + 1}】\n${part.paragraphs.map(p => p.text).filter(Boolean).join('\n')}`).join('\n\n');
}
export async function readXlsx(buffer) {
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer);
  const rows = []; let cells = 0;
  for (const sheet of workbook.worksheets) sheet.eachRow((row, rowNumber) => {
    const values = [];
    row.eachCell((cell, column) => {
      if (++cells > 20000) throw new KmError('Excel 超過 20,000 個非空儲存格，請分工作表或縮小資料後上傳；未靜默截斷。');
      const value = cell.value;
      const text = value && typeof value === 'object' && ('formula' in value || 'sharedFormula' in value) ? `公式=${value.formula || value.sharedFormula}；快取結果=${value.result ?? '未計算'}` : cell.text;
      values.push(`${sheet.name}!${cell.address}：${text}`);
    });
    rows.push(values.join('｜'));
  });
  return rows.join('\n');
}
export async function reviseOffice(buffer, ext, replacements) {
  const { zip, parts } = await inspectOffice(buffer, ext), prefix = ext === 'docx' ? 'w' : 'a';
  if (!Array.isArray(replacements) || !replacements.length || replacements.length > 30) throw new KmError('局部修改內容為空或太多，請縮小修改範圍。');
  const seen = new Set();
  for (const change of replacements) {
    const part = parts.find(p => p.name === change.part), paragraph = part?.paragraphs.find(p => p.index === change.index);
    const key = `${change.part}:${change.index}`;
    if (!paragraph || paragraph.text !== change.original || seen.has(key) || typeof change.replacement !== 'string') throw new KmError('原文或修改位置不符，未產生修改版，請重試。');
    seen.add(key);
  }
  for (const part of parts) {
    const changes = replacements.filter(c => c.part === part.name); if (!changes.length) continue;
    let index = 0; const xml = await zip.file(part.name).async('string');
    const edited = xml.replace(new RegExp(`<${prefix}:p(?:\\s[^>]*)?>[\\s\\S]*?<\\/${prefix}:p>`, 'g'), paragraph => {
      const change = changes.find(c => c.index === index++); if (!change) return paragraph; let first = true;
      return paragraph.replace(new RegExp(`(<${prefix}:t(?:\\s[^>]*)?>)[\\s\\S]*?(<\\/${prefix}:t>)`, 'g'), (_, open, close) => { const value = first ? xmlEscape(change.replacement) : ''; first = false; return open + value + close; });
    }); zip.file(part.name, edited);
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}
export async function appendImageDocx(buffer, imageBuffer, caption) {
  const zip = await JSZip.loadAsync(buffer), name = 'kongming-' + Date.now() + '.png', id = 'rIdKM' + Date.now();
  zip.file('word/media/' + name, imageBuffer);
  const relName = 'word/_rels/document.xml.rels';
  const rel = await zip.file(relName).async('string');
  zip.file(relName, rel.replace('</Relationships>', `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/></Relationships>`));
  let types = await zip.file('[Content_Types].xml').async('string');
  if (!/Extension="png"/.test(types)) types = types.replace('</Types>', '<Default Extension="png" ContentType="image/png"/></Types>'); zip.file('[Content_Types].xml', types);
  let xml = await zip.file('word/document.xml').async('string');
  const block = `<w:p><w:r><w:t>${xmlEscape(caption)}</w:t></w:r></w:p><w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="4286250" cy="4286250"/><wp:docPr id="${Date.now() % 100000000}" name="AI情境示意圖"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4286250" cy="4286250"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  xml = xml.replace(/(<w:sectPr[\s\S]*?<\/w:sectPr>)?\s*<\/w:body>/, block + '$1</w:body>');
  zip.file('word/document.xml', xml); return zip.generateAsync({ type: 'nodebuffer' });
}
