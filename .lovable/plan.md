## Goal
Swap the **text-to-image** action to OpenAI's **GPT Image 2** via fal (using the existing `FAL_KEY`). Image-image, remix, image-video, video-video, and analyze-image stay on their current models. The Action Queue (Now / Schedule / Recurring) keeps working unchanged because the swap happens inside the existing edge function — `process-action-queue` just calls `lovable-image` like today and inserts the resulting image URL into the checklist.

## Changes

### 1. `supabase/functions/lovable-image/index.ts`
Branch on the request: when there are **no `refImages`** (= text-to-image), call fal's `openai/gpt-image-2` queue. Otherwise keep the existing Lovable AI Gateway / Nano Banana path for edits & remix.

- Use `FAL_KEY` (already configured).
- Submit to `https://queue.fal.run/openai/gpt-image-2` with:
  - `prompt`: passed-through prompt (already includes any context block).
  - `image_size`: mapped from current `aspectRatio` → fal preset:
    - `1:1` → `square_hd`
    - `16:9` → `landscape_16_9`
    - `9:16` → `portrait_16_9`
    - `4:3` → `landscape_4_3`
    - `3:4` → `portrait_4_3`
  - `quality: "high"` (per your choice — ignore the standard/high UI toggle for this model).
  - `num_images: 1`, `output_format: "png"`.
- Poll the returned `status_url` / `response_url` (reuse the same poll pattern already used in `fal-video/index.ts`).
- Take `result.images[0].url`, fetch it, base64-encode it, and return `{ dataUrl }` — **same response shape as today**, so no caller changes needed.
- Surface 429 / 402 / generic errors with the same status codes as the current function.

### 2. No other code changes needed
- `process-action-queue/index.ts` already calls `lovable-image` for the `text-image` case and uploads the returned `dataUrl` to the `generated-media` bucket → inserts a checklist item with `media_type: "image"`. This continues to work unchanged for **Now**, **Schedule**, and **Recurring** jobs.
- `MediaActionDialog.tsx` continues to collect aspect ratio (still respected) and quality (silently overridden to high for text-to-image — the field is still sent so other flows are unaffected).
- No DB migrations, no config.toml change (function already deployed with `verify_jwt = false`), no client changes, no Action Queue dashboard changes.

## Out of scope (per your answer)
- Image-image and Remix stay on the current Nano Banana model. Fal's gpt-image-2 edit endpoint requires a separate OpenAI BYOK key, so we're not touching it.

## Verification after deploy
- Live smoke-test the function with a simple prompt and confirm a PNG `dataUrl` comes back.
- Run a Now text-to-image action from the UI → verify a new checklist item appears with the generated image.
- Schedule a text-to-image action 1 minute out → verify the cron worker processes it and inserts the image.
