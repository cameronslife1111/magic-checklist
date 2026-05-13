import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft, Image as ImageIcon, Video, Music, Eye, Trash2, Pencil, Upload, Loader2, Check, X, CheckSquare,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  MediaAsset, MediaKind, listMediaAssets, uploadMediaAsset,
  renameMediaAsset, deleteMediaAsset,
} from "@/lib/mediaAssets";
import { MediaViewer } from "@/components/MediaViewer";
import { cn } from "@/lib/utils";

type Filter = "all" | MediaKind;

const KindIcon = ({ kind, className }: { kind: MediaKind; className?: string }) => {
  if (kind === "image") return <ImageIcon className={className} />;
  if (kind === "video") return <Video className={className} />;
  return <Music className={className} />;
};

const fmtDate = (iso: string) => {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch { return ""; }
};

const MediaGalleryPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [uploading, setUploading] = useState(0);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [pendingDelete, setPendingDelete] = useState<MediaAsset | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pendingBulkDelete, setPendingBulkDelete] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const imgRef = useRef<HTMLInputElement>(null);
  const vidRef = useRef<HTMLInputElement>(null);
  const audRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const list = await listMediaAssets(user.id);
        if (!cancelled) setAssets(list);
      } catch {
        if (!cancelled) toast.error("Could not load Media Gallery.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  const filtered = useMemo(
    () => filter === "all" ? assets : assets.filter((a) => a.kind === filter),
    [assets, filter],
  );

  const handleUpload = async (files: FileList | null, kind: MediaKind) => {
    if (!user || !files || files.length === 0) return;
    const arr = Array.from(files);
    setUploading((c) => c + arr.length);
    const created: MediaAsset[] = [];
    for (const f of arr) {
      try {
        const a = await uploadMediaAsset(user.id, f, kind);
        created.push(a);
      } catch {
        toast.error(`Upload failed: ${f.name}`);
      } finally {
        setUploading((c) => c - 1);
      }
    }
    if (created.length) {
      setAssets((prev) => [...created, ...prev]);
      toast.success(`Added ${created.length} ${kind}${created.length > 1 ? "s" : ""}.`);
    }
  };

  const startEdit = (a: MediaAsset) => {
    setEditingId(a.id);
    setEditValue(a.title);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const id = editingId;
    const title = editValue.trim() || "Untitled";
    setEditingId(null);
    setAssets((prev) => prev.map((x) => x.id === id ? { ...x, title } : x));
    try { await renameMediaAsset(id, title); }
    catch { toast.error("Could not rename. Try again."); }
  };

  const confirmDelete = async () => {
    const a = pendingDelete;
    setPendingDelete(null);
    if (!a) return;
    setAssets((prev) => prev.filter((x) => x.id !== a.id));
    try { await deleteMediaAsset(a); toast.success("Deleted."); }
    catch { toast.error("Could not delete. Try again."); }
  };

  const exitSelect = () => { setSelectMode(false); setSelectedIds(new Set()); };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelectedIds(new Set(filtered.map((a) => a.id)));
  };

  const confirmBulkDelete = async () => {
    setPendingBulkDelete(false);
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const targets = assets.filter((a) => ids.includes(a.id));
    setBulkDeleting(true);
    setAssets((prev) => prev.filter((x) => !selectedIds.has(x.id)));
    let failed = 0;
    await Promise.all(targets.map(async (a) => {
      try { await deleteMediaAsset(a); } catch { failed += 1; }
    }));
    setBulkDeleting(false);
    exitSelect();
    if (failed === 0) toast.success(`Deleted ${targets.length} item${targets.length > 1 ? "s" : ""}.`);
    else toast.error(`Deleted ${targets.length - failed}, ${failed} failed.`);
  };

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="sticky top-0 z-20 bg-background/85 backdrop-blur-md border-b border-border">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-semibold">Media Gallery</h1>
        </div>
        <div className="max-w-2xl mx-auto px-4 pb-3 flex flex-wrap gap-2">
          {(["all", "image", "video", "audio"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "text-xs px-3 py-1.5 rounded-full border transition-colors",
                filter === f
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:bg-accent",
              )}
            >
              {f === "all" ? "All" : f === "image" ? "Images" : f === "video" ? "Videos" : "Audio"}
            </button>
          ))}
        </div>
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-4">
        {selectMode ? (
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <span className="text-sm font-medium mr-auto">{selectedIds.size} selected</span>
            <Button variant="outline" size="sm" onClick={selectAllVisible}>Select all</Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={selectedIds.size === 0 || bulkDeleting}
              onClick={() => setPendingBulkDelete(true)}
            >
              {bulkDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Delete ({selectedIds.size})
            </Button>
            <Button variant="ghost" size="sm" onClick={exitSelect}>Cancel</Button>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-2 mb-4">
            <Button variant="outline" onClick={() => imgRef.current?.click()} className="justify-center px-2">
              <Upload className="h-4 w-4" /> Image
            </Button>
            <Button variant="outline" onClick={() => vidRef.current?.click()} className="justify-center px-2">
              <Upload className="h-4 w-4" /> Video
            </Button>
            <Button variant="outline" onClick={() => audRef.current?.click()} className="justify-center px-2">
              <Upload className="h-4 w-4" /> Audio
            </Button>
            <Button variant="outline" onClick={() => setSelectMode(true)} className="justify-center px-2" aria-label="Select multiple">
              <CheckSquare className="h-4 w-4" /> Select
            </Button>
          </div>
        )}
        <input ref={imgRef} type="file" accept="image/*" multiple className="hidden"
          onChange={(e) => { handleUpload(e.target.files, "image"); e.target.value = ""; }} />
        <input ref={vidRef} type="file" accept="video/*" multiple className="hidden"
          onChange={(e) => { handleUpload(e.target.files, "video"); e.target.value = ""; }} />
        <input ref={audRef} type="file" accept="audio/*" multiple className="hidden"
          onChange={(e) => { handleUpload(e.target.files, "audio"); e.target.value = ""; }} />

        {uploading > 0 && (
          <p className="text-xs text-muted-foreground inline-flex items-center gap-1 mb-3">
            <Loader2 className="h-3 w-3 animate-spin" /> Uploading {uploading}…
          </p>
        )}

        {loading ? (
          <p className="text-center text-muted-foreground mt-12 text-sm">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-center text-muted-foreground mt-12 text-sm">
            {assets.length === 0 ? "Your gallery is empty. Upload something above." : "No items in this filter."}
          </p>
        ) : (
          <ul className="divide-y divide-border border border-border rounded-lg overflow-hidden">
            {filtered.map((a) => {
              const isSelected = selectedIds.has(a.id);
              return (
              <li
                key={a.id}
                className={cn(
                  "flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-3 py-2.5 bg-card",
                  selectMode && "cursor-pointer",
                  selectMode && isSelected && "bg-accent/40",
                )}
                onClick={selectMode ? () => toggleSelected(a.id) : undefined}
              >
                <div className="flex items-start gap-3 w-full min-w-0">
                  {selectMode ? (
                    <span
                      className={cn(
                        "shrink-0 h-9 w-9 rounded-full inline-flex items-center justify-center border",
                        isSelected ? "bg-blue-500 border-blue-500 text-white" : "bg-background border-border text-muted-foreground",
                      )}
                      aria-label={isSelected ? "Selected" : "Not selected"}
                    >
                      {isSelected ? <Check className="h-4 w-4" /> : <KindIcon kind={a.kind} className="h-4 w-4" />}
                    </span>
                  ) : (
                    <span className="shrink-0 h-9 w-9 rounded-full bg-muted inline-flex items-center justify-center">
                      <KindIcon kind={a.kind} className="h-4 w-4 text-muted-foreground" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    {editingId === a.id && !selectMode ? (
                      <div className="flex items-center gap-1 w-full">
                        <Input
                          autoFocus
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveEdit();
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          onBlur={saveEdit}
                          className="h-8"
                        />
                        <Button size="icon" variant="ghost" className="h-8 w-8" onMouseDown={(e) => { e.preventDefault(); saveEdit(); }}>
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onMouseDown={(e) => { e.preventDefault(); setEditingId(null); }}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : selectMode ? (
                      <p className="text-sm font-medium break-words whitespace-normal leading-snug">{a.title}</p>
                    ) : (
                      <button
                        onClick={() => startEdit(a)}
                        className="block w-full text-left text-sm font-medium hover:underline break-words whitespace-normal leading-snug"
                        title="Tap to rename"
                      >
                        {a.title}
                      </button>
                    )}
                    <p className="text-xs text-muted-foreground">{a.kind} · {fmtDate(a.created_at)}</p>
                  </div>
                </div>
                {!selectMode && editingId !== a.id && (
                  <div className="flex items-center gap-1 self-end sm:self-auto -mr-1 sm:mr-0">
                    <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => startEdit(a)} aria-label="Rename">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => setViewerIndex(filtered.findIndex((x) => x.id === a.id))} aria-label="Open">
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-9 w-9 text-destructive" onClick={() => setPendingDelete(a)} aria-label="Delete">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </li>
              );
            })}
          </ul>
        )}
      </main>

      <MediaViewer
        open={!!viewer}
        url={viewer?.url ?? null}
        type={viewer?.kind ?? null}
        title={viewer?.title ?? null}
        mimeType={viewer?.mime_type ?? null}
        storagePath={viewer?.storage_path ?? null}
        onClose={() => setViewer(null)}
      />

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this media?</AlertDialogTitle>
            <AlertDialogDescription>
              "{pendingDelete?.title}" will be permanently removed from your Media Gallery and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); confirmDelete(); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={pendingBulkDelete} onOpenChange={(o) => !o && setPendingBulkDelete(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedIds.size} item{selectedIds.size === 1 ? "" : "s"}?</AlertDialogTitle>
            <AlertDialogDescription>
              The selected media will be permanently removed from your Media Gallery and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); confirmBulkDelete(); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default MediaGalleryPage;
