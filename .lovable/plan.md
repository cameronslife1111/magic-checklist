## Goal

Before choosing **Now / Later / Recurring**, the user can attach context that gets sent to the API alongside the source checkbox text. Context travels with the job — including for scheduled and recurring runs — and works even when the app is closed.

## First-principles design

**Two kinds of context, two storage strategies:**

1. **Text context = checklist references.** Store only an array of `checklist_id`s in `payload.context.checklists` (≤15). At execution time, the **worker re-fetches** their items fresh. Tiny payload, always current — ideal for recurring jobs.
2. **Media context = files.** Upload to the existing `generated-media` storage bucket the moment the user attaches them, then store `[{ url, type, name }]` in `payload.context.media` (≤15 each for image/video/audio). Worker fetches URLs at run time. Persists for scheduled/recurring runs even if the user closes the tab.

**Why upload immediately (not at "Run" time)?** If the user picks Schedule or Recurring, the local `File` object would be gone. Uploading on attach guarantees the job is self-contained the moment it's enqueued.

## Changes

### 1. New component: `src/components/ContextAttacher.tsx`
Renders the 4 buttons inside `ScheduleActionDialog` above the Now/Later/Recurring tabs:
- **Add Text Context** → opens a multi-select checklist picker (search + checkboxes, max 15). Stores selected `{id, title}` pairs.
- **Add Image Context** / **Add Video Context** / **Add Audio Context** → opens a hidden `<input type="file" accept="image/*|video/*|audio/*" multiple>` (max 15 each). On selection: upload each file to `generated-media/{user_id}/context/{uuid}.{ext}`, show progress + thumbnails, store `{url, type, name}` per item. Each chip has an X to remove (also deletes from storage).
- Shows live counts: "3 checklists · 2 images · 1 audio attached".

### 2. `src/components/ScheduleActionDialog.tsx`
- Accept a new prop `attachedContext` + `onContextChange`. Render `<ContextAttacher>` at the top of the dialog (above the Now/Later/Recurring buttons).
- `SchedulePick` payload unchanged — context is owned by the parent (`Checklist.tsx`), not the dialog, so it cleanly threads through to enqueue.
- Add a small `excludeChecklistId` prop so the current checklist isn't selectable as its own context.

### 3. `src/pages/Checklist.tsx`
- Extend `pendingEnqueue` state with `context: { checklists: string[]; media: { url: string; type: "image"|"video"|"audio"; name: string }[] }`.
- Initialize empty when any `requestEnqueue(...)` is called.
- Render the dialog with `attachedContext` + `onContextChange` wired up.
- In `submitEnqueue`, merge `context` into `payload.context` before calling `enqueue-action`.
- Reset context on close/cancel; keep it across switching Now/Later/Recurring tabs (same dialog session).

### 4. `supabase/functions/enqueue-action/index.ts`
- Validate optional `payload.context`:
  - `context.checklists`: array of UUIDs, max 15, must belong to the user (verified via RLS — the function already runs with the user's auth token, so a `select id from checklists where id in (...)` enforces ownership).
  - `context.media`: array of `{url, type, name}`, max 15 per type, URLs must be in the project's storage public URL prefix.
- Reject with 400 on violations. Otherwise pass through into `action_jobs.payload`.

### 5. `supabase/functions/process-action-queue/index.ts` — context resolution
Add a `resolveContext(supabase, job)` helper that runs before each action:
- For each `context.checklists` ID: fetch `checklist_items.text` ordered by position, join into a labeled block:
  ```
  ### Context from checklist "<title>"
  - item 1
  - item 2
  ```
- For each `context.media`: keep URLs grouped by type.

Then per action:
- **text-text / web-search**: prepend the text-context block to `payload.prompt`. For media context, append `Attached references:\n- <url> (<type>)` lines so the model can at least cite them.
- **text-image / image-image / remix**: prepend text context to prompt. Append all `image` context URLs to `refImages` (download URL → base64 in worker, since `lovable-image` expects data URLs).
- **image-video / video-video**: prepend text context to prompt. If video context exists and the source is missing, treat the first as `sourceDataUrl`; otherwise add as references in the prompt (fal-video doesn't take multiple inputs).
- **analyze-image**: prepend text context to prompt. If extra image context exists, the call already supports one image; pass the first attached as a secondary reference by mentioning its URL in the prompt (vision endpoint is single-image today; document this gracefully).

A small `urlToDataUrl(url)` helper in the worker does `fetch → blob → base64` for endpoints that need data URLs.

### 6. Storage cleanup (light)
- Context uploads live under `generated-media/{user_id}/context/...`. No automatic cleanup needed for v1 — they're cheap and the user explicitly attached them. Removing a chip in the dialog deletes the object via `supabase.storage.from("generated-media").remove([path])`.

### 7. UI polish
- The dialog grows in height; wrap context section in a max-height scroll area.
- Disable the action buttons (Now/Later/Recurring) while any media upload is in progress.
- Show a tiny "Context will be re-fetched fresh on each recurring run" hint when the recurring tab is active and text-context is attached.

## Out of scope (can follow up)
- Editing context on already-queued jobs.
- A dedicated "context library" for re-using attachments across actions.
- Token-budget warnings when text context is huge.