# SmartPath Live — Status

Shared progress tracker. Read before starting work; update your section when you finish or get blocked.
Spec: [SPEC.md](SPEC.md) §5 (feature table). Last updated: 2026-11-02.

## P0 / P1 (baseline mock)

Shipped in commit `2369e43` — see README "What is genuine vs simulated". **Owned by teammates** — P2 work must not change P0/P1 behaviour (demo lesson, fixture explanations, quiz, graph, P1 Grok planner).

## P2 — in progress (2026-11-02)

Goal: P2 features work for real (not fixture-only). Real AI answers come from `server/p2_server.py`; with no key configured everything degrades to honest fallback text.

### Lane: server (P2 AI backend) — coordinator

- `server/p2_server.py` (stdlib HTTP server + official `openai` / `anthropic` SDKs): serves `mock-app/` on 5173 **and** `/api/live/v1/p2/*`. Namespaced `p2/` so it can't collide with the P1 Grok `/lesson` `/explain` routes teammates own.
  - `GET /api/live/v1/p2/health` → `{ai, provider, model, error, voice, voiceProvider}`
  - `POST /api/live/v1/p2/explain` `{source:'pdf'|'ocr'|'web', text, context, pageIndex?, title?, question?, style?}` → `{ai, text, quotes[], droppedQuotes}`. Quotes not literally present in the sent text are dropped (grounding check).
  - `POST /api/live/v1/p2/read-page` `{imageBase64 (PNG/JPEG), pageIndex, question?}` → `{ai, readable, transcript, description, answer}` (F18 vision).
  - `POST /api/live/v1/p2/tts` `{text}` → `audio/mpeg` (Deepgram Aura `aura-2-thalia-en`).
  - `POST /api/live/v1/p2/stt` raw `audio/*` body → `{voice, transcript, confidence}` (Deepgram `nova-3`).
- AI: OpenAI `gpt-5.4-mini` (override `OPENAI_MODEL`) via `chat.completions.parse` structured outputs; Anthropic is the alternative if only `ANTHROPIC_API_KEY` is set. Voice: Deepgram.
- Keys: `.env.local` at repo root (gitignored; template `.env.example`). Never in page/extension.
- Origin check: only localhost:5173 / 127.0.0.1:5173 / `chrome-extension://` (no Origin also allowed for local tools). Body cap 12 MB. PDF/web text is treated as untrusted data in the system prompt.
- Install: `pip install -r server/requirements.txt`. Run: `python server/p2_server.py` (use instead of `python -m http.server` to get P2 AI + voice; the demo works the same either way).
- **Verified live (real keys, 2026-11-02):** explain 200 in 2.5 s with 3/3 quotes grounded, planted "IGNORE ALL PREVIOUS INSTRUCTIONS" in the source was ignored; read-page on `page-3.png` 200 in 1.7 s, readable transcript; TTS 200 audio/mpeg 29 KB; STT of that audio returned the exact sentence (conf 0.999). No key → `ai:false`/503; foreign Origin → 403; bad image → 400.
- Note: SPEC names Grok for P1; P2 uses GPT (user-provided key). Provider swap is isolated to `call()`.

| ID | Feature | Owner lane | Status | Notes |
|---|---|---|---|---|
| F09 | "Open in SmartPath Live" arbitrary PDF import | mock-app (viewer) + extension (entry point) | in progress | Viewer side built and browser-verified (see mock-app lane); extension handoff pending. |
| F16 | General web-page selection explanation | extension | in progress | |
| F17 | Arbitrary browser UI control with CDP (restricted, user-approved) | extension | in progress | |
| F18 | Scanned PDF / image reasoning (OCR, degrade gracefully) | mock-app | in progress | |

### Lane: mock-app (F09 viewer, F18)

**Built (mock-app side done; extension entry point is the other lane):**
- F09 viewer: sidebar "Import PDF" (hidden file input) and `window` message `import_pdf` handler (same-window + origin checked, type-validated, 25 MB cap, `%PDF-` magic check, replies `import_result` via `emit`). `#import` hash shows "Waiting for the extension to hand over the PDF…". Handler is registered in `setupEvents()` before `emit('app_ready')`.
- PDF.js 3.11.174 (cdnjs, UMD, lazy) renders canvas + text layer per page at `state.zoom` (re-renders on zoom), max 60 pages (caption says so if truncated). Imported doc is a second sidebar item; `#open-doc` restores the fixture demo exactly (4 pages / 10 anchors / 5 nodes verified).
- While imported doc is active: "Teach me LDR", quiz and lesson refuse honestly ("Guided lessons exist only for the demo PDF…"), graph shows an empty-state message, no `data-anchor-id`/`data-concept-id` elements.
- Explore on imported docs: "Explain selection" button or prompt ("explain…") highlights the selection with normalized (%) rects on the page container; keyword hit (ldr/str/pointer/address/memory) quotes a fixture anchor and labels it "from the demo fixture (not your document)"; otherwise "no AI service is configured in this mock, so I can't explain it". Emits `selection_explained` with `extractionMethod:'pdf_text'|'ocr'`, rects, confidence.
- F18: pages with <10 non-whitespace chars get a "Scanned page · no text layer" badge + "Run OCR (local)" button with the CDN-download/stays-local notice. Click lazy-loads tesseract.js 5.1.1 (jsdelivr), recognizes a 2x offscreen render (eng), keeps words with conf >= 60 as a transparent selectable overlay (% positioned, `cqh` font size, per-word `data-conf`). Failure/empty -> "Couldn't read text on this page; I won't guess source locations". OCR answers caption "source came from OCR (mean confidence N%)". Figure/image questions get an honest out-of-scope caption.

**Files touched:** `mock-app/app.js` (new import/OCR block before `selectAnchor`, guards in `startLesson`/`showQuiz`/`handlePrompt`/`commandMessage`/`setupEvents`/`changeZoom`/`init`), `mock-app/index.html` (Import PDF button, file input, Explain selection button), `mock-app/styles.css` (appended text-layer/OCR/badge/highlight rules).

**Verified (built-in browser pane, python http.server):** demo 4/10/5 on load; local file pick of the demo PDF -> 4 canvases + 84 text-layer spans, 0 anchors/nodes; selection + "explain this" (keyword match and non-match answers, highlight drawn, survives zoom re-render); teach refused on imported; clicking demo item restores fixture and lesson starts; `import_pdf` message -> `import_result {ok:true,pageCount:1}`, bad bytes and malformed message -> `ok:false` with error; synthetic image-only PDF -> scanned badge; OCR ran on CDN (16 words, 95-97% conf), highlight aligns to word boxes, OCR note in explain; `#import` caption. `node --check app.js` ok; `tools/validate_mock.py` PASS (pymupdf installed via pip).
**Real-AI wiring (follow-up, `server/p2_server.py`):** `mock-app/app.js` fetches `/api/live/v1/p2/health` on load (404/network error = off) and shows an `AI: on (model)` / `AI: off` chip (`#ai-status` in `index.html`). With AI on: imported-PDF explain POSTs `/p2/explain` (selection or whole page text as context, `source` pdf/ocr, `style` from simpler/example wording, typed question), shows "Thinking…", ignores stale replies (`state.aiSeq`, doc/active checks), captions the answer, and highlights only returned quotes it can find exactly in the page text/OCR layer (unlocatable quotes skipped; the fixture keyword shortcut is AI-off only). Scanned pages get "Read page with AI" (JPEG <= 8 MB) -> `/p2/read-page`; a readable transcript is kept as page context (`ai_vision`, no rectangles drawn) so "explain this page" works; figure/image questions go to read-page when AI is on. One-time per-document notice (toast + caption) before anything is sent. AI-off messages unchanged.
**Verified AI wiring:** `node --check`; real `p2_server.py` (on PORT=5199, 5173 was occupied by another process) reported `ai:false`, chip "AI: off", honest fallback unchanged. AI-on path tested with a monkeypatched `fetch` in a same-origin srcdoc iframe: answer rendered, real quote highlighted (1 box) and fabricated quote not, stale slow reply ignored (newer one won), style mapping, read-page answer shown, vision-only scanned page then "explain this page" with no highlights. **Not verified:** a real key / real model output; real-server POST routes (503 path only via health).
**Voice (Deepgram via server), imported docs only:** `p2say()` speaks answers/fallbacks via `/p2/tts` (blob -> `Audio`, one at a time, falls back to `speak()`); `#voice-toggle` mutes it (`state.p2Muted`), `#stop-audio` and doc switch/`cancelVoice` stop it. `#mic-button` records with MediaRecorder (12 s cap, `aria-pressed`) -> `/p2/stt` -> "Heard: ..." -> same prompt path; demo-doc Web Speech mic unchanged. Verified on the real server (gpt-5.4-mini + Deepgram): explain 200, tts 200 audio/mpeg, Audio played, mute stops it; STT 200 with a real TTS mp3 returned "Explain this simpler." and drove a simplified explain. Mic capture itself was simulated (fake MediaRecorder); real microphone and autoplay-policy behaviour untested.
**Not verified:** `tools/smoke_test.py` (Playwright not installed; equivalent counts checked manually), the real extension handoff, CDN-failure path, >25 MB / >60 page paths, password-protected PDFs, non-Chromium browsers. PDF.js/tesseract scripts have no SRI hashes.
**Known limitations:** rendering stalls while the browser tab is hidden (PDF.js uses requestAnimationFrame); OCR is English only, per-page, and results live only in memory; imported doc is single-slot (importing another replaces it).

### Lane: extension (F09 entry point, F16, F17)

Done (extension v0.2.0, uncommitted). Files: `extension/manifest.json`, `background.js`, `content.js`, `sidepanel.html`, `sidepanel.js`, new `explain.js`, `tools/validate_mock.py`.
- **F09**: side panel shows "Open in SmartPath Live" on `.pdf` http(s)/file tabs. http(s): `permissions.request` for that origin only, then the service worker fetches (`credentials:'omit'`, same-origin redirects only, 25 MB cap by Content-Length and streamed size, `%PDF-` magic, 401/403/HTML => "download and use Import PDF"), opens `localhost:5173/#import`, content script queues until `app_ready` (2 s fallback if it fired before the script loaded) and posts the contract message; `import_result` is relayed to the panel status. `file://` => message only. Per-tab state in `chrome.storage.session` (`imp_<tabId>`); bytes only in worker memory, so a worker restart clears state and reports "interrupted". Stop cancels fetch/pending/queued import.
- **F16**: context menu "Explain in SmartPath Live" (selection) => `activeTab` + `scripting` inject `explain.js` (not a declared content script): closed-shadow popover, Esc/click-outside/close, fixture text for memory/address/pointer/LDR/STR else honest "no AI configured", optional Read aloud (user click).
- **F17**: `debugger` is optional only (requested on a panel click). Side panel "Agent control": allowlist dropdown (Quiz, Close quiz, Reset graph, Zoom in/out) -> Approve/Cancel -> AI cursor moves -> background verifies sender is top frame of localhost/127.0.0.1:5173 and CDP mode on -> attach, `Input.dispatchMouseEvent` move/press/release, detach (banner only during the click) -> content verifies real UI state. Detach on Stop, disable, tab close, `debugger.onDetach`.
- **Lesson stays on `target.click()`**: mock-app anchor/node handlers call `pauseLesson` on `isTrusted` clicks while running (`app.js` ~L51, ~L90), so a CDP click would self-pause the lesson. CDP is therefore used only for Agent control (none of those controls pause on trusted clicks). See blocker below for the optional one-line change.
- Permissions: required `sidePanel, tabs, storage, contextMenus, activeTab, scripting` (+ localhost-only `host_permissions` and content script match, unchanged); optional `debugger`; `optional_host_permissions` `https://*/*`, `http://*/*`.
- Verified: `node --check` all JS, manifest JSON parses, `python tools/validate_mock.py` PASS. Playwright + Chromium (headed, unpacked extension): content script connects and lesson runs; explain.js injects and Esc dismisses; with a scratch copy having `debugger` as a required permission (optional-permission prompt cannot be granted headlessly): agent zoom in/out, quiz open/close, reset graph all clicked with `isTrusted===true` and UI state verified, non-allowlisted action and CDP-off rejected; `startImport` of the mock's own PDF fetched, opened `#import`, and the page received the exact contract message (`JVBERi0x` = `%PDF-1`), session state cleared after the result.
- NOT verified (manual Chrome): real permission prompts (optional host + debugger), the "debugging this browser" banner, side-panel UI rendering, context-menu click path with real activeTab grant on a non-localhost site, `file://` and 401/403 PDF paths, Read aloud, MV3 worker restart mid-import.

## Cross-lane contract (F09 handoff)

Extension → page, after opening `http://localhost:5173/#import`:
`{source:'smartpath-live-extension', type:'import_pdf', name:string, sourceUrl:string, bytesBase64:string}`
(same-window `postMessage`, page origin checked; max 25 MB decoded).
Page → extension ack: `{source:'smartpath-mock-app', type:'import_result', ok:boolean, error?:string, pageCount?:number}`.

## Open questions / blockers

- (extension) Optional, only if the coordinator wants real CDP clicks in the *lesson*: in `mock-app/app.js` the two `event.isTrusted && state.running` pause checks (anchor click ~L51, node click ~L90) would need to skip clicks flagged as extension-initiated (e.g. ignore when `performance.now() < state.extClickUntil`, set on a new `cdp_click_pending` message). Not required: the lesson works with DOM clicks.
