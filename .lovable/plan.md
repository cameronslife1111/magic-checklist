## Goal
Add a 4th bottom action button — a yellow "Recycle" button with a 🐝 emoji — that automatically navigates the user through their Home Favorites slot 1 + linked-checklist chain, checking the current item off along the way.

## Layout change (bottom action bar)

Today the bar has 3 buttons (`src/pages/Checklist.tsx` ~line 1565–1682):

```text
[ Actions  flex-1 ] [ 🏠 w-20 ] [ ✓ flex-1 ]
```

New layout (left → right):

```text
[ Actions  ~half ] [ 🏠 w-20 ] [ 🐝 w-20 ] [ ✓ flex-1 ]
```

- Keep the green ✓ button at its current size (`flex-1 h-28`).
- Keep the blue 🏠 button at `w-20 h-28`.
- Insert a new yellow 🐝 button at `w-20 h-28` between 🏠 and ✓.
- Shrink the orange Actions button to roughly half its current width by changing `flex-1` → `flex-[0.5]` so the green button still occupies the dominant share. All four buttons keep `h-28` and `rounded-none` for the same visual language.

## New "Recycle" button (🐝, yellow)

Style:
- Same shape/height as the others (`w-20 h-28 rounded-none select-none touch-none`).
- New metallic-yellow background to mirror existing `btn-metallic-blue/green/orange` classes. Add `.btn-metallic-yellow` to `src/index.css` using HSL tokens (a warm yellow gradient + matching shadow), plus `--action-yellow-foreground` for the icon/emoji color. Apply `text-action-yellow-foreground btn-metallic-yellow btn-shimmer` and a `--shimmer-delay` of `2.4s` to interleave with the existing 0s / 1.6s / 3.2s shimmer cadence.
- Children: the 🐝 emoji at `text-2xl leading-none` (matches 🏠).
- `aria-label="Recycle: go to first Home Favorite, check current, follow links"`.

Behavior (single tap, no long-press):
1. Read Home Favorites slot 0 (`loadFavorites()[0]` from `src/lib/homeFavorites.ts`). If empty, toast "No Home Favorite in slot 1" and stop.
2. `await openChecklist(slot0Id)`.
3. Re-fetch that checklist's top-level items directly (don't rely on React state, which won't have updated yet inside the same handler) and find the first unchecked top-level item.
4. If found, mark it checked in the DB (`update checklist_items set checked = true where id = ...`) — mirrors what `handleToggle(item, true)` does for the persistence side, but performed inline so we can chain.
5. Re-query the same checklist's items, find the new first unchecked top-level item.
6. If that item has a `linked_checklist_id`, repeat from step 2 with that id (open it, find first unchecked, but do NOT auto-check on subsequent hops — the user said "open all of the links until it's at a checklist where there is not an attached link"). Loop until the landing checklist's first unchecked item has no `linked_checklist_id` (or there is no unchecked item).
7. Finally call `openChecklist(finalId)` so React state + UI reflect the landing checklist, and `stopSpeech()` already runs inside `openChecklist`.

Edge cases:
- All items in slot-1 already checked → still call `openChecklist(slot0)` and stop (nothing to chain).
- Linked checklist id points to a deleted checklist → if fetch returns null, stop on the previous valid one.
- Guard against infinite loops with a `Set<string>` of visited checklist ids; bail with a toast if we revisit.
- Only consider top-level items (`parent_item_id IS NULL`), matching how `highestUnchecked` is computed.

## Files to change

- `src/pages/Checklist.tsx`
  - Adjust the Actions button `className` from `flex-1` to `flex-[0.5]`.
  - Insert the new `<Button>` between the 🏠 button and the ✓ button.
  - Add a `runRecycle()` async helper near `openChecklist` containing steps 1–7 above.
- `src/index.css`
  - Add `--action-yellow` / `--action-yellow-foreground` HSL tokens (light + dark) and a `.btn-metallic-yellow` class mirroring the existing metallic button classes.
- `tailwind.config.ts`
  - Register `action-yellow` / `action-yellow-foreground` colors so `text-action-yellow-foreground` resolves, mirroring the existing `action-orange` / `action-green` entries.

## Out of scope
- No changes to long-press behavior on existing buttons.
- No changes to `homeFavorites.ts`, `ActionsSheet`, or any other component.
- No changes to how individual checkboxes render or to speech/dictation behavior.
