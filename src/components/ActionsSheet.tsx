import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  Plus, FilePlus, FilePlus2, Copy, CopyPlus, Pencil, Scissors, Type, Image as ImageIcon, Images, Wand2,
  Film, Video, Mic2, Link2, Eye, Search, Palette, LogOut, Moon, Sun, ArrowUpDown,
  ClipboardCopy, ClipboardList, Send, Volume2, VolumeX, ListChecks, Trash2, Library, Square, Smile, Combine,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type ActionKey =
  | "mute" | "queue"
  | "add" | "duplicate-item" | "new" | "duplicate" | "delete-checklist" | "edit-title" | "split" | "split-emoji"
  | "text-text" | "text-image" | "image-image" | "remix" | "image-video" | "video-video" | "audio-image-video"
  | "insert-link" | "analyze-image" | "web-search" | "bg" | "rearrange"
  | "copy-sentence" | "copy-checklist" | "send-to" | "send-to-blank" | "uncheck-all" | "media-gallery" | "theme" | "sign-out";

const AI_KEYS = new Set<ActionKey>([
  "text-text", "text-image", "image-image", "remix",
  "image-video", "video-video", "audio-image-video",
  "analyze-image", "web-search",
]);

const STATIC_ITEMS: { key: Exclude<ActionKey, "theme">; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  // Top: moved-up quick actions (right under Mute)
  { key: "split",            label: "Split current checkbox",   icon: Scissors },
  { key: "split-emoji",      label: "Split by emoji",           icon: Smile },
  { key: "send-to-blank",    label: "Send to blank checklist",  icon: FilePlus2 },
  { key: "rearrange",        label: "Rearrange checkboxes",     icon: ArrowUpDown },

  // Most-used quick utilities
  { key: "copy-sentence",    label: "Copy sentence",            icon: ClipboardCopy },
  { key: "copy-checklist",   label: "Copy full checklist",      icon: ClipboardList },
  { key: "insert-link",      label: "Insert checklist link",    icon: Link2 },
  { key: "add",              label: "Add new checkbox",         icon: Plus },
  { key: "duplicate-item",   label: "Duplicate checkbox",       icon: CopyPlus },
  { key: "uncheck-all",      label: "Uncheck all checkboxes",   icon: Square },
  { key: "media-gallery",    label: "Media Gallery",            icon: Library },
  { key: "bg",               label: "Change checklist background", icon: Palette },

  // Middle: AI actions (rendered in blue)
  { key: "text-text",        label: "Text to text",             icon: Type },
  { key: "text-image",       label: "Text to image",            icon: ImageIcon },
  { key: "image-image",      label: "Image to image",           icon: Wand2 },
  { key: "remix",            label: "Remix multiple images",    icon: Images },
  { key: "image-video",      label: "Image to video",           icon: Film },
  { key: "video-video",      label: "Video to video",           icon: Video },
  { key: "audio-image-video",label: "Audio + image to video",   icon: Mic2 },
  { key: "analyze-image",    label: "Analyze image",            icon: Eye },
  { key: "web-search",       label: "Text to web search",       icon: Search },

  // Bottom: rare / destructive
  { key: "edit-title",       label: "Edit checklist title",     icon: Pencil },
  { key: "new",              label: "New checklist",            icon: FilePlus },
  { key: "duplicate",        label: "Duplicate checklist",      icon: Copy },
  { key: "delete-checklist", label: "Delete checklist",         icon: Trash2 },
];

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPick: (k: ActionKey) => void;
  currentTheme: "light" | "dark";
  muted: boolean;
};

export const ActionsSheet = ({ open, onOpenChange, onPick, currentTheme, muted }: Props) => {
  const muteItem = muted
    ? { key: "mute" as const, label: "Unmute speech", icon: Volume2 }
    : { key: "mute" as const, label: "Mute speech", icon: VolumeX };
  const sendToItem = { key: "send-to" as const, label: "Send to checklist", icon: Send };
  const queueItem = { key: "queue" as const, label: "Action Queue Dashboard", icon: ListChecks };
  const themeItem = currentTheme === "dark"
    ? { key: "theme" as const, label: "Switch to light mode", icon: Sun }
    : { key: "theme" as const, label: "Switch to dark mode", icon: Moon };
  const signOutItem = { key: "sign-out" as const, label: "Sign out", icon: LogOut };
  const items = [sendToItem, queueItem, muteItem, ...STATIC_ITEMS, themeItem, signOutItem];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-3xl p-0 max-h-[85vh] flex flex-col border-border"
      >
        <div className="px-4 pt-3 pb-2">
          <div className="mx-auto h-1.5 w-10 rounded-full bg-muted-foreground/30" />
        </div>
        <h2 className="px-5 text-lg font-semibold pb-2">Actions</h2>
        <div className="flex-1 overflow-y-auto px-3 pb-6 safe-bottom">
          <ul className="flex flex-col gap-1">
            {items.map((it) => {
              const Icon = it.icon;
              const isAI = AI_KEYS.has(it.key as ActionKey);
              return (
                <li key={it.key}>
                  <Button
                    variant="ghost"
                    onClick={() => onPick(it.key)}
                    className={cn(
                      "w-full h-12 justify-start gap-3 text-base font-medium",
                      isAI && "text-blue-500 hover:text-blue-500",
                    )}
                  >
                    <Icon className={cn("h-5 w-5", isAI ? "text-blue-500" : "text-muted-foreground")} />
                    {it.label}
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      </SheetContent>
    </Sheet>
  );
};
