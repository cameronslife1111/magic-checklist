## Combine Mode for non-adjacent checkboxes

Currently, "Combine checked checkboxes" combines all checked items, but the normal toggle behavior cascades — checking item #3 also auto-checks #1 and #2. That makes it impossible to combine non-adjacent items.

The fix: introduce a temporary **Combine Mode**. While active, toggling a checkbox only toggles that one box (no cascade), and a floating bar lets the user confirm to combine the selected items.

### User flow

1. User taps **Combine checked checkboxes** in the Actions sheet.
2. App enters Combine Mode:
   - All items are visually unchecked (selection state is local — DB is not touched).
   - A small floating action bar appears at the bottom with **Combine (N)** and **Cancel** buttons.
   - A subtle banner/toast explains: "Select boxes to combine, then tap Combine."
3. User taps any boxes they want — each toggle affects only that one box. No cascade.
4. User taps **Combine** → the selected items are merged into the topmost selected one (same merge logic as today: join texts with a space, clear link/media on the keeper, delete the rest). Then exit Combine Mode.
5. **Cancel** (or Esc / back) exits without changes; original checked states are restored.

### Technical changes (single file: `src/pages/Checklist.tsx`)

1. **State**
   - `const [combineMode, setCombineMode] = useState(false)`
   - `const [combineSelection, setCombineSelection] = useState<Set<string>>(new Set())`
   - `const [savedCheckedIds, setSavedCheckedIds] = useState<Set<string> | null>(null)` — snapshot of which items were checked before entering mode, so we can restore on cancel (purely visual; no DB writes happen on enter/exit).

2. **Enter mode** — replace the body of the `"combine-checked"` case (line 554) so that instead of calling `combineCheckedItems()` immediately, it:
   - Snapshots current `items.filter(i => i.checked).map(i => i.id)` into `savedCheckedIds`.
   - Sets `combineMode = true`, `combineSelection = new Set()`.
   - Closes the Actions sheet.
   - Shows a toast: "Select boxes to combine."

3. **Toggle behavior in Combine Mode** — at the top of `handleToggle` (line 280), short-circuit when `combineMode` is true:
   ```ts
   if (combineMode) {
     setCombineSelection(prev => {
       const next = new Set(prev);
       if (next.has(item.id)) next.delete(item.id);
       else next.add(item.id);
       return next;
     });
     return; // no DB write, no cascade, no speech
   }
   ```

4. **Visual checked state in Combine Mode** — pass an effective `checked` prop to `ItemRow` based on `combineSelection` instead of the item's real `checked`. Smallest-touch approach: in the `items.map(...)` render block (around line 1236 / 1251), compute `const displayItem = combineMode ? { ...item, checked: combineSelection.has(item.id) } : item;` and pass that to `ItemRow`. This keeps `ItemRow.tsx` unchanged.

5. **Floating action bar** — render conditionally when `combineMode` is true: a fixed-bottom bar with two buttons:
   - `Combine (N)` — disabled when `N < 2`. On click, build the keeper/rest from `combineSelection` (preserving item order from `items`) and run the existing combine merge logic, then clear combine state.
   - `Cancel` — clears combine state without touching the DB.

6. **Refactor `combineCheckedItems`** (line 828) to accept an explicit list of selected item IDs rather than reading `items.filter(i => i.checked)`. Keep all current DB logic (update keeper text, delete rest, optimistic update, error rollback, toast). Call from the new bar's Combine button.

7. **Exit cleanup** — a single `exitCombineMode()` helper resets `combineMode`, `combineSelection`, `savedCheckedIds`. Called after a successful combine and on cancel.

### Notes

- Real DB `checked` values are never written during Combine Mode — entering/exiting is free and instant. The "all unchecked" appearance is purely visual via the override in step 4.
- Cascade logic in `handleToggle` is fully preserved for normal mode.
- No changes to `ActionsSheet.tsx`, `ItemRow.tsx`, or any other file.
