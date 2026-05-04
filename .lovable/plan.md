## Goal

Change the Home button (single tap) to cycle through up to 5 user-chosen "Home Favorites" checklists. Long-press behavior is unchanged. Add a new Actions Sheet button "Manage Home Favorites" to configure those 5 slots.

## How it should feel

- Tap 🏠 → opens the next favorite checklist in the cycle (slot 1 → 2 → 3 → 4 → 5 → 1 …), skipping empty slots. After opening, the page scrolls to the highlighted (highest unchecked) item and Web Speech reads it — same behavior already used by `openChecklist`.
- If the current checklist is one of the favorites, tapping Home advances to the next non-empty slot after it. If it's not in the list, it opens the first non-empty slot.
- If 0 or 1 slots are filled and the only filled slot is the current checklist, tapping Home does nothing (or stays put).
- Long-press 🏠 still adds a new item before current (unchanged).
- Drill-into-linked-checklist behavior on tap is **removed** in favor of the new cycle (the user asked to "change the function completely"). Linked checklists can still be opened via the row's existing link UI.

## Storage

Persist the 5 slots per user in `localStorage` under key `home_favorites_v1` as a JSON array of length 5: `(string | null)[]` where each entry is a checklist id or `null`. Local-only is appropriate since this is a per-device UX preference and avoids a schema change. (If the user later wants cross-device sync, we can migrate to a Supabase table.)

## Files to change

### 1. `src/lib/homeFavorites.ts` (new)

Small helper module:
- `SLOT_COUNT = 5`
- `loadFavorites(): (string|null)[]` — returns array padded/truncated to length 5.
- `saveFavorites(slots): void`
- `setSlot(index, checklistId | null)`
- `nextFavoriteAfter(currentChecklistId): string | null` — returns the next non-empty slot id after current (wrapping), skipping the current id itself; returns null if no eligible target.

### 2. `src/components/ActionsSheet.tsx`

- Add new `ActionKey` value: `"manage-home-favorites"`.
- Insert a new `STATIC_ITEMS` entry labeled **"Manage Home Favorites"** (icon: `Home` from lucide-react) positioned **immediately after `insert-link`** and **immediately before `send-to-top`** as requested.

### 3. `src/components/HomeFavoritesDialog.tsx` (new)

A dialog (using existing `Dialog` UI) opened from the Actions Sheet:
- Shows 5 numbered rows (1–5).
- Each row shows either the assigned checklist title or "Empty".
- Tapping a row opens the existing `ChecklistPickerDialog` (already used elsewhere) to pick a checklist for that slot.
- Each filled row has a "Remove" (X) button to clear the slot.
- "Done" closes the dialog. Changes are saved to localStorage immediately on each edit.
- Loads checklist titles via `supabase.from("checklists").select("id,title").in("id", ids)` to render labels.

### 4. `src/pages/Checklist.tsx`

- Import `loadFavorites` / `nextFavoriteAfter` and the new dialog.
- Replace the single-tap handler in the Home button (lines ~1520–1537):
  - Remove the "drill-into-linked-checklist" branch and the alphabetically-top-checklist fallback.
  - Compute `targetId = nextFavoriteAfter(checklist.id)`. If non-null and ≠ current, `await openChecklist(targetId)`. `openChecklist` already handles loading items, focusing the highest unchecked, scrolling, and speech.
  - If null, do nothing (silent no-op). Optionally `toast` a hint like "No Home Favorites set — open Actions → Manage Home Favorites" the first time.
- Long-press handler (add-new-before-current) is left untouched.
- In the `onPick` switch for `ActionsSheet`, add a `case "manage-home-favorites"` that opens the new dialog (add a `useState` for its open flag).

## Edge cases

- Slots referencing deleted checklists: when cycling, if the id no longer exists in `checklists`, treat the slot as empty (skip). The manage dialog also detects missing titles and shows "(missing)" with a Remove option.
- Exactly one favorite which equals the current checklist: tap Home is a no-op.
- Duplicate ids across slots are allowed (user choice) but cycling still moves to the "next" slot index, so duplicates effectively re-open the same checklist — acceptable.

## Out of scope

- No DB migration.
- No changes to long-press behavior.
- No changes to other Actions Sheet items or ordering beyond inserting the one new entry in the requested position.
