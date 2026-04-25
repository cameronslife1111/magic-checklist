import { useEffect, useRef, useState } from "react";
import { ChecklistItem } from "@/lib/types";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { ExternalLink, Link2, X } from "lucide-react";

type Props = {
  item: ChecklistItem;
  onToggle: (item: ChecklistItem, next: boolean) => void;
  onTextChange: (item: ChecklistItem, text: string) => void;
  onOpenLinkedChecklist: (id: string) => void;
  onOpenMedia: (url: string, type: string) => void;
  onDelete: (item: ChecklistItem) => void;
  registerRef: (id: string, el: HTMLLIElement | null) => void;
  autoFocus?: boolean;
  isActive?: boolean;
};

export const ItemRow = ({
  item, onToggle, onTextChange, onOpenLinkedChecklist, onOpenMedia, onDelete, registerRef, autoFocus, isActive,
}: Props) => {
  const [text, setText] = useState(item.text);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setText(item.text), [item.text]);

  useEffect(() => {
    if (autoFocus && taRef.current) {
      taRef.current.focus();
      taRef.current.select?.();
    }
  }, [autoFocus]);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
  }, [text]);

  const isExternalLink = !!item.external_link;
  const isInternalLink = !!item.linked_checklist_id;

  return (
    <li
      ref={(el) => registerRef(item.id, el)}
      className={cn(
        "flex gap-3 px-4 py-3 rounded-2xl bg-card/60 transition-all",
        item.checked && "opacity-80",
        isActive && "glow-active"
      )}
    >
      <div className="pt-1">
        <Checkbox
          checked={item.checked}
          onCheckedChange={(v) => onToggle(item, !!v)}
          aria-label={item.checked ? "Mark unchecked" : "Mark checked"}
          className="h-6 w-6 rounded-md"
        />
      </div>
      <div className="flex-1 min-w-0">
        {isInternalLink ? (
          <button
            type="button"
            onClick={() => onOpenLinkedChecklist(item.linked_checklist_id!)}
            className={cn(
              "text-left w-full inline-flex items-center gap-1.5 underline-offset-4 hover:underline text-primary",
              item.checked && "line-through text-[hsl(var(--checked))]"
            )}
          >
            <Link2 className="h-4 w-4 shrink-0" />
            <span className="break-words">{item.text || "Open checklist"}</span>
          </button>
        ) : isExternalLink ? (
          <a
            href={item.external_link!}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "inline-flex items-start gap-1.5 underline-offset-4 hover:underline text-primary break-all",
              item.checked && "line-through text-[hsl(var(--checked))]"
            )}
          >
            <ExternalLink className="h-4 w-4 mt-1 shrink-0" />
            <span>{item.text || item.external_link}</span>
          </a>
        ) : (
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => { if (text !== item.text) onTextChange(item, text); }}
            rows={1}
            className={cn(
              "w-full resize-none bg-transparent outline-none text-[15px] leading-snug",
              item.checked && "line-through text-[hsl(var(--checked))]"
            )}
            placeholder="Item…"
          />
        )}

        {item.media_url && (
          <button
            type="button"
            onClick={() => onOpenMedia(item.media_url!, item.media_type || "image")}
            className="mt-2 block rounded-xl overflow-hidden border border-border bg-muted max-w-[220px]"
            aria-label="Open media"
          >
            {item.media_type === "video" ? (
              <video src={item.media_url} className="w-full h-auto" muted playsInline />
            ) : (
              <img src={item.media_url} alt="Generated media" className="w-full h-auto" loading="lazy" />
            )}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => onDelete(item)}
        aria-label="Delete item"
        className="shrink-0 self-start mt-0.5 h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
      >
        <X className="h-4 w-4" />
      </button>
    </li>
  );
};
