// Draws the authored notes into a real, text-based PDF. Run: npm run generate:pdf
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { COURSE_LINE, DOCUMENT_TITLE, notesPages } from '../mock-smartpath/src/demo/notesContent.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = resolve(root, 'mock-smartpath/public/demo/gradient-descent-notes.pdf');

const PAGE = { width: 612, height: 792 };
const MARGIN = 56;
const CONTENT_WIDTH = PAGE.width - MARGIN * 2;
const INK = rgb(0.11, 0.13, 0.2);
const MUTED = rgb(0.42, 0.45, 0.53);
const ACCENT = rgb(0.17, 0.32, 0.72);
const RULE = rgb(0.84, 0.86, 0.91);
const PANEL = rgb(0.95, 0.96, 0.98);

const doc = await PDFDocument.create();
doc.setTitle(DOCUMENT_TITLE);
doc.setAuthor('CS 3600 Teaching Staff');
doc.setSubject('Lecture 8: Optimization');

const fonts = {
  body: await doc.embedFont(StandardFonts.Helvetica),
  bold: await doc.embedFont(StandardFonts.HelveticaBold),
  mono: await doc.embedFont(StandardFonts.CourierBold),
};

function wrap(text, font, size, width) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > width && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawLossFigure(page, top) {
  const box = { x: MARGIN + 70, y: top - 170, width: CONTENT_WIDTH - 140, height: 160 };
  const toX = (w) => box.x + 24 + ((w + 1) / 8) * (box.width - 48);
  const toY = (loss) => box.y + 18 + (loss / 16) * (box.height - 36);

  page.drawLine({ start: { x: box.x, y: box.y + 18 }, end: { x: box.x + box.width, y: box.y + 18 }, thickness: 1, color: MUTED });
  page.drawLine({ start: { x: box.x + 8, y: box.y }, end: { x: box.x + 8, y: box.y + box.height }, thickness: 1, color: MUTED });

  let previous = null;
  for (let i = 0; i <= 80; i += 1) {
    const w = -1 + (i / 80) * 8;
    const point = { x: toX(w), y: toY((w - 3) ** 2) };
    if (previous) page.drawLine({ start: previous, end: point, thickness: 2, color: ACCENT });
    previous = point;
  }

  const here = { x: toX(0.6), y: toY(5.76) };
  page.drawCircle({ ...here, size: 5, color: rgb(0.86, 0.3, 0.3) });
  page.drawLine({ start: { x: here.x + 8, y: here.y - 4 }, end: { x: here.x + 46, y: here.y - 24 }, thickness: 1.5, color: rgb(0.86, 0.3, 0.3) });
  return box.y;
}

notesPages.forEach((blocks, index) => {
  const page = doc.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - MARGIN;

  if (index === 0) {
    page.drawText(DOCUMENT_TITLE, { x: MARGIN, y: y - 24, size: 26, font: fonts.bold, color: INK });
    y -= 48;
  }
  page.drawText(COURSE_LINE, { x: MARGIN, y: y - 12, size: 11, font: fonts.body, color: MUTED });
  y -= 26;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE.width - MARGIN, y }, thickness: 1, color: RULE });
  y -= 30;

  for (const block of blocks) {
    switch (block.kind) {
      case 'heading':
        page.drawText(block.text, { x: MARGIN, y: y - 18, size: 20, font: fonts.bold, color: ACCENT });
        y -= 38;
        break;
      case 'paragraph':
      case 'key': {
        const font = block.kind === 'key' ? fonts.bold : fonts.body;
        for (const line of wrap(block.text, font, 15, CONTENT_WIDTH)) {
          page.drawText(line, { x: MARGIN, y: y - 13, size: 15, font, color: INK });
          y -= 23;
        }
        y -= 12;
        break;
      }
      case 'formula':
        page.drawRectangle({ x: MARGIN, y: y - 32, width: CONTENT_WIDTH, height: 36, color: PANEL });
        page.drawText(block.text, { x: MARGIN + 14, y: y - 19, size: 15, font: fonts.mono, color: INK });
        y -= 46;
        break;
      case 'bullet': {
        const lines = wrap(block.text, fonts.body, 15, CONTENT_WIDTH - 20);
        page.drawCircle({ x: MARGIN + 6, y: y - 8, size: 2.5, color: ACCENT });
        for (const line of lines) {
          page.drawText(line, { x: MARGIN + 20, y: y - 13, size: 15, font: fonts.body, color: INK });
          y -= 23;
        }
        y -= 8;
        break;
      }
      case 'table': {
        const column = CONTENT_WIDTH / block.header.length;
        block.header.forEach((cell, i) => {
          page.drawText(cell, { x: MARGIN + i * column + 8, y: y - 14, size: 13, font: fonts.bold, color: INK });
        });
        y -= 24;
        page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE.width - MARGIN, y }, thickness: 1, color: RULE });
        for (const row of block.rows) {
          row.forEach((cell, i) => {
            page.drawText(cell, { x: MARGIN + i * column + 8, y: y - 17, size: 13, font: fonts.body, color: INK });
          });
          y -= 24;
        }
        y -= 16;
        break;
      }
      case 'figure': {
        y = drawLossFigure(page, y) - 22;
        const lines = wrap(block.caption, fonts.body, 12, CONTENT_WIDTH);
        for (const line of lines) {
          page.drawText(line, { x: MARGIN, y, size: 12, font: fonts.body, color: MUTED });
          y -= 16;
        }
        break;
      }
    }
  }

  if (y < MARGIN + 24) throw new Error(`Page ${index + 1} overflows the footer (y=${y})`);
  page.drawText(`Page ${index + 1} of ${notesPages.length}`, { x: MARGIN, y: 36, size: 10, font: fonts.body, color: MUTED });
});

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, await doc.save());
console.log(`Wrote ${outPath}`);
