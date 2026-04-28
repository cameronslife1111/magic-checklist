import { useEffect, useRef, useState } from "react";
import { ChecklistItem } from "@/lib/types";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { ExternalLink, Link2, X } from "lucide-react";
import { notifyDictationDetected, notifyDictationEnd } from "@/lib/speech";

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
  isRunning?: boolean;
  isChild?: boolean;
  childLabel?: string;
};

export const ItemRow = ({
  item, onToggle, onTextChange, onOpenLinkedChecklist, onOpenMedia, onDelete, registerRef, autoFocus,
  isActive, isRunning, isChild, childLabel,
}: Props) => {
  const [text, setText] = useState(item.text);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLTextAreaElement>(null);
  const dictatingRef = useRef(false);
  useEffect(() => setText(item.text), [item.text]);

  useEffect(() => {
    if (autoFocus && taRef.current) {
      taRef.current.focus();
      taRef.current.select?.();
    }
  }, [autoFocus]);

  // Auto-size the textarea by measuring a hidden mirror with the same width
  // and content. We never collapse the live textarea's height to "auto" —
  // doing so causes a layout reflow that, on iOS Safari, triggers a caret
  // keep-in-view scroll correction (the page jumps to the top and back while
  // typing). Measuring on a sibling avoids that entirely.
  useEffect(() => {
    const ta = taRef.current;
    const mirror = mirrorRef.current;
    if (!ta || !mirror) return;
    mirror.style.width = ta.clientWidth + "px";
    mirror.value = text || " ";
    const next = mirror.scrollHeight;
    const cur = ta.clientHeight;
    if (Math.abs(next - cur) > 1) {
      ta.style.height = next + "px";
    }
  }, [text]);

  const isExternalLink = !!item.external_link;
  const isInternalLink = !!item.linked_checklist_id;

  return (
    <li
      ref={(el) => registerRef(item.id, el)}
      className={cn(
        "flex gap-3 px-4 py-3 rounded-2xl bg-card/60 transition-all",
        item.checked && "opacity-80",
        isActive && "glow-active",
        isRunning && "bg-green-500/15 ring-2 ring-green-500/60 animate-pulse",
        isChild && "bg-muted/40",
      )}
    >
      {isRunning && (
        <span className="absolute -mt-1 -ml-1 text-[10px] font-semibold text-green-700 bg-green-100 dark:bg-green-900/40 dark:text-green-300 px-1.5 py-0.5 rounded-full">
          ▶ Running…
        </span>
      )}
      {childLabel && (
        <span className="absolute -mt-2 ml-2 text-[10px] font-medium text-muted-foreground bg-background px-1.5 rounded">
          {childLabel}
        </span>
      )}
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
            onFocus={() => { dictatingRef.current = false; }}
            onInput={(e) => {
              const ne = e.nativeEvent as InputEvent;
              const it = ne.inputType || "";
              const data: any = (ne as any).data;
              // iOS Safari: explicit dictation event.
              // Android Chrome: composition inserts, or chunked insertText
              // (multi-char with null/long data) — heuristic catches both.
              const isDictation =
                it === "insertFromDictation" ||
                it === "insertCompositionText" ||
                (it === "insertText" && (data == null || (typeof data === "string" && data.length > 1)));
              if (isDictation && !dictatingRef.current) {
                dictatingRef.current = true;
                notifyDictationDetected();
              }
            }}
            onBlur={() => {
              const wasDictating = dictatingRef.current;
              dictatingRef.current = false;
              if (text !== item.text) onTextChange(item, text);
              if (wasDictating) notifyDictationEnd();
            }}
            rows={1}
            className={cn(
              "w-full resize-none bg-transparent outline-none text-base md:text-[15px] leading-snug",
              item.checked && "line-through text-[hsl(var(--checked))]"
            )}
            placeholder="Item…"
          />
        )}

        {/* Hidden mirror used to measure required textarea height without
            collapsing the live textarea (which would cause iOS scroll jumps). */}
        <textarea
          ref={mirrorRef}
          tabIndex={-1}
          aria-hidden="true"
          readOnly
          rows={1}
          className="resize-none bg-transparent text-base md:text-[15px] leading-snug absolute -left-[9999px] top-0 invisible pointer-events-none"
          style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
        />

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
