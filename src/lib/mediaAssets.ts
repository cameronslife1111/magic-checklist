import { supabase } from "@/integrations/supabase/client";

export type MediaKind = "image" | "video" | "audio";

export type MediaAsset = {
  id: string;
  user_id: string;
  title: string;
  kind: MediaKind;
  url: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  created_at: string;
  updated_at: string;
};

const BUCKET = "generated-media";

export const inferKindFromMime = (mime: string): MediaKind | null => {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return null;
};

export const stripExtension = (name: string) => {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
};

export async function listMediaAssets(userId: string, kind?: MediaKind): Promise<MediaAsset[]> {
  let q = supabase
    .from("media_assets")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (kind) q = q.eq("kind", kind);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as MediaAsset[];
}

export async function uploadMediaAsset(
  userId: string,
  file: File,
  kind: MediaKind,
): Promise<MediaAsset> {
  const ext = file.name.split(".").pop() || "bin";
  const storage_path = `${userId}/gallery/${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(storage_path, file, { contentType: file.type });
  if (upErr) throw upErr;
  const url = supabase.storage.from(BUCKET).getPublicUrl(storage_path).data.publicUrl;
  const title = stripExtension(file.name) || "Untitled";

  const { data, error } = await supabase
    .from("media_assets")
    .insert({
      user_id: userId,
      title,
      kind,
      url,
      storage_path,
      mime_type: file.type || null,
      size_bytes: file.size,
    })
    .select()
    .single();
  if (error || !data) {
    // best-effort cleanup
    try { await supabase.storage.from(BUCKET).remove([storage_path]); } catch {}
    throw error ?? new Error("insert failed");
  }
  return data as MediaAsset;
}

export async function renameMediaAsset(id: string, title: string): Promise<void> {
  const { error } = await supabase.from("media_assets").update({ title }).eq("id", id);
  if (error) throw error;
}

export async function deleteMediaAsset(asset: MediaAsset): Promise<void> {
  // Remove storage object first (best-effort), then row.
  try { await supabase.storage.from(BUCKET).remove([asset.storage_path]); } catch {}
  const { error } = await supabase.from("media_assets").delete().eq("id", asset.id);
  if (error) throw error;
}
