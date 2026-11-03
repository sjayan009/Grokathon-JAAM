# PDF viewer API (Engineer B)

Stable hooks for the mock study workspace. Other lanes should call these instead of positioning highlights with screen coordinates.

The reader renders `fixtures/demo.json` page images (`assets/page-1.png` … `page-4.png`), which are rasters of `assets/lc3-pointers-demo.pdf`. It is not a PDF.js text layer. Selectable text and arbitrary uploads stay a later integration.

## Coordinate system

Anchor `rects` are fractions of the PDF page in `[0,1]`. The origin is the **top-left** of the page and **y grows downward**, matching PyMuPDF `page.rect` / `search_for()`.

The reader gives each page an explicit width and height of `page.width * zoom` by `page.height * zoom` and places hotspots and highlight shapes **inside that page element**. Scrolling `#pdf-viewport` and changing zoom do not retarget the rectangles. Screen position is always remeasured from the page box:

```text
screenX = pageContentLeft + rect.x * pageContentWidth
screenY = pageContentTop  + rect.y * pageContentHeight
```

`#pdf-viewport` carries `data-coordinate-origin="top-left"`.

If an id is missing, the geometry is outside the page, or the page is not rendered, `highlightAnchor` returns `{ok:false}` and does **not** draw a new box. A previously valid highlight is left in place.

## `window.PdfViewerApi`

Required contract from SPEC.md section 11:

| Method | Behavior |
|---|---|
| `scrollToAnchor(anchorId \| {id})` | Scrolls `#pdf-viewport` only (not the outer page) so the hotspot is centered. Unknown ids return `{ok:false, reason:'unknown_anchor'}`. |
| `highlightAnchor(anchorId \| {id}, options?)` | Activates the fixture anchor. Rects come from the fixture, not from the caller. `options.scroll === false` skips scrolling. `options.behavior` is `'smooth'` or `'auto'`. |
| `clearHighlight()` | Removes the highlight and sets every anchor `aria-pressed` / `data-active` back to false. |
| `getSelectionContext()` | `{documentId, anchorId, conceptId, pageIndex, quote, rects, screenRects, extractionMethod, confidence, zoom, grounded}`. With nothing selected, `anchorId` is null and `pageIndex` is the visible page. |
| `getVisiblePage()` | `{pageIndex, pageNumber, ratio, visiblePx}` for the page occupying the most of the PDF viewport. |

Helpers:

| Method | Behavior |
|---|---|
| `mount(fixture, listeners)` | Builds the page stack. The app calls this once after `demo.json` loads. |
| `setZoom(zoom)` / `getZoom()` / `bumpZoom(delta)` | Zoom is clamped to `0.5`–`2`. Buttons step through 75%, 100%, 125%, 150%, and 200%. |
| `scrollToPage(pageIndex)` | Centers that page in the PDF viewport. |
| `measureAnchor(anchorId)` | Normalized rects, predicted client rects, the live hotspot client rect, page box, and `visible`. |
| `placeMeasurementRects(pageIndex, rects)` / `clearMeasurementRects()` | Test-only probes using the same percentage placement as hotspots. They do **not** use `data-anchor-id`. |

`highlightAnchor` / `scrollToAnchor` accept a string id or an object with an `id`. The id must already exist in `fixture.anchors`. Passing a made-up rectangle does not move the box.

Listeners passed to `mount`:

- `onAnchorClick(anchor, event)` — primary hotspot clicked
- `onHighlight(detail)` — highlight applied or cleared (`detail.reason` is `anchored` or `cleared`)
- `onGroundingFailure(detail)` — request failed closed (`unknown_anchor` or `invalid_geometry`)
- `onVisiblePage(page)` / `onLayout(detail)`

The same payloads are dispatched as `window` event `smartpath:pdf` (`event.detail.type` is `highlight`, `zoom`, or `layout`).

The app still posts `{source:'smartpath-mock-app', type:'source_selected', anchorId, conceptId, pageIndex}` when a highlight sticks, so existing lesson code keeps working.

## DOM attributes

Extension code in `extension/content.js` requires **exactly one** `[data-anchor-id="<id>"]` per anchor and reads `aria-pressed` and `data-active`. Do not add `data-anchor-id` to the highlight shape, and do not put `data-concept-id` on PDF controls (graph nodes already use that attribute).

| Selector | Meaning |
|---|---|
| `#pdf-viewport[data-pdf-viewport]` | Scrolling page viewport. `data-zoom`, `data-visible-page`, `data-grounding` (`idle` \| `anchored` \| `unlocated`), `data-pdf-api="ready"` after mount, `data-layout-epoch` after zoom or resize. |
| `.pdf-page-wrap[data-page-index]` | One generated page. `data-page-width` and `data-page-height` are PDF points. |
| `button[data-anchor-id]` | The clickable source hotspot (one per anchor). Also `data-page-index`, `data-anchor-concept`, `data-quote`, `data-rect-x`, `data-rect-y`, `data-rect-width`, `data-rect-height`, `data-active`, `aria-pressed`. |
| `[data-anchor-hit]` | Extra rects when an anchor has more than one box. Not a lesson target. |
| `.pdf-annotation-layer[data-annotation-layer]` | Page-sized SVG (`viewBox="0 0 1 1"`). |
| `[data-highlight-for="<anchor id>"]` | Visible highlight rect in that SVG, in normalized units. Present only while the anchor is active. |
| `[data-zoom-preset]` | 75%, 100%, and 150% buttons. |

Zoom controls: `#zoom-out`, `#zoom-in`, `#zoom-label`. Page controls: `#page-prev`, `#page-next`. The viewport is focusable; ArrowLeft/PageUp and ArrowRight/PageDown move between pages while it is focused.

## What other lanes can rely on

- Lane A: keep clicking `[data-anchor-id]`. `measureAnchor(id).hotspotClientRect` is the current screen box after zoom or scroll. `data-layout-epoch` changes when the page size changes and the cursor should remeasure.
- Lane C: call `highlightAnchor(id)` or read `getSelectionContext()` for the quote, page, and screen rects. A false `ok` means there is nothing safe to point at.
- Lane D: graph focus can keep calling the app's `selectAnchor` path. Concept buttons stay on `[data-concept-id]`.
