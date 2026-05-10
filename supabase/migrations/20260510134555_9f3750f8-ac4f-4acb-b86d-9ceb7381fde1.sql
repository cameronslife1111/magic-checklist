
-- Bee Protocol schema additions

ALTER TABLE public.checklist_items
  ADD COLUMN IF NOT EXISTS dante_locked_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS dante_fail_count int NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.dante_action_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  checklist_id uuid NOT NULL,
  item_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('complete','bee','error')),
  model_used text,
  tokens_used int,
  error text,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dante_action_log_user_processed_idx
  ON public.dante_action_log (user_id, processed_at DESC);

ALTER TABLE public.dante_action_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own dante_action_log select" ON public.dante_action_log;
CREATE POLICY "own dante_action_log select"
  ON public.dante_action_log FOR SELECT
  USING (auth.uid() = user_id);

-- Per-user daily counter
ALTER TABLE public.dante_daily_counters
  ADD COLUMN IF NOT EXISTS user_id uuid NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND indexname='dante_daily_counters_user_day_uniq'
  ) THEN
    -- Drop any preexisting PK on (day) so (user_id, day) can be the unique
    BEGIN
      ALTER TABLE public.dante_daily_counters DROP CONSTRAINT IF EXISTS dante_daily_counters_pkey;
    EXCEPTION WHEN others THEN NULL; END;
    CREATE UNIQUE INDEX dante_daily_counters_user_day_uniq
      ON public.dante_daily_counters (COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid), day);
  END IF;
END $$;
