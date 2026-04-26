## Goal
When the user taps **Re-run** or **Make recurring** on a job card in the Action Queue Dashboard, first show a small dialog that:
1. Pre-fills with the **text prompt** from the original job (no context/media editing).
2. Lets the user edit (or keep) the prompt.
3. On confirm, queues a brand-new job using the **exact same payload** as the original (same `refImageUrls`, `sourceUrl`, `imageUrl`, `context.checklists`, `context.media`, model params, etc.) — **only the `prompt` text is replaced** with the (possibly edited) value.

For recurring, after editing the prompt the user picks a recurrence interval and first-run time, then we queue it as a scheduled+recurring job.

## First-principles: why current Re-run is flaky
The dashboard's `rerun` and `saveRecurring` currently bypass the `enqueue-action` edge function and `INSERT` directly into `action_jobs`. That causes three regressions vs. the original "first run":

1. **No worker kick.** `enqueue-action` does a fire-and-forget POST to `process-action-queue` so jobs start within ~1s. A direct insert waits up to 60s for `pg_cron`, and (combined with the realtime UI showing repeated boots) is exactly the "multiple attempts / nothing appears" symptom.
2. **No validation.** Payloads aren't size/shape-checked; bad URLs or stale media silently misbehave.
3. **Prompt drift.** `prompt_preview` is copied from the old job instead of recomputed from the actual `payload.prompt`, so an edited prompt would never show on the dashboard card.

Routing both Re-run and Make-recurring through `enqueue-action` (the same path the first run uses) makes them behaviorally identical to the original run — the only difference for recurring is `scheduled_for` + `recurrence`.

## Changes

### 1) New component — `src/components/EditPromptRunDialog.tsx`
A small focused dialog (built on existing `Dialog` + `Textarea` + `Button` primitives — no new deps).

Props:
```ts
type Mode = "rerun" | "recurring";
type Props = {
  open: boolean;
  mode: Mode;
  actionLabel: string;            // e.g. "Image to image"
  initialPrompt: string;          // from original job's payload.prompt (or "")
  onCancel: () => void;
  onConfirm: (args: {
    prompt: string;
    recurrence?: "hourly" | "daily" | "weekly" | "monthly" | "yearly";
    scheduled_for?: string;       // ISO, required when mode==="recurring"
  }) => Promise<void> | void;
};
```

Layout:
- Title: `Re-run "{actionLabel}"` or `Make "{actionLabel}" recurring`.
- A short helper line: "Edit the text prompt below if you want. Attached media and context will stay the same."
- Multi-line `<Textarea>` (autoFocus, ~4 rows) bound to local `prompt` state, seeded with `initialPrompt`.
- If `mode === "recurring"`:
  - `<Select>` with `hourly | daily | weekly | monthly | yearly` (default `daily`).
  - `<Input type="datetime-local">` for first-run time (default `now + 5 minutes`, seconds zeroed).
- Footer: `Cancel` + primary action button (`Re-run` / `Save recurring`). Disable while submitting; show inline busy state.
- Empty prompt is allowed (image/video jobs sometimes have no prompt) — do not block on blank.

### 2) `src/pages/ActionQueue.tsx` — wire the dialog into Re-run / Make recurring

a. Add dialog state at the top of the component:
```ts
const [editDialog, setEditDialog] = useState<
  | { mode: "rerun" | "recurring"; job: Job; initialPrompt: string; actionLabel: string }
  | null
>(null);
```

b. Replace the existing `rerun` and `saveRecurring` functions with **openers**:

```ts
const openRerun = async (j: Job) => {
  // Fetch the latest payload so we always start from authoritative data.
  const { data: full, error } = await supabase
    .from("action_jobs").select("payload").eq("id", j.id).maybeSingle();
  if (error || !full) { toast.error("Could not load original job."); return; }
  const initialPrompt =
    typeof (full.payload as any)?.prompt === "string"
      ? String((full.payload as any).prompt)
      : (j.prompt_preview ?? "");
  setEditDialog({
    mode: "rerun", job: j, initialPrompt,
    actionLabel: ACTION_LABELS[j.action_type] ?? j.action_type,
  });
};

const openMakeRecurring = async (j: Job) => { /* identical, mode: "recurring" */ };
```

c. Add a single submit handler that re-queues through `enqueue-action` (same path as the first run):

```ts
const submitEdit = async (args: {
  prompt: string;
  recurrence?: "hourly"|"daily"|"weekly"|"monthly"|"yearly";
  scheduled_for?: string;
}) => {
  if (!editDialog) return;
  const j = editDialog.job;
  // Re-fetch full payload one more time at submit (cheap, avoids stale capture).
  const { data: full, error: fetchErr } = await supabase
    .from("action_jobs").select("payload").eq("id", j.id).maybeSingle();
  if (fetchErr || !full) { toast.error("Could not re-run."); return; }

  // Preserve EVERYTHING from the original payload; only replace `prompt`.
  // This is what keeps refImageUrls / sourceUrl / imageUrl / context / model
  // params byte-identical to the original run.
  const payload = { ...(full.payload as any ?? {}), prompt: args.prompt };

  const body: any = {
    action_type: j.action_type,
    checklist_id: j.checklist_id,
    source_item_id: j.source_item_id,
    payload,
  };
  if (editDialog.mode === "recurring") {
    body.scheduled_for = args.scheduled_for;
    body.recurrence = args.recurrence;
  }

  const { error } = await supabase.functions.invoke("enqueue-action", { body });
  if (error) { toast.error("Could not re-queue."); return; }
  toast.success(editDialog.mode === "rerun" ? "Re-queued." : "Recurring schedule saved.");
  setEditDialog(null);
};
```

d. Update the JSX buttons so they call the new openers:
- `Re-run` button → `onClick={() => openRerun(j)}`
- `Make recurring` button → `onClick={() => openMakeRecurring(j)}`

e. Render the dialog once near the bottom of the component:
```tsx
{editDialog && (
  <EditPromptRunDialog
    open
    mode={editDialog.mode}
    actionLabel={editDialog.actionLabel}
    initialPrompt={editDialog.initialPrompt}
    onCancel={() => setEditDialog(null)}
    onConfirm={submitEdit}
  />
)}
```

### 3) Why this fixes the "rerun multi-attempt / image never appears" bug
- `enqueue-action` re-validates the payload, sets `prompt_preview` from the (possibly edited) `payload.prompt`, and **kicks `process-action-queue` immediately** — so the rerun follows the exact same fast path as the very first run.
- We no longer copy the *old* `prompt_preview`; the dashboard card for the new job will display whatever the user just confirmed (edited or original).
- We preserve `refImageUrls`, `sourceUrl`, `imageUrl`, `context.checklists`, `context.media`, and any model-specific keys from the original payload via spread, so image-image / remix / video jobs reuse the exact same media references. No re-upload, no drift.
- For recurring, the only deltas vs. a rerun are `scheduled_for` and `recurrence`, exactly matching how the Checklist page enqueues a recurring job (`submitEnqueue` in `Checklist.tsx`).

### 4) Out of scope (intentionally)
- Editing attached **context checklists / media** at re-run time — user explicitly asked to keep those locked to the original.
- Backend changes — `enqueue-action` and `process-action-queue` already handle this shape.
- The pre-existing display bug where `deriveAttachments` reads `c.id` from context-checklist entries that are stored as plain UUID strings (not objects). Out of scope for this task; can be addressed separately.

## Files touched
- **New:** `src/components/EditPromptRunDialog.tsx`
- **Edited:** `src/pages/ActionQueue.tsx` (replace `rerun` / `saveRecurring`, add dialog state + submit handler, mount dialog)

No DB, no edge function, no schema changes.
