
# Insert new checkbox above current on long-press

## Change (`src/pages/Checklist.tsx`)

### 1. Add `positionBefore` helper (mirror of `positionAfter`)
- If `sourceId` is the first item → `cur.position - POS_STEP`
- Otherwise → midpoint of `prev.position` and `cur.position`
- If list empty → `POS_STEP`

### 2. Add `insertItemBefore` (mirror of `insertItemAfter`)
- Inserts row in Supabase with the "before" position
- Splices into local `items` state at `idx` (not `idx + 1`)

### 3. Add `addNewBeforeCurrent`
- Source = `highestUnchecked?.id` (fallback: first item, or null for empty list)
- Calls `insertItemBefore(sourceId, { text: "" })`
- Sets `focusItemId` to the new item's id (preserves iOS keyboard handoff)

### 4. Update the long-press call site
In the bottom Check button's `onPointerDown` long-press timer, replace `await addNewAfterCurrent()` with `await addNewBeforeCurrent()`.

## Why the yellow highlight "just works"
Yellow `glow-active` is driven by `highestUnchecked = items.find(i => !i.checked)` (first unchecked item by position). The new item is inserted with a smaller position and `checked = false`, so it automatically becomes the new `highestUnchecked` and inherits the existing yellow glow. No CSS changes needed.

## Unchanged
- iOS keyboard handoff via `keepaliveRef` + `autoFocus`
- Short-tap check behavior
- Actions sheet "Add" still inserts after current
- `addNewAfterCurrent` stays available
