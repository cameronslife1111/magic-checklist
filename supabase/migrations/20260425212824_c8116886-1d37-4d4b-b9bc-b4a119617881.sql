
CREATE TABLE public.media_assets (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  title text NOT NULL DEFAULT 'Untitled',
  kind text NOT NULL CHECK (kind IN ('image','video','audio')),
  url text NOT NULL,
  storage_path text NOT NULL,
  mime_type text,
  size_bytes bigint,
  duration_seconds numeric,
  width integer,
  height integer,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own media_assets select" ON public.media_assets FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own media_assets insert" ON public.media_assets FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own media_assets update" ON public.media_assets FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own media_assets delete" ON public.media_assets FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_media_assets_user_created ON public.media_assets (user_id, created_at DESC);
CREATE INDEX idx_media_assets_user_kind ON public.media_assets (user_id, kind, created_at DESC);

CREATE TRIGGER update_media_assets_updated_at
  BEFORE UPDATE ON public.media_assets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
