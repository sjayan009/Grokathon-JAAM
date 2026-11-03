#!/usr/bin/env python3
"""F03/F04 checks: real page rasters, hotspot geometry, zoom, and scroll.

Runs its own static server on port 5174 so it does not collide with smoke_test.py.
"""
import subprocess, time, urllib.request, sys
from pathlib import Path
import fitz
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / 'mock-app'
OUT = Path('/tmp/pdf-grounding')
OUT.mkdir(parents=True, exist_ok=True)
ZOOMS = (0.75, 1, 1.5)
TOLERANCE_PX = 1.5

def chromium_executable():
    for candidate in ('/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/local/bin/chrome'):
        if Path(candidate).is_file():
            return candidate
    raise SystemExit('Chromium or Chrome is required')

def curated_words(pdf, per_page=5):
    chosen = []
    for page_index, page in enumerate(pdf):
        seen = set()
        taken = 0
        words = sorted(page.get_text('words'), key=lambda word: (round(word[1], 1), word[0]))
        for word in words:
            text = word[4]
            if text in seen or len(text) < 4 or not text[0].isalpha() or word[1] < 90:
                continue
            if (word[2] - word[0]) < 8 or (word[3] - word[1]) < 4:
                continue
            seen.add(text)
            chosen.append({
                'pageIndex': page_index,
                'text': text,
                'x': word[0] / page.rect.width,
                'y': word[1] / page.rect.height,
                'width': (word[2] - word[0]) / page.rect.width,
                'height': (word[3] - word[1]) / page.rect.height,
                'raw': word[:4],
            })
            taken += 1
            if taken >= per_page:
                break
    if len(chosen) < 20:
        raise SystemExit(f'Need 20 word boxes, found {len(chosen)}')
    return chosen[:20]

def assert_word_ink(pdf, words):
    for entry in words:
        page = pdf[entry['pageIndex']]
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
        x0 = max(0, int(entry['raw'][0] * 2))
        y0 = max(0, int(entry['raw'][1] * 2))
        x1 = min(pix.width, int(entry['raw'][2] * 2))
        y1 = min(pix.height, int(entry['raw'][3] * 2))
        dark = 0
        for y in range(y0, y1):
            for x in range(x0, x1):
                red, green, blue = pix.pixel(x, y)[:3]
                if red + green + blue < 620:
                    dark += 1
        if dark < 3:
            raise SystemExit(f'Word box has no ink: p{entry["pageIndex"]} {entry["text"]}')

def measure_error(page, anchor_id):
    return page.evaluate(
        """(anchorId) => {
          const api = window.PdfViewerApi;
          const measured = api.measureAnchor(anchorId);
          const hotspot = document.querySelector(`[data-anchor-id="${CSS.escape(anchorId)}"]`);
          const box = hotspot.getBoundingClientRect();
          const expected = measured.clientRects[0];
          const highlight = document.querySelector(`[data-highlight-for="${CSS.escape(anchorId)}"]`);
          const highlightBox = highlight ? highlight.getBoundingClientRect() : null;
          const pageEl = document.getElementById('page-' + measured.pageIndex);
          const pageBox = pageEl.getBoundingClientRect();
          return {
            hotspot: {left: box.left, top: box.top, width: box.width, height: box.height},
            expected: {left: expected.left, top: expected.top, width: expected.width, height: expected.height},
            highlight: highlightBox ? {left: highlightBox.left, top: highlightBox.top, width: highlightBox.width, height: highlightBox.height} : null,
            pageWidth: pageBox.width,
            pageHeight: pageBox.height,
            pdfWidth: Number(pageEl.dataset.pageWidth),
            pdfHeight: Number(pageEl.dataset.pageHeight),
            zoom: api.getZoom(),
            active: hotspot.dataset.active,
            pressed: hotspot.getAttribute('aria-pressed'),
            highlightCount: document.querySelectorAll(`[data-highlight-for="${CSS.escape(anchorId)}"]`).length,
            anchorCount: document.querySelectorAll('[data-anchor-id]').length
          };
        }""",
        anchor_id,
    )

def max_delta(actual, expected):
    return max(
        abs(actual['left'] - expected['left']),
        abs(actual['top'] - expected['top']),
        abs(actual['width'] - expected['width']),
        abs(actual['height'] - expected['height']),
    )

def main():
    pdf = fitz.open(str(APP / 'assets' / 'lc3-pointers-demo.pdf'))
    words = curated_words(pdf)
    assert_word_ink(pdf, words)
    server = subprocess.Popen(
        [sys.executable, '-m', 'http.server', '5174', '--bind', '127.0.0.1', '--directory', str(APP)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        for _ in range(40):
            try:
                urllib.request.urlopen('http://127.0.0.1:5174/fixtures/demo.json', timeout=1)
                break
            except Exception:
                time.sleep(0.15)
        else:
            raise SystemExit('Fixture server did not start')
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                executable_path=chromium_executable(),
                headless=True,
                args=['--no-sandbox', '--disable-dev-shm-usage'],
            )
            page = browser.new_page(viewport={'width': 1440, 'height': 900})
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto('http://127.0.0.1:5174/', wait_until='networkidle')
            page.wait_for_function("() => window.PdfViewerApi && document.querySelector('#pdf-viewport')?.dataset.pdfApi === 'ready'")
            scrollable = page.evaluate("""() => {
              const viewport = document.getElementById('pdf-viewport');
              return {scrollHeight: viewport.scrollHeight, clientHeight: viewport.clientHeight};
            }""")
            if scrollable['scrollHeight'] <= scrollable['clientHeight'] + 40:
                raise SystemExit(f'PDF viewport does not scroll: {scrollable}')
            assert page.locator('.pdf-page-wrap').count() == 4
            assert page.locator('[data-anchor-id]').count() == 10
            assert page.locator('[data-concept-id]').count() == 5
            images = page.evaluate("""() => [...document.querySelectorAll('.pdf-page-wrap img')].map(img => ({
              w: img.naturalWidth, h: img.naturalHeight, complete: img.complete
            }))""")
            assert images == [{'w': 980, 'h': 1268, 'complete': True}] * 4, images

            anchor_ids = page.evaluate("() => window.PdfViewerApi.getSelectionContext() && [...document.querySelectorAll('[data-anchor-id]')].map(el => el.dataset.anchorId)")
            worst = 0
            for zoom in ZOOMS:
                applied = page.evaluate("(zoom) => window.PdfViewerApi.setZoom(zoom)", zoom)
                assert abs(applied - zoom) < 0.001, applied
                for anchor_id in anchor_ids:
                    page.evaluate(
                        "(id) => window.PdfViewerApi.highlightAnchor(id, {scroll:true, behavior:'auto'})",
                        anchor_id,
                    )
                    report = measure_error(page, anchor_id)
                    delta = max_delta(report['hotspot'], report['expected'])
                    worst = max(worst, delta)
                    if delta > TOLERANCE_PX:
                        raise SystemExit(f'{anchor_id} at {zoom:.0%} off by {delta:.2f}px: {report}')
                    if abs(report['pageWidth'] - report['pdfWidth'] * zoom) > TOLERANCE_PX:
                        raise SystemExit(f'Page width at {zoom} is {report["pageWidth"]}, expected {report["pdfWidth"] * zoom}')
                    if abs(report['pageHeight'] - report['pdfHeight'] * zoom) > TOLERANCE_PX:
                        raise SystemExit(f'Page height at {zoom} is {report["pageHeight"]}')
                    if report['active'] != 'true' or report['pressed'] != 'true' or report['highlightCount'] != 1:
                        raise SystemExit(f'Highlight state missing for {anchor_id}: {report}')
                    if report['highlight']:
                        center_dx = abs((report['highlight']['left'] + report['highlight']['width'] / 2) - (report['hotspot']['left'] + report['hotspot']['width'] / 2))
                        center_dy = abs((report['highlight']['top'] + report['highlight']['height'] / 2) - (report['hotspot']['top'] + report['hotspot']['height'] / 2))
                        if center_dx > 2 or center_dy > 2:
                            raise SystemExit(f'Highlight center left the hotspot for {anchor_id}: {center_dx:.2f},{center_dy:.2f}')
                    if report['anchorCount'] != 10:
                        raise SystemExit(f'data-anchor-id count changed to {report["anchorCount"]}')
                    visible = page.evaluate(
                        """(anchorId) => {
                          const hotspot = document.querySelector(`[data-anchor-id="${CSS.escape(anchorId)}"]`).getBoundingClientRect();
                          const viewport = document.getElementById('pdf-viewport').getBoundingClientRect();
                          const slop = 2;
                          const fitsX = hotspot.width <= viewport.width - 4;
                          const fitsY = hotspot.height <= viewport.height - 4;
                          const horizontally = fitsX
                            ? hotspot.left >= viewport.left - slop && hotspot.right <= viewport.right + slop
                            : hotspot.left <= viewport.left + slop && hotspot.right >= viewport.right - slop;
                          const vertically = fitsY
                            ? hotspot.top >= viewport.top - slop && hotspot.bottom <= viewport.bottom + slop
                            : hotspot.top <= viewport.top + slop && hotspot.bottom >= viewport.bottom - slop;
                          return horizontally && vertically;
                        }""",
                        anchor_id,
                    )
                    if not visible:
                        raise SystemExit(f'{anchor_id} at {zoom:.0%} is not fully inside the PDF viewport')

            page.evaluate("() => window.PdfViewerApi.highlightAnchor('ldr_instruction', {scroll:true, behavior:'auto'})")
            before = page.evaluate("""() => {
              const hotspot = document.querySelector('[data-anchor-id="ldr_instruction"]');
              const pageEl = document.getElementById('page-2');
              const hotspotBox = hotspot.getBoundingClientRect();
              const pageBox = pageEl.getBoundingClientRect();
              return {dx: hotspotBox.left - pageBox.left, dy: hotspotBox.top - pageBox.top, top: hotspotBox.top};
            }""")
            page.evaluate("() => { document.getElementById('pdf-viewport').scrollTop += 90; }")
            after = page.evaluate("""() => {
              const hotspot = document.querySelector('[data-anchor-id="ldr_instruction"]');
              const pageEl = document.getElementById('page-2');
              const hotspotBox = hotspot.getBoundingClientRect();
              const pageBox = pageEl.getBoundingClientRect();
              return {dx: hotspotBox.left - pageBox.left, dy: hotspotBox.top - pageBox.top, top: hotspotBox.top};
            }""")
            if abs(after['dx'] - before['dx']) > 0.6 or abs(after['dy'] - before['dy']) > 0.6:
                raise SystemExit(f'Highlight drifted from the page while scrolling: {before} -> {after}')
            if abs((before['top'] - after['top']) - 90) > 2:
                raise SystemExit(f'Scroll did not move the hotspot with the page: {before} -> {after}')

            word_worst = page.evaluate(
                """(words) => {
                  const api = window.PdfViewerApi;
                  let worst = 0;
                  const grouped = new Map();
                  words.forEach(word => {
                    const list = grouped.get(word.pageIndex) || [];
                    list.push(word);
                    grouped.set(word.pageIndex, list);
                  });
                  grouped.forEach((list, pageIndex) => {
                    api.setZoom(1);
                    api.scrollToPage(pageIndex, {behavior:'auto'});
                    const probes = api.placeMeasurementRects(pageIndex, list);
                    const pageEl = document.getElementById('page-' + pageIndex);
                    const pageBox = pageEl.getBoundingClientRect();
                    list.forEach((word, index) => {
                      const box = probes[index].getBoundingClientRect();
                      const expected = {
                        left: pageBox.left + word.x * pageBox.width,
                        top: pageBox.top + word.y * pageBox.height,
                        width: word.width * pageBox.width,
                        height: word.height * pageBox.height
                      };
                      worst = Math.max(worst,
                        Math.abs(box.left - expected.left),
                        Math.abs(box.top - expected.top),
                        Math.abs(box.width - expected.width),
                        Math.abs(box.height - expected.height));
                    });
                    api.clearMeasurementRects();
                  });
                  return worst;
                }""",
                words,
            )
            if word_worst > TOLERANCE_PX:
                raise SystemExit(f'Word probes off by {word_worst:.2f}px')
            for zoom in ZOOMS:
                page.evaluate("(zoom) => window.PdfViewerApi.setZoom(zoom)", zoom)
                zoom_worst = page.evaluate(
                    """(words) => {
                      const api = window.PdfViewerApi;
                      let worst = 0;
                      const grouped = new Map();
                      words.forEach(word => {
                        const list = grouped.get(word.pageIndex) || [];
                        list.push(word);
                        grouped.set(word.pageIndex, list);
                      });
                      grouped.forEach((list, pageIndex) => {
                        const probes = api.placeMeasurementRects(pageIndex, list);
                        const pageBox = document.getElementById('page-' + pageIndex).getBoundingClientRect();
                        list.forEach((word, index) => {
                          const box = probes[index].getBoundingClientRect();
                          worst = Math.max(worst,
                            Math.abs(box.left - (pageBox.left + word.x * pageBox.width)),
                            Math.abs(box.top - (pageBox.top + word.y * pageBox.height)),
                            Math.abs(box.width - word.width * pageBox.width),
                            Math.abs(box.height - word.height * pageBox.height));
                        });
                        api.clearMeasurementRects();
                      });
                      return {worst, anchorCount: document.querySelectorAll('[data-anchor-id]').length};
                    }""",
                    words,
                )
                word_worst = max(word_worst, zoom_worst['worst'])
                if zoom_worst['worst'] > TOLERANCE_PX or zoom_worst['anchorCount'] != 10:
                    raise SystemExit(f'Word alignment at {zoom} failed: {zoom_worst}')

            missed = page.evaluate("""() => {
              const before = document.querySelectorAll('[data-highlight-for]').length;
              const result = window.PdfViewerApi.highlightAnchor('not-a-real-passage');
              return {
                result,
                before,
                after: document.querySelectorAll('[data-highlight-for]').length,
                grounding: document.getElementById('pdf-viewport').dataset.grounding,
                context: window.PdfViewerApi.getSelectionContext()
              };
            }""")
            if missed['result']['ok'] or missed['after'] != missed['before'] or missed['grounding'] != 'anchored':
                raise SystemExit(f'Unknown anchor drew or cleared a highlight: {missed}')
            if missed['context']['anchorId'] != 'ldr_instruction' or missed['context']['grounded'] is not True:
                raise SystemExit(f'Selection context changed after a failed highlight: {missed["context"]}')

            page.evaluate("() => window.PdfViewerApi.clearHighlight()")
            cleared = page.evaluate("""() => ({
              highlights: document.querySelectorAll('[data-highlight-for]').length,
              pressed: document.querySelector('[data-anchor-id="ldr_instruction"]').getAttribute('aria-pressed'),
              context: window.PdfViewerApi.getSelectionContext(),
              grounding: document.getElementById('pdf-viewport').dataset.grounding
            })""")
            if cleared['highlights'] != 0 or cleared['pressed'] != 'false' or cleared['context']['grounded'] or cleared['grounding'] != 'idle':
                raise SystemExit(f'clearHighlight left state behind: {cleared}')

            for zoom, filename in ((0.75, 'zoom-75-ldr.png'), (1.5, 'zoom-150-ldr.png')):
                page.evaluate(
                    """(zoom) => {
                      window.PdfViewerApi.setZoom(zoom);
                      window.PdfViewerApi.highlightAnchor('ldr_instruction', {scroll:true, behavior:'auto'});
                    }""",
                    zoom,
                )
                page.locator('.pdf-panel').screenshot(path=str(OUT / filename))

            page.locator('[data-anchor-id="memory_example"]').click()
            clicked = page.evaluate("""() => {
              const context = window.PdfViewerApi.getSelectionContext();
              const hotspot = document.querySelector('[data-anchor-id="memory_example"]');
              return {context, pressed: hotspot.getAttribute('aria-pressed'), active: hotspot.dataset.active};
            }""")
            if clicked['context']['quote'] != 'Memory[x4000] = 7' or clicked['context']['pageIndex'] != 0 or clicked['pressed'] != 'true':
                raise SystemExit(f'Hotspot click did not select the source: {clicked}')

            page.evaluate("() => window.PdfViewerApi.scrollToPage(3, {behavior:'auto'})")
            visible = page.evaluate("() => window.PdfViewerApi.getVisiblePage()")
            if visible['pageIndex'] != 3:
                raise SystemExit(f'Visible page after scrollToPage(3) was {visible}')

            if errors:
                raise SystemExit(errors)
            browser.close()
        print(f'PASS: 10 anchors aligned within {worst:.2f}px at 75/100/150%; 20 word probes within {word_worst:.2f}px; scroll stays page-relative; unknown anchor not drawn')
        print(f'Screenshots: {OUT}/zoom-75-ldr.png {OUT}/zoom-150-ldr.png')
    finally:
        server.terminate()
        server.wait(timeout=3)

if __name__ == '__main__':
    main()
