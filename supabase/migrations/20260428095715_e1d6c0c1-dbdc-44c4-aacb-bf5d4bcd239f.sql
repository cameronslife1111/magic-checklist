ALTER TABLE public.checklist_items
  ADD COLUMN IF NOT EXISTS parent_item_id uuid NULL
  REFERENCES public.checklist_items(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_items_parent
  ON public.checklist_items(parent_item_id)
  WHERE parent_item_id IS NOT NULL;

ALTER TABLE public.action_jobs
  ADD COLUMN IF NOT EXISTS active_line_item_id uuid NULL;