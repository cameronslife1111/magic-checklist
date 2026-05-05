-- 1. Allow new statuses
CREATE OR REPLACE FUNCTION public.validate_checklist_item_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status IS NOT NULL
     AND NEW.status NOT IN ('pending','in_progress','done','error','awaiting_dante','awaiting_cj') THEN
    RAISE EXCEPTION 'invalid status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$function$;

-- 2. Auto-detect new 👑 turns vs 🤖 turns. If user added a new crown turn
-- after the latest robot reply, mark it awaiting_dante so the watcher picks it up.
CREATE OR REPLACE FUNCTION public.detect_dante_new_turn()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  crown_count int;
  robot_count int;
BEGIN
  -- only act if text actually changed
  IF NEW.text IS NOT DISTINCT FROM OLD.text THEN
    RETURN NEW;
  END IF;
  -- never override an in-flight or terminal status mid-tick
  IF NEW.status IN ('in_progress','awaiting_cj') AND NEW.status IS DISTINCT FROM OLD.status THEN
    -- watcher itself is updating; leave alone
    RETURN NEW;
  END IF;

  crown_count := (length(NEW.text) - length(replace(NEW.text, '👑:', ''))) / length('👑:');
  robot_count := (length(NEW.text) - length(replace(NEW.text, '🤖 Dante said:', ''))) / length('🤖 Dante said:');

  IF crown_count > robot_count AND COALESCE(NEW.status, '') NOT IN ('in_progress') THEN
    NEW.status := 'awaiting_dante';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS dante_thread_status_trg ON public.checklist_items;
CREATE TRIGGER dante_thread_status_trg
BEFORE UPDATE ON public.checklist_items
FOR EACH ROW
WHEN (OLD.text IS DISTINCT FROM NEW.text)
EXECUTE FUNCTION public.detect_dante_new_turn();

-- 3. Claim items where status IS NULL OR status = 'awaiting_dante'
CREATE OR REPLACE FUNCTION public.dante_claim_items(p_checklist_id uuid, p_limit integer)
RETURNS SETOF public.checklist_items
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH next_items AS (
    SELECT id FROM public.checklist_items
    WHERE checklist_id = p_checklist_id
      AND (status IS NULL OR status = 'awaiting_dante')
    ORDER BY updated_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.checklist_items ci
  SET status = 'in_progress', updated_at = NOW()
  FROM next_items
  WHERE ci.id = next_items.id
  RETURNING ci.*;
$function$;