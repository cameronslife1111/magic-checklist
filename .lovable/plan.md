## First-principles diagnosis

The Kling V3 Motion-Control schema is tiny and we're hitting all of it correctly:

```
prompt, image_url, video_url, keep_original_sound, character_orientation, elements?
```

Yet Fal returns **422 Unprocessable Entity** at submit time. 422 = the JSON parsed fine but a field value was rejected. Looking at the schema's hard rules, three things can produce 422 here:

1. **Video duration vs orientation mismatch** (by far the most likely) — the docs are explicit:
   > *"Duration limit depends on character_orientation: 10s max for 'image', 30s max for 'video'."*
   Our dialog defaults `character_orientation` to `"image"`, so any reference clip longer than **10 seconds** is rejected. A user uploading a typical 15–30s clip will always 422.
2. **`video_url` host rejected** — Fal sometimes refuses Supabase storage URLs (CORS/HEAD probe quirks). Re-uploading the asset to Fal's own storage avoids this entirely.
3. **`elements` shape** — only relevant when `character_orientation='video'` and an element image is picked. Not the cause of the current failure (orientation defaults to `image`).

The deeper bug is **observability**: when Fal 422s, our `fal-video` returns `"fal error 422: <truncated>"`, then `process-action-queue` wraps that in `error_raw`, then the LLM "explainer" rewrites it into a meaningless `"Ensure you are sending a valid video"`. The actual Fal validation message (which would tell us exactly what's wrong) is *thrown away*. That's why we've been guessing.

## The fix

### 1. Always upload the reference video to Fal storage before submit
In `supabase/functions/fal-video/index.ts > handleSubmit`, treat the V2V `video_url` the same way we already treat data URLs: upload to Fal's `rest.alpha.fal.ai/storage` and submit the returned `file_url`. Same for `image_url` (the reference image) and the optional `elementImageUrl`. This eliminates host-rejection 422s and matches what the official `@fal-ai/client` SDK does internally.

  - Add a small `hostOnFal(falKey, url)` helper: fetch the asset → upload to Fal → return Fal-hosted URL. If the URL is already on `*.fal.media` or `*.fal.ai`, pass it through unchanged.
  - Run image, video, and element through it before building the body.

### 2. Preserve and surface the real Fal error message
- In `fal-video` `handleSubmit`, when Fal returns non-2xx, parse the body as JSON when possible and return the structured `detail`/`message` field (Fal's 422 bodies look like `{"detail":[{"loc":["body","video_url"],"msg":"video duration ... exceeds 10s","type":"value_error"}]}`). Return that as `error` instead of the raw blob.
- In `process-action-queue` `runJob`, when the submit call fails, write the **raw Fal error verbatim** into `action_jobs.error_raw` *before* invoking the LLM explainer. Then pass that raw text to `explainErrorInline` so the dashboard's "What went wrong" / "Fix" reflects the actual root cause (e.g. "Your reference video is longer than 10 seconds for the chosen orientation. Switch orientation to 'video' or trim the clip to ≤10s.").

### 3. Client-side guard rail in `MediaActionDialog.tsx`
For `mode === "video-video"`, when the user selects a reference video asset:
- If `media_assets.duration_seconds` is known and the chosen `characterOrientation === "image"` and `duration > 10`, show an inline warning *"Reference video is {N}s — exceeds 10s limit for 'Image' orientation. Switch to 'Video' orientation (≤30s) or pick a shorter clip."* and disable the Generate button until they switch or replace.
- If duration is unknown (older row), do a one-shot client probe: `<video preload="metadata">` → read `duration` → cache by asset id for the dialog session.
- Same check for `character_orientation === "video"` with the 30s limit.

This turns the most common failure into a *prevented* failure rather than a 422 round-trip.

### 4. Element shape — defensive normalization
Per the docs: `elements: list<KlingV3ImageElementInput>`, max 1, only with `character_orientation='video'`, referenced as `@Element1` in the prompt. The exact field name isn't shown in the doc, but the broader `KlingV3ComboElementInput` (used by the standard model) accepts `image_url`, and the `MotionControlV3StandardRequest` example in the doc uses image-set semantics. Send `elements: [{ image_url: hostedElementUrl }]` (current shape) but **drop the field entirely** if `characterOrientation !== "video"` (we already do this) — and if Fal still rejects it, the new error-surfacing from step 2 will tell us exactly which field name to switch to in one round-trip instead of guessing blind.

### 5. Files touched
- `supabase/functions/fal-video/index.ts` — host-on-Fal for image/video/element URLs; better 422 parsing.
- `supabase/functions/process-action-queue/index.ts` — pass raw Fal error into `error_raw` *before* the LLM rewrite, so the dashboard shows the truth.
- `src/components/MediaActionDialog.tsx` — duration guard + inline warning for V2V.
- (No DB migration. No client API change. No changes to image-to-video, which is working.)

## Why this fixes your symptom

- If your test video was longer than 10s with the default "image" orientation, the **client guard will block** it before submission and tell you exactly what to do. No more 422.
- If Fal was rejecting the Supabase-hosted URL, **uploading to Fal's own storage** removes that failure mode entirely.
- If neither of the above were the cause, the **next failed run will report the real Fal validation message** in your action dashboard ("video duration exceeds…", "image_url not accessible…", "elements[0].image_url required…") — so even an unforeseen 4th cause becomes a one-shot fix instead of another guessing round.

This is the smallest set of changes that turns an opaque, intermittent 422 into either (a) a prevented user error with clear guidance, or (b) a self-explaining error message — without touching the parts of the pipeline (image-to-video, async polling) that are already working.