import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { markPickJustHappened } from "@/lib/clickGuard";

type Props = {
  onPick: (id: string) => void;
};

export const ChecklistSearch = ({ onPick }: Props) => {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; title: string }[]>([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      let query = supabase.from("checklists").select("id,title").order("updated_at", { ascending: false }).limit(20);
      if (q.trim()) query = query.ilike("title", `%${q.trim()}%`);
      const { data } = await query;
      if (!cancelled) setResults(data ?? []);
    }, 150);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  const handlePick = (id: string) => {
    // Mark the moment of pick so any follow-up "ghost click" within ~500ms
    // (synthesized by iOS Safari after pointerdown) on elements underneath
    // the dropdown can be ignored by their click handlers.
    markPickJustHappened();

    // Belt-and-suspenders: also try to swallow the next click event itself.
    const swallow = (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, { capture: true } as any), 500);

    onPick(id);
    setQ("");
    setOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div ref={wrapRef} className="relative">
      <Input
        ref={inputRef}
        value={q}
        onChange={(e) => { setQ(e.target.value); if (!open) setOpen(true); }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
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
                    onPointerDown={(e) => { e.preventDefault(); handlePick(r.id); }}
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
