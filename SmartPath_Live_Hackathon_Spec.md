# SmartPath Live — Product Requirements & Engineering Specification

**Version:** 1.0 · **Date:** November 2, 2026  
**Team:** Four engineers · **Delivery:** Chrome Manifest V3 extension + browser-hosted SmartPathAI study workspace  
**Positioning:** *Your PDFs don't just contain information anymore. They teach you.*

---

## 0. Executive decision

Build **SmartPath Live**, a visual, voice-enabled learning agent that lives alongside a student's PDF and teaches directly on the page. It points at passages, highlights definitions, draws temporary arrows/circles, narrates explanations, traverses the related SmartPathAI knowledge graph, and tests understanding. The primary UI is **the document itself**—not a conventional chatbot or permanent chat sidebar.

Ship two connected browser surfaces:

1. **Actual Chrome extension (MV3):** installable unpacked, with an animated second cursor, press-to-talk/keyboard commands, on-page overlays, a compact control palette, run/stop/pause state, and page-aware communication.
2. **SmartPathAI Study Workspace:** a normal website route inside SmartPathAI, built with React and PDF.js, that renders imported PDFs and their source anchors beside the existing React Flow concept graph and quizzes.

**Non-negotiable:** ordinary extensions cannot reliably inject overlays into Chrome's built-in PDF viewer. When the browser opens a raw PDF, the extension must offer **Open in SmartPath Live**, importing via explicitly authorized URL access or local file selection; it must not claim direct annotation of the built-in viewer.

**Hackathon showcase:** A student opens a PDF about pointers, activates the extension and says: “Teach me LDR from scratch.” The AI cursor visibly finds an LDR example, highlights the operands, speaks an explanation, traces prerequisites in the SmartPath graph, and ends with a one-question comprehension check.

## 1. Why this directly extends SmartPathAI

SmartPathAI already has a React/Vite web frontend, an Express/TypeScript API, a separate Python AI service, PDF ingestion, graph-grounded Q&A, a React Flow knowledge graph, quizzes, and concept confidence/progress. It stores uploaded documents in a chat-centered flow rather than an independent PDF study library.

SmartPath Live adds **three missing product capabilities**:

- **Source-grounded teaching:** every explanation can point to a specific passage, page, or equation in the uploaded PDF.
- **Embodied interaction:** the AI has a visible cursor that navigates the document and graph, with narrated, verifiable UI changes.
- **Guided learning:** instead of making the student manually alternate between text, graph search, and quizzes, the AI sequences them into a lesson.

Reuse, rather than rewrite, the existing ingestion, graph search, quiz, authentication, and progress pipelines. The existing private AI-server repo requires access from a SmartPathAI project lead; do not assume it is publicly cloneable.

### Current integration assumptions to verify on day one

- Can the original uploaded PDF **bytes** be retrieved after graph creation? If not, add authenticated document storage/access.
- What do graph nodes and edges actually represent? Do not infer a “prerequisite” relation unless edge semantics support it. Otherwise describe linked concepts as *related*.
- Do graph nodes contain page/span provenance? If not, build a separate evidence-anchor mapping; do not invent citations.
- Do existing quiz endpoints support a concept filter? If not, reuse document-level quizzes in the MVP.
- Ensure the existing frontend's API URLs use the configured API base rather than hardcoded production endpoints.

## 2. Users, outcomes, and product principles

**Primary user:** college students studying PDFs with technical concepts, diagrams, definitions, and prerequisite relationships.

**Desired outcomes:** Understand a difficult passage faster; see which concepts connect; ask follow-ups without switching interfaces; practice the material just explained; continue reading exactly where the lesson left off.

**Product principles:**

1. **No chat window as the default interface.** A small floating input bubble, voice command, or selected-text action is enough. Answers appear as transient captions/popovers anchored to the document.
2. **Show, don't just tell.** The cursor must point to what is being discussed. If source grounding is unavailable, explicitly say so and provide a non-anchored answer.
3. **Explain with evidence.** Generated factual claims cite page numbers/passages, and graph links use known concept IDs.
4. **Student owns the pace.** Easy pause, stop, next, slower, repeat, and “explain simpler.” No auto page-turn during manual reading unless Teach Mode has started.
5. **Visible actions are real.** A displayed click/scroll/highlight must correspond to an actual UI state transition; never show a fake successful action.
6. **The extension is the product entry point.** The website provides the high-fidelity PDF/graph canvas; the extension provides the persistent browser companion.
7. **Privacy by default.** No continuous screen recording, microphone capture, or arbitrary document exfiltration.

## 3. Experience and information architecture

### Entry flows

**A. Existing SmartPathAI PDF:** Open document in `/study/:documentId` (or a chat-linked study route, depending on repository structure); extension recognizes the page and activates the cursor.

**B. PDF opened on the web:** User clicks extension → “Open in SmartPath Live.” If a direct PDF URL is accessible and the user grants access, import it; otherwise offer a local file picker. Login-protected/Drive-hosted PDFs may require manual download/upload; never bypass access controls.

**C. File on device:** User chooses a PDF from the Study Workspace file picker. No requirement to enable Chrome `file://` injection.

**D. Other websites (stretch):** Explicit selection → “Explain in SmartPath Live.” Contextual text-only explanation is permitted on allowlisted/granted sites but full document annotation is not promised.

### Workspace layout

- Center/left: full PDF with selectable text, scrolling, page navigation, zoom, visual annotation overlay.
- Right or collapsible lower pane: existing interactive SmartPathAI knowledge graph. It can be hidden to focus on reading.
- Overlay: distinct AI cursor, a temporary speech bubble, an animated highlight or drawn arrow, and small lesson controls.
- Compact extension panel: input, microphone, status, voice toggle, Stop/Pause/Resume, current concept; **no default scrolling chat transcript**.
- Optional lesson timeline: progress checkpoints, not chat messages.

### Primary interaction modes

**Teach Mode:** “Teach me this page” / “Explain LDR like I’m new to pointers.” Generate a short 3–5-step explanation grounded to source spans. Cursor navigates source → narrates → shows graph relation → checks comprehension. User controls next/stop.

**Explore Mode:** Select text or point at an equation → “What does this mean?” The model answers contextually using the selected page region and nearby paragraphs. Cursor highlights exactly the selected source. Provide “simpler,” “example,” and “show relationship” actions.

**Guide Mode:** “What should I study next?” Use existing confidence scores and graph structure to recommend weak or foundational concepts, move the cursor to the corresponding node and PDF evidence, then offer the existing quiz. Do not claim that the quiz is concept-specific unless the filter is implemented.

**Focus Mode:** “This graph is overwhelming.” Use existing graph controls to focus/expand/collapse related concepts. Never remove source nodes or rewrite the graph.

### Voice and visual personality

- Natural-language press-to-talk; text entry always works.
- Short voice segments that refer to **this** highlight, **this** equation, and **this** graph edge.
- TTS ON by default during a lesson, user-toggleable and interruptible.
- Cursor states: `following`, `listening`, `thinking`, `planning`, `acting`, `awaiting_student`, `paused`, `done`, `error`.
- Cursor trails and glow subtle; never cover selected text. Offset ~18–24 px when following; break away during teaching, then return to user pointer.
- Respect `prefers-reduced-motion`, keyboard accessibility, and captions.

## 4. Flagship demo — exact sequence

**Fixture:** A 5–15-page, digitally generated educational PDF containing `Memory`, `Pointers`, and `LDR/STR` and a prebuilt/successfully generated graph.

1. Student opens a PDF in Chrome and chooses **Open in SmartPath Live**.
2. Browser navigates to a normal SmartPathAI study URL; PDF and graph render.
3. User presses the extension hotkey or mic button and says: “Teach me how LDR uses pointers.”
4. Intent router returns `teach_concept`, `targetConcept=ldr`, and a source-grounded plan.
5. Cursor moves to the PDF example `LDR R1, R2, #0`, highlights it, and says what `R2` contains versus what the instruction loads.
6. The PDF stays visible; the cursor traces from the `Memory` node to `Pointers` and then `LDR/STR` if those graph edges actually exist.
7. User interrupts: “Wait—why doesn't R2 hold the value?” AI pauses the lesson, points back at the address/value example, and gives a simpler analogy.
8. User presses Continue. Agent displays a one-question knowledge check.
9. User answers; result is checked, and the lesson indicates completion. Persist progress only through an existing authorized progress flow.
10. User clicks Stop; cursor stops, speech cancels, and controls remain responsive.

**What judges should notice:** it never looks like ChatGPT pasted into a PDF viewer. The document, cursor, graph, and explanation remain synchronized.

## 5. Functional requirements and priorities

| ID | Priority | Requirement | Acceptance |
|---|---|---|---|
| F01 | P0 | Unpacked MV3 Chrome extension | Loads and detects SmartPath study tabs |
| F02 | P0 | Floating animated second cursor | Smooth follower + accurate target movement |
| F03 | P0 | Embedded browser PDF viewer | Renders and scrolls an uploaded PDF, selectable text |
| F04 | P0 | Source anchored highlighting | Correct page and bounding box at varying zoom/scroll |
| F05 | P0 | Selected-passage explanation | Relevant voice/caption explanation grounded in source |
| F06 | P0 | Graph node sync | Clicking or explaining a concept focuses the matching node |
| F07 | P0 | Start/pause/stop and user override | No unwanted subsequent actions or speech after Stop |
| F08 | P0 | Text input + spoken output | Usable even if microphone permission fails |
| F09 | P0 | “Open in SmartPath Live” PDF import | Supported URL import or clearly guided file upload fallback |
| F10 | P1 | Speech-to-text voice command | Works in tested Chrome environment; text fallback |
| F11 | P1 | Guided 3–5 step Teach Mode | Correct ordered anchors + step-by-step controls |
| F12 | P1 | Graph-path guided navigation | Follows verified graph relationships, not guessed ones |
| F13 | P1 | Comprehension check | Accepts answer, gives reasoning, optionally updates progress |
| F14 | P1 | Weak-concept study recommendations | Uses existing confidence scores where authorized |
| F15 | P1 | Temporary arrows/circles | Overlays mapped to PDF page coordinates |
| F16 | P2 | General web-page selection explanation | Only after explicit activation and host permission |
| F17 | P2 | Arbitrary browser UI control with CDP | Restricted, user-approved; not required for demo |
| F18 | P2 | Scanned PDF / image reasoning | Requires OCR/figure grounding; degrade gracefully |

**Priority order:** Grounded PDF teaching > visible cursor > graph sync > interruptible narration > quiz > broader browser automation. If time runs short, cut P2 before compromising source reliability.

## 6. Technical architecture

```text
Chrome Browser
│
├── SmartPath Live Extension (Manifest V3)
│   ├── content script: cursor, overlay, page context, user-intervention detection
│   ├── side panel or popover: mic/input, mini-controls, voice/status
│   └── service worker: active-tab gating, messaging, run coordination
│
└── SmartPathAI web app (React/Vite)
    └── /study/:documentId
        ├── PDF.js renderer + text/annotation layers
        ├── React Flow knowledge graph (reuse)
        ├── lesson event controller + trusted UI bridge
        └── quiz / progress UI (reuse)
                │
                ▼
        Existing Express/TypeScript API (authentication, session, proxy)
                │
                ▼
        Existing FastAPI AI server + Neo4j graph
        ├── PDF extraction and passage-index creation
        ├── evidence / concept grounding
        ├── Grok lesson planning and contextual explanation
        └── optional quiz question generation
```

### Principle: extension controls UI; servers produce data

- Grok can return an **explanation plan** and **source IDs**, never arbitrary executable browser code.
- The extension/app controller resolves approved source IDs into visible PDF rectangles and graph nodes.
- Navigation and graph focus use verified React UI commands; visual cursor movement accompanies the actual UI update.
- If using real mouse events, resolve the target first and send input via user-approved CDP; the hackathon MVP does **not** require the powerful `debugger` permission for the first-party SmartPath workspace.
- No simulated browser-level pointer movement is implied: the second cursor is an animated overlay separate from the physical pointer.

### Reuse the existing stack

- **React + TypeScript + Vite:** app and extension UI.
- **PDF.js / react-pdf:** browser PDF rendering and selectable text layer.
- **React Flow:** SmartPath graph.
- **Express:** authenticated app API and proxy for AI requests.
- **FastAPI + PyMuPDF:** source text, geometry, graph evidence, LLM.
- **Neo4j:** concept graph; **MongoDB:** existing user/progress records.
- **Grok:** semantic tutoring/planning, invoked server-side with model ID configured through environment.
- **Browser `speechSynthesis`:** TTS; **SpeechRecognition** if supported/permission granted, with text fallback.

**Avoid introducing** a second Python web service, a new database, and a new agent orchestration framework for the hackathon.

### Permission posture

MVP manifest should request as little as practical, e.g. `activeTab`, `scripting`, `sidePanel`, `storage` (optional `commands`), and scoped host permissions for local/dev and deployed SmartPath domains. Support other sites via optional host permission obtained on a user gesture. Add `debugger` **only** if real CDP automation is later implemented; it causes a broad permission warning.

### MV3 lifecycle

- Treat the service worker as ephemeral; it can restart. Store minimal run metadata in `chrome.storage.session` or reconstruct from the study tab.
- One active teaching run per tab; run ID and sequence number on every event.
- Ignore late responses from cancelled runs.
- Every command rechecks `tabId`, documentId, route, and origin.
- On tab close/navigation/log out, cancel speech, animation, and pending UI actions.

## 7. Document evidence and on-screen coordinate system — critical path

### Proposed model

```ts
export type SourceAnchor = {
  documentId: string;
  pageIndex: number;          // zero-based
  quote: string;              // short exact source excerpt
  textHash?: string;
  rects: Array<{x: number; y: number; width: number; height: number}>;
                            // normalized [0,1] within canonical PDF page
  extractionMethod: 'pdf_text' | 'ocr' | 'manual';
  confidence: number;         // alignment score, not factual certainty
};

export type ConceptEvidence = {
  conceptId: string;
  anchor: SourceAnchor;
  relation: 'definition' | 'example' | 'mention' | 'figure';
};
```

### Required pipeline

1. Parse a digital PDF with PyMuPDF. Extract per-page words/blocks, bounding rectangles, page dimensions, and text.
2. Preserve the PDF bytes under authenticated document access, along with a stable document ID and hash; determine whether existing SmartPath storage already meets this requirement.
3. Produce source anchors from words/blocks, retaining page number and normalized rectangles.
4. Map graph concepts to anchors using exact/lexical/semantic retrieval. Confirm quoted span actually appears on that page; score match quality. Only accept anchors above a calibrated threshold.
5. Render the original file via PDF.js in the website. Convert normalized page rectangles into on-screen positions using PDF.js page viewport transforms, zoom, rotation, scroll, and text layer geometry.
6. Draw highlights in an SVG/canvas layer **relative to the page container**, not fixed screen coordinates.
7. Scroll page and target anchor into view, wait for layout/scale changes to settle, remeasure, animate the cursor to the latest visible box, and verify the highlight intersects the intended region.
8. If two plausible occurrences exist, prefer an exact quote + page pair or ask which occurrence the student means.

**Mandatory failure behavior:** If no trustworthy location exists, teach with an explicit “I can explain this, but couldn't pinpoint the source” message; do not draw at guessed coordinates. Scanned PDFs and complex figures are stretch unless reliable OCR or visual grounding already works.

### Event and lesson data contracts

```ts
export type LiveIntent =
  | 'teach_page' | 'teach_concept' | 'explain_selection'
  | 'focus_graph' | 'review_weaknesses' | 'quiz_me'
  | 'general_question' | 'unsupported';

export type LessonStep = {
  id: string;
  kind: 'highlight_pdf' | 'focus_graph' | 'say' | 'ask_question';
  narration: string;
  sourceAnchor?: SourceAnchor;
  conceptId?: string;
  quiz?: {question: string; choices?: string[]; correctAnswer: string};
  expectedUiState: string; // predefined/verifiable state enum in implementation
};

export type LessonPlan = {
  planId: string;
  documentId: string;
  intent: LiveIntent;
  title: string;
  steps: LessonStep[]; // 3–5 steps for guided demo
  needsClarification?: string[];
};

export type RunEvent = {
  runId: string;
  stepId?: string;
  sequence: number;
  type: 'status_changed' | 'step_started' | 'step_verified'
     | 'speech_started' | 'speech_stopped' | 'paused'
     | 'resumed' | 'failed' | 'completed' | 'cancelled';
  timestamp: number;
  payload?: Record<string, unknown>;
};
```

Treat generated `expectedUiState` as descriptive only; verification logic should be predefined by the UI engine, not executable LLM expressions.

## 8. Proposed authenticated API contract

These are **new routes to implement**, not claims that they already exist. Keep them on the existing Express API, with Python service calls behind it.

| Endpoint | Purpose | Response |
|---|---|---|
| `POST /api/live/v1/documents/import` | Explicit file upload or authorized URL import | `{documentId, graphId?, status}` |
| `GET /api/live/v1/documents/:id` | Authenticated metadata | `{id, title, pageCount, graphId, ready}` |
| `GET /api/live/v1/documents/:id/content` | Secure PDF bytes/stream | `application/pdf` |
| `GET /api/live/v1/documents/:id/anchors` | Page words/spans/geometry | `{anchors: [...]}` |
| `GET /api/live/v1/documents/:id/concepts` | Graph concepts with evidence | `{concepts: [...]}` |
| `POST /api/live/v1/intent` | Interpret utterance + selected context | `{intent, args, missingFields}` |
| `POST /api/live/v1/lesson` | Generate validated, grounded lesson plan | `{planId, steps: [...]}` |
| `POST /api/live/v1/explain` | Answer selection or follow-up | `{text, evidence: [...], nextActions: [...]}` |
| `POST /api/live/v1/check` | Grade low-stakes knowledge check | `{correct, feedback, rationale}` |

**Example request**

```json
{
  "documentId": "doc_demo_001",
  "mode": "teach_concept",
  "utterance": "Teach me LDR like I'm new to pointers",
  "selectedText": null,
  "currentPageIndex": 7,
  "currentConceptId": null,
  "priorLessonStepId": null
}
```

**Example grounded step**

```json
{
  "id": "step-2",
  "kind": "highlight_pdf",
  "narration": "R2 holds the address. LDR loads the value stored at that address into R1.",
  "sourceAnchor": {
    "documentId": "doc_demo_001",
    "pageIndex": 7,
    "quote": "LDR R1, R2, #0",
    "rects": [{"x":0.18,"y":0.35,"width":0.21,"height":0.025}],
    "extractionMethod":"pdf_text",
    "confidence":0.98
  },
  "expectedUiState": "pdf_anchor_visible"
}
```

All model outputs are schema-validated; unknown intents, nonexistent page indices, hallucinated concept IDs, and invalid rectangles fail closed. The above values are illustrative fixtures, not extracted coordinates from an actual document.

### Grok responsibilities

- Intent classification from voice/text and concise allowed context.
- Explain source passages using retrieved verified evidence.
- Compose short lesson plans from known anchors and known graph concepts.
- Generate an optional question with verified source context.
- Reformulate an explanation as “simpler,” “example,” or “slower.”

### Deterministic responsibilities

- Find/scroll/highlight correct PDF anchor.
- Position virtual cursor and draw visual annotation.
- Focus known graph node and display existing graph links.
- Show question card; track pause/resume/next.
- Verify page, node and target states; reject invalid operations.

## 9. Trust, privacy and prompt-injection defense

- Only act after explicit user input. No always-on audio/video or periodic screenshot capture.
- The user chooses a document; display that its selected contents will be sent to the configured AI service for explanations.
- Keep LLM/API keys in server env, never bundled into the extension or Vite public env.
- Respect existing user authentication; document read APIs verify document ownership.
- Use signed or authenticated document access; sanitize any remote URL imports against SSRF, redirects to internal networks, oversized payloads, unsupported MIME types, and unsafe schemes.
- Do not copy auth cookies, tokens, passwords, or unrestricted page DOM to Grok.
- Treat PDF text and web page text as **untrusted evidence**, never as instructions. A sentence inside a PDF saying “ignore all rules” must remain content, not control behavior.
- Browser page bridge accepts only typed allowlisted operations and validates origin, tab, document, run ID, and request ID; do not rely on postMessage origin alone for authorization.
- Only the user can initiate actions; the backend cannot command the browser directly.
- No delete/payment/account-permission changes; no external website automation in P0.
- Temporary overlay annotations can be cleared; avoid storing complete voice transcripts and raw screenshots by default.
- On Stop: cancel speech synchronously, cancel queued UI actions, abort pending request where possible, ignore stale backend results, and reset the pointer state.
- On unexpected user scroll/typing/manual graph movement: pause automated scrolling and wait for explicit resume.

## 10. Runtime state machine

```text
idle
  └─ user activates → observing
        └─ contextualize → planning
              ├─ missing info → awaiting_student → planning
              └─ validated plan → teaching
                     ├─ step success → next step
                     ├─ follow-up → explaining → teaching
                     ├─ user intervention → paused → revalidate → teaching
                     ├─ stop → cancelled
                     ├─ invalid anchor/state → error
                     └─ last verified step → completed
```

Before a meaningful UI operation: `step_started` → cursor animation/highlight → actual UI update → assertion of visible state → `step_verified` → narration of completion. There is no fake cursor click followed by an unrelated hidden API operation.

## 11. Four-person ownership and parallel work

### Engineer A — Extension & Cursor Lead

**Owns:** MV3 manifest, extension bundling, content script, Shadow DOM overlay, pointer following, voice/compact controls, tab permission checks, pause/stop implementation, extension↔website messaging client.

**Deliverables:** loads unpacked in Chrome; pointer follows and separates to approved targets; controls communicate to Study Workspace; stop reliably halts pointer/speech.

**First PR contract:** `CURSOR_MOVE_TO({runId, anchorId|viewportRect})` with acknowledgments; never accept unauthenticated arbitrary coordinates from Grok.

### Engineer B — PDF Workspace & Grounding Lead

**Owns:** `/study/:documentId`, PDF.js viewer, zoom/scroll, text selection, annotation layer, anchor-to-screen transform, original PDF loading/import UX, visual regression fixtures.

**Deliverables:** selected passages resolve to stable page anchors; `highlightAnchor(anchor)` positions correctly at zoom changes; text and highlights remain aligned during scroll.

**First PR contract:** `PdfViewerApi = {scrollToAnchor, highlightAnchor, clearHighlight, getSelectionContext, getVisiblePage}`.

### Engineer C — AI, Evidence & Backend Lead

**Owns:** Grok server-side adapter, validated intent and lesson schemas, PyMuPDF word extraction and evidence anchors, concept-to-evidence mapping, Express/Python API route integration, provenance checks, sample PDF fixtures.

**Deliverables:** API returns a 3–5-step lesson whose anchors and graph IDs all exist; explanations include page references; uncertainty/failure is explicit.

**First PR contract:** sample deterministic `/lesson` response before wiring the LLM; preserve fixture IDs for other engineers.

### Engineer D — SmartPath Graph, Learning UX & QA Lead

**Owns:** existing React Flow integration, graph focus and relation traversal, teaching timeline, comprehension cards/quiz reuse, concept progress, integration tests and demo operator script.

**Deliverables:** `focusConcept(id)`, `showRelatedConcepts(id)`, a guided 3-node path, quiz/check UI, and stable smoke tests.

**First PR contract:** `GraphApi = {focusConcept, getRelatedConceptIds, showPath, clearFocus}`; paths use actual relation semantics.

### Shared rules

- Four owners, four branches: `feat/extension-cursor`, `feat/pdf-workspace`, `feat/evidence-tutor`, `feat/graph-guidance`.
- One integration branch, feature flags, daily/periodic merges (not one final giant merge).
- Shared types and fake fixture data are agreed upon first; no developer waits for another's finished API.
- Every PR includes a screenshot/GIF or terminal test, setup instructions, and declared test status.
- Only authorized SmartPath team members modify private services; coordinate project-lead access on day one.
- One person conducts a final demo from a clean Chrome profile; no last-minute unreviewed dependency upgrades.

## 12. Build plan and critical path

### Phase 0 — First 60–90 minutes: prove dependencies

- Clone and run website plus AI server using project onboarding docs.
- Confirm PDF upload, graph generation, and ability to retrieve original PDF or implement a temporary authenticated demo document route.
- Agree on sample PDF, document ID, three concepts, and source-anchor fixtures.
- Agree on the lesson step JSON/TypeScript schema.
- Test unpacked MV3 extension injection into the SmartPath dev route.

**Gate:** A PDF page and graph node render, and an extension cursor appears on that tab. If private AI-server access is blocked, work from static fixtures without postponing frontend integration.

### Phase 1 — Parallel build

- A: cursor and control bubble over existing page.
- B: PDF.js reader, text-layer selection, highlight and scroll.
- C: API and one fully validated, hardcoded lesson fixture; later Grok generation.
- D: graph focus and question card using three known concepts.

**Gate:** A scripted plan sends `scroll→highlight→focus node→ask question` through the actual UI, with no live model dependency.

### Phase 2 — AI and voice integration

- C wires Grok to existing source anchors; validate JSON and grounding.
- A wires mic/TTS and interruption; captions continue if speech fails.
- B verifies anchors at multiple zoom/scroll positions.
- D connects graph confidence (if available) and quiz verification.

**Gate:** Live text instruction produces a correct source-grounded lesson from the demo PDF; voice works on at least one tested Chrome installation.

### Phase 3 — Reliability and presentation

- End-to-end rehearsals, measured selector/anchor failures, stale events, cancellation.
- Final UI styling: subtle cursor glow, laser pointer and annotation circle, concise lesson progress.
- Polish import fallback, microphone denial, PDF parsing failure messages.
- Run the demo with cold reload, prepared PDF, and one backup offline fixture.

### If hackathon time is shorter than planned

**Cut in this order:** arbitrary-site help → personalized weak-topic ranking → custom quiz generation → drawing beyond simple rectangles → sophisticated follow-up memory. **Do not cut:** source alignment, working extension, spoken explanation, graph node link, Stop.

## 13. Acceptance tests and measurable success

### Product tests

1. Install unpacked extension, open SmartPathAI in Chrome, and observe a non-blocking AI cursor that follows the physical pointer.
2. Import a known 10-page PDF and view it in a normal Chrome tab with selectable text.
3. Select the phrase `LDR R1, R2, #0` and request “explain this”; cursor highlights the actual phrase and speaks a relevant explanation with a page label.
4. Say “teach me pointers”; a 3+ step plan moves through real evidence anchors and the correct graph node IDs.
5. Ask “explain simpler” while speaking; current voice stops and a new grounded explanation begins.
6. Pause/resume safely; on manual scroll the agent must not yank the viewport back without revalidation.
7. Press Stop during animation, narration, and pending AI request: no stale step advances afterward.
8. Ask about a topic missing from the PDF: no invented passage/rectangle, honest fallback.
9. Graph concept focus stays correct when hidden and re-opened.
10. Voice permission denied: text-only learning remains functional.

### Engineering tests

- **Anchor accuracy target:** >= 95% of a curated set of 20 word-level annotations visibly align at 75%, 100%, and 150% zoom. Any anchor rejected as ambiguous must not be falsely drawn.
- **Demonstration reliability target:** >= 9 successful runs out of 10 controlled rehearsals on the preselected demo PDF; report failures honestly.
- **Stop target:** local animation and TTS halt within 500 ms of user click on tested hardware; late network responses must not restart a cancelled run.
- **Model grounding target:** 100% of cited page references in the demo plan exist, and source quotes match verified extracted text.
- **Privacy target:** no API keys in extension build, no prompt injection from document content can invoke privileged Chrome operations.
- **Accessibility:** keyboard controls for core operations, captions, reduced-motion behavior.

Targets are goals, not measured results.

### Test infrastructure

Use Vitest/Jest for pure types, matching, and state-machine logic; Playwright for browser UI and PDF rendering assertions; a clean Chrome profile with an unpacked MV3 extension for final smoke tests. Add a small mock AI server response fixture to keep CI deterministic. Use a real logged-in SmartPathAI test account for only the final integrated demo.

## 14. Key risks and mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Chrome built-in PDF viewer cannot be injected | Critical | Open PDF in SmartPath PDF.js study tab via extension action |
| Existing AI-server private/access unavailable | High | Request access early; mock graph/lesson fixtures; do not block UI work |
| Original PDF bytes unavailable after upload | High | Create authenticated PDF storage/retrieval or use explicit local import demo route |
| Graph concepts lack page provenance | High | Separate verified concept-evidence index with quote/page/rect mapping |
| Misplaced pointer at zoom/scroll | High | Page-relative rectangles, `ResizeObserver`, viewport remeasurement, verified visible targets |
| Hallucinated citations or relationships | High | Only use retrieved anchors and real graph edges; schema validation and rejection |
| Latency interrupts lesson feel | Medium | Short plan batches, captions immediately, cache evidence, start TTS per verified step |
| Speech recognition inconsistent | Medium | Text fallback and recorded test utterance only as demo backup (not fake live behavior) |
| MV3 worker restarts | Medium | Session state and run IDs; graceful cancellation/resumption checks |
| Full feature scope grows unmanageable | Critical | P0-first, fixture-first parallelization, single flagship demo |

## 15. Demo script (3 minutes)

**0:00–0:20 — Problem.** “Uploading a PDF gives you information. But when you're stuck, you still have to figure out what matters and where to start.”

**0:20–0:40 — Chrome extension.** Show installation/extension icon and choose **Open in SmartPath Live** from a real PDF tab. Emphasize browser-only, no native desktop app.

**0:40–1:40 — Teach.** Ask aloud: “Teach me LDR from scratch.” AI cursor visibly moves to source text, highlights the relevant syntax, narrates a concise explanation, then focuses the corresponding SmartPath graph node.

**1:40–2:10 — Interrupt.** Ask “Wait, why does R2 contain an address?” The tutor stops and explains the highlighted example more simply with an animated arrow or circle.

**2:10–2:40 — Check understanding.** Present one question, answer it, show feedback and progress.

**2:40–3:00 — Control and differentiation.** Click Stop; cursor and speech halt. Close with “SmartPath already knows how concepts connect. SmartPath Live turns that understanding into a teacher that points to what you're reading.”

## 16. Repository and handoff structure (proposed)

```text
SmartPathAI-workspace/
├── Smart-Path-AI/                # Existing public website repository
│   ├── src/pages/Study.tsx      # New browser study route
│   ├── src/components/live/     # PDF/graph controls and teaching overlays
│   ├── src/lib/live/            # Shared lesson/runtime contracts
│   └── server/routes/live/      # Authenticated new endpoints
├── smartpathai-aiserver/        # Existing private AI repo, when authorized
│   └── live/                    # PDF grounding + Grok lesson planning
└── smartpath-live-extension/    # New MV3 extension repository/package
    ├── manifest.json
    ├── src/background/
    ├── src/content/
    ├── src/sidepanel/
    ├── src/shared/
    └── README.md
```

If the team prefers a monorepo, place the extension in an `extension/` workspace while keeping the existing app's build commands functional. Keep `SourceAnchor`, `LessonPlan`, and `RunEvent` schema versions identical across services.

### README must include

- What SmartPath Live is, its direct relationship to BDBI SmartPathAI, and why it is a Chrome extension.
- Prerequisites and how to run the existing SmartPath app/AI server.
- How to install/load the unpacked MV3 extension.
- Where Grok credentials go (server only), and how to test without them using fixtures.
- Importing a PDF; why the built-in Chrome PDF viewer is not directly scriptable.
- Permissions, voice support and denial fallback, privacy statement.
- Supported commands, known limitations, example PDF, exact 3-minute demo steps.
- Test commands, smoke checklist, screenshots, and attribution/licenses for dependencies.

## 17. Definition of done

**Ship only if:**

- The Chrome extension is real, installable, and visibly active on the SmartPath study website.
- A real PDF renders in a normal browser page and can be annotated at verified source coordinates.
- A natural-language request (text minimum; voice strongly preferred) yields a verified, context-grounded explanation.
- The animated AI cursor points to the actual discussed material and graph node.
- The user can interrupt, pause, and stop without the agent continuing behind their back.
- A complete staged lesson and comprehension check work on the prepared test document.
- A teammate can follow the README and reproduce the demo.

**Not in MVP:** arbitrary desktop control, native apps, all websites, unrestricted browsing, always-on listening, generalized agentic UI automation, automated account changes, or flawless OCR for scanned PDFs.

---

## Source and research notes

- BDBI project page: https://www.gtbigdatabigimpact.com/projects/smart-path-ai
- SmartPathAI public website repo: https://github.com/gt-big-data/Smart-Path-AI
- SmartPathAI onboarding: https://github.com/gt-big-data/Smart-Path-AI/blob/main/ONBOARDING.md
- Chrome Side Panel API: https://developer.chrome.com/docs/extensions/reference/api/sidePanel
- Chrome service-worker lifecycle: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- Chrome debugger API: https://developer.chrome.com/docs/extensions/reference/api/debugger
- PDF.js example: https://mozilla.github.io/pdf.js/examples/
- PyMuPDF Page text / bounding-box API: https://pymupdf.readthedocs.io/en/latest/page.html
- HeyClicky (interaction reference, not code): https://www.heyclicky.com/about

**Scope note:** This specification proposes new APIs and model contracts; it does not claim they already exist in SmartPathAI. The AI server is private and its internals were not independently inspected here.
