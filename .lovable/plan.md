## Move "Delete all checkboxes" to the bottom of the actions sheet

Relocate the action so it sits next to the other destructive checklist-level actions, away from the frequently-tapped quick utilities, to prevent accidental presses.

### Change

**`src/components/ActionsSheet.tsx`** — `STATIC_ITEMS` array only:
- Remove the `delete-all-checkboxes` entry from its current position (right after `delete-current` in the quick utilities section).
- Re-insert it in the bottom "rare / destructive" group, directly above `delete-checklist`, so the tail of the list becomes:
  - Edit checklist title
  - New checklist
  - Duplicate checklist
  - **Delete all checkboxes** ← new position
  - Delete checklist

No other files, styling, behavior, or logic change. The red styling (via `RED_KEYS`) and confirmation dialog in `Checklist.tsx` stay exactly as they are.