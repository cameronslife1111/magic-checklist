## Root cause (first principles)

I pulled the failed job from the database. There are actually **two stacked bugs**, not one:

### Bug A — "no video url returned" (your latest run)
`fal-video` parses the result with:
```ts
const url = result?.video?.url ?? result?.output?.video?.url ?? result?.url;
```
For Kling V3 Pro **motion-control**, Fal's queue response wraps the payload differently — the URL commonly lives at `result.data.video.url`. When none of the three paths match, we throw "no video url returned" without ever logging the raw shape, so we've been flying blind.

### Bug B — 150 s hard ceiling (the deeper, structural bug)
The previous V2V job (22 min earlier) failed with:
> `fal-video 504: {"code":"IDLE_TIMEOUT","message":"Request idle timeout limit (150s) reached"}`

`process-action-queue` calls `fal-video` synchronously and waits. `fal-video` then blocks for up to 8 minutes polling Fal. **Supabase edge functions hard-cap function-to-function calls at ~150 s**, so any Kling V3 Pro Motion-Control job (typical runtime 3–6 min) is mathematically guaranteed to fail this way. I2V occasionally squeaks under the cap, which is why it "works." This is the real, repeatable failure — Bug A is just what happens on the rare occasion the synchronous pattern doesn't time out first.

## The fix — async, queue-handle-based polling

Refactor so no single function call ever waits more than a few seconds for Fal. The job row itself becomes the state machine.

### 1. DB migration — store the Fal queue handle on the job
Add three nullable columns to `action_jobs`:
- `provider` text — e.g. `"fal"`
- `provider_request_id` text — Fal request id
- `provider_status_url` / `provider_response_url` text — the queue URLs Fal returns at submit time

(One migration, no data backfill needed.)

### 2. Rework `supabase/functions/fal-video/index.ts` into two modes
- `mode: "submit"` — uploads the source if needed, POSTs to `queue.fal.run/<model>`, returns `{ request_id, status_url, response_url }` immediately. No polling. Always returns in <10 s.
- `mode: "poll"` — given a `status_url`/`response_url`, checks once. Returns `{ status: "IN_PROGRESS" | "COMPLETED" | "FAILED", url? }`. **Critically**, on `COMPLETED` it now reads the URL from **all known shapes**: `result?.video?.url ?? result?.output?.video?.url ?? result?.data?.video?.url ?? result?.url`, and on miss logs `JSON.stringify(result).slice(0, 1000)` so we can never be blind again.

### 3. Rework `process-action-queue` for video jobs
Split the `image-video` / `video-video` / `audio-image-video` branches into a two-phase flow:
- **First time the worker sees the job** (status `pending` → `running`): call `fal-video` (or `fal-avatar`) in `submit` mode, store the returned handle on the row, set status to `awaiting_provider`, return.
- **Subsequent cron ticks**: select jobs where `status = 'awaiting_provider'` AND `provider = 'fal'`, call the function in `poll` mode. If `IN_PROGRESS`, leave it. If `COMPLETED`, run the existing `insertResultItem` + mark `completed`. If `FAILED`, mark failed with the real error.

This means the worker never holds an open connection longer than a few seconds, and Kling V3 Pro Motion-Control (which can legitimately take 6 minutes) finishes correctly across however many cron ticks it needs.

### 4. Apply the same pattern to `fal-avatar` (HeyGen)
HeyGen Avatar 4 has the same 5-min runtime profile and the same 150 s problem waiting in the wings. Refactor it identically (`submit` / `poll` modes) so we don't have to re-fix this next time the user tests audio-image-video.

### 5. Keep the worker's batch query honest
Update the `select` in `process-action-queue` to include `awaiting_provider` so polled jobs get picked back up each tick, and add a `provider_polled_at` guard so we don't hammer Fal more than once per ~10 s per job.

### 6. UX: surface the real Fal error if `submit` fails inline
When Fal returns a 4xx at submit (bad reference image, content policy, etc.), bubble that string into `error_friendly` instead of "no video url returned".

## Files touched
- `supabase/migrations/<new>.sql` — add provider columns to `action_jobs`
- `supabase/functions/fal-video/index.ts` — split into submit/poll modes, fix URL extraction, log raw result on miss
- `supabase/functions/fal-avatar/index.ts` — same submit/poll split
- `supabase/functions/process-action-queue/index.ts` — two-phase flow for the three video action types; include `awaiting_provider` in the batch query
- (No client-side changes needed — `runMediaAction` and the dialog are already correct.)

## Why this fixes both your symptoms
- The 150 s timeout disappears because nothing waits that long anymore.
- "no video url returned" disappears because we read the correct response path AND log the raw shape if it ever drifts again.
- I2V keeps working (same code path, just async now).
- Audio-image-video gets the same robustness for free.
