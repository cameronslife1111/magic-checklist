import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const COLORS = [
  "#fcfbf8", "#ffffff", "#f4f1ea", "#fff7ed", "#fef2f2", "#fdf4ff",
  "#eef2ff", "#eff6ff", "#ecfeff", "#ecfdf5", "#f0fdf4", "#fefce8",
  "#1f2937", "#0f172a",
];

type Props = {
  open: boolean;
  current: string;
  onClose: () => void;
  onPick: (color: string) => void;
};

export const BackgroundPickerDialog = ({ open, current, onClose, onPick }: Props) => {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Change background</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-6 gap-3 py-2">
          {COLORS.map((c) => (
            <button
              key={c}
              aria-label={`Use ${c}`}
              onClick={() => onPick(c)}
              className={cn(
                "h-12 rounded-xl border border-border transition-transform hover:scale-105",
                current === c && "ring-2 ring-primary"
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};
