import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { FileText, Image as ImageIcon, Video, Music, X, Layers } from "lucide-react";
import { toast } from "sonner";
import { sortChecklistsByTitle } from "@/lib/sortChecklists";
import { MediaGalleryPicker } from "@/components/MediaGalleryPicker";
import { MediaAsset, MediaKind } from "@/lib/mediaAssets";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listGroups, getGroupChecklists, type ContextGroup } from "@/lib/contextGroups";

export type AttachedMedia = { url: string; path: string; type: "image" | "video" | "audio"; name: string };
export type AttachedContext = {
  checklists: { id: string; title: string }[];
  media: AttachedMedia[];
};

const MAX_PER_KIND = 15;

type Props = {
  userId: string;
  excludeChecklistId?: string;
  currentChecklist?: { id: string; title: string };
  value: AttachedContext;
  onChange: (next: AttachedContext) => void;
  onUploadingChange?: (uploading: boolean) => void;
};

export const ContextAttacher = ({ userId, excludeChecklistId, currentChecklist, value, onChange, onUploadingChange }: Props) => {
  const isCurrentIncluded = !!currentChecklist && value.checklists.some((c) => c.id === currentChecklist.id);
  const toggleCurrent = (checked: boolean) => {
    if (!currentChecklist) return;
    if (checked) {
      if (value.checklists.some((c) => c.id === currentChecklist.id)) return;
      if (value.checklists.length >= MAX_PER_KIND) {
        toast.error(`Max ${MAX_PER_KIND} checklists.`);
        return;
      }
      onChange({ ...value, checklists: [...value.checklists, { id: currentChecklist.id, title: currentChecklist.title }] });
    } else {
      onChange({ ...value, checklists: value.checklists.filter((c) => c.id !== currentChecklist.id) });
    }
  };
  const [pickerOpen, setPickerOpen] = useState(false);
  const [galleryKind, setGalleryKind] = useState<MediaKind | null>(null);
  const [groups, setGroups] = useState<ContextGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>("__none__");
  // Track which checklist ids were added by the currently-applied group, so
  // switching/clearing the group only removes those — manual chips stay.
  const [groupAppliedIds, setGroupAppliedIds] = useState<string[]>([]);

  useEffect(() => {
    onUploadingChange?.(false);
  }, [onUploadingChange]);

  useEffect(() => {
    let cancelled = false;
    listGroups()
      .then((gs) => { if (!cancelled) setGroups(gs); })
      .catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, []);

  const handleGroupChange = async (nextId: string) => {
    // Remove previously applied group chips first.
    let nextChecklists = value.checklists.filter((c) => !groupAppliedIds.includes(c.id));
    let nextAppliedIds: string[] = [];
    if (nextId !== "__none__") {
      try {
        const groupChecklists = await getGroupChecklists(nextId);
        const existingIds = new Set(nextChecklists.map((c) => c.id));
        const toAdd = groupChecklists.filter((c) => !existingIds.has(c.id));
        const remaining = MAX_PER_KIND - nextChecklists.length;
        const accepted = toAdd.slice(0, Math.max(0, remaining));
        if (toAdd.length > accepted.length) {
          toast.error(`Group has more checklists than the ${MAX_PER_KIND} limit. Some were skipped.`);
        }
        nextChecklists = [...nextChecklists, ...accepted];
        nextAppliedIds = accepted.map((c) => c.id);
      } catch {
        toast.error("Could not load context group.");
      }
    }
    setSelectedGroupId(nextId);
    setGroupAppliedIds(nextAppliedIds);
    onChange({ ...value, checklists: nextChecklists });
  };


  const countByType = (t: AttachedMedia["type"]) => value.media.filter((m) => m.type === t).length;

  const openGallery = (k: MediaKind) => setGalleryKind(k);

  const onGalleryConfirm = (assets: MediaAsset[]) => {
    if (!galleryKind) return;
    // Replace media of this kind with the picked set, in order. Keep other kinds intact.
    const others = value.media.filter((m) => m.type !== galleryKind);
    const added: AttachedMedia[] = assets.map((a) => ({
      url: a.url, path: a.storage_path, type: a.kind, name: a.title,
    }));
    if (added.length > MAX_PER_KIND) {
      toast.error(`Max ${MAX_PER_KIND} ${galleryKind} attachments.`);
    }
    onChange({ ...value, media: [...others, ...added.slice(0, MAX_PER_KIND)] });
    setGalleryKind(null);
  };

  const removeMedia = (m: AttachedMedia) => {
    // Detach only — never delete the underlying gallery asset.
    onChange({ ...value, media: value.media.filter((x) => x.path !== m.path) });
  };

  const removeChecklist = (id: string) => {
    setGroupAppliedIds((cur) => cur.filter((x) => x !== id));
    onChange({ ...value, checklists: value.checklists.filter((c) => c.id !== id) });
  };

  const totalCount = value.checklists.length + value.media.length;

  const initialIdsForKind = (k: MediaKind | null): string[] => {
    if (!k) return [];
    // We stored storage_path in `path`; for re-open we don't have asset ids. Leave empty.
    return [];
  };

  return (
    <div className="space-y-2 border rounded-md p-3 bg-muted/30">
      {currentChecklist && (
        <label className="flex items-center gap-2 text-xs cursor-pointer select-none pb-1 border-b border-border/50">
          <Checkbox
            checked={isCurrentIncluded}
            onCheckedChange={(v) => toggleCurrent(v === true)}
          />
          <span className="font-medium">Include this checklist as context</span>
        </label>
      )}
      <div className="flex items-center gap-2 pb-1">
        <Layers className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-medium text-muted-foreground shrink-0">Context group:</span>
        <Select value={selectedGroupId} onValueChange={handleGroupChange}>
          <SelectTrigger className="h-8 text-xs flex-1">
            <SelectValue placeholder="None" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">None</SelectItem>
            {groups.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.title} ({g.checklist_count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
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
        <Button type="button" variant="outline" size="sm" onClick={() => openGallery("image")} className="justify-start">
          <ImageIcon className="h-4 w-4" /> Add Image Context
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => openGallery("video")} className="justify-start">
          <Video className="h-4 w-4" /> Add Video Context
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => openGallery("audio")} className="justify-start">
          <Music className="h-4 w-4" /> Add Audio Context
        </Button>
      </div>

      {(value.checklists.length > 0 || value.media.length > 0) && (
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
        </div>
      )}

      <ChecklistMultiPicker
        open={pickerOpen}
        excludeId={excludeChecklistId}
        selected={value.checklists}
        onClose={() => setPickerOpen(false)}
        onConfirm={(picks) => { onChange({ ...value, checklists: picks }); setPickerOpen(false); }}
      />

      {galleryKind && (
        <MediaGalleryPicker
          open={!!galleryKind}
          userId={userId}
          kind={galleryKind}
          mode="multi"
          maxSelected={MAX_PER_KIND}
          initialSelectedIds={initialIdsForKind(galleryKind)}
          onClose={() => setGalleryKind(null)}
          onConfirm={onGalleryConfirm}
        />
      )}
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
