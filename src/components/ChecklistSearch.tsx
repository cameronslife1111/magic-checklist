import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";

type Props = {
  onPick: (id: string) => void;
};

export const ChecklistSearch = ({ onPick }: Props) => {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; title: string }[]>([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      let query = supabase.from("checklists").select("id,title").order("updated_at", { ascending: false }).limit(20);
      if (q.trim()) query = query.ilike("title", `%${q.trim()}%`);
      const { data } = await query;
      if (!cancelled) setResults(data ?? []);
    })();
    return () => { cancelled = true; };
  }, [q, open]);

  return (
    <div ref={wrapRef} className="relative">
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setOpen(true)}
        placeholder="Search checklists"
        aria-label="Search checklists"
        className="h-11 rounded-xl bg-card shadow-soft"
      />
      {open && (
        <div className="absolute top-full mt-2 left-0 right-0 bg-popover border border-border rounded-xl shadow-floating z-30 max-h-72 overflow-y-auto">
          {results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">No checklist found.</p>
          ) : (
            <ul>
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { onPick(r.id); setQ(""); setOpen(false); }}
                    className="w-full text-left px-4 py-2.5 hover:bg-accent text-sm"
                  >
                    {r.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
