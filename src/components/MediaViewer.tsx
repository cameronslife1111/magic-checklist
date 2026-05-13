import { useEffect, useRef } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, ChevronLeft, ChevronRight } from "lucide-react";
import { triggerDirectDownload, MediaAsset } from "@/lib/mediaAssets";

type Props = {
  items: MediaAsset[];
  index: number | null;
  onIndexChange: (i: number) => void;
  onClose: () => void;
};

export const MediaViewer = ({ items, index, onIndexChange, onClose }: Props) => {
  const open = index !== null && index >= 0 && index < items.length;
  const active = open ? items[index!] : null;
  const count = items.length;

  const go = (delta: number) => {
    if (count === 0 || index === null) return;
    onIndexChange(((index + delta) % count + count) % count);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, index, count]);

  const touchStartX = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const dx = (e.changedTouches[0]?.clientX ?? touchStartX.current) - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
  };

  const handleDownload = () => {
    if (!active) return;
    triggerDirectDownload({
      url: active.url,
      title: active.title || "magic-checklist",
      mime_type: active.mime_type ?? null,
      storage_path: active.storage_path ?? "",
      kind: active.kind,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[95vw] sm:max-w-3xl max-h-[90vh] p-2 bg-background flex flex-col">
        {active && (
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

            <div
              className="flex-1 min-h-0 flex items-center justify-center overflow-hidden relative"
              onTouchStart={onTouchStart}
              onTouchEnd={onTouchEnd}
            >
              {active.kind === "video" ? (
                <video
                  key={active.id}
                  src={active.url}
                  controls
                  playsInline
                  className="max-h-[80vh] max-w-full w-auto h-auto rounded-lg"
                />
              ) : active.kind === "audio" ? (
                <audio key={active.id} src={active.url} controls className="w-full" />
              ) : (
                <img
                  key={active.id}
                  src={active.url}
                  alt={active.title || "Media"}
                  className="max-h-[80vh] max-w-full w-auto h-auto object-contain rounded-lg"
                />
              )}
            </div>

            {count > 1 && (
              <>
                <Button
                  size="icon"
                  variant="secondary"
                  onClick={() => go(-1)}
                  aria-label="Previous"
                  className="absolute left-2 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full shadow-md z-10"
                >
                  <ChevronLeft className="h-5 w-5" />
                </Button>
                <Button
                  size="icon"
                  variant="secondary"
                  onClick={() => go(1)}
                  aria-label="Next"
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full shadow-md z-10"
                >
                  <ChevronRight className="h-5 w-5" />
                </Button>
              </>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
