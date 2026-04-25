import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type Props = {
  open: boolean;
  title: string;
  label: string;
  initial?: string;
  saveLabel?: string;
  onClose: () => void;
  onSave: (value: string) => Promise<void> | void;
};

export const TextPromptDialog = ({ open, title, label, initial = "", saveLabel = "Save", onClose, onSave }: Props) => {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);

  // Reset the input every time the dialog opens, so callers always see the
  // latest `initial` value (e.g. the title of the checklist currently open).
  useEffect(() => {
    if (open) setValue(initial);
  }, [open, initial]);

  const handleOpen = (o: boolean) => {
    if (!o) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label>{label}</Label>
          <Input value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={busy || !value.trim()}
            onClick={async () => {
              setBusy(true);
              try { await onSave(value.trim()); } finally { setBusy(false); }
            }}
          >
            {busy ? "Saving…" : saveLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
