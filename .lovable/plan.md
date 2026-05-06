## Auto-check matching checklist links

When the user checks (or unchecks) a checkbox whose item is a checklist link (`linked_checklist_id` is set), automatically apply the same checked state to every other item in the current checklist that points to the same `linked_checklist_id`.

### Where

`src/pages/Checklist.tsx`, inside `handleToggle` (around lines 319–348), after the `combineMode` / `swapLinksMode` early returns and before the existing cascade logic.

### Behavior

1. If `item.linked_checklist_id` is set, compute `matchIds = items.filter(i => i.linked_checklist_id === item.linked_checklist_id).map(i => i.id)`.
2. Run the existing cascade map, but additionally force every item in `matchIds` to `checked: next` (regardless of position).
   - Checking a link still cascades: all earlier unchecked items get checked AND all matching links get checked.
   - Unchecking a link still cascades: all later checked items get unchecked AND all matching links get unchecked.
3. Track every id whose `checked` actually changed in `changedIds` so the single batched `supabase.update({checked: next}).in("id", changedIds)` call (line 343) covers them too — no extra round trip.
4. Auto-advance / speech logic (lines 350–357) is unchanged; it already finds the next unchecked item from the updated list.

### Edge cases

- Items with `linked_checklist_id === null` are unaffected (current behavior).
- Multiple distinct links in one checklist only auto-toggle siblings that match the toggled item's link.
- Children (nested rows) are included since they live in the same `items` array.
- Combine mode and Swap Links mode are not affected — the early returns run first.

No DB schema changes, no new state, no UI changes.
