## The Problem (first principles)

Image generation hits `lovable-image 504: IDLE_TIMEOUT 150s`. Why?

1. Supabase Edge Functions enforce a **150s wall-clock idle limit** per request.
2. `lovable-image` does a **synchronous wait**: it submits to Fal's queue, then polls for up to ~230s before returning.
3. The worker (`process-action-queue`) calls `lovable-image` and *also* waits synchronously for that response.
4. When Fal's GPT Image 2 takes >150s (which happens regularly under load, especially for edits with multiple reference images), the gateway kills the connection → 504 → the job is marked failed even though Fal may still finish the image successfully a few seconds later.

The video pipeline (`fal-video`, `fal-avatar`) **already solved this exact problem** with a `submit` / `poll` two-phase handoff: the worker stores the Fal queue handle on the job row and the cron-triggered worker polls it on subsequent ticks. There is **no synchronous wait**, so 150s is a non-issue. Images need the same pattern.

## The Fix

Convert `lovable-image` to the same async submit/poll handoff used by `fal-video`, and route `text-image` / `image-image` / `remix` through the existing handoff machinery in `process-action-queue`.

### 1. `supabase/functions/lovable-image/index.ts` — add two modes

Keep the existing single-shot behavior for backward compatibility (one-off UI calls outside the queue), but add:

- **`mode: "submit"`** — POSTs to `https://queue.fal.run/openai/gpt-image-2` (or `/edit` when refs are present) and returns immediately with `{ request_id, status_url, response_url }`. No polling. Returns in <2s.
- **`mode: "poll"`** — given `{ statusUrl, responseUrl }`, does **one** `GET status_url`. If `COMPLETED`, fetches `response_url`, downloads the image, and returns `{ status: "COMPLETED", dataUrl }`. If `IN_PROGRESS`, returns `{ status: "IN_PROGRESS" }`. If `FAILED`, returns `{ status: "FAILED", error }`. Single round-trip, finishes in <5s — well under the 150s limit.

When `mode` is omitted, behave like today (used by any direct UI calls that aren't through the queue).

### 2. `supabase/functions/process-action-queue/index.ts` — handoff for images

In `runJob`, change the three image cases (`text-image`, `image-image`, `remix`) to:

1. Call `lovable-image` with `mode: "submit"` instead of waiting for the final image.
2. Return `{ kind: "handoff", provider: "lovable-image", status_url, response_url, request_id }` — exactly the same shape used today by `image-video` / `video-video` / `audio-image-video`.

In **PHASE 1 (poll handoff)** of the worker (around line 1082), extend the dispatch so that when `j.provider === "lovable-image"` it calls `lovable-image` with `mode: "poll"` instead of `fal-video` / `fal-avatar`. On `COMPLETED`, run the existing image post-processing path:

- `uploadDataUrl(...)` → Storage
- `registerGeneratedAsset(...)` → Media Gallery (`Generated image` / `Edited image` / `Remixed image` based on the original `action_type`)
- `insertResultItem(...)` → checklist row with `media_url` + `media_type: "image"`

Mark the job `complete`. On `FAILED`, route through the existing failure path (which already calls `explainErrorInline`). On `IN_PROGRESS`, leave it as `awaiting_provider` to be polled on the next tick.

The handoff record in `action_jobs` already has the right columns (`provider`, `provider_status_url`, `provider_response_url`, `provider_request_id`, `provider_polled_at`) — no schema change needed.

### 3. Sequence runner (`tickSequence`)

The sequence runner dispatches each step through the same `runJob` path and already handles `kind: "handoff"` outcomes for video. Once images return handoffs, sequence steps that generate images will naturally wait across worker ticks the same way video steps do today. The "stuck on image generation" symptom inside Run Sequence disappears because the worker is no longer holding a connection open against the 150s ceiling.

### Why this is the right fix

- **Removes the only failure mode**: there is no longer any synchronous wait that can exceed 150s. Each HTTP call in the chain finishes in seconds.
- **Reuses a proven pattern**: the exact same handoff shape works in production today for Kling video (which routinely takes 60–300s).
- **No schema change, no new table, no new cron** — `action_jobs` already has the provider-handoff columns and the worker already polls them every minute (and within ~8s on the fast path).
- **Backward compatible**: the no-`mode` form of `lovable-image` still works for any direct UI invocation.
- **Cancellation still works**: a user cancelling an in-flight image job is observed during the next poll tick, just like video today.

### Files touched

- `supabase/functions/lovable-image/index.ts` — refactor to add `submit` / `poll` modes (single shot path retained).
- `supabase/functions/process-action-queue/index.ts` — image cases return `handoff`; PHASE 1 poller dispatches `lovable-image` and runs image post-processing on `COMPLETED`.

No frontend, DB, or `config.toml` changes required.