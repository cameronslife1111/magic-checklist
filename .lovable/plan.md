# Add Stop button for running jobs in Action Queue

## Goal
Add a **Stop** button to running jobs in the Action Queue Dashboard that truly cancels in-flight AI generation (not just a status flip).

## How cancellation will actually work

The worker (`process-action-queue`) currently `await`s each upstream AI call (OpenAI / Lovable AI / Fal / Perplexity) to completion with no way to abort. To make Stop *real*, we need cooperative cancellation:

1. Client marks the job `cancelled` in the DB.
2. Worker polls the job's status during the fetch and aborts the upstream HTTP request via `AbortController` the moment it sees `cancelled`.
3. Worker writes the final `cancelled` state and skips result-insert / retry logic.

This is the only way to stop work that's already left the browser — there is no persistent socket to the worker.

## Changes

### 1. `supabase/functions/process-action-queue/index.ts`
- Change `callFn(name, body)` → `callFn(name, body, signal?: AbortSignal)`; pass `signal` into the upstream `fetch(...)`.
- Add a `runWithCancellation(supabase, jobId, work)` helper:
  - Creates an `AbortController`.
  - `setInterval` every ~2s re-reads `action_jobs.status` for `jobId`; if `cancelled`, calls `controller.abort()`.
  - Awaits inner `work(controller.signal)`, clears the interval in `finally`.
- In `runJob`, thread the signal through every `callFn(...)` (text-text, web-search, text-image, image-image/remix, image-video/video-video, analyze-image).
- In the main loop catch: if the error is an `AbortError` **or** a fresh DB read shows status is `cancelled`, set `status = 'cancelled'`, `completed_at = now()`; **do not** retry, **do not** insert a result item, **do not** enqueue the next recurrence. Otherwise keep existing failed/retry behavior.
- Existing claim filter `.in("status", ["pending","scheduled"])` already prevents claiming a job cancelled before it ran — no extra code.

### 2. `src/pages/ActionQueue.tsx`
- In `JobRow`, when `j.status === "running"`, render a destructive **Stop** button (Square icon from lucide-react). Clicking calls `update(j.id, { status: "cancelled" })` and toasts: "Stopping… this may take a few seconds."
- Keep Pause only for `pending` / `scheduled` (already gated by `canPause`).
- Update the **Failed** tab to also include `cancelled` jobs and relabel it "Failed / Stopped":
  - `failed = jobs.filter(j => j.status === "failed" || j.status === "cancelled")`
- For `cancelled` rows: hide the red error block; keep Re-run and Delete buttons.

### 3. No DB migration needed
`status` is a free `text` column. `'cancelled'` is already in the TS union. RLS already permits owners to update their own jobs.

## Caveats (will share after shipping)
- Stop takes up to ~2 seconds to take effect (the worker's poll interval).
- For video jobs, Fal may have already started GPU work and may still bill for it after we abort the connection.
- If the job finished within the same worker tick, Stop is a no-op and the UI just refreshes to the final state.