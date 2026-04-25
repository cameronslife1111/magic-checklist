
-- 1. Lightweight preview column for dashboard
ALTER TABLE public.action_jobs ADD COLUMN IF NOT EXISTS prompt_preview text;

-- 2. Backfill from existing payloads (truncate to a safe length)
UPDATE public.action_jobs
SET prompt_preview = LEFT(COALESCE(payload->>'prompt', ''), 500)
WHERE prompt_preview IS NULL;

-- 3. Compact non-active jobs: strip giant embedded base64 fields the dashboard never needs
UPDATE public.action_jobs
SET payload = (payload - 'refImages' - 'sourceDataUrl' - 'imageDataUrl')
WHERE status IN ('completed','failed','cancelled')
  AND octet_length(payload::text) > 50000;

-- 4. Safely fail any old pending/running/scheduled/paused jobs that still have giant inline media
--    (these are what was crashing the worker with "Memory limit exceeded").
UPDATE public.action_jobs
SET status = 'failed',
    error_raw = 'Legacy oversized payload',
    error_friendly = 'This action was queued before the Media Gallery upgrade and is too large to run.',
    error_fix = 'Re-run it from the checklist using images selected from your Media Gallery.',
    completed_at = now(),
    payload = (payload - 'refImages' - 'sourceDataUrl' - 'imageDataUrl')
WHERE status IN ('pending','scheduled','running','paused')
  AND octet_length(payload::text) > 200000;

-- 5. Index to keep the per-user dashboard query fast
CREATE INDEX IF NOT EXISTS idx_action_jobs_user_created
  ON public.action_jobs (user_id, created_at DESC);
