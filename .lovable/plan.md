# Auto-select matching linked items in Swap Links mode

When in Swap Links mode, tapping a checkbox on an item that already has a `linked_checklist_id` should also auto-toggle every other item (including children) in the checklist that links to the same checklist. This lets the user batch-swap groups of identical links in one tap.

## Behavior

- Tap a non-linked item → toggles only that item (current behavior).
- Tap a linked item (has `linked_checklist_id`) → toggle that item AND every other item in the current checklist sharing the same `linked_checklist_id`.
  - If the tapped item is being added to selection: add it and all matches not already in the set.
  - If the tapped item is being removed: remove it and all matches.
- Children (nested items) are included in the match scan, mirroring how Swap Links already treats children as selectable.
- No change to non-swap modes (combine, normal toggle).

## Implementation

Single edit in `src/pages/Checklist.tsx`, in the `handleToggle` function's `if (swapLinksMode)` branch (around lines 309–317).

Replace the simple toggle with one that:
1. Reads `item.linked_checklist_id`.
2. If null → toggle just `item.id` (current behavior).
3. If present → build a list of matching ids by scanning both top-level `items` and any children arrays for items where `linked_checklist_id === item.linked_checklist_id`. Determine whether we are adding or removing based on whether `item.id` is currently in `swapLinksSelection`. Add/remove all matching ids in a single `setSwapLinksSelection` update.

Pseudocode:

```ts
if (swapLinksMode) {
  setSwapLinksSelection((prev) => {
    const n = new Set(prev);
    const linkId = item.linked_checklist_id;
    const adding = !n.has(item.id);
    const matchIds: string[] = [item.id];
    if (linkId) {
      // collect all items + children with same linked_checklist_id
      for (const top of items) {
        if (top.id !== item.id && top.linked_checklist_id === linkId) matchIds.push(top.id);
        // include children if the row map exposes them; otherwise iterate items array which already contains them flat
      }
    }
    for (const id of matchIds) {
      if (adding) n.add(id); else n.delete(id);
    }
    return n;
  });
  return;
}
```

Note: I'll verify whether `items` is flat (contains children too) or whether children live in a separate structure during the implementation pass; if separate, the scan will iterate both. No DB changes, no UI changes, no new state.

## Optional polish

- Toast a brief "Selected N matching links" when auto-select adds >1 extra item, so the user knows why other boxes lit up. Skip if you'd rather keep it silent.

## Files

- `src/pages/Checklist.tsx` (one function body change)
- `.lovable/plan.md` (append note about auto-match behavior)
