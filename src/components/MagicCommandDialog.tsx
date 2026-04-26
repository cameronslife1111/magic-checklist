import { useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Mic, Square, Sparkles } from "lucide-react";
import { ContextAttacher, AttachedContext } from "@/components/ContextAttacher";

type Props = {
  open: boolean;
  recording: boolean;
  transcribing: boolean;
  sending: boolean;
  transcript: string;
  onTranscriptChange: (v: string) => void;
  attachedContext: AttachedContext;
  onAttachedContextChange: (c: AttachedContext) => void;
  userId: string;
  excludeChecklistId?: string;
  clarifyingQuestion?: string | null;
  onStopRecording: () => void;
  onCancel: () => void;
  onSend: () => void;
};

export const MagicCommandDialog = ({
  open, recording, transcribing, sending,
  transcript, onTranscriptChange,
  attachedContext, onAttachedContextChange,
  userId, excludeChecklistId, clarifyingQuestion,
  onStopRecording, onCancel, onSend,
}: Props) => {
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus the textarea once we're past recording/transcribing.
  useEffect(() => {
    if (open && !recording && !transcribing) {
      requestAnimationFrame(() => taRef.current?.focus());
    }
  }, [open, recording, transcribing]);

  const handleOpen = (o: boolean) => {
    if (!o && !sending) onCancel();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" /> Magic Steps
          </DialogTitle>
        </DialogHeader>

        {recording ? (
          <div className="flex flex-col items-center justify-center py-8 gap-4">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-red-500/30 animate-ping" />
              <div className="relative h-20 w-20 rounded-full bg-red-500 flex items-center justify-center shadow-lg">
                <Mic className="h-9 w-9 text-white" />
              </div>
            </div>
            <p className="text-sm text-muted-foreground text-center">Listening… speak your command, then tap Stop.</p>
            <Button onClick={onStopRecording} variant="destructive" className="gap-2">
              <Square className="h-4 w-4" /> Stop
            </Button>
          </div>
        ) : transcribing ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Transcribing…</div>
        ) : (
          <div className="space-y-3">
            {clarifyingQuestion && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
                <span className="font-medium">Magic Steps asks:</span> {clarifyingQuestion}
              </div>
            )}
            <div>
              <label className="text-xs text-muted-foreground">What should Magic Steps do?</label>
              <Textarea
                ref={taRef}
                value={transcript}
                onChange={(e) => onTranscriptChange(e.target.value)}
                placeholder="e.g. Open the action sheet and pick video to video, set 9:16, attach the Jackson context file, and start it."
                className="mt-1 min-h-[120px]"
                disabled={sending}
              />
            </div>
            <div className="border-t border-border pt-3">
              <p className="text-xs text-muted-foreground mb-2">Optional context to attach:</p>
              <ContextAttacher
                userId={userId}
                excludeChecklistId={excludeChecklistId}
                value={attachedContext}
                onChange={onAttachedContextChange}
              />
            </div>
          </div>
        )}

        {!recording && !transcribing && (
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={onCancel} disabled={sending}>Cancel</Button>
            <Button onClick={onSend} disabled={sending || !transcript.trim()} className="gap-2">
              <Sparkles className="h-4 w-4" />
              {sending ? "Working…" : "Send to Magic Steps"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
};
