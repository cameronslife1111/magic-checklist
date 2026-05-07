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

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/gif": "gif",
  "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "image/svg+xml": "svg",
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "video/x-msvideo": "avi",
  "video/x-matroska": "mkv", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/ogg": "ogg",
  "audio/webm": "weba", "audio/mp4": "m4a",
};

const sanitize = (s: string) => s.replace(/[\/\\:*?"<>|\x00-\x1f]+/g, "_").trim() || "Untitled";

const hasExt = (name: string) => /\.[A-Za-z0-9]{1,6}$/.test(name);

const extFor = (asset: MediaAsset): string => {
  if (asset.mime_type && MIME_EXT[asset.mime_type.toLowerCase()]) return MIME_EXT[asset.mime_type.toLowerCase()];
  const fromPath = asset.storage_path?.split(".").pop();
  if (fromPath && fromPath.length <= 6 && /^[A-Za-z0-9]+$/.test(fromPath)) return fromPath.toLowerCase();
  if (asset.kind === "image") return "png";
  if (asset.kind === "video") return "mp4";
  return "bin";
};

export async function downloadAllMediaAsZip(userId: string): Promise<number> {
  const all = await listMediaAssets(userId);
  const items = all.filter((a) => a.kind === "image" || a.kind === "video");
  if (items.length === 0) return 0;

  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const used = new Map<string, number>();

  await Promise.all(items.map(async (a) => {
    try {
      const res = await fetch(a.url);
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      const blob = await res.blob();
      let base = sanitize(a.title);
      if (!hasExt(base)) base = `${base}.${extFor(a)}`;
      const dot = base.lastIndexOf(".");
      const stem = dot > 0 ? base.slice(0, dot) : base;
      const ext = dot > 0 ? base.slice(dot) : "";
      let name = base;
      const key = name.toLowerCase();
      if (used.has(key)) {
        const n = (used.get(key) ?? 1) + 1;
        used.set(key, n);
        name = `${stem} (${n})${ext}`;
      } else {
        used.set(key, 1);
      }
      zip.file(name, blob);
    } catch (e) {
      console.error("zip skip", a.title, e);
    }
  }));

  const out = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(out);
  const a = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `media-gallery-${date}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return items.length;
}
