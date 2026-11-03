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
| Engineer B (PDF Workspace & Grounding) | F03 mock PDF reader + F04 source-anchored highlights | `cursor/pdf-workspace-grounding-4015` | 2026-11-03 | Claimed. Building page-image reader, exact hotspot geometry, and `PdfViewerApi` (`scrollToAnchor`, `highlightAnchor`, `clearHighlight`, `getSelectionContext`, `getVisiblePage`). Will not change extension/, lesson copy, or graph behavior. |
| Engineer C (AI, Evidence & Backend) | F05 selected-passage explanation; F08 text input + spoken output | `cursor/evidence-tutor-f05-f08-95f8` | 2026-11-03 | 2026-11-03T01:40Z: speech cancel hook is live in `mock-app/speech.js` (see handoff). TTS on by default; captions stay up if speech is muted or missing. Next: fixture explanations for a selected passage. |
| Engineer B (PDF Workspace & Grounding) | F03 mock PDF reader + F04 source-anchored highlights | `cursor/pdf-workspace-grounding-4015` | 2026-11-03 | 2026-11-03: `window.PdfViewerApi` is in `mock-app/pdf-reader.js` (see `PDF_VIEWER_API.md`). One `[data-anchor-id]` per anchor; highlight box is `[data-highlight-for]`. Verified at 75/100/150% zoom and while scrolling. |

## Blocked / needs help
| Who | Task | Blocked on |
|---|---|---|

## Done
| Who | Task | PR | Finished |
|---|---|---|---|
| Engineer D (Graph, Learning UX & QA) | F06 graph node sync; headless P0 / §18.8 gate | https://github.com/sjayan009/Grokathon-JAAM/pull/3 | 2026-11-03 |

## Notes / handoffs
- **2026-11-03T01:28Z — Lane A (extension):** Will not change the fixture shape (SPEC 18.5) or the page↔extension message types (SPEC 18.6). Other lanes can keep sending `action_request` `{kind, targetId}` and reading `action_result` `{requestId, ok, error?}`. Cursor coordinates are measured from the live DOM (`data-anchor-id`, `data-concept-id`, `#top-quiz`); do not post arbitrary `viewportRect`s. Stop/Pause/Resume stay the existing `command` values (`teach`, `pause`, `resume`, `stop`, `quiz`, `ask`). Speech still starts in the mock page; the extension will cancel `speechSynthesis` synchronously on Stop so a cancelled run cannot keep talking.

- 2026-11-03 Engineer B: Lane started. Stable hooks will land on `window.PdfViewerApi` and existing `[data-anchor-id]` buttons (exactly one per anchor so the extension verifier stays valid). Highlight geometry will use a separate `[data-highlight-for]` layer so it does not duplicate anchor IDs. Zoom ladder will include 75%, 100%, and 150%.

- **2026-11-03T01:40Z — Lane C speech hook (Lane A Stop):** Page speech is `window.SmartPathSpeech` in `mock-app/speech.js`. `cancel('stop')` is synchronous, latches later `speak()` until `allow()` on the next user action, and does not clear captions. Content-script `speechSynthesis.cancel()` does not stop page utterances. From `content.js`, dispatch on the shared document: `document.dispatchEvent(new CustomEvent('smartpath-cancel-speech', {detail:{reason:'stop'}}))`. The existing relay `{source:'smartpath-live-extension', type:'command', command:'stop'}` also cancels; `pause` cancels the utterance and does not latch. SPEC 18.5 fixture shape and 18.6 message types are unchanged. Touched shared files only to load the script and route the in-page Stop button: `mock-app/index.html` (script tag + voice default on), `mock-app/app.js` (speak/cancel delegates). `extension/` not edited.
- **2026-11-03T01:45Z — Lane D (graph/QA): focus hook is live.** `window.SmartPathGraph = {focusConcept, getRelatedConceptIds, showRelatedConcepts, showPath, clearFocus, getFocusedConceptId}`. Concept IDs: `memory`, `addresses`, `pointers`, `ldr`, `str`. `related` edges are undirected; a path that skips an edge returns `null` and does not change focus. Other worlds: `document.dispatchEvent(new CustomEvent('smartpath:focus-concept', {detail:{conceptId:'ldr'}}))`. Also `smartpath:show-path` and `smartpath:clear-focus`. Existing `focus_graph` clicks on the single `[data-concept-id]` button still work. `focusConcept(id, true)` still selects that node's source anchor. Clicking a passage or explaining it focuses `anchor.conceptId`. `concept_focused` still has `conceptId` and now also `path` (array). Optional extension messages `focus_concept`, `show_path`, `clear_focus` are additive; `action_request` / `action_result` are unchanged.
- **Merge notes for B and C:** Keep `<script src="/graph.js" defer>` before `app.js` (alongside `pdf-reader.js` and `speech.js`). If `selectAnchor` moves into `PdfViewerApi`, keep the `focusConcept(anchor.conceptId, {selectSource:false})` call when the click is an explanation. This branch does not adopt Lane C's default-on TTS or Lane B's reader. `python3 tools/acceptance_gate.py` is the headless gate (port 8765). It does not load the unpacked extension, so cursor-follow and live extension detection are SKIP.
- **2026-11-03 — Engineer B (PDF):** `PdfViewerApi = {scrollToAnchor, highlightAnchor, clearHighlight, getSelectionContext, getVisiblePage}` plus `measureAnchor`, `setZoom`, `scrollToPage`. Call `highlightAnchor(anchorId)` with a fixture id. Unknown ids return `{ok:false}` and do not draw. Rects are page fractions, origin top-left, y down. `#pdf-viewport` is the only scroller for source jumps (`data-zoom`, `data-visible-page`, `data-grounding`, `data-layout-epoch`). Do not put `data-concept-id` on PDF controls. `source_selected` postMessage is unchanged. `tools/smoke_test.py` falls back to Google Chrome when `/usr/bin/chromium` is absent. Grounding test: `python3 tools/test_pdf_grounding.py` (port 5174).

_Last synced from agent branches: 2026-11-02 08:41 PM ET_
