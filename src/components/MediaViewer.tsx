import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { triggerDirectDownload } from "@/lib/mediaAssets";

type Props = {
  open: boolean;
  url: string | null;
  type: string | null;
  title?: string | null;
  mimeType?: string | null;
  storagePath?: string | null;
  onClose: () => void;
};

export const MediaViewer = ({ open, url, type, title, mimeType, storagePath, onClose }: Props) => {
  const handleDownload = () => {
    if (!url) return;
    const kind = (type === "video" || type === "audio" || type === "image"
      ? type
      : "image") as "image" | "video" | "audio";
    triggerDirectDownload({
      url,
      title: title || "magic-checklist",
      mime_type: mimeType ?? null,
      storage_path: storagePath ?? "",
      kind,
    });
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
              <video src={url} controls playsInline className="w-full h-auto rounded-lg" />
            ) : type === "audio" ? (
              <audio src={url} controls className="w-full" />
            ) : (
              <img src={url} alt="Media" className="w-full h-auto rounded-lg" />
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
