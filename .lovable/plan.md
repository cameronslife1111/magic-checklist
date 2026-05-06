# Add "Swap Links" Bulk Action

A new Actions-menu entry "Swap Links" that lets you tap multiple checkboxes (just like Combine mode), then pick a checklist — all selected items become links to that checklist.

## UX Flow

1. Open Actions sheet → tap **Swap Links** (placed directly under "Insert checklist link").
2. Bottom bar switches to two buttons: **Cancel** (orange) and **Swap (N)** (blue, disabled until ≥1 selected).
3. Tapping checkboxes toggles selection without checking/unchecking the underlying item — same visual behavior as Combine mode (the checkbox shows the selection state, not the saved state).
4. Tap **Swap (N)** → opens the existing `ChecklistPickerDialog`.
5. Pick a checklist → every selected item is updated to `{ text: <picked title>, linked_checklist_id: <picked id>, external_link: null }`. Selection state and mode clear.

## Implementation (in `src/pages/Checklist.tsx`)

1. **State**
   - Add `swapLinksMode: boolean` and `swapLinksSelection: Set<string>`.
   - Add `exitSwapLinksMode()` helper that clears both.

2. **Toggle handler** (`handleToggle`)
   - Mirror the existing `combineMode` branch: if `swapLinksMode`, toggle id in `swapLinksSelection` and return.

3. **Row rendering** (around line 1377 / 1394)
   - Extend the `combineMode ? {...checked: combineSelection.has(...)} : it` pattern so when `swapLinksMode`, `checked` reflects `swapLinksSelection.has(it.id)`. Same for child rows.
   - Disable `isActive` highlight while in swap mode (same as combine).

4. **Bottom action bar** (around line 1423)
   - Add a new branch `swapLinksMode ?` rendering Cancel + `Swap (N)` buttons (matching the Combine layout). The Swap button opens `setDialog({ kind: "swap-links-pick" })`.

5. **Actions sheet** (`src/components/ActionsSheet.tsx`)
   - Add new action key `"swap-links"` to the union type.
   - Insert a new entry `{ key: "swap-links", label: "Swap Links", icon: Link2 }` directly after the existing `insert-link` row (line 37).

6. **Action handler** in Checklist.tsx switch (near line 594)
   - Case `"swap-links"`: close actions sheet, clear selection set, set `swapLinksMode = true`, toast "Select boxes, then tap Swap".

7. **Dialog wiring**
   - Extend the `dialog` discriminated union with `{ kind: "swap-links-pick" }`.
   - Render a second `<ChecklistPickerDialog>` instance bound to that kind. Its `onPick(id, title)`:
     - Build `ids = [...swapLinksSelection]`.
     - Optimistically `setItems` mapping each selected item to `{ ...i, text: title, linked_checklist_id: id, external_link: null, media_url: null, media_type: null, checked: i.checked }` (preserve existing checked state).
     - Single `supabase.from("checklist_items").update({ text: title, linked_checklist_id: id, external_link: null, media_url: null, media_type: null }).in("id", ids)`.
     - On error: revert via refetch and toast. On success: toast "Swapped N items", call `exitSwapLinksMode()`, close dialog.

## Notes / Edge Cases

- Selecting zero items disables the Swap button (same UX as Combine requiring ≥2; here we allow ≥1).
- The picker already excludes the current checklist via `excludeId={checklist.id}` — reuse that.
- Children (nested items) are selectable too, matching Combine behavior.
- No DB schema changes; reuses existing `linked_checklist_id` column.
- Cancel exits without mutating anything.
