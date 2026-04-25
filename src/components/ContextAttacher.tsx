import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { FileText, Image as ImageIcon, Video, Music, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { sortChecklistsByTitle } from "@/lib/sortChecklists";

export type AttachedMedia = { url: string; path: string; type: "image" | "video" | "audio"; name: string };
export type AttachedContext = {
  checklists: { id: string; title: string }[];
  media: AttachedMedia[];
};

const MAX_PER_KIND = 15;

type Props = {
  userId: string;
  excludeChecklistId?: string;
  value: AttachedContext;
  onChange: (next: AttachedContext) => void;
  onUploadingChange?: (uploading: boolean) => void;
};

export const ContextAttacher = ({ userId, excludeChecklistId, value, onChange, onUploadingChange }: Props) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [uploadingCount, setUploadingCount] = useState(0);
  const imgRef = useRef<HTMLInputElement>(null);
  const vidRef = useRef<HTMLInputElement>(null);
  const audRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onUploadingChange?.(uploadingCount > 0);
  }, [uploadingCount, onUploadingChange]);

  const countByType = (t: AttachedMedia["type"]) => value.media.filter((m) => m.type === t).length;

  const handleFiles = async (files: FileList | null, type: AttachedMedia["type"]) => {
    if (!files || files.length === 0) return;
    const remaining = MAX_PER_KIND - countByType(type);
    const arr = Array.from(files).slice(0, remaining);
    if (arr.length < files.length) toast.error(`Max ${MAX_PER_KIND} ${type} attachments.`);
    if (arr.length === 0) return;

    setUploadingCount((c) => c + arr.length);
    const uploaded: AttachedMedia[] = [];
    for (const file of arr) {
      try {
        const ext = file.name.split(".").pop() || "bin";
        const path = `${userId}/context/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from("generated-media").upload(path, file, { contentType: file.type });
        if (error) throw error;
        const url = supabase.storage.from("generated-media").getPublicUrl(path).data.publicUrl;
        uploaded.push({ url, path, type, name: file.name });
      } catch (e: any) {
        toast.error(`Upload failed: ${file.name}`);
      } finally {
        setUploadingCount((c) => c - 1);
      }
    }
    if (uploaded.length) onChange({ ...value, media: [...value.media, ...uploaded] });
  };

  const removeMedia = async (m: AttachedMedia) => {
    onChange({ ...value, media: value.media.filter((x) => x.path !== m.path) });
    try { await supabase.storage.from("generated-media").remove([m.path]); } catch { /* best-effort */ }
  };

  const removeChecklist = (id: string) => {
    onChange({ ...value, checklists: value.checklists.filter((c) => c.id !== id) });
  };

  const totalCount = value.checklists.length + value.media.length;

  return (
    <div className="space-y-2 border rounded-md p-3 bg-muted/30">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">Attach context (optional)</p>
        {totalCount > 0 && (
          <span className="text-xs text-muted-foreground">
            {value.checklists.length > 0 && `${value.checklists.length} checklist${value.checklists.length > 1 ? "s" : ""}`}
            {value.checklists.length > 0 && value.media.length > 0 && " · "}
            {countByType("image") > 0 && `${countByType("image")} img `}
            {countByType("video") > 0 && `${countByType("video")} vid `}
            {countByType("audio") > 0 && `${countByType("audio")} aud`}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)} className="justify-start">
          <FileText className="h-4 w-4" /> Add Text Context
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => imgRef.current?.click()} className="justify-start">
          <ImageIcon className="h-4 w-4" /> Add Image Context
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => vidRef.current?.click()} className="justify-start">
          <Video className="h-4 w-4" /> Add Video Context
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => audRef.current?.click()} className="justify-start">
          <Music className="h-4 w-4" /> Add Audio Context
        </Button>
      </div>

      <input ref={imgRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { handleFiles(e.target.files, "image"); e.target.value = ""; }} />
      <input ref={vidRef} type="file" accept="video/*" multiple className="hidden" onChange={(e) => { handleFiles(e.target.files, "video"); e.target.value = ""; }} />
      <input ref={audRef} type="file" accept="audio/*" multiple className="hidden" onChange={(e) => { handleFiles(e.target.files, "audio"); e.target.value = ""; }} />

      {(value.checklists.length > 0 || value.media.length > 0 || uploadingCount > 0) && (
        <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pt-1">
          {value.checklists.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1 text-xs bg-background border rounded-full pl-2 pr-1 py-0.5 max-w-[180px]">
              <FileText className="h-3 w-3 shrink-0" />
              <span className="truncate">{c.title}</span>
              <button onClick={() => removeChecklist(c.id)} className="hover:bg-muted rounded-full p-0.5"><X className="h-3 w-3" /></button>
            </span>
          ))}
          {value.media.map((m) => (
            <span key={m.path} className="inline-flex items-center gap-1 text-xs bg-background border rounded-full pl-2 pr-1 py-0.5 max-w-[180px]">
              {m.type === "image" ? <ImageIcon className="h-3 w-3 shrink-0" /> : m.type === "video" ? <Video className="h-3 w-3 shrink-0" /> : <Music className="h-3 w-3 shrink-0" />}
              <span className="truncate">{m.name}</span>
              <button onClick={() => removeMedia(m)} className="hover:bg-muted rounded-full p-0.5"><X className="h-3 w-3" /></button>
            </span>
          ))}
          {uploadingCount > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Uploading {uploadingCount}…
            </span>
          )}
        </div>
      )}

      <ChecklistMultiPicker
        open={pickerOpen}
        excludeId={excludeChecklistId}
        selected={value.checklists}
        onClose={() => setPickerOpen(false)}
        onConfirm={(picks) => { onChange({ ...value, checklists: picks }); setPickerOpen(false); }}
      />
    </div>
  );
};

type PickerProps = {
  open: boolean;
  excludeId?: string;
  selected: { id: string; title: string }[];
  onClose: () => void;
  onConfirm: (picks: { id: string; title: string }[]) => void;
};

const ChecklistMultiPicker = ({ open, excludeId, selected, onClose, onConfirm }: PickerProps) => {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; title: string }[]>([]);
  const [picks, setPicks] = useState<{ id: string; title: string }[]>(selected);

  useEffect(() => { if (open) { setPicks(selected); setQ(""); } }, [open, selected]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      let query = supabase.from("checklists").select("id,title").order("title", { ascending: true }).limit(200);
      if (q.trim()) query = query.ilike("title", `%${q.trim()}%`);
      const { data } = await query;
      if (!cancelled) setResults(sortChecklistsByTitle((data ?? []).filter((r) => r.id !== excludeId)));
    })();
    return () => { cancelled = true; };
  }, [q, open, excludeId]);

  const toggle = (r: { id: string; title: string }) => {
    setPicks((cur) => {
      if (cur.some((p) => p.id === r.id)) return cur.filter((p) => p.id !== r.id);
      if (cur.length >= MAX_PER_KIND) { toast.error(`Max ${MAX_PER_KIND} checklists.`); return cur; }
      return [...cur, r];
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Select checklists ({picks.length}/{MAX_PER_KIND})</DialogTitle>
        </DialogHeader>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search checklists" autoFocus />
        <ul className="max-h-72 overflow-y-auto divide-y divide-border -mx-2">
          {results.length === 0 ? (
            <li className="px-4 py-6 text-sm text-muted-foreground">No checklist found.</li>
          ) : results.map((r) => {
            const isPicked = picks.some((p) => p.id === r.id);
            return (
              <li key={r.id}>
                <button onClick={() => toggle(r)} className="w-full text-left px-4 py-3 hover:bg-accent flex items-center gap-3">
                  <Checkbox checked={isPicked} />
                  <span className="truncate">{r.title}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onConfirm(picks)}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
