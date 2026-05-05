CREATE OR REPLACE FUNCTION public.detect_dante_new_turn()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  rev_text text;
  rev_crown int;
  rev_robot int;
BEGIN
  IF NEW.text IS NOT DISTINCT FROM OLD.text THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'in_progress' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'in_progress' AND NEW.status = 'awaiting_cj' THEN
    RETURN NEW;
  END IF;

  rev_text := reverse(NEW.text);
  rev_crown := strpos(rev_text, reverse('👑:'));
  rev_robot := strpos(rev_text, reverse('🤖 Dante said:'));

  -- Smaller reverse-position = closer to end of text = more recent.
  -- CJ's last turn is the most recent iff rev_crown > 0 AND (rev_robot = 0 OR rev_crown < rev_robot).
  IF rev_crown > 0
     AND (rev_robot = 0 OR rev_crown < rev_robot)
     AND COALESCE(NEW.status, '') IN ('', 'awaiting_cj', 'done', 'error')
  THEN
    NEW.status := 'awaiting_dante';
  END IF;

  RETURN NEW;
END;
$$;