## Add "Delete All Checkboxes" action

Adds a new red action to the actions sheet that wipes every checkbox on the current checklist (after a confirmation prompt) and leaves a single blank checkbox so the user can start fresh on the same checklist.

### UX

- New row in `ActionsSheet` labeled "Delete all checkboxes" with the `ListX` icon, styled red (added to `RED_KEYS`).
- Placed near the other destructive checkbox actions (right after `delete-current`).
- Tap → confirmation `AlertDialog`: title "Delete all checkboxes?", description "All checkboxes on '{title}' will be permanently deleted and replaced with one blank checkbox. This cannot be undone." with Cancel / Delete all (destructive) buttons.

### Technical changes

**`src/components/ActionsSheet.tsx`**
- Add `"delete-all-checkboxes"` to the `ActionKey` union.
- Insert a new `STATIC_ITEMS` entry right after `delete-current` using the `ListX` lucide icon.
- Add the key to `RED_KEYS` so it renders red like `delete-current`.

**`src/pages/Checklist.tsx`**
- Extend the `dialog` discriminated union with `{ kind: "delete-all-checkboxes" }`.
- New case in the action handler: `setActionsOpen(false); setDialog({ kind: "delete-all-checkboxes" });`.
- New `deleteAllCheckboxes()` helper:
  1. Optimistic UI: snapshot `items`, then `setItems([blankPlaceholder])` so the list never appears empty mid-flight.
  2. `await supabase.from("checklist_items").delete().eq("checklist_id", checklist.id).eq("user_id", user.id);`
  3. Insert one new blank row: `supabase.from("checklist_items").insert({ checklist_id, user_id, text: "", position: 1024 }).select().single()`.
  4. Replace local `items` with `[insertedRow]`, focus + speak it via the existing `focusAndSpeakHighestUnchecked` helper, and `primeSpeech()` so behavior matches `uncheck-all`.
  5. On error: restore the snapshot and `toast.error("Could not delete checkboxes. Try again.")`.
- Clear any related transient UI state that references item ids (e.g. `combineSelection`, `editingId` if set) to avoid stale references.
- New `AlertDialog` mirroring the existing `delete-checklist` dialog, wired to `deleteAllCheckboxes()`.

### Notes

- No schema changes; existing RLS on `checklist_items` already restricts delete/insert to the owner.
- Linked-checklist rows on the deleted items are unaffected (only membership on the current checklist is removed); the linked target checklists remain intact.
