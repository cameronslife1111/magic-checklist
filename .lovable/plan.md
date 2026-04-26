## Goal
Replace the current Video-to-Video model (Luma Ray-2 Modify) with **`fal-ai/kling-video/v3/pro/motion-control`**. The new model requires **two** inputs — a reference **image** (appearance) and a reference **video** (motion) — plus character orientation and a few extra options. Output remains an `.mp4` URL that drops into the same checkbox UI (play + download), exactly like the working Image-to-Video flow.

## First-principles analysis
The Image-to-Video pipeline already works end-to-end:
1. `MediaActionDialog` collects user options + gallery assets
2. `Checklist.runMediaAction` packages a `payload` and enqueues the job
3. `process-action-queue` reads the job, calls `fal-video` edge function with the chosen model
4. `fal-video` submits to fal.run, polls, returns `{ url }`
5. Worker inserts a `checklist_items` row with `media_url` + `media_type:"video"` → checkbox shows it, MediaViewer plays + downloads

Only the inputs and the model endpoint differ for motion-control. So the change is **schema-shaped, not architectural** — extend the existing pipeline rather than build a parallel one.

### Motion-Control schema (per context doc)
- `image_url` (required) — reference image for appearance
- `video_url` (required) — reference video for motion (≤10s if `character_orientation="image"`, ≤30s if `"video"`)
- `character_orientation` ("image" | "video") — required choice
- `keep_original_sound` (bool, default true)
- `elements` (optional, only when `character_orientation="video"`) — single facial element image, referenced as `@Element1`
- `prompt` (optional text)

## Proposed Technical Changes

### 1. `supabase/functions/fal-video/index.ts`
- For `sourceKind === "video"`, switch model from `fal-ai/luma-dream-machine/ray-2/modify` to **`fal-ai/kling-video/v3/pro/motion-control`**.
- New request body for video branch:
  - `image_url`: hosted URL of the reference image (uploaded via existing `uploadToFal` helper if a data URL is supplied)
  - `video_url`: hosted URL of the reference video (existing path)
  - `character_orientation`: from request
  - `keep_original_sound`: from request
  - `elements`: `[{ image_url: <hosted url> }]` when supplied AND orientation is `"video"`
  - `prompt`: passthrough
- Drop `aspect_ratio` from the video branch (motion-control doesn't accept it).
- Keep the existing 8-min polling window and the `result.video.url` extractor.

### 2. `src/components/MediaActionDialog.tsx`
- Add a new conditional UI block when `mode === "video-video"`:
  - **Reference image** picker (single, kind=image) — required
  - **Reference video** picker (single, kind=video) — required (already covered by the existing `assets` flow)
  - **Character orientation** `<Select>`: "Match reference image (camera moves, ≤10s)" / "Match reference video (complex motion, ≤30s)"
  - **Keep original sound** `<Switch>` (default on)
  - **Facial element image** picker (single, kind=image, optional) — disabled with helper text unless orientation is `"video"`
- Hide the Aspect Ratio + Quality selects in `video-video` mode (motion-control ignores them).
- Extend `GenOptions` with: `referenceImageAsset`, `characterOrientation`, `keepOriginalSound`, `elementImageAsset`.
- Validate on submit: both reference image and reference video must be selected.

### 3. `src/pages/Checklist.tsx` (`runMediaAction`)
- For `action === "video-video"`, build payload:
  - `prompt` (item text)
  - `sourceUrl` = reference video URL (motion source)
  - `imageUrl` = reference image URL (appearance source)
  - `characterOrientation`, `keepOriginalSound`
  - `elementImageUrl` (optional, only when orientation is `"video"`)
  - Drop `aspectRatio` / `quality` for this action.

### 4. `supabase/functions/process-action-queue/index.ts`
- In the `image-video | video-video` branch, when `action_type === "video-video"`, forward the new fields to `fal-video`:
  - `imageUrl: p.imageUrl`
  - `characterOrientation: p.characterOrientation`
  - `keepOriginalSound: p.keepOriginalSound`
  - `elementImageUrl: p.elementImageUrl`
- Continue NOT sending `aspectRatio` for `video-video`.

## What stays the same (and why)
- **Checkbox rendering / play / download**: motion-control returns the same `{ video: { url } }` shape, so the existing `media_url` + `media_type:"video"` insert and `MediaViewer` flow Just Work — no UI changes there.
- **Enqueue → recurrence → cancel → rerun**: all live in the generic job pipeline; no special-casing needed.
- **Auth, RLS, storage**: unchanged. The output URL is still a fal-hosted URL written to `media_url`.

## Validation plan after implementation
1. Pick a checklist item, run "Video to video" → confirm dialog requires image + video + orientation.
2. Submit → watch action queue → confirm a new checkbox appears with a playable `.mp4`.
3. Click the video → MediaViewer opens → Download works.
4. Try `character_orientation="video"` with an element image → confirm it submits without error.
5. Re-run the same job from Action Queue → confirm it produces a new video the same way.
