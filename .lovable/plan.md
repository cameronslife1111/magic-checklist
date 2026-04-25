## Problem

When you tap the title to rename the current checklist, the dialog shows the title of a *different* checklist (typically the previously-opened one), not the one you're on.

## Root Cause

`TextPromptDialog` (`src/components/TextPromptDialog.tsx`) initializes its internal input state once with `useState(initial)`, and only re-syncs to the latest `initial` prop inside `onOpenAutoFocus`. That handler runs only the **first time** the underlying Radix Dialog mounts/auto-focuses. After that, the same dialog instance is reused for every subsequent "Edit title" / "Duplicate" / "New checklist" open, so the input keeps the stale value from the first open instead of picking up the current `checklist.title`.

Because the `edit-title`, `duplicate-title`, and `new-checklist` dialogs all share this single component, switching checklists and then opening "Edit title" shows the title from whichever checklist was active the first time the dialog opened.

## Fix

Update `src/components/TextPromptDialog.tsx` so the input value is reliably reset to the current `initial` prop **every time the dialog opens**:

- Add a `useEffect` that watches `open` and `initial`. Whenever `open` becomes `true`, set `value` to `initial`.
- Keep `onClose` behavior unchanged.
- Remove the brittle `onOpenAutoFocus={() => setValue(initial)}` reset (no longer needed; the effect handles it for all opens, not just the first).

This guarantees the Edit dialog always shows the title of the checklist the user is currently on, the Duplicate dialog always shows `"<current title> Copy"`, and the New dialog always opens blank.

## Files to change

- `src/components/TextPromptDialog.tsx` — add `useEffect` to sync `value` from `initial` on every open; drop the `onOpenAutoFocus` reset.

No backend, schema, or other component changes needed. The callers in `src/pages/Checklist.tsx` already pass the correct `initial={checklist.title}`, so once the dialog respects the latest prop the bug is gone.