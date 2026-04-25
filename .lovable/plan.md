## Goal
Swap **image-to-image** and **remix multiple images** to OpenAI's **GPT Image 2 Edit** via fal (`openai/gpt-image-2/edit`), using the existing `FAL_KEY`. Text-to-image stays on the already-swapped `openai/gpt-image-2`. Image-video, video-video, and analyze-image stay unchanged. Action Queue (Now / Schedule / Recurring) keeps working unchanged because the swap happens inside the existing `lovable-image` edge function — same `{ dataUrl }` response shape, so `process-action-queue` and the UI need no changes.

## Changes

### 1. `supabase/functions/lovable-image/index.ts`
Update the branch where `refImages` is present (image-image / remix) to call fal's gpt-image-2 edit endpoint instead of the Lovable AI Gateway / Nano Banana path.

- **New helper `editWithGptImage2Edit(prompt, aspectRatio, refImages)`**:
  - Use `FAL_KEY` (already configured).
  - POST to `https://queue.fal.run/openai/gpt-image-2/edit` with:
    - `prompt`: passed-through prompt (already includes any context block from the worker).
    - `image_urls`: the `refImages` array (already data URIs / URLs), capped at **16** items (matches the model max and what the UI already enforces).
    - `image_size`: mapped from `aspectRatio` using the existing `ASPECT_TO_SIZE` map; if `aspectRatio` is missing, send `"auto"` so the model infers from the input images.
    - `quality: "high"` (consistent with the text-to-image swap).
    - `num_images: 1`, `output_format: "png"`.
  - Reuse the existing `pollFal(...)` helper for `status_url` / `response_url`.
  - Take `result.images[0].url`, fetch it via the existing `urlToDataUrl(...)` helper, and return the base64 `dataUrl`.
- **Replace** the `generateWithNanoBanana(...)` call in the `hasRefs` branch of the `Deno.serve` handler with the new helper. Keep `generateWithNanoBanana` deletable (remove it to avoid dead code).
- **Error handling**: surface 429 / 402 / generic errors with the same status codes the function already uses. (The fal queue endpoint returns standard HTTP codes; map non-OK submit responses to 500 with the truncated body, matching the text-to-image branch.)
- **Response shape unchanged**: `{ dataUrl }` — so callers (`process-action-queue` and the client) don't need any changes.

### 2. No other code changes
- **`process-action-queue/index.ts`**: already calls `lovable-image` for `image-image` and `remix` with `refImages` (capped at 16 by `.slice(0, 16)`), uploads the returned `dataUrl` to the `generated-media` bucket, and inserts a checklist item with `media_type: "image"`. This continues to work unchanged for **Now**, **Schedule**, and **Recurring**.
- **`MediaActionDialog.tsx` / `ContextAttacher.tsx`**: continue to collect refs and aspect ratio (still respected). Quality is silently overridden to `high` for the edit model — the field is still sent so other flows are unaffected.
- **Action Queue dashboard**: no schema changes; jobs already display action_type `image-image` / `remix` and their results. Nothing to update there.
- **No DB migrations**, no `config.toml` change (function already deployed with `verify_jwt = false`), no client changes.

## Out of scope
- BYOK variant (`openai_api_key` field) — not needed; the standard fal-managed `openai/gpt-image-2/edit` works with the existing `FAL_KEY`.
- Any change to text-to-image, image-video, video-video, or analyze-image.
- Mask support (`mask_url`) — current UI doesn't expose masks.

## Verification after deploy
- Live smoke-test the function with a single ref image + prompt → confirm a PNG `dataUrl` comes back.
- Run a Now image-image action from the UI → verify a new checklist item appears with the edited image.
- Run a Now remix with 3+ ref images → verify the result.
- Schedule a remix 1 minute out → verify the cron worker processes it and inserts the image.
