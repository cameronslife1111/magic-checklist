
**Add copy button to failed action error details**

Update `src/pages/ActionQueue.tsx` to enhance the red error block on failed jobs with a copy button and clearer action labeling. No backend, schema, or other-page changes.

### Changes to the failed-job error block in `src/pages/ActionQueue.tsx`

1. **Show action label inside the error block** (next to the existing `AlertTriangle` warning icon):
   - Add a small line above the "What went wrong" title showing the human-readable action (e.g. `Text to text`, `Image to video`) using the existing `ACTION_LABELS[j.action_type]` map.
   - Intentionally duplicates the label at the top of the card so the copied block is self-contained when pasted elsewhere.

2. **Add a "Copy" button** in the top-right of the red error block:
   - Existing `Button` (size `sm`, variant `ghost`) with a `Copy` icon from `lucide-react`.
   - On click, build plain text in this exact order and copy via `navigator.clipboard.writeText`:
     ```
     Action: <ACTION_LABELS[action_type] ?? action_type>
     What went wrong: <error_friendly ?? "Something went wrong.">
     Fix: <error_fix ?? "(no fix suggested)">
     Raw error:
     <error_raw ?? "(no raw error)">
     ```
   - `toast.success("Error details copied")` on success, `toast.error("Could not copy")` on failure.
   - Briefly swap the icon to `Check` for ~1.5s after a successful copy (local `useState` inside `JobRow`).

3. **Layout details** (minimal, consistent with existing card):
   - Wrap existing error content in a flex row: warning icon + text on the left, Copy button on the right.
   - Copied text only includes: modality (action), title, fix, raw error. NOT run time, scheduled time, attempts, payload, or prompt.

### Explicitly out of scope
- No changes to `created_at` / `completed_at`, action buttons row, or other tabs.
- No changes to `process-action-queue`, `explain-error`, or any other edge function.
- No DB schema or migration changes.
- No new dependencies — `Copy` and `Check` already ship with `lucide-react`.
