import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ContextAttacher, AttachedContext } from "@/components/ContextAttacher";
import { ChecklistPickerDialog } from "@/components/ChecklistPickerDialog";

const GEN_TOOLS: { key: string; label: string }[] = [
  { key: "text-text", label: "Text → text" },
  { key: "web-search", label: "Web search" },
  { key: "text-image", label: "Text → image" },
  { key: "image-image", label: "Image → image" },
  { key: "remix", label: "Remix images" },
  { key: "image-video", label: "Image → video" },
  { key: "video-video", label: "Video → video" },
  { key: "audio-image-video", label: "Audio + image → video" },
  { key: "analyze-image", label: "Analyze image" },
];

const MGMT_TOOLS: { key: string; label: string }[] = [
  { key: "fetchChecklist", label: "Find checklist" },
  { key: "fetchItems", label: "Read items" },
  { key: "fetchMedia", label: "Search media" },
  { key: "addItem", label: "Add item" },
  { key: "updateItem", label: "Update item" },
  { key: "updateChecklistTitle", label: "Rename checklist" },
  { key: "updateMediaTitle", label: "Rename media" },
  { key: "createChecklist", label: "Create checklist" },
  { key: "createItemAndTriggerJob", label: "Add item + run job" },
];

const ALL_TOOLS = [...GEN_TOOLS, ...MGMT_TOOLS];

const ASPECT_OPTIONS = ["1:1", "16:9", "9:16", "4:3", "3:4"] as const;

type Props = {
  open: boolean;
  userId: string;
  currentChecklist: { id: string; title: string };
  onClose: () => void;
  onSubmit: (args: {
    output_checklist_id: string;
    max_steps: number;
    max_images: number;
    max_videos: number;
    max_runtime_minutes: number;
    default_aspect_ratio: string;
    allowed_actions: string[];
    context: AttachedContext;
  }) => Promise<void>;
};

export const RunSequenceDialog = ({ open, userId, currentChecklist, onClose, onSubmit }: Props) => {
  const [output, setOutput] = useState<{ id: string; title: string }>(currentChecklist);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [maxSteps, setMaxSteps] = useState(12);
  const [maxImages, setMaxImages] = useState(12);
  const [maxVideos, setMaxVideos] = useState(4);
  const [defaultAspect, setDefaultAspect] = useState<string>("1:1");
  const [allowed, setAllowed] = useState<Set<string>>(new Set(ALL_TOOLS.map((t) => t.key)));
  const [context, setContext] = useState<AttachedContext>({ checklists: [], media: [] });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setOutput(currentChecklist);
      setContext({ checklists: [], media: [] });
    }
  }, [open, currentChecklist]);

  const toggle = (k: string, on: boolean) => {
    setAllowed((cur) => {
      const next = new Set(cur);
      if (on) next.add(k); else next.delete(k);
      return next;
    });
  };

  const submit = async () => {
    setBusy(true);
    try {
      await onSubmit({
        output_checklist_id: output.id,
        max_steps: maxSteps,
        max_images: maxImages,
        max_videos: maxVideos,
        max_runtime_minutes: 30,
        default_aspect_ratio: defaultAspect,
        allowed_actions: Array.from(allowed),
        context,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Run as Action Sequence</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <p className="text-muted-foreground text-xs">
              The agent works through your checklist <span className="font-semibold">one line at a time</span>. For each line it picks a single tool, runs it, and adds the output as a new checkbox at the bottom of the output checklist. Attached text context is shared with text-based steps; image and video steps only get the prompt the agent writes for that line.
            </p>

            <div>
              <Label className="text-xs">Output checklist</Label>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPickerOpen(true)}
                className="w-full justify-start mt-1 truncate"
              >
                {output.title}
              </Button>
            </div>

            <div>
              <Label className="text-xs">Max tool calls: <span className="font-semibold">{maxSteps}</span></Label>
              <Slider min={1} max={50} step={1} value={[maxSteps]} onValueChange={(v) => setMaxSteps(v[0])} className="mt-2" />
            </div>
            <div>
              <Label className="text-xs">Max images total: <span className="font-semibold">{maxImages}</span></Label>
              <Slider min={1} max={30} step={1} value={[maxImages]} onValueChange={(v) => setMaxImages(v[0])} className="mt-2" />
            </div>
            <div>
              <Label className="text-xs">Max videos total: <span className="font-semibold">{maxVideos}</span></Label>
              <Slider min={0} max={8} step={1} value={[maxVideos]} onValueChange={(v) => setMaxVideos(v[0])} className="mt-2" />
            </div>

            <div>
              <Label className="text-xs">Default aspect ratio</Label>
              <div className="flex gap-2 mt-1 flex-wrap">
                {ASPECT_OPTIONS.map((a) => (
                  <Button
                    key={a}
                    type="button"
                    size="sm"
                    variant={defaultAspect === a ? "default" : "outline"}
                    onClick={() => setDefaultAspect(a)}
                  >
                    {a}
                  </Button>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                Used when a line doesn't say vertical / horizontal / square.
              </p>
            </div>

            <div>
              <Label className="text-xs">Allowed generation tools</Label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                {GEN_TOOLS.map((t) => (
                  <label key={t.key} className="flex items-center gap-2 text-xs cursor-pointer">
                    <Checkbox checked={allowed.has(t.key)} onCheckedChange={(v) => toggle(t.key, v === true)} />
                    <span>{t.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-xs">Allowed app actions (Magic Checklist CRUD)</Label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                {MGMT_TOOLS.map((t) => (
                  <label key={t.key} className="flex items-center gap-2 text-xs cursor-pointer">
                    <Checkbox checked={allowed.has(t.key)} onCheckedChange={(v) => toggle(t.key, v === true)} />
                    <span>{t.label}</span>
                  </label>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                Lets the agent route work to roster checklists, rename items, etc. Defaults to Cameron Inbox when no destination is named.
              </p>
            </div>

            <ContextAttacher
              userId={userId}
              excludeChecklistId={currentChecklist.id}
              value={context}
              onChange={setContext}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={submit} disabled={busy || allowed.size === 0}>
              {busy ? "Queuing…" : "Run sequence"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ChecklistPickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(id, title) => { setOutput({ id, title }); setPickerOpen(false); }}
      />
    </>
  );
};
