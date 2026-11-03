# Team Status

Shared log so every agent and teammate knows what everyone else is doing.

## Rules for agents
1. **Read this file before starting any task.** Pull `master` first.
2. **Claim your task** by adding a row to *In progress* before you write code.
3. **Don't take work someone else has claimed.** If you need to touch their area, note it under *Notes / handoffs*.
4. **Update this file when you finish**: move your row to *Done* with the PR link.
5. Keep entries short. One row per task, one branch per task.

## In progress
| Who (agent/person) | Task | Branch | Started | Notes |
|---|---|---|---|---|
| Engineer A (Extension & Cursor) | F01 unpacked MV3 + study-tab detect, F02 animated second cursor, F07 Start/Pause/Stop and override | `cursor/extension-cursor-f01-f02-f07-667e` | 2026-11-03 | 2026-11-03T01:28Z: claimed. Staying in `extension/`. Existing skeleton already handshakes `app_ready`/`extension_ready` and clicks allowlisted targets. Next: real run state machine, smooth follower, Stop that drops late actions. |
| Engineer B (PDF Workspace & Grounding) | F03 mock PDF reader + F04 source-anchored highlights | `cursor/pdf-workspace-grounding-4015` | 2026-11-03 | 2026-11-03: `window.PdfViewerApi` is in `mock-app/pdf-reader.js` (see `PDF_VIEWER_API.md`). One `[data-anchor-id]` per anchor; highlight box is `[data-highlight-for]`. Verified at 75/100/150% zoom and while scrolling. |

## Blocked / needs help
| Who | Task | Blocked on |
|---|---|---|

## Done
| Who | Task | PR | Finished |
|---|---|---|---|

## Notes / handoffs
- **2026-11-03T01:28Z — Lane A (extension):** Will not change the fixture shape (SPEC 18.5) or the page↔extension message types (SPEC 18.6). Other lanes can keep sending `action_request` `{kind, targetId}` and reading `action_result` `{requestId, ok, error?}`. Cursor coordinates are measured from the live DOM (`data-anchor-id`, `data-concept-id`, `#top-quiz`); do not post arbitrary `viewportRect`s. Stop/Pause/Resume stay the existing `command` values (`teach`, `pause`, `resume`, `stop`, `quiz`, `ask`). Speech still starts in the mock page; the extension will cancel `speechSynthesis` synchronously on Stop so a cancelled run cannot keep talking.
- **2026-11-03 — Engineer B (PDF):** `PdfViewerApi = {scrollToAnchor, highlightAnchor, clearHighlight, getSelectionContext, getVisiblePage}` plus `measureAnchor`, `setZoom`, `scrollToPage`. Call `highlightAnchor(anchorId)` with a fixture id. Unknown ids return `{ok:false}` and do not draw. Rects are page fractions, origin top-left, y down. `#pdf-viewport` is the only scroller for source jumps (`data-zoom`, `data-visible-page`, `data-grounding`, `data-layout-epoch`). Do not put `data-concept-id` on PDF controls. `source_selected` postMessage is unchanged. `tools/smoke_test.py` falls back to Google Chrome when `/usr/bin/chromium` is absent. Grounding test: `python3 tools/test_pdf_grounding.py` (port 5174).

_Last synced from agent branches: 2026-11-02 08:29 PM ET_
