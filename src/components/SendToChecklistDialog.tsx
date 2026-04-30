import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { sortChecklistsByTitle } from "@/lib/sortChecklists";
export type SendPosition = "top" | "bottom" | "current";

type Props = {
  open: boolean;
  excludeId?: string;
  onClose: () => void;
  onSend: (checklistId: string, checklistTitle: string, position: SendPosition) => void | Promise<void>;
};

export const SendToChecklistDialog = ({ open, excludeId, onClose, onSend }: Props) => {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; title: string }[]>([]);
  const [position, setPosition] = useState<SendPosition>("top");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setPosition("top");
    setSending(false);
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

  const positions: { key: SendPosition; label: string }[] = [
    { key: "top", label: "Top" },
    { key: "current", label: "Current" },
    { key: "bottom", label: "Bottom" },
  ];

  const handlePick = async (id: string, title: string) => {
    if (sending) return;
    setSending(true);
    try {
      await onSend(id, title, position);
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Send to checklist</DialogTitle>
        </DialogHeader>

        <div className="flex gap-2">
          {positions.map((p) => (
            <Button
              key={p.key}
              type="button"
              variant={position === p.key ? "default" : "outline"}
              size="sm"
              className="flex-1"
              onClick={() => setPosition(p.key)}
            >
              {p.label}
            </Button>
          ))}
        </div>

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
                disabled={sending}
                onClick={() => handlePick(r.id, r.title)}
                className="w-full text-left px-4 py-3 hover:bg-accent disabled:opacity-50"
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
