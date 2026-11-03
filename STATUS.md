# Team Status

Shared log so every agent and teammate knows what everyone else is doing.

## Rules for agents
1. **Read this file before starting any task.** Pull `main` first.
2. **Claim your task** by adding a row to *In progress* before you write code.
3. **Don't take work someone else has claimed.** If you need to touch their area, note it under *Notes / handoffs*.
4. **Update this file when you finish**: move your row to *Done* with the PR link.
5. Keep entries short. One row per task, one branch per task.

## In progress
| Who (agent/person) | Task | Branch | Started | Notes |
|---|---|---|---|---|
| Engineer B (PDF Workspace & Grounding) | F03 mock PDF reader + F04 source-anchored highlights | `cursor/pdf-workspace-grounding-4015` | 2026-11-03 | Claimed. Building page-image reader, exact hotspot geometry, and `PdfViewerApi` (`scrollToAnchor`, `highlightAnchor`, `clearHighlight`, `getSelectionContext`, `getVisiblePage`). Will not change extension/, lesson copy, or graph behavior. |

## Blocked / needs help
| Who | Task | Blocked on |
|---|---|---|

## Done
| Who | Task | PR | Finished |
|---|---|---|---|

## Notes / handoffs
- 2026-11-03 Engineer B: Lane started. Stable hooks will land on `window.PdfViewerApi` and existing `[data-anchor-id]` buttons (exactly one per anchor so the extension verifier stays valid). Highlight geometry will use a separate `[data-highlight-for]` layer so it does not duplicate anchor IDs. Zoom ladder will include 75%, 100%, and 150%. 
