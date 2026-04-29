## Add "Delete current sentence" button to Actions sheet

A new red entry in the Actions sheet that instantly deletes the currently highlighted (yellow) checkbox — same as tapping the X next to it on the row. No confirmation prompt.

### Behavior
- Label: **Delete current sentence**
- Icon: `Trash2` (red, like the AI items are blue)
- Position: directly under **Copy full checklist**
- On tap: closes the sheet and deletes `highestUnchecked` via the existing `handleDelete(item)` flow (which also cleans up owned generated media and re-focuses the next unchecked item).
- If there is no unchecked item, show a toast: "No checkbox to delete."
- No confirmation dialog.

### Technical changes

**1. `src/components/ActionsSheet.tsx`**
- Add `"delete-current"` to the `ActionKey` union.
- Insert a new entry in `STATIC_ITEMS` immediately after `copy-checklist`:
  ```ts
  { key: "delete-current", label: "Delete current sentence", icon: Trash2 },
  ```
- Add a `RED_KEYS` set (mirroring `AI_KEYS`) containing `"delete-current"`, and apply red text/icon classes (`text-red-500 hover:text-red-500`) when the key is in that set — keeping the existing blue styling for AI items untouched.

**2. `src/pages/Checklist.tsx`**
- In the `onPick` switch (around line 500), add:
  ```ts
  case "delete-current": {
    if (!highestUnchecked) {
      toast.error("No checkbox to delete.");
      break;
    }
    await handleDelete(highestUnchecked);
    break;
  }
  ```

No schema changes, no new dialogs, no other files touched.
