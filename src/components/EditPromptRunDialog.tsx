import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type EditPromptMode = "rerun" | "recurring";
export type Recurrence = "hourly" | "daily" | "weekly" | "monthly" | "yearly";

type Props = {
  open: boolean;
  mode: EditPromptMode;
  actionLabel: string;
  initialPrompt: string;
  onCancel: () => void;
  onConfirm: (args: {
    prompt: string;
    recurrence?: Recurrence;
    scheduled_for?: string;
  }) => Promise<void> | void;
};

const defaultLocal = () => {
  const d = new Date(Date.now() + 5 * 60_000);
  d.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const EditPromptRunDialog = ({
  open, mode, actionLabel, initialPrompt, onCancel, onConfirm,
}: Props) => {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [recurrence, setRecurrence] = useState<Recurrence>("daily");
  const [when, setWhen] = useState<string>(defaultLocal());
  const [busy, setBusy] = useState(false);

  // Reset state every time the dialog opens with new inputs.
  useEffect(() => {
    if (open) {
      setPrompt(initialPrompt);
      setRecurrence("daily");
      setWhen(defaultLocal());
      setBusy(false);
    }
  }, [open, initialPrompt]);

  const title = mode === "rerun"
    ? `Re-run "${actionLabel}"`
    : `Make "${actionLabel}" recurring`;

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (mode === "recurring") {
        const iso = new Date(when).toISOString();
        await onConfirm({ prompt, recurrence, scheduled_for: iso });
      } else {
        await onConfirm({ prompt });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onCancel(); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground -mt-2">
          Edit the text prompt below if you want. Attached media and context will stay the same.
        </p>

        <div className="space-y-1.5">
          <Label htmlFor="rerun-prompt">Prompt</Label>
          <Textarea
            id="rerun-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            autoFocus
            placeholder="(no prompt)"
          />
        </div>

        {mode === "recurring" && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="rerun-when">First run at</Label>
              <Input
                id="rerun-when"
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Repeat every</Label>
              <Select value={recurrence} onValueChange={(v) => setRecurrence(v as Recurrence)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="hourly">Hour</SelectItem>
                  <SelectItem value="daily">Day</SelectItem>
                  <SelectItem value="weekly">Week</SelectItem>
                  <SelectItem value="monthly">Month</SelectItem>
                  <SelectItem value="yearly">Year</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>
            {busy
              ? (mode === "rerun" ? "Re-queuing…" : "Saving…")
              : (mode === "rerun" ? "Re-run" : "Save recurring")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
