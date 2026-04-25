import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Image as ImageIcon, Video, Library } from "lucide-react";
import { MediaGalleryPicker } from "@/components/MediaGalleryPicker";
import { MediaAsset } from "@/lib/mediaAssets";

export type GenOptions = {
  aspectRatio: "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
  quality: "standard" | "high";
  assets?: MediaAsset[]; // ordered selection from gallery
};

type Props = {
  open: boolean;
  title: string;
  prompt: string;
  mode: "text-image" | "image-image" | "remix" | "image-video" | "video-video" | "analyze-image";
  userId: string;
  onClose: () => void;
  onGenerate: (opts: GenOptions) => Promise<void> | void;
  generateLabel?: string;
};

export const MediaActionDialog = ({ open, title, prompt, mode, userId, onClose, onGenerate, generateLabel = "Generate" }: Props) => {
  const [aspect, setAspect] = useState<GenOptions["aspectRatio"]>("1:1");
  const [quality, setQuality] = useState<GenOptions["quality"]>("standard");
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (open) { setAssets([]); setError(null); } }, [open]);

  const needsMedia = mode !== "text-image";
  const needsVideo = mode === "video-video";
  const allowsMultiple = mode === "remix";
  const pickerKind: "image" | "video" = needsVideo ? "video" : "image";
  const pickerMode: "single" | "multi" = allowsMultiple ? "multi" : "single";

  const submit = async () => {
    setError(null);
    if (needsMedia && assets.length === 0) {
      setError(needsVideo ? "Pick a video from your Media Gallery." : "Pick an image from your Media Gallery.");
      return;
    }
    setBusy(true);
    try {
      await onGenerate({ aspectRatio: aspect, quality, assets: assets.length ? assets : undefined });
    } catch (e: any) {
      setError(e?.message ?? "Failed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const KindIcon = pickerKind === "video" ? Video : ImageIcon;

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Prompt</Label>
              <p className="text-sm bg-muted rounded-lg p-3 mt-1 max-h-28 overflow-y-auto">{prompt}</p>
            </div>

            {needsMedia && (
              <div className="space-y-2">
                <Label>{allowsMultiple ? "Media (in order)" : `Media (${pickerKind})`}</Label>
                <Button type="button" variant="outline" onClick={() => setPickerOpen(true)} className="w-full justify-start">
                  <Library className="h-4 w-4" />
                  {assets.length === 0
                    ? `Choose from Media Gallery`
                    : allowsMultiple
                      ? `${assets.length} selected — change`
                      : `Change selection`}
                </Button>
                {assets.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5 pt-1">
                    {assets.map((a, i) => (
                      <li
                        key={a.id}
                        className="inline-flex items-center gap-1.5 text-xs bg-background border rounded-full pl-1 pr-2 py-0.5 max-w-[200px]"
                      >
                        <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-blue-500 text-white text-[10px] font-bold shrink-0">
                          {i + 1}
                        </span>
                        <KindIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="truncate">{a.title}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {allowsMultiple && (
                  <p className="text-xs text-muted-foreground">
                    The model receives images in this order. Refer to them in your prompt as "image 1", "image 2", etc.
                  </p>
                )}
              </div>
            )}

            {mode !== "analyze-image" && (
              <>
                <div className="space-y-2">
                  <Label>Aspect ratio</Label>
                  <Select value={aspect} onValueChange={(v) => setAspect(v as GenOptions["aspectRatio"])}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1:1">Square (1:1)</SelectItem>
                      <SelectItem value="16:9">Landscape (16:9)</SelectItem>
                      <SelectItem value="9:16">Portrait (9:16)</SelectItem>
                      <SelectItem value="4:3">4:3</SelectItem>
                      <SelectItem value="3:4">3:4</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Quality</Label>
                  <Select value={quality} onValueChange={(v) => setQuality(v as GenOptions["quality"])}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="standard">Standard</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={submit} disabled={busy}>{busy ? "Working…" : generateLabel}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {needsMedia && (
        <MediaGalleryPicker
          open={pickerOpen}
          userId={userId}
          kind={pickerKind}
          mode={pickerMode}
          maxSelected={16}
          initialSelectedIds={assets.map((a) => a.id)}
          onClose={() => setPickerOpen(false)}
          onConfirm={(picked) => { setAssets(picked); setPickerOpen(false); }}
        />
      )}
    </>
  );
};
