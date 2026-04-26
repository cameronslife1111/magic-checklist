ALTER TABLE public.action_jobs
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS provider_request_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_status_url TEXT,
  ADD COLUMN IF NOT EXISTS provider_response_url TEXT,
  ADD COLUMN IF NOT EXISTS provider_polled_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_action_jobs_status_polled
  ON public.action_jobs (status, provider_polled_at)
  WHERE status = 'awaiting_provider';