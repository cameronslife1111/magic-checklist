// Floating, non-modal recording indicator for the Magic Steps voice assistant.
// Stays out of the way so the user can still navigate the app while talking.
import { Button } from "@/components/ui/button";
import { Mic, Square, X } from "lucide-react";

type Props = {
  active: boolean;
  onStop: () => void;
  onCancel?: () => void;
};

export const MagicRecordingPill = ({ active, onStop, onCancel }: Props) => {
  if (!active) return null;
  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 bottom-24 z-[70] pointer-events-auto animate-fade-in"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 rounded-full bg-background/95 backdrop-blur border border-red-500/40 shadow-lg px-3 py-2">
        <span className="relative flex h-3 w-3">
          <span className="absolute inset-0 rounded-full bg-red-500/60 animate-ping" />
          <span className="relative h-3 w-3 rounded-full bg-red-500" />
        </span>
        <Mic className="h-4 w-4 text-red-500" />
        <span className="text-xs font-medium text-foreground pr-1">Recording…</span>
        <Button
          size="sm"
          variant="destructive"
          className="h-7 rounded-full px-3 gap-1"
          onClick={onStop}
        >
          <Square className="h-3 w-3" /> Stop
        </Button>
        {onCancel && (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 rounded-full"
            onClick={onCancel}
            aria-label="Cancel recording"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
};
