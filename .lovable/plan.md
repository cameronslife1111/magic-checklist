## Goal
Add a new Action Sheet button — **"Audio + image to video"** — that takes a reference **image** (face) plus an **audio** clip (lip-sync source) and produces a talking-avatar `.mp4` via **`fal-ai/heygen/avatar4/image-to-video`**. The output appears in a new checkbox with the same play/download UX as the existing image-to-video flow.

## First-principles reasoning
The existing video pipeline has a clean shape we can reuse without changes:
1. **ActionsSheet** key → 2. **Checklist.runMediaAction** packages payload → 3. **enqueue-action** writes a job → 4. **process-action-queue** calls a generator edge function → 5. result `{ url }` is inserted as a `checklist_items` row with `media_type:"video"` → 6. **MediaViewer** plays + downloads.

The only model-specific difference for HeyGen Avatar 4 is the **inputs** (image + audio + a few options) and the **endpoint**. Cleanest approach: introduce a **new edge function `fal-avatar`** rather than overloading `fal-video`, because the input contract (audio_url, voice, talking_style, resolution, aspect_ratio, caption) is fundamentally different from Kling's image-to-video / motion-control schemas. Keeping them separate avoids branchy spaghetti and lets each model evolve independently.

Everything else (queue, recurrence, cancel, MediaViewer download) is generic and needs zero changes.

## Proposed Technical Changes

### 1. New edge function `supabase/functions/fal-avatar/index.ts`
- Mirror the structure of `fal-video` (CORS, `uploadToFal` for data URLs, `pollFal` with ~8 min budget).
- Endpoint: `https://queue.fal.run/fal-ai/heygen/avatar4/image-to-video`.
- Accept body: `{ imageUrl|imageDataUrl, audioUrl|audioDataUrl, prompt?, voice?, talkingStyle?, resolution?, aspectRatio?, caption? }`.
- Build request with: `image_url`, `audio_url` (audio overrides prompt+voice per docs), and pass through `talking_style`, `resolution`, `aspect_ratio`, `caption`. If `audio_url` missing, fall back to `prompt` + `voice`.
- Validate `image_url` is required; either `audio_url` or `prompt` must be present.
- Extract `result.video.url` (same shape Kling returns) → `{ url }`.
- Function deploys with `verify_jwt = false` like the other generators (no config.toml change needed beyond what's already there for `fal-video`).

### 2. `supabase/functions/process-action-queue/index.ts`
- Add a new `case "audio-image-video":` branch.
- Resolve `imageUrl` from payload (preferred) or `ctx.imageUrls[0]`; resolve `audioUrl` from payload or `ctx.audioUrls[0]`.
- Call `fal-avatar` with `{ prompt: buildPrompt(...), imageUrl, audioUrl, voice, talkingStyle, resolution, aspectRatio, caption }`.
- Insert result with `text: "Generated talking video"`, `media_type: "video"` — identical pattern to the existing video case so MediaViewer auto-handles play+download.

### 3. `src/components/ActionsSheet.tsx`
- Extend `ActionKey` with `"audio-image-video"`.
- Add it to `AI_KEYS` (renders blue) and to `STATIC_ITEMS` next to `image-video` / `video-video`:
  - label: `"Audio + image to video"`, icon: `Mic2` (lucide).

### 4. `src/components/MediaActionDialog.tsx`
- Extend `mode` union with `"audio-image-video"`.
- Add `GenOptions` fields: `audioAsset?: MediaAsset | null`, `talkingStyle?: "stable" | "expressive"`, `resolution?: "360p"|"480p"|"540p"|"720p"|"1080p"`, `caption?: boolean`. Reuse existing `aspectRatio` (HeyGen accepts `1:1 | 16:9 | 9:16` — restrict the Select when in this mode).
- New UI block when `mode === "audio-image-video"`:
  - **Reference image** picker (single, kind=image) — required (uses the existing `assets` flow, since `needsMedia=true` and `pickerKind="image"`).
  - **Audio clip** picker (single, kind=audio) — required, separate state + `MediaGalleryPicker` instance (kind="audio" already supported).
  - **Talking style** Select: stable / expressive (default stable).
  - **Resolution** Select: 360p…1080p (default 720p).
  - **Aspect ratio** Select limited to 1:1 / 16:9 / 9:16 (default 16:9).
  - **Captions** Switch (default off).
  - Hide the generic Quality select and Kling-specific blocks for this mode.
- Validate on submit: image asset AND audio asset both selected.

### 5. `src/pages/Checklist.tsx`
- Add `"audio-image-video"` to the `MediaAction` union, `MEDIA_LABELS`, the `DialogState` `media.action` union, and the action-sheet switch (route to the media dialog like other media actions).
- In `runMediaAction`, new branch:
  - `payload.imageUrl = assets[0].url` (the picked image)
  - `payload.audioUrl = opts.audioAsset.url`
  - `payload.talkingStyle`, `payload.resolution`, `payload.aspectRatio`, `payload.caption`
  - drop `quality`
- Title rendered in the dialog: `"Audio + image to video"`.

## What stays the same (and why)
- **Checkbox rendering, play, download**: `media_type:"video"` + `media_url` already triggers `MediaViewer` (which has the blob-download we built earlier). Zero UI work there.
- **Enqueue / schedule / recur / cancel / re-run**: all generic, driven by `action_type`. The new key flows through unchanged.
- **Auth / RLS / storage cleanup**: the output URL is a fal-hosted `.mp4` written to `media_url` exactly like existing video jobs. The deletion-cleanup helper we built earlier already handles it.

## Validation plan after implementation
1. Open Action Sheet → confirm "Audio + image to video" appears (blue) under the AI section.
2. Tap it → dialog requires image + audio + shows talking style / resolution / aspect / captions.
3. Submit "Now" → Action Queue shows `audio-image-video` running → completes → new checkbox appears with playable `.mp4`.
4. Click the video → MediaViewer opens → Download saves the file.
5. Re-run from Action Queue → produces a fresh video the same way.
6. Try a "later" / "recurring" schedule to confirm the generic queue path works.
