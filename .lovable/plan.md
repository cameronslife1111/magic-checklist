## Goal
Make submitted actions (especially multi-image → image) feel as fast as other AI sites, without changing the dashboard, the buttons, or any user-visible options.

## Root causes found

1. **Up to ~60s of dead time before any job starts.** `process-action-queue` only runs on a 1-minute pg_cron tick. A job submitted right after a tick waits a full minute before the model is even called.
2. **Gallery images are needlessly round-tripped through base64.** In `process-action-queue` → `image-image`/`remix`, each gallery `refImageUrl` is fetched and converted to a `data:` URL, then `lovable-image` decodes that data URL and **re-uploads the bytes to fal.ai**. Fal accepts public URLs directly, so we're doing: download → base64-encode → send across function boundary → base64-decode → upload to fal — for every reference image. With multi-image this dominates latency.
3. **Worker's `urlToDataUrl` is not chunked** (`String.fromCharCode(...new Uint8Array(buf))`), making large images slow and risky. The one in `lovable-image` is already chunked.
4. **Fal polling waits a flat 2s.** Image edits often finish in ~5–15s, so avg ~1s of pure idle wait per job.
5. **DB cancellation poll every 2s** for every running job adds load and can throttle the worker.

## Plan (no UI/feature changes)

### 1. Fire the worker immediately on enqueue (kills the ~60s cron lag)
- In `supabase/functions/enqueue-action/index.ts`, after a successful insert of a `pending` job, **fire-and-forget** a POST to `process-action-queue` (do not `await`; just log errors). The pg_cron tick stays as a safety net for missed/scheduled jobs.
- Result: a submitted job starts processing within ~1 second instead of up to 60.

### 2. Pass gallery image URLs straight through to fal (removes the biggest per-image cost)
- Extend `lovable-image` to accept a new `refImageUrls: string[]` field in addition to existing `refImages` (data URLs). When URLs are present, pass them directly to fal's `openai/gpt-image-2/edit` `image_urls` field — no fetch, no base64, no re-upload.
- In `process-action-queue` `image-image`/`remix` branch:
  - Stop calling `urlToDataUrl` on `p.refImageUrls` and on `ctx.imageUrls`.
  - Forward them to `lovable-image` as `refImageUrls` instead.
  - Keep legacy `refImages` (data URLs) support for any old queued jobs.
- Apply the same pattern to `text-image` (only when `ctx.imageUrls` is present).
- Apply to `fal-video` (`image-video` / `video-video`): accept `sourceUrl` directly and pass as `image_url` / `video_url` to fal without base64. Keep `sourceDataUrl` for backward compat.

### 3. Chunk the worker's `urlToDataUrl` (only used for the legacy/fallback paths now)
- Replace `btoa(String.fromCharCode(...new Uint8Array(buf)))` with the same chunked loop used in `lovable-image`. Prevents stack overflow and speeds up large blobs.

### 4. Faster, smarter fal polling
- In both `lovable-image` and `fal-video`, change the polling loop to: 1s for the first 10 polls, then 2s after that, capped at the same total wait. Image edits usually finish in the first window.

### 5. Reduce cancellation DB load
- Increase the cancellation poll interval in `process-action-queue` from 2s to 5s. Cancellation is user-initiated and 5s feels instant; this cuts DB hits 2.5×.

## Out of scope (per your request)
- No changes to the dashboard layout, buttons, tabs, status badges, or any options.
- No new features, no removed features.
- No DB schema changes.

## Expected outcome
- Multi-image → image: typically **~30–90s faster** end-to-end (no cron wait + no base64 round-trip of N images).
- Single image edits: **~10–60s faster** (mostly the cron-wait elimination).
- Text-text / web-search: **up to ~60s faster** start time.
- Video jobs: **~60s faster start** + smaller payloads to fal.

## Files to change
- `supabase/functions/enqueue-action/index.ts` — fire-and-forget worker kick.
- `supabase/functions/process-action-queue/index.ts` — pass URLs through, chunked encoder for fallback paths, slower cancel poll.
- `supabase/functions/lovable-image/index.ts` — accept `refImageUrls`, pass directly to fal; faster early polling.
- `supabase/functions/fal-video/index.ts` — accept `sourceUrl`, skip upload when given; faster early polling.