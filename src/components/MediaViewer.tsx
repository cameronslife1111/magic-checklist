import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { toast } from "sonner";

type Props = {
  open: boolean;
  url: string | null;
  type: string | null;
  onClose: () => void;
};

const extFor = (type: string | null, mime?: string): string => {
  if (mime) {
    const sub = mime.split("/")[1]?.split(";")[0];
    if (sub) return sub === "jpeg" ? "jpg" : sub === "quicktime" ? "mov" : sub;
  }
  if (type === "video") return "mp4";
  if (type === "audio") return "mp3";
  return "png";
};

export const MediaViewer = ({ open, url, type, onClose }: Props) => {
  const handleDownload = async () => {
    if (!url) return;
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`download failed: ${r.status}`);
      const blob = await r.blob();
      const ext = extFor(type, blob.type);
      const obj = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = obj;
      a.download = `magic-checklist.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(obj), 1000);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not download. Try again.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[95vw] sm:max-w-2xl p-2 bg-background">
        {url && (
          <>
            <div className="absolute right-12 top-3 z-10">
              <Button
                size="sm"
                variant="secondary"
                onClick={handleDownload}
                className="h-8 gap-1.5 shadow-md"
              >
                <Download className="h-4 w-4" />
                Download
              </Button>
            </div>
            {type === "video" ? (
              <video src={url} controls autoPlay className="w-full h-auto rounded-lg" />
            ) : type === "audio" ? (
              <audio src={url} controls autoPlay className="w-full" />
            ) : (
              <img src={url} alt="Media" className="w-full h-auto rounded-lg" />
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
