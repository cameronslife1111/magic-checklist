import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { sortChecklistsByTitle } from "@/lib/sortChecklists";

type Props = {
  open: boolean;
  excludeId?: string;
  onClose: () => void;
  onPick: (id: string, title: string) => void;
};

export const ChecklistPickerDialog = ({ open, excludeId, onClose, onPick }: Props) => {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; title: string }[]>([]);

  useEffect(() => {
    if (!open) return;
    setQ("");
  }, [open]);

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

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Insert checklist link</DialogTitle>
        </DialogHeader>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search checklists" autoFocus />
        <ul className="max-h-72 overflow-y-auto divide-y divide-border -mx-2">
          {results.length === 0 ? (
            <li className="px-4 py-6 text-sm text-muted-foreground">No checklist found.</li>
          ) : results.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => onPick(r.id, r.title)}
                className="w-full text-left px-4 py-3 hover:bg-accent"
              >
                {r.title}
              </button>
            </li>
          ))}
        </ul>
        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
