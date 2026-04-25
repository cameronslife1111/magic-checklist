When the user creates a new checklist via the "New checklist" dialog, automatically seed it with 3 empty checkbox rows so they can start typing immediately.

### Change
**`src/pages/Checklist.tsx`** — in the `TextPromptDialog` for `dialog.kind === "new"` (around lines 903–910), after the `checklists.insert(...)` succeeds and before `openChecklist(data.id)`:

- Insert 3 blank rows into `checklist_items` for the new checklist:
  ```ts
  await supabase.from("checklist_items").insert([
    { checklist_id: data.id, user_id: user.id, text: "", position: 1024 },
    { checklist_id: data.id, user_id: user.id, text: "", position: 2048 },
    { checklist_id: data.id, user_id: user.id, text: "", position: 3072 },
  ]);
  ```
- Then call `openChecklist(data.id)` as today so the new list loads with its 3 empty rows.

### Notes / scope
- Position spacing of 1024 matches the existing seed pattern used elsewhere in the file, keeping room for drag-reorder fractional positions.
- `text` defaults to `''` in the DB schema, so empty strings are valid.
- Only the user-initiated "New checklist" flow changes. The first-ever checklist auto-created on initial load (lines 129–139) and the SignUp starter checklist are left as-is — they already seed welcome copy.
- No database schema, RLS, or edge-function changes required.