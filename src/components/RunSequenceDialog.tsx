import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ContextAttacher, AttachedContext } from "@/components/ContextAttacher";
import { ChecklistPickerDialog } from "@/components/ChecklistPickerDialog";

const ALL_TOOLS: { key: string; label: string }[] = [
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
    max_images_per_step: number;
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
  const [maxImagesPerStep, setMaxImagesPerStep] = useState(2);
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
        max_images_per_step: maxImagesPerStep,
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
              The agent works through your checklist <span className="font-semibold">one line at a time</span>. The current line turns green and any output is attached directly under it. Each line can also have its own attached media or linked checklist (added on the line itself) — that's its private context. Anything you attach below is shared across the whole run.
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
              <Label className="text-xs">Per-step image count cap: <span className="font-semibold">{maxImagesPerStep}</span></Label>
              <Slider min={1} max={5} step={1} value={[maxImagesPerStep]} onValueChange={(v) => setMaxImagesPerStep(v[0])} className="mt-2" />
            </div>

            <div>
              <Label className="text-xs">Allowed tools</Label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                {ALL_TOOLS.map((t) => (
                  <label key={t.key} className="flex items-center gap-2 text-xs cursor-pointer">
                    <Checkbox checked={allowed.has(t.key)} onCheckedChange={(v) => toggle(t.key, v === true)} />
                    <span>{t.label}</span>
                  </label>
                ))}
              </div>
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
