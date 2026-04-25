-- updated_at helper
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- checklists
CREATE TABLE public.checklists (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Untitled',
  background_color TEXT NOT NULL DEFAULT '#fcfbf8',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_checklists_user ON public.checklists(user_id);

ALTER TABLE public.checklists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own checklists select" ON public.checklists FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own checklists insert" ON public.checklists FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own checklists update" ON public.checklists FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own checklists delete" ON public.checklists FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER trg_checklists_updated BEFORE UPDATE ON public.checklists
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- checklist_items
CREATE TABLE public.checklist_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  checklist_id UUID NOT NULL REFERENCES public.checklists(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  text TEXT NOT NULL DEFAULT '',
  checked BOOLEAN NOT NULL DEFAULT false,
  position DOUBLE PRECISION NOT NULL DEFAULT 0,
  external_link TEXT,
  linked_checklist_id UUID REFERENCES public.checklists(id) ON DELETE SET NULL,
  media_url TEXT,
  media_type TEXT, -- 'image' | 'video'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_items_checklist ON public.checklist_items(checklist_id, position);
CREATE INDEX idx_items_user ON public.checklist_items(user_id);

ALTER TABLE public.checklist_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own items select" ON public.checklist_items FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own items insert" ON public.checklist_items FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own items update" ON public.checklist_items FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own items delete" ON public.checklist_items FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER trg_items_updated BEFORE UPDATE ON public.checklist_items
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Storage bucket for generated media (public read)
INSERT INTO storage.buckets (id, name, public) VALUES ('generated-media', 'generated-media', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "public read generated-media" ON storage.objects FOR SELECT USING (bucket_id = 'generated-media');
CREATE POLICY "users upload generated-media" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'generated-media' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "users update own generated-media" ON storage.objects FOR UPDATE
  USING (bucket_id = 'generated-media' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "users delete own generated-media" ON storage.objects FOR DELETE
  USING (bucket_id = 'generated-media' AND auth.uid()::text = (storage.foldername(name))[1]);