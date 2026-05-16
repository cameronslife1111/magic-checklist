# Bumblebee 🐝 — auto-reset when list is fully complete

## Current behavior
A single press of 🐝 calls `runRecycle()` in `src/pages/Checklist.tsx`:
1. Loads Home Favorite slot 1's checklist.
2. Finds the first unchecked top-level item, checks it off, and follows its linked checklist (hopping up to 25 levels).
3. Opens the deepest reached checklist.

If every item on the slot-1 list is already checked, `firstUnchecked` is `null`, nothing gets checked, and it just opens slot 1 again with no progress.

## Requested change
When 🐝 is pressed and **every top-level item on the slot-1 checklist is already checked**, automatically:
1. Uncheck all top-level items on that slot-1 checklist (reset it).
2. Then continue the normal recycle flow on the freshly reset list — i.e. check off the new "first unchecked" (which is now the top item) and open its linked checklist (the "top link").

Net effect: the user can keep pressing 🐝 forever and the list will loop back to the top once fully completed, instead of stalling.

## Scope
- Only the first-hop (slot-1) list resets. Nested/linked child lists are left alone, matching current recycle semantics.
- Long-press lock behavior is unchanged.
- No UI/visual changes. No new components.

## Technical detail
In `runRecycle()` (around lines 236–270 of `src/pages/Checklist.tsx`), after fetching the slot-1 list, before the existing `if (!didCheck && firstUnchecked)` branch:

```text
if first hop AND list.length > 0 AND firstUnchecked is null:
    update checklist_items set checked = false
      where checklist_id = currentId and parent_item_id is null
    re-fetch the list
    firstUnchecked = list[0]
    (fall through into the existing "check off + follow link" block)
```

Optional small UX touch: `speak("Resetting")` / `toast.message("List reset")` when the reset fires, so the user knows why everything just unchecked. (Will include unless you'd rather it be silent.)

No schema changes, no edge function changes, no other files touched.
