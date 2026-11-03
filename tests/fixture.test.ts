import { readFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { ALPHA, iterations, lesson } from '../mock-smartpath/src/demo/gradientDescentLesson.ts';

const strip = (s: string) => s.replace(/\s+/g, '');

describe('worked example', () => {
  it('recomputes every iteration from the formula and alpha', () => {
    let w = 0;
    for (const row of iterations) {
      const gradient = 2 * (w - 3);
      expect(row.w).toBeCloseTo(w, 9);
      expect(row.gradient).toBeCloseTo(gradient, 9);
      expect(row.loss).toBeCloseTo((w - 3) ** 2, 9);
      w -= ALPHA * gradient;
    }
  });
});

describe('PDF matches the fixture', () => {
  let pageTexts: string[] = [];

  beforeAll(async () => {
    const data = new Uint8Array(readFileSync('mock-smartpath/public/demo/gradient-descent-notes.pdf'));
    const doc = await getDocument({ data, useSystemFonts: true }).promise;
    expect(doc.numPages).toBe(lesson.pageCount);
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pageTexts.push(strip(content.items.map((item) => ('str' in item ? item.str : '')).join('')));
    }
  });

  it('contains every page block verbatim', () => {
    for (const page of lesson.pages) {
      for (const line of page.text.split('\n')) {
        expect(pageTexts[page.number - 1]).toContain(strip(line));
      }
    }
  });

  it('contains every highlight quote on its stated page', () => {
    for (const h of lesson.highlights) {
      expect(pageTexts[h.page - 1], h.id).toContain(strip(h.quote));
    }
  });

  it('cites only highlights that exist', () => {
    const ids = new Set(lesson.highlights.map((h) => h.id));
    for (const qa of lesson.qaFallbacks) {
      if (qa.cite.highlightId) expect(ids.has(qa.cite.highlightId), qa.id).toBe(true);
    }
    for (const s of lesson.selectionExplanations) {
      if (s.highlightId) expect(ids.has(s.highlightId)).toBe(true);
    }
  });

  it('narrates every step', () => {
    for (const step of lesson.lessonSteps) expect(lesson.narration[step.id], step.id).toBeTruthy();
  });
});
