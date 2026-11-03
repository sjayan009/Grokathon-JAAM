# Smart Path AI: Cursor Tutor

A Chrome extension that teaches inside a study workspace. Ask it about gradient descent and its cursor walks through your PDF, highlights the passages, draws a worked example on a whiteboard, opens a video and checks your understanding, narrating as it goes.

This is a standalone hackathon demo. It needs no Smart Path repo, login, database or API key.

## Run it

Requires Node 22.18+ (tested on 25) and Chrome.

```sh
npm install
npm run build -w chrome-extension
npm run dev
```

1. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose `chrome-extension/dist`.
2. Open http://localhost:5173.
3. Type **Teach me gradient descent**.

Port 5173 is required, because the extension only runs on `http://localhost:5173`.

**No extension handy?** Click **Run embedded simulation** in the right rail. It runs the same lesson code inside the page and is labelled as a simulation.

## Demo script

1. Ask: *Could you walk me through gradient descent using my lecture notes?*
2. Move your own mouse while the lesson runs. The orange cursor is the tutor; yours stays free.
3. Mid-lesson, ask *Why subtract the gradient?* The lesson pauses, answers with a page reference, and offers Resume.
4. At the end, answer the quiz, then press Play on the video.
5. Select a passage in the PDF and click **Explain**, then say *Save this explanation*. Refresh to show the note persisted.

Pause, Skip line and Stop are always available. The toolbar icon shows or hides the companion.

## Optional: live AI answers

Everything above works offline with authored answers. To answer questions outside that set:

```sh
cp optional-ai-proxy/.env.example optional-ai-proxy/.env   # then add OPENAI_API_KEY
npm run dev:proxy
```

Reload the page and the panel badge changes from `AI: scripted` to `AI: live`. The key stays in the proxy and never reaches the extension or page. Answers use only excerpts from the notes, and if the proxy fails the tutor falls back to the authored answers.

`OPENAI_MODEL` is optional. When unset, the proxy uses the newest `gpt-*-mini` model on your account.

## How it works

```
Typed or spoken request
  → intent router ─┬─ known lesson → LessonRunner (state machine)
                   └─ question     → grounded Q&A, or authored fallback
  → companion cursor + panel (Shadow DOM)
  ⇅ allowlisted postMessage commands, each acknowledged
  → mock workspace: PDF.js, whiteboard, video, quiz, notes
```

| Path | Purpose |
|---|---|
| `tutor-core/` | Runner, bridge, intent routing, Q&A, speech, cursor and panel. Shared by the extension and embedded mode |
| `chrome-extension/` | MV3 content script and service worker. A thin wrapper around `tutor-core` |
| `mock-smartpath/` | The study workspace, the lesson fixture and the PDF |
| `optional-ai-proxy/` | OpenAI proxy that holds the API key |
| `scripts/` | Generates the PDF and icons |

**Key rules**

- Every lesson beat waits for the workspace to acknowledge it, so narration never runs ahead of the screen.
- Model output never reaches the DOM. Actions go through `validateStudyAction` in `tutor-core/src/protocol.ts`.
- The extension only touches `localhost:5173`. The microphone is push-to-talk only.
- Failures are reported, not hidden. A passage that can't be found gets a visible callout instead of a claimed highlight, and a blocked video falls back to a YouTube link.

To change the lecture text, edit `mock-smartpath/src/demo/notesContent.ts` and run `npm run generate:pdf`. The PDF and fixture both come from that file, and tests check they still match.

## Differences from the original spec

- **Learning rate is 0.4, not 0.2.** The spec's sequence (0 → 2.4 → 2.88 → 2.976) only works with α = 0.4. With α = 0.2 it would be 0 → 1.2 → 1.92 → 2.352. 0.2 is the factor the distance to the minimum shrinks by each step (1 − 2α).
- **Shared code moved to `tutor-core/`** so embedded mode runs the same code as the extension.
- **More bridge actions** (`GET_BOUNDS`, `GET_CONTEXT`, `RESET_WORKSPACE`, `SET_LESSON_MODE`, `SET_PLAYBACK`, `CANCEL_ALL`), because the spec's list couldn't express Pause, Restart or clicking a button.

## Test

```sh
npm test            # unit tests
npx playwright install chromium   # once
npm run e2e         # full acceptance suite in Chromium with the extension loaded
npm run typecheck
```

`?tutorSpeed=N` in the URL speeds up the lesson and silences speech. The e2e suite uses it.
