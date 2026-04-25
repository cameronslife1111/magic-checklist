import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";

export type GenOptions = {
  aspectRatio: "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
  quality: "standard" | "high";
  files?: File[];
};

type Props = {
  open: boolean;
  title: string;
  prompt: string;
  mode: "text-image" | "image-image" | "remix" | "image-video" | "video-video" | "analyze-image";
  onClose: () => void;
  onGenerate: (opts: GenOptions) => Promise<void> | void;
  generateLabel?: string;
};

export const MediaActionDialog = ({ open, title, prompt, mode, onClose, onGenerate, generateLabel = "Generate" }: Props) => {
  const [aspect, setAspect] = useState<GenOptions["aspectRatio"]>("1:1");
  const [quality, setQuality] = useState<GenOptions["quality"]>("standard");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsImage = mode === "image-image" || mode === "image-video" || mode === "remix" || mode === "analyze-image";
  const needsVideo = mode === "video-video";
  const allowsMultiple = mode === "remix";
  const accept = needsVideo ? "video/*" : "image/*";

  const handleFiles = (list: FileList | null) => {
    if (!list) return;
    let arr = Array.from(list);
    if (mode === "remix") {
      if (arr.length > 16) {
        setError("You can select up to 16 images.");
        arr = arr.slice(0, 16);
      } else setError(null);
    } else {
      arr = arr.slice(0, 1);
      setError(null);
    }
    setFiles(arr);
  };

  const submit = async () => {
    setError(null);
    if ((needsImage || needsVideo) && files.length === 0) {
      setError(needsVideo ? "Select a video to continue." : "Select an image to continue.");
      return;
    }
    setBusy(true);
    try {
      await onGenerate({ aspectRatio: aspect, quality, files: files.length ? files : undefined });
    } catch (e: any) {
      setError(e?.message ?? "Failed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
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
          {(needsImage || needsVideo) && (
            <div className="space-y-2">
              <Label>{needsVideo ? "Select video" : allowsMultiple ? "Select images (up to 16)" : "Select image"}</Label>
              <Input type="file" accept={accept} multiple={allowsMultiple} onChange={(e) => handleFiles(e.target.files)} />
              {files.length > 0 && (
                <p className="text-xs text-muted-foreground">{files.length} file{files.length > 1 ? "s" : ""} selected</p>
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
  );
};
