## Plan

I found the core problem: the dashboard is loading full action job records, but some older jobs still contain massive embedded base64 media payloads. Two rows are over 30 MB each, and the table currently holds about 69 MB of payload JSON. That makes the dashboard query time out, and the same oversized jobs are also causing backend worker memory-limit crashes.

### What I’ll build

1. **Make the dashboard read a lightweight job shape only**
   - Update the dashboard so it no longer fetches full `payload` and `result` blobs.
   - Add a dedicated lightweight field for display text (for example `prompt_preview`) so the UI can still show the prompt without loading huge media data.
   - Keep the existing tabs, counts, refresh flow, and realtime behavior.

2. **Clean up the oversized legacy queue data**
   - Add a migration that backfills the new lightweight prompt field from existing jobs.
   - Compact old completed/failed/cancelled jobs by removing embedded base64 media data that the dashboard does not need.
   - For old pending/running jobs that still depend on giant embedded files, mark them failed with a clear message telling the user to re-run them from the Media Gallery. This stops them from hanging forever and crashing the worker.

3. **Harden the queue so this cannot happen again**
   - Update `enqueue-action` to save the lightweight prompt field when a job is created.
   - Add a payload-size guard so oversized inline media jobs are rejected early instead of being saved to the database.
   - Update `process-action-queue` to detect legacy oversized jobs and fail them safely instead of repeatedly hitting memory limits.

4. **Polish the dashboard behavior**
   - Keep the current error/retry UX, but show the lightweight prompt field instead of reading from the full payload.
   - Ensure new jobs appear immediately and old jobs still render correctly after the cleanup.
   - Preserve the clean layout and current queue workflow.

## Why this is the right fix

This is not just a frontend loading bug. The timeout is happening because the dashboard is asking the database for far more data than it needs, and some historical rows are extremely large. Fixing only the React page would leave the worker unstable; fixing only the worker would still leave the dashboard slow. This plan fixes the read path, the bad historical data, and the future write path together.

## Technical details

- Files to update:
  - `src/pages/ActionQueue.tsx`
  - `supabase/functions/enqueue-action/index.ts`
  - `supabase/functions/process-action-queue/index.ts`
  - new database migration for `action_jobs`
- Database changes:
  - add `prompt_preview text`
  - backfill from `payload->>'prompt'`
  - compact legacy payloads for non-active jobs
  - safely fail oversized active legacy jobs
- Query change:
  - replace `select("*")` with a minimal column list used by the dashboard
- Guardrails:
  - reject future oversized inline payloads
  - stop retry loops for jobs that are already known to exceed backend memory limits

## Validation

After implementation, I’ll verify that:
- the dashboard loads quickly even with historical jobs present
- existing jobs show in the queue again
- newly queued actions appear immediately
- oversized legacy jobs no longer keep the worker in a crash loop
- the clean dashboard UX stays intact