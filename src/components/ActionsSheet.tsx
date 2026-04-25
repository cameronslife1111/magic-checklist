import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  Plus, FilePlus, Copy, Pencil, Scissors, Type, Image as ImageIcon, Images, Wand2,
  Film, Video, Link2, Eye, Search, Palette, LogOut, Moon, Sun, ArrowUpDown,
  ClipboardCopy, ClipboardList, Send,
} from "lucide-react";

export type ActionKey =
  | "add" | "new" | "duplicate" | "edit-title" | "split"
  | "text-text" | "text-image" | "image-image" | "remix" | "image-video" | "video-video"
  | "insert-link" | "analyze-image" | "web-search" | "bg" | "rearrange"
  | "copy-sentence" | "copy-checklist" | "send-to" | "theme" | "sign-out";

const STATIC_ITEMS: { key: Exclude<ActionKey, "theme">; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "add",            label: "Add new checkbox",        icon: Plus },
  { key: "send-to",        label: "Send to checklist",       icon: Send },
  { key: "new",            label: "New checklist",           icon: FilePlus },
  { key: "duplicate",      label: "Duplicate checklist",     icon: Copy },
  { key: "edit-title",     label: "Edit checklist title",    icon: Pencil },
  { key: "split",          label: "Split current checkbox",  icon: Scissors },
  { key: "text-text",      label: "Text to text",            icon: Type },
  { key: "text-image",     label: "Text to image",           icon: ImageIcon },
  { key: "image-image",    label: "Image to image",          icon: Wand2 },
  { key: "remix",          label: "Remix multiple images",   icon: Images },
  { key: "image-video",    label: "Image to video",          icon: Film },
  { key: "video-video",    label: "Video to video",          icon: Video },
  { key: "insert-link",    label: "Insert checklist link",   icon: Link2 },
  { key: "analyze-image",  label: "Analyze image",           icon: Eye },
  { key: "web-search",     label: "Text to web search",      icon: Search },
  { key: "bg",             label: "Change checklist background", icon: Palette },
  { key: "rearrange",      label: "Rearrange checkboxes",    icon: ArrowUpDown },
  { key: "copy-sentence",  label: "Copy sentence",           icon: ClipboardCopy },
  { key: "copy-checklist", label: "Copy full checklist",     icon: ClipboardList },
  { key: "send-to",        label: "Send to checklist",       icon: Send },
];

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPick: (k: ActionKey) => void;
  currentTheme: "light" | "dark";
};

export const ActionsSheet = ({ open, onOpenChange, onPick, currentTheme }: Props) => {
  const themeItem = currentTheme === "dark"
    ? { key: "theme" as const, label: "Switch to light mode", icon: Sun }
    : { key: "theme" as const, label: "Switch to dark mode", icon: Moon };
  const signOutItem = { key: "sign-out" as const, label: "Sign out", icon: LogOut };
  const items = [...STATIC_ITEMS, themeItem, signOutItem];

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
              return (
                <li key={it.key}>
                  <Button
                    variant="ghost"
                    onClick={() => onPick(it.key)}
                    className="w-full h-12 justify-start gap-3 text-base font-medium"
                  >
                    <Icon className="h-5 w-5 text-muted-foreground" />
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
