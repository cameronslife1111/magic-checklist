## Goal
Long-press the 🏠 home button → record voice → transcribe → show editable review pop-up (with optional context/checklists attached) → send to a "Magic Steps" AI assistant that loosely parses intent and executes one or many app actions in sequence (open Actions sheet, pick Video-to-video, set 9:16, attach context, generate; check off N items below the highlighted one; etc.). While running, the screen edges pulse green/blue/yellow/pink. On completion show a success/failure toast.

## First-principles reasoning

**1. Where to hook the long-press.**
The 🏠 button already exists in `src/pages/Checklist.tsx` (lines ~1116–1134) as a plain `onClick`. The neighboring "Actions" button already implements a clean long-press pattern using `onPointerDown` + `setTimeout` + `onPointerUp`/`onPointerLeave`/`onPointerCancel` + a `firedRef` flag (lines ~1073–1115). We mirror that pattern exactly so behavior is consistent: short tap = current home behavior, ≥500ms hold = start voice capture and turn the button red.

**2. How to capture audio.**
Browsers reliably support `MediaRecorder` with `audio/webm;codecs=opus` or `audio/mp4` (Safari). We don't need streaming transcription — the user explicitly wants a "stop → review pop-up" flow, so a single batch transcription after stop is simpler and more reliable than realtime. We send the recorded blob to a new `transcribe-voice` edge function which uses the existing `OPENAI_API_KEY` secret to call Whisper (`whisper-1`) — already in the project, no new secret needed.

**3. How the assistant performs actions safely.**
We already have a single dispatch surface: `onPick(k: ActionKey)` in `src/pages/Checklist.tsx` (the `switch` around line 400+). Every user-visible button funnels through it. So the "Magic Steps" assistant doesn't need to control DOM/clicks — it just emits a **typed plan** (a list of `{ step }` instructions) and a small executor calls the same handlers any button would. This is dramatically more reliable than DOM automation, matches the existing architecture, and works even when sheets/dialogs aren't mounted yet.

We use the **Lovable AI Gateway** with `openai/gpt-5.2` and **tool/structured-output calling** (per the repo's AI Gateway docs) to force a typed plan. Free, already wired via `LOVABLE_API_KEY`.

**4. Loose pattern matching.**
The assistant prompt embeds the full app capability map (every `ActionKey`, all aspect ratios, durations, character orientations, etc.) plus the *current* checklist snapshot (titles, item texts, which is highest unchecked, which are checked, position of the yellow item). The model handles fuzzy phrasing — "the video to video button" → `video-video`, "9 by 16" → `aspectRatio: "9:16"`, "after the yellow highlighted one" → resolves to item ids using the snapshot. We also ship a deterministic fallback `fuzzyMatchActionKey()` (lowercased, removes "the/button/please", token Jaccard against label) used when the model returns an unknown key — defensive belt-and-suspenders.

**5. Multi-step orchestration.**
Many requests chain (open sheet → pick action → set option → attach context → generate). We model this as a flat list of typed steps that the executor runs sequentially with small awaits between them so React can flush state. Steps are typed (discriminated union), not freeform — the AI can only emit known shapes. Examples: `openActions`, `pickAction`, `setMediaOption`, `attachContextChecklist`, `attachContextMedia`, `generate`, `checkItems`, `uncheckItems`, `splitCurrent`, `splitByEmoji`, `combineChecked`, `addItem`, `editItemText`, `openChecklist`, `navigate`, `setBackground`, `setTheme`, `mute`/`unmute`, `editTitle`, `newChecklist`, `duplicateChecklist`, `deleteChecklist`, `rearrangeMode`, `copySentence`, `copyChecklist`.

**6. Visual feedback.**
A fixed full-viewport `pointer-events-none` overlay with a thick gradient ring on the inner edges, animated via Tailwind/keyframes cycling green → blue → yellow → pink. Mounted only while `executing` is true. Recording state additionally turns the 🏠 button background red and adds a subtle pulsing red ring on the button itself.

**7. Editable review pop-up.**
A new `MagicCommandDialog` opens automatically when recording stops. It contains:
- The transcript in a `Textarea` (fully editable).
- A `ContextAttacher` (already exists) so the user can attach checklists / media just like they can for AI actions.
- "Cancel" and "Send to Magic Steps" buttons.
- A small status footer ("Transcribing…" while waiting on the edge function; "Sending…" while the planner is running).

## Changes

### 1. New edge function `supabase/functions/transcribe-voice/index.ts`
- POST `multipart/form-data` with `audio` file.
- Validates JWT? No — keep verify_jwt=false (matches other functions in the project) and rely on the user already being authed in the app.
- Forwards to OpenAI: `POST https://api.openai.com/v1/audio/transcriptions` with `model=whisper-1`, `response_format=json`. Uses `OPENAI_API_KEY` (already configured).
- Returns `{ text: string }` or `{ error }`. Standard CORS headers (mirror `openai-text/index.ts`).

### 2. New edge function `supabase/functions/magic-steps-plan/index.ts`
- POST JSON: `{ utterance, transcript, contextChecklists, contextMedia, snapshot }` where `snapshot` is the compact app/checklist state the client builds (current checklist title+id, all items with `{id, text, checked, isHighest}` truncated to ~80 chars, list of all the user's checklists `{id,title}`, current theme, muted state, current route).
- Uses **Lovable AI Gateway** at `https://ai.gateway.lovable.dev/v1/chat/completions` with `LOVABLE_API_KEY` (already configured), `model: "openai/gpt-5.2"`, `reasoning: { effort: "medium" }`.
- Tool-calling forced output: a single tool `emit_plan` with parameters:
  ```ts
  { steps: Array<Step>, summary: string, clarifying_question?: string }
  ```
  where `Step` is a JSON-schema enum union over all step kinds (see "Step types" below).
- System prompt embeds the full capability catalog (all ActionKeys + their human labels, allowed media options per AI action, allowed aspect ratios, etc.) and instructs the model to:
  - Resolve fuzzy references against the snapshot (e.g., "the yellow one" → the item with `isHighest: true`).
  - When the user says "check off the next 3 sentences after the yellow one", emit a single `checkItems` step with the resolved item ids.
  - Emit `clarifying_question` instead of guessing if intent is genuinely ambiguous (e.g., two checklists named similarly when picking one to attach).
- Handles 429 / 402 from the gateway by surfacing them to the client (matches the documented pattern).

### 3. New file `src/lib/magicSteps.ts`
- Exports the `Step` discriminated union (kept in sync with the edge function's tool schema — single source of truth lives here, the edge function imports the same shape via duplicated TS types, since edge functions can't import from `src/`).
- Exports `buildAppSnapshot({ checklist, items, allChecklists, theme, muted, route })` returning the compact JSON the planner sees.
- Exports `fuzzyMatchActionKey(label: string): ActionKey | null` — token-overlap match against the static label table from `ActionsSheet.tsx` (we re-export the label map from there). Used as a fallback when the model emits a non-canonical key.

### 4. New file `src/lib/magicExecutor.ts`
- `runPlan(steps, ctx)` where `ctx` exposes typed callbacks the page wires up: `pick(actionKey)`, `setActionsOpen(bool)`, `openMediaDialog(action, sourceItem, opts)`, `setPendingContext`, `confirmEnqueue`, `setItemsChecked(ids, checked)`, `editItemText(id, text)`, `addItem`, `splitCurrent`, `splitByEmoji`, `combineChecked`, `openChecklist`, `navigate`, `setTheme`, `setMuted`, `setBackgroundColor`, etc. — basically thin wrappers around things `Checklist.tsx` already does.
- Sequential `for` loop with small `await new Promise(r => setTimeout(r, 80))` between steps so React can re-render dialogs/sheets before the next step runs.
- Per step: try/catch; on error returns `{ ok: false, failedAtIndex, error }` and stops; otherwise `{ ok: true, completed: n }`.

### 5. New component `src/components/MagicCommandDialog.tsx`
- Props: `{ open, recording, transcribing, sending, transcript, onTranscriptChange, attachedContext, onAttachedContextChange, userId, onCancel, onSend }`.
- While `recording`: shows a big red mic indicator + animated bars + "Tap stop to review" + a Stop button (clicking Stop is the only way to leave recording state from inside the dialog; the long-press release on the home button is the primary stop trigger but the dialog is also a stop).
- After stop, while `transcribing`: shows skeleton + "Transcribing…".
- Once transcribed: shows editable `Textarea` (auto-focused, sized to content), the `ContextAttacher`, and "Cancel" / "Send to Magic Steps" buttons.
- While `sending`: disables buttons, shows "Magic Steps is working…".

### 6. New component `src/components/MagicGlowOverlay.tsx`
- `{ active: boolean }` → renders a `fixed inset-0 z-[60] pointer-events-none` div with a thick inset ring using a CSS keyframe animation that cycles `--glow-color` through `#22c55e → #3b82f6 → #eab308 → #ec4899` over ~3s, with a soft outer/inner blur. Defined locally with a `<style>` block scoped via a unique className (no Tailwind config edits needed).

### 7. `src/components/ActionsSheet.tsx`
- Export a `LABELS: Record<ActionKey, string>` object derived from `STATIC_ITEMS` plus the dynamic items, so `magicSteps.ts` and the planner prompt builder can share the canonical label list without duplication.

### 8. `src/pages/Checklist.tsx` — wiring (the bulk of the change)
- Add state: `magicOpen`, `magicRecording`, `magicTranscribing`, `magicSending`, `magicExecuting`, `magicTranscript`, `magicContext` (separate from `pendingContext` to avoid collisions with the existing AI-action flow), and refs for `MediaRecorder` + recorded chunks + a `homeLongPressTimerRef` + `homeLongPressFiredRef`.
- New helpers:
  - `startMagicRecording()`: requests `getUserMedia({ audio: true })`, creates `MediaRecorder`, opens `MagicCommandDialog` with `recording=true`. On permission denial → toast + abort.
  - `stopMagicRecording()`: stops recorder, collects blob, posts to `transcribe-voice` via `supabase.functions.invoke("transcribe-voice", { body: formData })` (using fetch with the function URL since `invoke` doesn't always handle `multipart`), sets `magicTranscript`.
  - `sendMagicCommand()`: calls `supabase.functions.invoke("magic-steps-plan", { body: { transcript, context, snapshot } })`. On success: closes dialog, sets `magicExecuting=true` (mounts overlay), runs `runPlan(plan.steps, ctx)`, on completion sets `magicExecuting=false` and toasts `"Magic Steps completed"` (or shows `clarifying_question` in a follow-up toast/dialog).
- Replace the 🏠 button's `onClick` with the long-press pattern (mirroring the Actions button):
  - `onPointerDown`: arm 500ms timer; on fire → set `homeLongPressFiredRef=true`, turn the button red (controlled by `magicRecording` state), call `startMagicRecording()`.
  - `onPointerUp`/`onPointerLeave`/`onPointerCancel`: clear timer; if `firedRef && magicRecording` → `stopMagicRecording()` (don't trigger the original short-tap nav). If not fired → run the existing top-checklist navigation.
- Apply `bg-red-500 hover:bg-red-500 animate-pulse` (or equivalent) to the 🏠 button while `magicRecording`.
- Mount `<MagicGlowOverlay active={magicExecuting || magicRecording} />` once at the root of the page (use different intensities — recording = red-only static glow, executing = full color cycle).
- Build the executor `ctx` once via `useMemo` exposing the existing handlers (lots of them already exist: `splitCurrent`, `combineCheckedItems`, `openChecklist`, `setTheme`, `setMuted`, `setReorderMode`, `duplicateCurrentItem`, etc.) and small new helpers where missing (e.g., `setItemsCheckedById(ids, val)` which does an optimistic `setItems` + bulk Supabase `update().in("id", ids)`).

### 9. `supabase/config.toml` — verify_jwt
- Add explicit `[functions.transcribe-voice]` and `[functions.magic-steps-plan]` blocks with `verify_jwt = false` to match the rest of the project's edge functions.

### 10. Step types (single source of truth)
Defined in `src/lib/magicSteps.ts` and mirrored in `magic-steps-plan/index.ts` JSON schema:
```ts
type Step =
  | { kind: "openActions" }
  | { kind: "closeActions" }
  | { kind: "pickAction"; action: ActionKey }
  | { kind: "openMediaAction"; action: "text-image"|"image-image"|"remix"|"image-video"|"video-video"|"audio-image-video"|"analyze-image"; sourceItemId?: string; opts?: Partial<GenOptions> }
  | { kind: "setMediaOption"; field: keyof GenOptions; value: any }
  | { kind: "attachContextChecklist"; checklistId: string }
  | { kind: "attachContextMedia"; mediaPaths: string[] }
  | { kind: "generate" }            // confirms the current media dialog
  | { kind: "checkItems"; ids: string[] }
  | { kind: "uncheckItems"; ids: string[] }
  | { kind: "addItem"; text: string; afterId?: string }
  | { kind: "editItemText"; id: string; text: string }
  | { kind: "splitCurrent" } | { kind: "splitByEmoji" } | { kind: "combineChecked" }
  | { kind: "openChecklist"; id: string }
  | { kind: "newChecklist"; title: string }
  | { kind: "duplicateChecklist"; title?: string }
  | { kind: "deleteChecklist" }
  | { kind: "navigate"; to: "/"|"/queue"|"/media" }
  | { kind: "setTheme"; theme: "light"|"dark" }
  | { kind: "setMuted"; muted: boolean }
  | { kind: "setBackground"; color: string }
  | { kind: "rearrangeMode"; on: boolean }
  | { kind: "copySentence" } | { kind: "copyChecklist" }
  | { kind: "speak"; text: string }
  | { kind: "wait"; ms: number };
```

## Behavior details

- **Permission**: if mic permission is denied, toast `"Microphone permission needed for voice commands."` and abort.
- **Empty transcript**: if Whisper returns empty text, keep the dialog open with an empty textarea so the user can type instead — the assistant works equally well with typed input.
- **Cancel during recording**: pressing Stop in the dialog without speaking → close dialog, no AI call.
- **Cancel during planning**: a Cancel button on the "Magic Steps is working…" footer aborts the in-flight `fetch` (AbortController) and stops execution between steps.
- **Multiple checklists with same name**: planner emits `clarifying_question` and we surface it as a toast + reopen the dialog with the question prefilled above the textarea.
- **Failure mid-plan**: stop, toast `"Magic Steps stopped at step N: <reason>"` and turn off the glow.

## Out of scope (to keep this shippable)
- No streaming transcription (batch-only).
- No persistent log of past commands (could be added later by writing to a new table).
- No voice activity auto-stop — user controls start/stop via the long-press / dialog Stop button.
- No DOM-level click automation — everything routes through typed handlers, which is both safer and more reliable.

## Files touched

**New:**
- `supabase/functions/transcribe-voice/index.ts`
- `supabase/functions/magic-steps-plan/index.ts`
- `src/lib/magicSteps.ts`
- `src/lib/magicExecutor.ts`
- `src/components/MagicCommandDialog.tsx`
- `src/components/MagicGlowOverlay.tsx`

**Modified:**
- `src/pages/Checklist.tsx` (long-press wiring on 🏠, state, executor ctx, overlay mount)
- `src/components/ActionsSheet.tsx` (export `LABELS` map)
- `supabase/config.toml` (function blocks for the two new functions)
