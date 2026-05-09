DROP TRIGGER IF EXISTS dante_thread_status_trg ON public.checklist_items;
DROP FUNCTION IF EXISTS public.detect_dante_new_turn();
DROP FUNCTION IF EXISTS public.dante_claim_items(uuid, integer);
DROP FUNCTION IF EXISTS public.dante_try_lock();
DROP FUNCTION IF EXISTS public.dante_unlock();

CREATE TABLE IF NOT EXISTS public.dante_daily_counters (
  day date PRIMARY KEY,
  count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dante_daily_counters ENABLE ROW LEVEL SECURITY;
-- No policies = only service role can read/write. Intentional.