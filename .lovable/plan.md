## Root cause analysis (from first principles)

Two independent bugs are stacked on top of each other.

### Bug 1 — Edge Function 400: "Unknown parameter: 'reasoning'"
`supabase/functions/magic-steps-plan/index.ts` sends:
```json
{ "model": "openai/gpt-5.2", "reasoning": { "effort": "medium" }, ... }
```
The Lovable AI Gateway logs confirm every call returns:
```
gateway err 400 "Unknown parameter: 'reasoning'"
```
The gateway's chat-completions endpoint does not accept a top-level `reasoning` field for the `openai/gpt-5.2` model. That's why **every** Magic Steps send fails with "Edge function returned a non-2xx status code".

**Fix:** Remove the `reasoning` field from the request body. Keep model, messages, tools, and `tool_choice` exactly as-is. (GPT-5.2 already does internal reasoning; we don't need the extra parameter.)

### Bug 2 — Recording dialog blocks the app
Currently, the moment the user long-presses 🏠, `MagicCommandDialog` is opened with `recording=true`. Because it's a modal `Dialog`, it traps focus and blocks all interaction with the rest of the app — the user can't scroll, tap items, or open the actions sheet while explaining their command.

The user wants the opposite flow:
1. Long-press 🏠 → recording starts → only a **small floating Stop pill** appears (plus the existing red glow overlay). The rest of the app stays fully interactive.
2. User taps Stop → audio is sent to `transcribe-voice` → only then does `MagicCommandDialog` open with the transcript pre-filled, so they can edit, attach context, and Send.

## Plan

### 1. `supabase/functions/magic-steps-plan/index.ts`
- Delete the `reasoning: { effort: "medium" }` line from the gateway request body.
- Leave everything else (system prompt, tool schema, error handling) unchanged.

### 2. New component `src/components/MagicRecordingPill.tsx`
- A small fixed-position pill (bottom-center, above the home bar, `z-70`, `pointer-events-auto`) — NOT a dialog, so it doesn't trap focus.
- Shows a pulsing red mic dot + "Recording…" label + a "Stop" button.
- Props: `{ active: boolean; onStop: () => void }`.
- Uses Tailwind only; no portal/Dialog primitives.
- The existing `MagicGlowOverlay` (red variant) keeps providing the full-screen visual cue.

### 3. `src/pages/Checklist.tsx` — split the two phases
Currently one boolean (`magicOpen`) controls both recording and the review dialog. Separate them:
- Keep `magicRecording` state (already exists) to drive `MagicRecordingPill` + red `MagicGlowOverlay`.
- Only set `magicOpen = true` (which renders `MagicCommandDialog`) **after** transcription finishes successfully (in the `onStopRecording` handler, right after we receive `text` from `transcribe-voice`).
- Render `<MagicRecordingPill active={magicRecording} onStop={handleStopRecording} />` at the top level alongside the existing overlay.
- Do NOT render `MagicCommandDialog` while `magicRecording` is true; only render it when `magicOpen` is true and recording has stopped.
- The long-press handler on the 🏠 button keeps starting `MediaRecorder` + setting `magicRecording = true`, but no longer opens the dialog.
- If transcription fails, show a toast and reset state without opening the dialog.
- Cancel path: long-press again or a small "✕" on the pill aborts the recording without sending.

### 4. Optional polish
- While `magicRecording` is true, keep the home button visually "armed" (e.g., red ring) so the user knows another long-press would cancel — or just rely on the pill's Stop/Cancel.
- Ensure `stopSpeech()` is called when recording starts so TTS doesn't talk over the user (already done; verify it stays).

## Why this has the highest probability of success
- Bug 1 is a one-line server fix proven by the gateway's own error message — no guesswork.
- Bug 2 is a pure UI re-architecture that removes the modal trap; the underlying recording/transcription pipeline already works (the function boots cleanly in the logs), so we're only changing **when** the dialog mounts, not the data flow.
- No database, auth, or schema changes needed.
- All existing Magic Steps plan execution (`runPlan`, fuzzy matching, glow overlay) is untouched and keeps working.

## Files touched
- `supabase/functions/magic-steps-plan/index.ts` (remove `reasoning` field)
- `src/components/MagicRecordingPill.tsx` (new)
- `src/pages/Checklist.tsx` (split recording vs. review state, render pill, gate dialog)
