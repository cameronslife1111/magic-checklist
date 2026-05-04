import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X } from "lucide-react";
import {
  SLOT_COUNT,
  loadFavorites,
  setSlot,
  type FavoriteSlots,
} from "@/lib/homeFavorites";
import { sortChecklistsByTitle } from "@/lib/sortChecklists";

type Props = {
  open: boolean;
  onClose: () => void;
};

export const HomeFavoritesDialog = ({ open, onClose }: Props) => {
  const [slots, setSlots] = useState<FavoriteSlots>(() => loadFavorites());
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [pickingIndex, setPickingIndex] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; title: string }[]>([]);

  // Refresh slots & titles when opened
  useEffect(() => {
    if (!open) return;
    const loaded = loadFavorites();
    setSlots(loaded);
    setPickingIndex(null);
    setQ("");
    const ids = loaded.filter((s): s is string => !!s);
    if (ids.length === 0) {
      setTitles({});
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("checklists").select("id,title").in("id", ids);
      if (cancelled) return;
      const map: Record<string, string> = {};
      (data ?? []).forEach((r) => { map[r.id] = r.title; });
      setTitles(map);
    })();
    return () => { cancelled = true; };
  }, [open]);

  // Search results when picking
  useEffect(() => {
    if (pickingIndex === null) return;
    let cancelled = false;
    (async () => {
      let query = supabase.from("checklists").select("id,title").order("title", { ascending: true }).limit(200);
      if (q.trim()) query = query.ilike("title", `%${q.trim()}%`);
      const { data } = await query;
      if (!cancelled) setResults(sortChecklistsByTitle(data ?? []));
    })();
    return () => { cancelled = true; };
  }, [q, pickingIndex]);

  const handleAssign = async (id: string, title: string) => {
    if (pickingIndex === null) return;
    const next = setSlot(pickingIndex, id);
    setSlots(next);
    setTitles((t) => ({ ...t, [id]: title }));
    setPickingIndex(null);
    setQ("");
  };

  const handleClear = (idx: number) => {
    const next = setSlot(idx, null);
    setSlots(next);
  };

  const slotRows = useMemo(() => {
    return Array.from({ length: SLOT_COUNT }, (_, i) => {
      const id = slots[i];
      const title = id ? (titles[id] ?? "(missing checklist)") : null;
      return { i, id, title };
    });
  }, [slots, titles]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {pickingIndex === null ? "Manage Home Favorites" : `Pick checklist for slot ${pickingIndex + 1}`}
          </DialogTitle>
        </DialogHeader>

        {pickingIndex === null ? (
          <>
            <p className="text-sm text-muted-foreground">
              Tap Home to cycle through these checklists. Empty slots are skipped.
            </p>
            <ul className="flex flex-col gap-2">
              {slotRows.map(({ i, id, title }) => (
                <li key={i} className="flex items-center gap-2">
                  <button
                    onClick={() => { setPickingIndex(i); setQ(""); }}
                    className="flex-1 text-left px-3 py-3 rounded-md border border-border hover:bg-accent flex items-center gap-3"
                  >
                    <span className="w-6 h-6 flex items-center justify-center rounded-full bg-muted text-xs font-semibold">
                      {i + 1}
                    </span>
                    <span className={id ? "font-medium" : "text-muted-foreground"}>
                      {id ? title : "Empty — tap to assign"}
                    </span>
                  </button>
                  {id && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove slot ${i + 1}`}
                      onClick={() => handleClear(i)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            <div className="flex justify-end">
              <Button onClick={onClose}>Done</Button>
            </div>
          </>
        ) : (
          <>
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search checklists"
              autoFocus
            />
            <ul className="max-h-72 overflow-y-auto divide-y divide-border -mx-2">
              {results.length === 0 ? (
                <li className="px-4 py-6 text-sm text-muted-foreground">No checklist found.</li>
              ) : results.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => handleAssign(r.id, r.title)}
                    className="w-full text-left px-4 py-3 hover:bg-accent"
                  >
                    {r.title}
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex justify-end">
              <Button variant="ghost" onClick={() => { setPickingIndex(null); setQ(""); }}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
