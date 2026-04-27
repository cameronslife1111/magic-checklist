import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Image as ImageIcon, Video, Music, Loader2, Upload, Check } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  MediaAsset, MediaKind, listMediaAssets, uploadMediaAsset,
} from "@/lib/mediaAssets";

type Props = {
  open: boolean;
  userId: string;
  kind: MediaKind;
  mode: "single" | "multi";
  maxSelected?: number; // multi only; default 16
  initialSelectedIds?: string[];
  onClose: () => void;
  onConfirm: (assets: MediaAsset[]) => void; // returned in selection order
};

const KindIcon = ({ kind, className }: { kind: MediaKind; className?: string }) => {
  if (kind === "image") return <ImageIcon className={className} />;
  if (kind === "video") return <Video className={className} />;
  return <Music className={className} />;
};

export const MediaGalleryPicker = ({
  open, userId, kind, mode, maxSelected = 16, initialSelectedIds, onClose, onConfirm,
}: Props) => {
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [orderedIds, setOrderedIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const accept = kind === "image" ? "image/*" : kind === "video" ? "video/*" : "audio/*";

  useEffect(() => {
    if (!open) return;
    setQ("");
    setOrderedIds(initialSelectedIds ?? []);
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const list = await listMediaAssets(userId, kind);
        if (!cancelled) setAssets(list);
      } catch {
        if (!cancelled) toast.error("Could not load Media Gallery.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, userId, kind, initialSelectedIds]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return assets;
    return assets.filter((a) => a.title.toLowerCase().includes(t));
  }, [assets, q]);

  const toggle = (a: MediaAsset) => {
    if (mode === "single") {
      setOrderedIds([a.id]);
      return;
    }
    setOrderedIds((cur) => {
      if (cur.includes(a.id)) return cur.filter((x) => x !== a.id);
      if (cur.length >= maxSelected) {
        toast.error(`Max ${maxSelected} selected.`);
        return cur;
      }
      return [...cur, a.id];
    });
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const arr = Array.from(files);
    setUploading((c) => c + arr.length);
    const newAssets: MediaAsset[] = [];
    for (const f of arr) {
      try {
        const created = await uploadMediaAsset(userId, f, kind);
        newAssets.push(created);
      } catch {
        toast.error(`Upload failed: ${f.name}`);
      } finally {
        setUploading((c) => c - 1);
      }
    }
    if (newAssets.length) {
      setAssets((prev) => [...newAssets, ...prev]);
      // Auto-select newly uploaded assets in order
      setOrderedIds((cur) => {
        if (mode === "single") return [newAssets[0].id];
        const merged = [...cur];
        for (const a of newAssets) {
          if (!merged.includes(a.id) && merged.length < maxSelected) merged.push(a.id);
        }
        return merged;
      });
    }
  };

  const confirm = () => {
    const byId = new Map(assets.map((a) => [a.id, a]));
    const picked = orderedIds.map((id) => byId.get(id)).filter(Boolean) as MediaAsset[];
    onConfirm(picked);
  };

  const kindLabel = kind === "image" ? "image" : kind === "video" ? "video" : "audio";
  const title = mode === "single" ? `Select ${kindLabel}` : `Select ${kindLabel}s (${orderedIds.length}/${maxSelected})`;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-md w-[calc(100vw-1.5rem)] p-0 gap-0 flex flex-col max-h-[85vh] overflow-hidden z-[60]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className="px-5 pt-5 pb-3 shrink-0">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="px-5 space-y-3 shrink-0">
          <div className="flex gap-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${kindLabel}s`} inputMode="search" autoFocus={false} />
            <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} className="shrink-0">
              <Upload className="h-4 w-4" /> Upload
            </Button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept={accept}
            multiple
            className="hidden"
            onChange={(e) => { handleUpload(e.target.files); e.target.value = ""; }}
          />
          {uploading > 0 && (
            <p className="text-xs text-muted-foreground inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Uploading {uploading}…
            </p>
          )}
        </div>

        <ul className="mt-3 max-h-[55vh] overflow-y-auto divide-y divide-border border-y border-border">
          {loading ? (
            <li className="px-5 py-6 text-sm text-muted-foreground inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </li>
          ) : filtered.length === 0 ? (
            <li className="px-5 py-8 text-sm text-muted-foreground text-center">
              No {kindLabel}s yet. Tap Upload to add one.
            </li>
          ) : (
            filtered.map((a) => {
              const order = orderedIds.indexOf(a.id);
              const selected = order !== -1;
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => toggle(a)}
                    className={cn(
                      "w-full text-left px-4 py-3 hover:bg-accent flex items-center gap-3",
                      selected && "bg-accent/40",
                    )}
                  >
                    <span
                      className={cn(
                        "shrink-0 inline-flex items-center justify-center h-8 w-8 rounded-full border text-sm font-semibold",
                        selected
                          ? "bg-blue-500 text-white border-blue-500"
                          : "bg-background text-muted-foreground border-border",
                      )}
                      aria-label={selected ? `Selected position ${order + 1}` : "Not selected"}
                    >
                      {selected ? (mode === "single" ? <Check className="h-4 w-4" /> : order + 1) : <KindIcon kind={a.kind} className="h-4 w-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{a.title}</p>
                      <p className="text-xs text-muted-foreground">{a.kind}</p>
                    </div>
                  </button>
                </li>
              );
            })
          )}
        </ul>

        <DialogFooter className="px-5 py-4 gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={confirm} disabled={orderedIds.length === 0}>
            {mode === "single" ? "Select" : `Done (${orderedIds.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
