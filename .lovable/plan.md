
## Goal
Switch the **Image → Video** action to **`fal-ai/kling-video/v3/pro/image-to-video`** (your FAL key, no new secrets). Expose all of V3 pro's user-facing options in the existing dialog *before* the user picks "Run now / Schedule / Recurring". Make the resulting video play and be downloadable from the checkbox.

## First-principles read of the current pipeline
1. **Dialog** (`MediaActionDialog`) collects options → calls `onGenerate(opts)`.
2. `runMediaAction` (`Checklist.tsx`) builds `payload`, then calls `requestEnqueue` → `ScheduleActionDialog` (now/schedule/recurring) → `enqueue-action`.
3. `process-action-queue` picks the job up and calls **`fal-video`** with `{ prompt, sourceUrl, sourceKind, aspectRatio }`.
4. `fal-video` posts to fal queue, polls until `COMPLETED`, returns `{ url }`.
5. Worker uploads / passes URL through → inserts a `checklist_items` row with `media_type: "video"`.
6. `ItemRow` already renders `<video>` thumbnails and opens `MediaViewer` on tap — that part already works. Only the **download** affordance is missing.

So this is purely additive plumbing: extra fields flow dialog → payload → fal-video body. No schema changes, no new secrets (FAL_KEY already configured).

## Changes

### 1. `supabase/functions/fal-video/index.ts` — switch model + accept new fields
- **Only for `sourceKind === "image"`** swap the model to `fal-ai/kling-video/v3/pro/image-to-video`.
- Build the body using V3 pro's schema (note the param name change `image_url` → `start_image_url`):
  ```ts
  if (sourceKind === "image") {
    body.start_image_url = hostedUrl;            // V3 pro uses start_image_url
    if (duration)        body.duration = String(duration);  // enum string "3"…"15"
    if (typeof generateAudio === "boolean") body.generate_audio = generateAudio;
    if (negativePrompt)  body.negative_prompt = negativePrompt;
    if (typeof cfgScale === "number") body.cfg_scale = cfgScale;
    if (endImageUrl)     body.end_image_url = endImageUrl;
    // V3 pro schema does NOT take aspect_ratio — omit it.
  } else {
    body.video_url = hostedUrl;                  // unchanged Luma path
    if (aspectRatio) body.aspect_ratio = aspectRatio;
  }
  ```
- Output parsing already handles `result.video.url` (V3 pro returns exactly that shape) — no change needed.
- Keep the existing polling loop. V3 pro can take a while; bump max polls from 120 → 240 (cap ~8 min) to be safe.

### 2. `src/components/MediaActionDialog.tsx` — show V3 pro options when mode is `image-video`
- Add to `GenOptions`:
  ```ts
  duration?: "3"|"4"|…|"15";
  generateAudio?: boolean;
  negativePrompt?: string;
  cfgScale?: number;        // 0–1
  endImageAsset?: MediaAsset | null;  // optional second image from gallery
  ```
- When `mode === "image-video"`:
  - **Hide** the "Quality" select (Kling V3 has no quality knob).
  - **Hide** "Aspect ratio" (V3 pro doesn't accept it).
  - **Show**:
    - **Duration** `<Select>` with options `3,4,5,6,7,8,9,10,11,12,13,14,15` (default `5`). Label "seconds".
    - **Generate audio** `<Switch>` (default ON, matches V3 default).
    - **Negative prompt** `<Textarea>` (small, default `"blur, distort, and low quality"`).
    - **CFG scale** `<Slider>` 0–1 step 0.05 (default 0.5) with the current value shown.
    - **End image (optional)** — a second "Choose from Media Gallery" button reusing `MediaGalleryPicker` (single, image kind). Shows the selected thumbnail chip with a small "✕ remove".
  - Pass all of these through `opts` to `onGenerate`.

### 3. `src/pages/Checklist.tsx` — forward new options into the payload
- In `runMediaAction`, when `action === "image-video"`, extend the payload:
  ```ts
  payload.sourceUrl     = assets[0].url;
  payload.duration      = opts.duration;
  payload.generateAudio = opts.generateAudio;
  payload.negativePrompt = opts.negativePrompt;
  payload.cfgScale      = opts.cfgScale;
  if (opts.endImageAsset) payload.endImageUrl = opts.endImageAsset.url;
  // aspectRatio intentionally NOT set for image-video.
  ```
- The schedule dialog (`ScheduleActionDialog`) is unchanged — Run now / Schedule / Recurring all work because they just attach `scheduled_for` / `recurrence` to whatever payload we hand them.

### 4. `supabase/functions/process-action-queue/index.ts` — pass the new fields through
In the `image-video` / `video-video` case, currently it builds `body = { prompt, sourceKind, aspectRatio }`. Extend so V3 pro fields flow to `fal-video`:
```ts
const body: any = {
  prompt,
  sourceKind: job.action_type === "video-video" ? "video" : "image",
};
if (job.action_type === "image-video") {
  if (p.duration)               body.duration = p.duration;
  if (typeof p.generateAudio === "boolean") body.generateAudio = p.generateAudio;
  if (p.negativePrompt)         body.negativePrompt = p.negativePrompt;
  if (typeof p.cfgScale === "number") body.cfgScale = p.cfgScale;
  if (p.endImageUrl)            body.endImageUrl = p.endImageUrl;
} else {
  if (p.aspectRatio) body.aspectRatio = p.aspectRatio;
}
if (sourceUrl) body.sourceUrl = sourceUrl;
else if (p.sourceDataUrl) body.sourceDataUrl = p.sourceDataUrl;
```
This keeps the `video-video` (Luma) path completely unchanged.

### 5. `src/components/MediaViewer.tsx` — make videos (and images) downloadable
The user explicitly asked: tap the checkbox media → opens viewer → can play and **download**.
- Add a small "Download" button (lucide `Download` icon) overlayed top-right of the dialog content.
- Implementation: fetch the URL as a blob, create an object URL, trigger a synthetic `<a download>` click, revoke the URL. This works around the cross-origin `download` attribute being ignored on direct `<a>` tags pointing at the Supabase Storage CDN.
  ```ts
  const handleDownload = async () => {
    if (!url) return;
    const r = await fetch(url);
    const blob = await r.blob();
    const ext = type === "video" ? "mp4" : type === "audio" ? "mp3" : "png";
    const obj = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = obj;
    a.download = `magic-checklist.${ext}`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(obj);
  };
  ```
- Wire it for image, video, and audio (all are already in the same dialog).

## Why this is correct end-to-end
- **Plays in the checkbox**: ItemRow already renders `<video src=… muted playsInline>` thumbnails; tapping opens `MediaViewer` with `controls autoPlay`. No change required there — V3 pro returns a standard `video/mp4` URL stored in our `generated-media` bucket via the worker's existing `out.url` → insert flow (the worker passes the URL straight through; `fal-video` returns `{ url }` from `result.video.url` which already matches).
- **Downloadable**: New explicit button in `MediaViewer` saves the file with the right extension regardless of CORS quirks.
- **All Kling V3 options are surfaced** before the user commits, exactly as requested, and the Schedule dialog still wraps "Run now / Schedule / Recurring" around the same payload — so a recurring job will recreate the video with identical options every interval (matches your earlier requirement that rerun/recurring use the *exact* same payload).
- **No new secrets** — uses the existing `FAL_KEY`. No DB migrations.
- **Video → video path is untouched**, so the Luma `ray-2/modify` flow keeps working as today.
