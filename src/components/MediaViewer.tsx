import { Dialog, DialogContent } from "@/components/ui/dialog";

type Props = {
  open: boolean;
  url: string | null;
  type: string | null;
  onClose: () => void;
};

export const MediaViewer = ({ open, url, type, onClose }: Props) => {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[95vw] sm:max-w-2xl p-2 bg-background">
        {url && (type === "video" ? (
          <video src={url} controls autoPlay className="w-full h-auto rounded-lg" />
        ) : type === "audio" ? (
          <audio src={url} controls autoPlay className="w-full" />
        ) : (
          <img src={url} alt="Media" className="w-full h-auto rounded-lg" />
        ))}
      </DialogContent>
    </Dialog>
  );
};
