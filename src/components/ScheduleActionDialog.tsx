import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Zap, Clock, Repeat } from "lucide-react";
import { ContextAttacher, AttachedContext } from "@/components/ContextAttacher";

export type SchedulePick =
  | { mode: "now" }
  | { mode: "later"; scheduled_for: string }
  | { mode: "recurring"; recurrence: "hourly" | "daily" | "weekly" | "monthly" | "yearly"; scheduled_for: string };

type Props = {
  open: boolean;
  actionLabel: string;
  onClose: () => void;
  onPick: (p: SchedulePick) => void;
  userId?: string;
  excludeChecklistId?: string;
  currentChecklist?: { id: string; title: string };
  context?: AttachedContext;
  onContextChange?: (c: AttachedContext) => void;
};

const defaultLocal = () => {
  const d = new Date(Date.now() + 5 * 60_000);
  d.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const ScheduleActionDialog = ({ open, actionLabel, onClose, onPick, userId, excludeChecklistId, currentChecklist, context, onContextChange }: Props) => {
  const [tab, setTab] = useState<"now" | "later" | "recurring">("now");
  const [when, setWhen] = useState<string>(defaultLocal());
  const [recurrence, setRecurrence] = useState<"hourly" | "daily" | "weekly" | "monthly" | "yearly">("daily");
  const [uploading, setUploading] = useState(false);

  const submit = () => {
    if (uploading) return;
    if (tab === "now") return onPick({ mode: "now" });
    const iso = new Date(when).toISOString();
    if (tab === "later") return onPick({ mode: "later", scheduled_for: iso });
    onPick({ mode: "recurring", recurrence, scheduled_for: iso });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Run "{actionLabel}"</DialogTitle>
        </DialogHeader>

        {userId && context && onContextChange && (
          <ContextAttacher
            userId={userId}
            excludeChecklistId={excludeChecklistId}
            value={context}
            onChange={onContextChange}
            onUploadingChange={setUploading}
          />
        )}

        <div className="grid grid-cols-3 gap-2">
          <Button
            type="button"
            variant={tab === "now" ? "default" : "outline"}
            onClick={() => setTab("now")}
            className="h-auto flex-col gap-1 py-3"
          >
            <Zap className="h-4 w-4" />
            <span className="text-xs">Now</span>
          </Button>
          <Button
            type="button"
            variant={tab === "later" ? "default" : "outline"}
            onClick={() => setTab("later")}
            className="h-auto flex-col gap-1 py-3"
          >
            <Clock className="h-4 w-4" />
            <span className="text-xs">Later</span>
          </Button>
          <Button
            type="button"
            variant={tab === "recurring" ? "default" : "outline"}
            onClick={() => setTab("recurring")}
            className="h-auto flex-col gap-1 py-3"
          >
            <Repeat className="h-4 w-4" />
            <span className="text-xs">Recurring</span>
          </Button>
        </div>

        {tab !== "now" && (
          <div className="space-y-3 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="when">{tab === "later" ? "Run at" : "First run at"}</Label>
              <Input id="when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            </div>
            {tab === "recurring" && (
              <div className="space-y-1.5">
                <Label>Repeat every</Label>
                <Select value={recurrence} onValueChange={(v) => setRecurrence(v as typeof recurrence)}>
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
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={uploading}>
            {uploading ? "Uploading…" : tab === "now" ? "Run now" : tab === "later" ? "Schedule" : "Save recurring"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
