ALTER TABLE public.action_jobs
  ADD COLUMN IF NOT EXISTS sequence_step integer,
  ADD COLUMN IF NOT EXISTS sequence_state jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS action_jobs_parent_idx
  ON public.action_jobs(parent_job_id)
  WHERE parent_job_id IS NOT NULL;