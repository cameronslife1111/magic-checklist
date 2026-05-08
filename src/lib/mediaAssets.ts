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

/** Build a filename from an asset's title, ensuring it has a sensible extension. */
export function filenameForAsset(asset: Pick<MediaAsset, "title" | "mime_type" | "storage_path" | "kind">): string {
  let base = sanitize(asset.title || "Untitled");
  if (!hasExt(base)) base = `${base}.${extFor(asset as MediaAsset)}`;
  return base;
}

/**
 * Build a download URL that tells Supabase Storage to serve the file with
 * Content-Disposition: attachment; filename=... — so the browser streams
 * straight to disk with the right name and the save dialog appears instantly,
 * no JS-side fetch+blob buffering required.
 */
export function buildDownloadUrl(
  asset: Pick<MediaAsset, "url" | "title" | "mime_type" | "storage_path" | "kind">,
  overrideName?: string,
): string {
  const name = overrideName ?? filenameForAsset(asset);
  const sep = asset.url.includes("?") ? "&" : "?";
  return `${asset.url}${sep}download=${encodeURIComponent(name)}`;
}

/** Trigger a direct streaming download via a temporary anchor. */
export function triggerDirectDownload(
  asset: Pick<MediaAsset, "url" | "title" | "mime_type" | "storage_path" | "kind">,
  overrideName?: string,
): void {
  const href = buildDownloadUrl(asset, overrideName);
  const a = document.createElement("a");
  a.href = href;
  a.rel = "noopener";
  a.download = overrideName ?? filenameForAsset(asset);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * Stream-zips the user's images + videos and triggers a single download.
 * Uses client-zip so files are pulled lazily and no full-archive blob is
 * held in memory until generation is done. A small concurrency limiter
 * keeps the network from being saturated by huge galleries.
 */
export async function downloadAllMediaAsZip(userId: string): Promise<number> {
  const all = await listMediaAssets(userId);
  const items = all.filter((a) => a.kind === "image" || a.kind === "video");
  if (items.length === 0) return 0;

  // Resolve unique filenames up front.
  const used = new Map<string, number>();
  const planned = items.map((a) => {
    let base = filenameForAsset(a);
    const dot = base.lastIndexOf(".");
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : "";
    const key = base.toLowerCase();
    let name = base;
    if (used.has(key)) {
      const n = (used.get(key) ?? 1) + 1;
      used.set(key, n);
      name = `${stem} (${n})${ext}`;
    } else {
      used.set(key, 1);
    }
    return { asset: a, name };
  });

  const { downloadZip } = await import("client-zip");

  // Lazy async iterator with a concurrency cap of 4: we prefetch up to 4
  // responses ahead of what client-zip is consuming, so the pipeline stays
  // full but we don't fire 200 requests at once.
  const CONCURRENCY = 4;
  async function* source() {
    let next = 0;
    const inflight: Promise<{ idx: number; name: string; res: Response } | null>[] = [];
    const start = (idx: number) => {
      const { asset, name } = planned[idx];
      return fetch(asset.url)
        .then((res) => {
          if (!res.ok) throw new Error(`fetch ${res.status}`);
          return { idx, name, res };
        })
        .catch((e) => {
          console.error("zip skip", planned[idx].name, e);
          return null;
        });
    };
    while (next < CONCURRENCY && next < planned.length) inflight.push(start(next++));
    while (inflight.length > 0) {
      const item = await inflight.shift()!;
      if (next < planned.length) inflight.push(start(next++));
      if (!item) continue;
      yield { name: item.name, input: item.res, lastModified: new Date(planned[item.idx].asset.created_at) };
    }
  }

  const zipResponse = downloadZip(source());
  const date = new Date().toISOString().slice(0, 10);
  const filename = `media-gallery-${date}.zip`;

  // We still need an object URL to trigger a download (browsers don't let
  // anchors point at in-memory streams). But because client-zip emits as it
  // reads, peak memory is bounded by network buffer + a few in-flight files,
  // not the whole archive.
  const blob = await zipResponse.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return planned.length;
}
