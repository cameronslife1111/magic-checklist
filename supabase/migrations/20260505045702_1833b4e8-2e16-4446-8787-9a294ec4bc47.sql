ALTER TABLE public.checklist_items
  ADD COLUMN status text,
  ADD COLUMN result text;

CREATE OR REPLACE FUNCTION public.validate_checklist_item_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS NOT NULL
     AND NEW.status NOT IN ('pending','in_progress','done','error') THEN
    RAISE EXCEPTION 'invalid status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_checklist_item_status_trigger
BEFORE INSERT OR UPDATE ON public.checklist_items
FOR EACH ROW EXECUTE FUNCTION public.validate_checklist_item_status();