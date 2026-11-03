# SmartPath Live — Standalone SmartPathAI Mock + Chrome Extension

A **self-contained, browser-based demo environment** for building the SmartPath Live AI cursor and PDF tutor without running the original SmartPathAI stack. Based on the public [BDBI SmartPathAI project](https://github.com/gt-big-data/Smart-Path-AI), but this workspace is a clean-room, hackathon-focused mock rather than a copy of the production app.

## Quick start (no npm, database, login, or API key)

1. Start the local web server in this project directory:

   ```bash
   python3 -m http.server 5173 --directory mock-app
   ```

2. Open **http://localhost:5173** in Chrome. You should see a learning workspace inspired by SmartPathAI with a PDF, concept graph, confidence sidebar, and voice/text command dock.
3. Go to `chrome://extensions` → enable Developer mode → **Load unpacked** → select the `extension/` folder. Reload the study page.
4. Click the extension icon to open its **side panel**. Start with **Teach Demo** or type `Teach me LDR from scratch`.
5. Watch the separate AI cursor move to actual clickable PDF source regions and graph nodes; see real UI state change and verification. The final step opens a multiple-choice quiz.

The demo works **without the extension** using local verified DOM interactions, but the animated AI cursor and Chrome side panel require it.

## What's included

| File | Purpose |
|---|---|
| `mock-app/index.html` | Browser-based study workspace, no chat window |
| `mock-app/styles.css` | SmartPath-inspired slate sidebar + teal theme |
| `mock-app/app.js` | Mock UI, PDF annotation overlays, graph, quiz, lesson runtime |
| `mock-app/assets/lc3-pointers-demo.pdf` | Generated 4-page LC-3 teaching PDF |
| `mock-app/assets/page-1.png`–`page-4.png` | Actual raster renderings of the generated PDF |
| `mock-app/fixtures/demo.json` | Real source bounding boxes, graph nodes/edges, confidence scores, quiz, lesson |
| `extension/manifest.json` | Chrome MV3 extension with only local host access |
| `extension/content.js` | AI cursor overlay + animated real DOM clicks + verification |
| `extension/sidepanel.html`, `sidepanel.js` | Chrome extension controls and text commands |
| `tools/generate_fixtures.py` | Recreate PDF, page renderings and source anchors from exact text matches |
| `tools/smoke_test.py` | Browser interaction smoke test (Playwright + Chromium required) |
| `tools/validate_mock.py` | Offline PDF provenance, anchor, graph, quiz and MV3 contract checks |

## Provenance: what comes from the real SmartPathAI project

The mock uses the project's **document/upload → graph → progress → quiz** user journey and its documented color tokens/visual patterns. It refers to these original public source files:

- [README and API layout](https://github.com/gt-big-data/Smart-Path-AI/blob/main/README.md)
- [Chat.tsx](https://github.com/gt-big-data/Smart-Path-AI/blob/main/src/pages/Chat.tsx) — chat-owned PDF uploads and graph UI
- [GraphVisualization.tsx](https://github.com/gt-big-data/Smart-Path-AI/blob/main/src/components/GraphVisualization.tsx) — concept nodes, graph search, React Flow
- [graphTree.ts](https://github.com/gt-big-data/Smart-Path-AI/blob/main/src/lib/graphTree.ts) / [pathHighlight.ts](https://github.com/gt-big-data/Smart-Path-AI/blob/main/src/lib/pathHighlight.ts) — graph structure and path highlighting
- [ProgressContext.tsx](https://github.com/gt-big-data/Smart-Path-AI/blob/main/src/context/ProgressContext.tsx) — concept confidence data
- [Quiz.tsx](https://github.com/gt-big-data/Smart-Path-AI/blob/main/src/pages/Quiz.tsx) — quiz UX
- [index.css](https://github.com/gt-big-data/Smart-Path-AI/blob/main/src/index.css) — teal/blue/white design tokens

**Not included:** original proprietary/real user data, authentication flows, actual Neo4j backend, MongoDB, Grok calls, original graph rendering implementation, original PDF uploads, or source from the private Python AI server. All example content and teaching responses were authored as deterministic demo fixtures. The generated teaching PDF and source anchors are new assets, not copied class notes.

## How source grounding is real within this fixture

`tools/generate_fixtures.py` writes the lecture as a PDF with ReportLab, opens it with PyMuPDF, searches for **exact quotes** and extracts actual page bounding rectangles. The same PDF is rasterized into PNG page images; the mock renders transparent HTML controls over the source rectangles. Clicking those controls updates the source highlight state. No arbitrary pixel positions or fabricated source citations are used. The generated `demo.json` records anchor IDs, concept IDs, quote, pageIndex, and rectangles normalized to [0,1].

**Limitations:** The mock renders **raster pages**, not a general PDF.js reader. Text in the page image isn't selectable. Clicking known passage hotspots works; real arbitrary PDF uploads, text-layer selection, OCR, and robust rotation handling are future integration tasks. For production, replace the raster stage with PDF.js while preserving the same `SourceAnchor` contract. The small graph is rendered with DOM/SVG rather than the original React Flow component; replace it later without changing concept IDs.

## PDF viewer API

`mock-app/pdf-reader.js` exposes `window.PdfViewerApi` with `scrollToAnchor`, `highlightAnchor`, `clearHighlight`, `getSelectionContext`, and `getVisiblePage`. Highlights are page-relative, so they stay on the source rectangle at 75%, 100%, and 150% zoom and while `#pdf-viewport` scrolls. Unknown anchor ids fail closed and do not draw a box. DOM hooks and the coordinate system are documented in `mock-app/PDF_VIEWER_API.md`. Lesson code should keep using the single `[data-anchor-id]` button per anchor; the visible box is a separate `[data-highlight-for]` shape.

## What is genuine vs simulated

- ✅ Actual Chrome MV3 content script and side panel; actual second cursor overlay.
- ✅ Actual DOM click on visible PDF anchor buttons and graph node buttons (not silent service APIs).
- ✅ Expected UI state checked after each step. Missing/duplicate/unviewable targets fail closed.
- ✅ Source quote rectangles extracted from a **real PDF**, not hardcoded screen coordinates.
- ✅ Real quiz UI, response feedback and in-memory confidence changes.
- ✅ Pause, Resume, Stop, and basic user-intervention handling.
- ✅ Browser speech synthesis when enabled; microphone recognition if supported.
- ◇ Intent classification and explanations use **deterministic fixtures** (not a running LLM).
- ◇ Graph/search/progress data use the fixed demo fixture (not the original app database).
- ◇ No actual AI-generated lesson planning or generalized webpage control yet.

Do not claim this mock demonstrates live Grok or full SmartPathAI interoperability until the integrations are implemented and tested.

## Extension message contract

The mock uses **same-window `postMessage` on the local study origin** to communicate between page and isolated MV3 content script. It accepts only typed, allowlisted targets (PDF anchor ID, concept ID, or quiz button):

- app → extension: `{source:'smartpath-mock-app',type:'app_ready',documentId}`
- extension → app: `{source:'smartpath-live-extension',type:'extension_ready'}`
- app → extension: `{source:'smartpath-mock-app',type:'action_request',requestId,step:{kind,targetId}}`
- extension → app: `{source:'smartpath-live-extension',type:'action_result',requestId,ok,error?}`
- app → extension: `lesson_started`, `step_started`, `step_verified`, `lesson_paused`, `lesson_resumed`, `lesson_stopped`, `lesson_completed`
- side panel → content script: Chrome messaging `{type:'control',command,prompt}`; content script relays a typed command to the mock page.

The current `postMessage` bridge is **development-only**. Scripts injected into the mock page can forge same-origin messages. Production must add a stronger session/capability handshake, verify message sender and active tab, and restrict operations to authenticated document-specific state. The extension only grants access to localhost port 5173.

## Speech cancel hook (Lane A Stop)

Spoken output uses the page's `speechSynthesis` from `mock-app/speech.js`. Captions stay visible even when speech is muted, unavailable, or cancelled. TTS is on by default.

`speechSynthesis.cancel()` inside the extension content script does **not** stop an utterance the page started. Stop has to call the page hook. `cancel('stop')` is synchronous and latches speech: later `speak()` calls do nothing until the next user action calls `allow()`.

From the page:

```js
window.SmartPathSpeech.cancel('stop');
```

From the content script, dispatch on the shared document so the page listener runs in that same call:

```js
document.dispatchEvent(new CustomEvent('smartpath-cancel-speech', {detail:{reason:'stop'}}));
```

The existing side-panel command `{type:'control', command:'stop'}` is already relayed as `{source:'smartpath-live-extension', type:'command', command:'stop'}`. `speech.js` cancels on that message. `command:'pause'` stops the current utterance and does not latch. The in-page Stop button calls `SmartPathSpeech.cancel('stop')` directly. Cancel does not clear captions.

## Selected-passage explanations (F05) and text input (F08)

Click a source hotspot, or type `explain this` after one is selected. The caption and the spoken line both name the page and quote the fixture passage. `explain simpler`, `explain example`, and `show relationship` use the matching fixture text. A topic that is not in the document gets an explicit “couldn't pinpoint” caption and does not draw a new highlight.

Microphone denial, a missing speech engine, or muted narration leaves the text field usable. Captions still update, and spoken output stays available after a microphone failure. Explanations are loaded from `mock-app/fixtures/explanations.json` and joined to `demo.json` anchors by id. The optional Grok adapter in `mock-app/grok.js` stays off unless `window.SMARTPATH_GROK_CONFIG` is set at runtime. Do not commit that object or an API key.

## Contract for later replacing fixtures with SmartPathAI + Grok

Keep these IDs and shapes stable:

- `document.id`, `document.pdfUrl`, `pages[]`
- `graph.nodes[]`, `graph.relationships[]`, `node.confidence`, `node.anchorId`
- `anchors[]` `{id,documentId,conceptId,pageIndex,quote,rects[]}`
- `lesson.steps[]` `{id,kind,targetId,narration}`
- `quiz` `{id,conceptId,question,choices,correctChoice,explanation}`

**Original SmartPathAI graph view format differs:** existing UI expects `GraphData = {status, graph_id, subject, graph:{nodes,relationships}}`; use an adapter, rather than changing everything to the mock's simpler `graph` shape. Node IDs and relationship semantics must be mapped explicitly. Only treat an edge as a *prerequisite* when its metadata confirms that meaning.

The intended future data flow is `original PDF bytes -> PDF.js text layer -> PyMuPDF anchors -> concept evidence -> Grok lesson planner -> validated step plan -> extension visual executor`. It should not require running MongoDB/Neo4j during daily UI development.

## Team split

1. **Chrome Engineer:** extension overlay, side panel, voice, pause/stop; owns `extension/`.
2. **PDF/UI Engineer:** page rendering and source anchors, PDF.js migration; owns reader and fixture generator.
3. **Grok/Backend Engineer:** schema validation, lesson planner, Grok adapter, tests with deterministic fixtures.
4. **Graph/Learning Engineer:** graph nodes, path focus, quiz and progress, integration with original SmartPathAI contracts.

All four can build against `mock-app/fixtures/demo.json` immediately. First integration contract: **run `highlight_pdf → focus_graph → ask_question` using only fixture IDs**.

## Graph focus hook

`window.SmartPathGraph` is on the study page after `mock-app/graph.js` and `mock-app/app.js` load. Concept IDs are the fixture IDs: `memory`, `addresses`, `pointers`, `ldr`, `str`.

| Method | Behavior |
|---|---|
| `focusConcept(conceptId, selectSource?)` | Focus that node. Pass `true` to also highlight the node's `anchorId`. An options object `{selectSource, preservePath, preserveRelated, summary}` is also accepted. Unknown IDs return `false` and leave the current focus in place. |
| `getRelatedConceptIds(conceptId)` | Neighbor IDs across `type: "related"` edges, in either direction. Unknown IDs return `[]`. |
| `showRelatedConcepts(conceptId)` | Focus the node and mark its related neighbors. Returns those IDs, or `null` when the id is unknown. |
| `showPath(conceptIds \| {from, to})` | Highlight a walk that exists on `related` edges. `{from, to}` is the shortest such path. A list that skips an edge returns `null` and does not change focus. |
| `clearFocus()` | Clear the focused node, path, and related highlighting. The nodes stay on the graph. |
| `getFocusedConceptId()` | The focused concept ID, or `null`. |

Paths are described as **related concepts, not prerequisites**. Edges of any other type are ignored.

Other JavaScript worlds (including the extension content script) can drive the same hook without calling the page global:

```js
document.dispatchEvent(new CustomEvent('smartpath:focus-concept', {
  detail: {conceptId: 'ldr', selectSource: false}
}));
document.dispatchEvent(new CustomEvent('smartpath:show-path', {
  detail: {from: 'memory', to: 'ldr'}
}));
document.dispatchEvent(new CustomEvent('smartpath:clear-focus'));
```

Existing `focus_graph` actions still click the single `[data-concept-id="<id>"]` button. Optional same-origin messages from `source: 'smartpath-live-extension'` — `focus_concept`, `show_path`, and `clear_focus` — are additive. `action_request` / `action_result` are unchanged. `concept_focused` still includes `conceptId` and now also includes `path` (an array, empty when no path is highlighted).

Clicking a passage hotspot or asking the mock to explain the selected passage focuses the anchor's `conceptId`.

## Tests

For syntax and fixture sanity:

```bash
node --check mock-app/app.js
node --check mock-app/speech.js
node --check mock-app/graph.js
node tools/test_speech.js
node tools/test_explain.js
node --check extension/content.js
node tools/test_graph_model.js
python3 tools/validate_mock.py
python3 tools/test_pdf_grounding.py
python3 tools/acceptance_gate.py
# Optional: recreate the bundled PDF and exact anchors
python3 tools/generate_fixtures.py
```

`tools/acceptance_gate.py` runs the headless P0 checks from SPEC §13 and the mock-mode gate in §18.8. It starts its own static server (port 8765 by default, or `ACCEPTANCE_PORT`). Live unpacked-extension cursor following is reported as SKIP. Playwright and Chrome or Chromium must be installed for the browser checks.

For a browser smoke test, after installing Playwright and Chromium locally:

```bash
python3 tools/smoke_test.py
```

The smoke test starts its own local server on port 5173. Run it with that port free. If your environment restricts automated local browser traffic, manually validate the same flow in regular Chrome.

## Demo script (90 seconds)

1. Open `http://localhost:5173` and point out the familiar SmartPath-inspired concept confidence sidebar, study PDF, and concept graph.
2. Open the extension panel and type **Teach me LDR from scratch**.
3. Watch the AI cursor highlight `Memory[x4000] = 7`, then `R2 = x4000`, then focus Pointers in the graph.
4. Watch it point to `LDR R1, R2, #0`, focus LDR, and open the comprehension check.
5. Choose **B. 7** and watch the UI update progress.
6. Use **Stop** or the Pause/Resume buttons to demonstrate control.
7. Explain the boundary: today the educational content is deterministic; adding Grok swaps only the lesson generation layer, not the verified cursor executor.

## Security/privacy

No remote API calls, account data, credentials, cookies, unrestricted host permissions, or database writes. Sample PDF is generated locally, and the app uses in-memory fixtures. The optional browser speech APIs operate only after a user action. There is no continuous recording. No `debugger` permission is required; the Chrome extension clicks approved DOM controls on the allowed local page rather than controlling arbitrary websites.
