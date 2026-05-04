## Goal

Fix Home button so that when only one Home Favorite slot is filled, tapping Home always opens that checklist — even if it's the one already open. No "no favorites" toast/message in that case.

## Change

### `src/lib/homeFavorites.ts` — `nextFavoriteAfter`

Update the cycling logic so that if there is exactly one filled slot, it is always returned (even if it equals `currentChecklistId`). Cycling/skipping current only applies when 2+ slots are filled.

New behavior:
- 0 filled slots → return `null` (unchanged)
- 1 filled slot → return that id (even if it equals current)
- 2+ filled slots → return next non-empty slot after current, skipping current id (unchanged)

### `src/pages/Checklist.tsx` — Home tap handler

When `nextFavoriteAfter` returns the same id as the current checklist (single-favorite case), still call `openChecklist(targetId)` so the page re-focuses/scrolls/speaks the highest unchecked item. The existing "no favorites set" toast still fires only when result is `null` (i.e., zero slots filled).

## Out of scope

Long-press behavior, Manage Home Favorites dialog, Actions Sheet ordering — all unchanged.