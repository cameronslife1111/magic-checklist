## Goal

Swap the long-press gestures on the bottom action bar so it's easy to open a linked-checklist item when it's the yellow-highlighted (highest-unchecked) row.

## New gesture map

| Button | Tap | Long-press (new) |
|---|---|---|
| 🟧 Actions | Open Actions sheet *(unchanged)* | **Add a new checkbox before current** (was: scroll-to + speak highest unchecked) |
| 🏠 Home | Cycle Home Favorites *(unchanged)* | **Open the highlighted item's link** if it has one — `linked_checklist_id` opens that checklist; otherwise `external_link` opens in a new tab; otherwise show a toast "No link on current item" (was: add new item) |
| ✅ Check | Check current & advance *(unchanged)* | Go back one step *(unchanged)* |

## Changes — `src/pages/Checklist.tsx` (~lines 1454–1552)

1. **Actions button long-press handler**
   - Replace the scroll/speak timer body with the keyboard-keepalive + `addNewBeforeCurrent()` flow that currently lives on the Home button (focus `keepaliveRef` synchronously in `onPointerDown`, re-focus inside the timer, `await addNewBeforeCurrent()`).
   - Tap behavior (open `setActionsOpen(true)`) stays in `onPointerUp` guarded by `actionsLongPressFiredRef`.
   - Add `onPointerCancel` / `onPointerLeave` blur of `keepaliveRef`, mirroring the existing Home handler.

2. **Home button long-press handler**
   - Replace the `addNewBeforeCurrent()` timer body with link-open logic:
     ```ts
     if (highestUnchecked?.linked_checklist_id) {
       await openChecklist(highestUnchecked.linked_checklist_id);
     } else if (highestUnchecked?.external_link) {
       window.open(highestUnchecked.external_link, "_blank", "noopener,noreferrer");
     } else {
       toast.message("No link on current item");
     }
     ```
   - Remove the `keepaliveRef` focus calls from this button (no longer needed here).
   - Tap behavior (cycle Home Favorites via `nextFavoriteAfter`) is unchanged.

3. **`aria-label` updates**
   - Actions button: `"Open Actions (long-press: add new checkbox)"`
   - Home button: `"Open top checklist (long-press: open current item's link)"`

## Out of scope
No schema, MCP, or styling changes. Keepalive `<input>` element stays where it is — just used by the Actions button now.