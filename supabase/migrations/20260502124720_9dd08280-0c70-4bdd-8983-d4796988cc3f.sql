-- Context groups: saved bundles of checklists for quick context selection
CREATE TABLE public.context_groups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL DEFAULT 'Untitled group',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.context_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own context_groups select" ON public.context_groups FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own context_groups insert" ON public.context_groups FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own context_groups update" ON public.context_groups FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own context_groups delete" ON public.context_groups FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_context_groups_updated_at
BEFORE UPDATE ON public.context_groups
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.context_group_checklists (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  group_id UUID NOT NULL,
  checklist_id UUID NOT NULL,
  position DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (group_id, checklist_id)
);

CREATE INDEX idx_context_group_checklists_group ON public.context_group_checklists(group_id);

ALTER TABLE public.context_group_checklists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own context_group_checklists select" ON public.context_group_checklists FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own context_group_checklists insert" ON public.context_group_checklists FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own context_group_checklists update" ON public.context_group_checklists FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own context_group_checklists delete" ON public.context_group_checklists FOR DELETE USING (auth.uid() = user_id);

-- Cascade: when a group is deleted, remove its membership rows
CREATE OR REPLACE FUNCTION public.delete_context_group_memberships()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  DELETE FROM public.context_group_checklists WHERE group_id = OLD.id;
  RETURN OLD;
END;
$$;

CREATE TRIGGER context_groups_before_delete
BEFORE DELETE ON public.context_groups
FOR EACH ROW EXECUTE FUNCTION public.delete_context_group_memberships();

-- Cascade: when a checklist is deleted, remove it from any groups
CREATE OR REPLACE FUNCTION public.delete_checklist_group_memberships()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  DELETE FROM public.context_group_checklists WHERE checklist_id = OLD.id;
  RETURN OLD;
END;
$$;

CREATE TRIGGER checklists_before_delete_groups
BEFORE DELETE ON public.checklists
FOR EACH ROW EXECUTE FUNCTION public.delete_checklist_group_memberships();