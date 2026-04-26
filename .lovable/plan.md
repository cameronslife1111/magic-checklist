## Root cause analysis (first principles)

### Issue 1 — Home button uses long-press; user wants tap-to-toggle
In `src/pages/Checklist.tsx` (~lines 1366–1417), the 🏠 button starts recording only after a 500ms `setTimeout` inside `onPointerDown`, and stops on `onPointerUp` if the timer fired. That forces a press-and-hold gesture. We need a simple **tap-to-start, tap-again-to-stop** flow with no timer.

### Issue 2 — "Open the actions sheet and press X button" doesn't actually press X
Two compounding causes:

1. **Prompt under-specifies non-media action flows.** `supabase/functions/magic-steps-plan/index.ts` only documents `openActions → pickAction → … → generate` for **media** actions. For a generic "open actions sheet and press X button," the model often emits just `{ kind: "openActions" }` and stops, or emits `pickAction` with a value the executor's strict whitelist rejects (e.g. "video to video" instead of `"video-video"`).
2. **Executor's `pickAction` for non-media correctly calls `ctx.pick(key)`** which dispatches the same `onPick` the UI uses — that part works. But `openActions` is unnecessary noise: the dispatcher runs the action whether the sheet is open or not, and `onPick` itself calls `setActionsOpen(false)`. The redundant `openActions` step also fights with `pickAction` (open → close in ~120ms, looks broken).

### Plan (highest probability of success)

#### 1. `src/pages/Checklist.tsx` — tap-to-toggle home recording
Replace the long-press logic on the 🏠 button (lines 1366–1417) with a simple `onClick` toggle:
- If `magicRecording` is **false** → call `startMagicRecording()` and **return** (do NOT navigate).
- If `magicRecording` is **true** → call `stopMagicRecording()` and **return**.
- Only if neither is true do we fall through to the existing short-tap "open top checklist / open linked checklist" behavior.

Implementation details:
- Remove `homeLongPressTimerRef` / `homeLongPressFiredRef` usage on this button (refs can stay declared; they're cheap).
- Use `onClick` instead of `onPointerDown`/`onPointerUp` so we get one clean event per tap and avoid double-firing on touch.
- Keep `onContextMenu={(e) => e.preventDefault()}` and the red-pulse class while `magicRecording` is true.
- Update the `aria-label` to `"Tap to start/stop Magic Steps voice; tap again to open top checklist"`.
- Keep `MagicRecordingPill`'s Stop button as a secondary way to end recording (it already calls `stopMagicRecording`).

This keeps the non-blocking pill UX the user already loves; only the trigger gesture changes.

#### 2. `src/pages/Checklist.tsx` — short-tap navigation safety
Because the same button now both toggles recording and navigates, ensure that the very tap that **stops** recording does NOT also navigate. The `if (magicRecording) { stop; return; }` early-return above handles that. Also: the tap that **starts** recording must not navigate either (early return). Without these returns, every start/stop tap would also jump to the top checklist.

#### 3. `supabase/functions/magic-steps-plan/index.ts` — teach the model the right pattern for "press a button"
Tighten the system prompt with two concrete additions:

- **New rule (general action button presses):**
  > For ANY non-media action button the user names ("press the X button", "open actions and tap Y", "switch to dark mode via the menu"), emit a SINGLE `{ kind: "pickAction", action: "<exact-key>" }` step. Do NOT emit `openActions` first — the app dispatches the action whether the sheet is open or not, and emitting both makes the sheet flash open and shut.
  > Only emit `openActions` when the user explicitly says "just open the actions sheet" with no follow-up button.

- **Strengthen fuzzy mapping examples** so the model always emits one of the canonical `ACTION_KEYS` strings:
  > Spoken → key: "video to video" → `"video-video"`, "image to image" → `"image-image"`, "remix" → `"remix"`, "audio + image to video" → `"audio-image-video"`, "analyze image" / "describe this image" → `"analyze-image"`, "web search" → `"web-search"`, "background color" / "change background" → `"bg"`, "rearrange" / "reorder" → `"rearrange"`, "send to checklist" → `"send-to"`, "send to blank" → `"send-to-blank"`, "uncheck all" → `"uncheck-all"`, "combine checked" → `"combine-checked"`, "media gallery" → `"media-gallery"`, "split current" → `"split"`, "split by emoji" → `"split-emoji"`, "copy sentence" → `"copy-sentence"`, "copy checklist" → `"copy-checklist"`, "insert link" → `"insert-link"`, "duplicate item" → `"duplicate-item"`, "duplicate checklist" → `"duplicate"`, "new checklist" → `"new"`, "edit title" → `"edit-title"`, "delete checklist" → `"delete-checklist"`.

- **Reaffirm the media-flow exception:** the `openActions → pickAction → setMediaOption* → attach* → generate` sequence still applies ONLY to the seven media keys.

#### 4. `src/lib/magicExecutor.ts` — make `pickAction` resilient
Currently `pickAction` already runs `fuzzyMatchActionKey` when the key isn't in the whitelist. Two small hardenings:

- If the AI emits `openActions` immediately followed by `pickAction`, **skip the redundant `setActionsOpen(true)`** by detecting "next step is pickAction" and turning `openActions` into a no-op. Implementation: peek at `plan.steps[i+1]`; if `plan.steps[i].kind === "openActions"` and `plan.steps[i+1]?.kind === "pickAction"`, continue without toggling the sheet.
- After calling `ctx.pick(key)`, bump the post-step settle delay from 60ms → 120ms so React can flush state from sheet-close + dispatched handler before the next step runs. (Keeps responsiveness; fixes occasional dropped second-step actions.)

#### 5. (No DB / auth / schema changes.)

### Files touched
- `src/pages/Checklist.tsx` — replace 🏠 long-press handlers with tap-to-toggle, keep early returns to suppress navigation on toggle taps.
- `supabase/functions/magic-steps-plan/index.ts` — extend SYSTEM prompt with the "single pickAction" rule and explicit fuzzy mapping table.
- `src/lib/magicExecutor.ts` — collapse redundant `openActions → pickAction` and bump inter-step delay to 120ms.

### Why this has the highest probability of success
- **Tap-to-toggle is a 10-line UI change** with no async edge cases — the recording pipeline (`startMagicRecording` / `stopMagicRecording`) is already proven to work; we're only changing how it's triggered.
- **The button-press bug is fixed both server-side AND client-side**: even if the model occasionally still emits `openActions + pickAction`, the executor now collapses that pair, so we get correct behavior either way (defense in depth).
- The expanded fuzzy mapping table in the prompt closes the gap where the model previously guessed at action strings the executor's whitelist rejected.
- Zero risk to existing media-generation flows (the seven media keys keep their full sequence).