import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChecklistItem } from "@/lib/types";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  item: ChecklistItem;
  isActive?: boolean;
};

export const SortableItemRow = ({ item, isActive }: Props) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex gap-3 px-4 py-3 rounded-2xl bg-card/60 border border-border touch-none select-none",
        isActive && "glow-active",
        isDragging && "opacity-60 shadow-floating z-10"
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        className="shrink-0 self-center h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent cursor-grab active:cursor-grabbing"
      >
        <GripVertical className="h-5 w-5" />
      </button>
      <div className="flex-1 min-w-0">
        <p className={cn("text-[15px] leading-snug break-words", item.checked && "line-through text-[hsl(var(--checked))]")}>
          {item.text || (item.linked_checklist_id ? "Open checklist" : item.external_link || "Item…")}
        </p>
        {item.media_url && (
          <div className="mt-2 rounded-xl overflow-hidden border border-border bg-muted max-w-[160px]">
            {item.media_type === "video" ? (
              <video src={item.media_url} className="w-full h-auto" muted playsInline />
            ) : (
              <img src={item.media_url} alt="" className="w-full h-auto" loading="lazy" />
            )}
          </div>
        )}
      </div>
    </li>
  );
};
