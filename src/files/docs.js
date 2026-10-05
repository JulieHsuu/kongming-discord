// Word（.docx）與 PowerPoint（.pptx）產生器
import * as D from 'docx';
import PptxGenJS from 'pptxgenjs';
import { arr, isoDay } from '../util.js';
import { cfg } from '../config.js';

const F = 'Microsoft JhengHei';
const C = { ink: '0B1F5C', text: '1B2A4E', teal: '1597B5', navy: '0A1E5E', cyan: '33C6EA', soft: 'EAF3FB', muted: '5B6A8E', line: 'DCE4EF', white: 'FFFFFF' };

/** blocks: [{h},{p,muted},{ul:[..]},{ol:[..]},{table:{headers,rows}}] */
export async function buildDocx(title, blocks, sub) {
  const run = (text, o = {}) => new D.TextRun({ text: String(text ?? ''), font: F, size: o.size || 22, bold: !!o.bold, color: o.color || C.text });
  const children = [
    new D.Paragraph({ spacing: { after: 120 }, children: [run(title, { size: 36, bold: true, color: C.ink })] }),
    new D.Paragraph({ spacing: { after: 240 }, children: [run(sub || `孔明 Kongming・${cfg.org}・${isoDay()}・草稿，請顧問確認後使用`, { size: 18, color: C.muted })] }),
  ];
  for (const b of blocks) {
    if (b.h) children.push(new D.Paragraph({ spacing: { before: 280, after: 100 }, children: [run(b.h, { size: 26, bold: true, color: '13328A' })] }));
    else if (b.h2) children.push(new D.Paragraph({ spacing: { before: 180, after: 80 }, children: [run(b.h2, { size: 23, bold: true, color: C.ink })] }));
    else if (b.p) children.push(new D.Paragraph({ spacing: { after: 100 }, children: [run(b.p, { color: b.muted ? C.muted : C.text })] }));
    else if (b.ul) arr(b.ul).forEach(t => children.push(new D.Paragraph({ bullet: { level: 0 }, spacing: { after: 60 }, children: [run(t)] })));
    else if (b.ol) arr(b.ol).forEach((t, i) => children.push(new D.Paragraph({ indent: { left: 360, hanging: 360 }, spacing: { after: 60 }, children: [run(`${i + 1}. ${t}`)] })));
    else if (b.table && arr(b.table.rows).length) {
      const rows = [b.table.headers, ...b.table.rows].map((r, ri) => new D.TableRow({
        tableHeader: ri === 0,
        children: arr(r).map(cell => new D.TableCell({
          shading: ri === 0 ? { fill: C.navy, type: D.ShadingType.CLEAR, color: 'auto' } : undefined,
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          children: [new D.Paragraph({ children: [run(cell, { size: 20, bold: ri === 0, color: ri === 0 ? C.white : C.text })] })],
        })),
      }));
      children.push(new D.Table({ rows, width: { size: 100, type: D.WidthType.PERCENTAGE } }));
      children.push(new D.Paragraph({ children: [] }));
    }
  }
  const doc = new D.Document({
    creator: '孔明 Kongming', title,
    styles: { default: { document: { run: { font: F, size: 22 } } } },
    sections: [{ properties: { page: { margin: { top: 1200, bottom: 1200, left: 1200, right: 1200 } } }, children }],
  });
  return await D.Packer.toBuffer(doc);
}

export function blocksToMd(title, blocks) {
  const L = [`# ${title}`, '', `> 孔明 Kongming・${isoDay()}・草稿，請顧問確認後使用`, ''];
  for (const b of blocks) {
    if (b.h) L.push(`## ${b.h}`, '');
    else if (b.h2) L.push(`### ${b.h2}`, '');
    else if (b.p) L.push(b.p, '');
    else if (b.ul) L.push(...arr(b.ul).map(t => `- ${t}`), '');
    else if (b.ol) L.push(...arr(b.ol).map((t, i) => `${i + 1}. ${t}`), '');
    else if (b.table && arr(b.table.rows).length) L.push(`| ${b.table.headers.join(' | ')} |`, `| ${b.table.headers.map(() => '---').join(' | ')} |`, ...b.table.rows.map(r => `| ${arr(r).map(x => String(x ?? '').replace(/\|/g, '／').replace(/\n/g, ' ')).join(' | ')} |`), '');
  }
  return L.join('\n');
}

/** 提案簡報 → .pptx Buffer */
export async function buildPptx(d, { company = '', program = '' } = {}) {
  const pptx = new PptxGenJS(); pptx.layout = 'LAYOUT_WIDE'; pptx.title = d.deck_title || '提案簡報'; pptx.company = '資策會'; pptx.author = '孔明 Kongming';
  pptx.defineSlideMaster({ title: 'BODY', background: { color: C.white }, objects: [
    { rect: { x: 0, y: 0, w: 13.333, h: 0.1, fill: { color: C.teal } } },
    { rect: { x: 0, y: 7.05, w: 13.333, h: 0.45, fill: { color: C.navy } } },
    { text: { text: `${company}｜${program ? program + ' ' : ''}提案草稿｜資策會`, options: { x: 0.5, y: 7.1, w: 10, h: 0.35, fontSize: 10, color: C.white, fontFace: F } } },
  ], slideNumber: { x: 12.3, y: 7.1, w: 0.6, h: 0.35, fontSize: 10, color: C.white, fontFace: F } });
  const head = (sl, s) => { sl.addText(s.title || '', { x: 0.5, y: 0.3, w: 12.3, h: 0.8, fontSize: 28, bold: true, color: C.ink, fontFace: F }); if (s.subtitle) sl.addText(s.subtitle, { x: 0.5, y: 1.0, w: 12.3, h: 0.4, fontSize: 14, color: C.muted, fontFace: F }); };
  const bullets = (items, x, y, w, h, size = 18) => arr(items).length ? [arr(items).map(t => ({ text: String(t), options: { bullet: { indent: 18 }, breakLine: true } })), { x, y, w, h, fontSize: size, color: C.text, fontFace: F, valign: 'top', paraSpaceAfter: 8 }] : null;
  arr(d.slides).forEach((s, i) => {
    if (s.layout === 'title' || i === 0) {
      const sl = pptx.addSlide(); sl.background = { color: C.navy };
      sl.addShape(pptx.ShapeType.ellipse, { x: 9.2, y: -2.2, w: 6.4, h: 6.4, fill: { color: C.navy }, line: { color: C.cyan, width: 18, transparency: 75 } });
      sl.addText(s.title || d.deck_title, { x: 0.8, y: 2.2, w: 10.5, h: 1.5, fontSize: 36, bold: true, color: C.white, fontFace: F });
      sl.addText(s.subtitle || `${company}${program ? '｜' + program : ''}`, { x: 0.8, y: 3.8, w: 10.5, h: 0.6, fontSize: 18, color: '9EDDF0', fontFace: F });
      sl.addText(`${cfg.org}｜${isoDay()}｜草稿`, { x: 0.8, y: 6.3, w: 8, h: 0.4, fontSize: 12, color: 'A9B8E2', fontFace: F });
      if (s.notes) sl.addNotes(s.notes); return;
    }
    const sl = pptx.addSlide({ masterName: 'BODY' }); head(sl, s);
    const top = s.subtitle ? 1.55 : 1.3;
    if (s.layout === 'two-col') {
      [['left', 0.5], ['right', 6.85]].forEach(([k, x]) => { const col = s[k] || {};
        sl.addShape(pptx.ShapeType.roundRect, { x, y: top, w: 6.0, h: 5.4, fill: { color: k === 'left' ? 'F5F8FC' : C.soft }, line: { color: C.line }, rectRadius: 0.08 });
        sl.addText(col.heading || '', { x: x + 0.25, y: top + 0.15, w: 5.5, h: 0.5, fontSize: 18, bold: true, color: '13328A', fontFace: F });
        const b = bullets(col.bullets, x + 0.25, top + 0.75, 5.5, 4.5, 15); if (b) sl.addText(...b); });
    } else if (s.layout === 'table' && s.table && arr(s.table.rows).length) {
      const hdr = arr(s.table.headers).map(h => ({ text: String(h), options: { bold: true, color: C.white, fill: { color: C.navy } } }));
      const rows = arr(s.table.rows).map(r => arr(r).map(v => ({ text: String(v ?? '') })));
      sl.addTable(hdr.length ? [hdr, ...rows] : rows, { x: 0.5, y: top, w: 12.3, fontSize: 13, fontFace: F, color: C.text, border: { type: 'solid', pt: 0.75, color: C.line }, autoPage: false, valign: 'middle' });
    } else if (s.layout === 'timeline' && arr(s.milestones).length) {
      const ms = arr(s.milestones).slice(0, 6), n = ms.length, w = 12.3 / n, y = top + 1.2;
      sl.addShape(pptx.ShapeType.line, { x: 0.5, y, w: 12.3, h: 0, line: { color: C.teal, width: 2.5 } });
      ms.forEach((m, k) => { const x = 0.5 + k * w;
        sl.addShape(pptx.ShapeType.ellipse, { x: x + w / 2 - 0.15, y: y - 0.15, w: 0.3, h: 0.3, fill: { color: C.navy }, line: { color: C.white, width: 2 } });
        sl.addText(String(m.when || ''), { x, y: y - 0.75, w, h: 0.45, fontSize: 14, bold: true, color: C.teal, align: 'center', fontFace: F });
        sl.addText(String(m.what || ''), { x: x + 0.08, y: y + 0.3, w: w - 0.16, h: 2.6, fontSize: 13, color: C.text, align: 'center', valign: 'top', fontFace: F }); });
      const b = bullets(s.bullets, 0.5, y + 3.1, 12.3, 1.7, 14); if (b) sl.addText(...b);
    } else { const b = bullets(s.bullets, 0.6, top + 0.1, 12.1, 5.4); if (b) sl.addText(...b); }
    if (s.notes) sl.addNotes(s.notes);
  });
  return await pptx.write({ outputType: 'nodebuffer' });
}
