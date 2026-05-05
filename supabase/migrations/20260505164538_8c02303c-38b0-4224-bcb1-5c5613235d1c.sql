
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Advisory lock helpers (single-watcher concurrency guard)
CREATE OR REPLACE FUNCTION public.dante_try_lock()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pg_try_advisory_lock(7273477347347234);
$$;

CREATE OR REPLACE FUNCTION public.dante_unlock()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pg_advisory_unlock(7273477347347234);
$$;

-- Atomic claim: move up to N inbox items from status NULL -> 'in_progress'
CREATE OR REPLACE FUNCTION public.dante_claim_items(p_checklist_id uuid, p_limit int)
RETURNS SETOF public.checklist_items
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH next_items AS (
    SELECT id FROM public.checklist_items
    WHERE checklist_id = p_checklist_id
      AND status IS NULL
    ORDER BY created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.checklist_items ci
  SET status = 'in_progress', updated_at = NOW()
  FROM next_items
  WHERE ci.id = next_items.id
  RETURNING ci.*;
$$;

REVOKE ALL ON FUNCTION public.dante_try_lock() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dante_unlock() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dante_claim_items(uuid, int) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.dante_try_lock() TO service_role;
GRANT EXECUTE ON FUNCTION public.dante_unlock() TO service_role;
GRANT EXECUTE ON FUNCTION public.dante_claim_items(uuid, int) TO service_role;
