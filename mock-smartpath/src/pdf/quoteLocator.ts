import type { Rect } from '@smartpath/tutor-core';

export interface SegmentPosition {
  segment: number;
  offset: number;
}

/**
 * Finds a quote across text segments, ignoring all whitespace. pdf.js splits
 * text into arbitrary spans and drops the spaces at line wraps, so neither
 * span boundaries nor whitespace can be trusted.
 */
export function findInSegments(
  segments: string[],
  quote: string,
): { start: SegmentPosition; end: SegmentPosition } | null {
  const needle = quote.replace(/\s+/g, '');
  if (!needle) return null;

  let haystack = '';
  const positions: SegmentPosition[] = [];
  segments.forEach((text, segment) => {
    for (let offset = 0; offset < text.length; offset += 1) {
      if (/\s/.test(text[offset])) continue;
      haystack += text[offset];
      positions.push({ segment, offset });
    }
  });

  const at = haystack.indexOf(needle);
  if (at < 0) return null;
  return { start: positions[at], end: positions[at + needle.length - 1] };
}

export function locateQuote(layer: HTMLElement, quote: string): Range | null {
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);

  const found = findInSegments(
    nodes.map((node) => node.data),
    quote,
  );
  if (!found) return null;

  const range = document.createRange();
  range.setStart(nodes[found.start.segment], found.start.offset);
  range.setEnd(nodes[found.end.segment], found.end.offset + 1);
  return range;
}

export function toRect(r: DOMRect | DOMRectReadOnly): Rect {
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

export function unionRects(rects: Rect[]): Rect {
  const left = Math.min(...rects.map((r) => r.x));
  const top = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Collapses a span-by-span rect list into one rect per visual line. */
export function mergeLines(rects: Rect[]): Rect[] {
  const lines: Rect[] = [];
  const sorted = rects.filter((r) => r.width > 0 && r.height > 0).sort((a, b) => a.y - b.y || a.x - b.x);
  for (const rect of sorted) {
    const line = lines.find((l) => Math.abs(l.y + l.height / 2 - (rect.y + rect.height / 2)) < rect.height / 2);
    if (line) Object.assign(line, unionRects([line, rect]));
    else lines.push({ ...rect });
  }
  return lines;
}
