
-- Extensions for background scheduling
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Action jobs table
CREATE TABLE public.action_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  checklist_id UUID NOT NULL,
  source_item_id UUID,
  action_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  error_raw TEXT,
  error_friendly TEXT,
  error_fix TEXT,
  scheduled_for TIMESTAMPTZ,
  recurrence TEXT,
  parent_job_id UUID,
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_action_jobs_user ON public.action_jobs(user_id, created_at DESC);
CREATE INDEX idx_action_jobs_worker ON public.action_jobs(status, scheduled_for) WHERE status IN ('pending','scheduled');

ALTER TABLE public.action_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own action_jobs select" ON public.action_jobs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own action_jobs insert" ON public.action_jobs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own action_jobs update" ON public.action_jobs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own action_jobs delete" ON public.action_jobs FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_action_jobs_updated_at
BEFORE UPDATE ON public.action_jobs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.action_jobs;
ALTER TABLE public.action_jobs REPLICA IDENTITY FULL;
