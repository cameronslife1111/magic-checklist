## Goal
Add a new **Combine checked checkboxes** button to the Actions sheet. When pressed, it merges every currently checked checkbox into a single checkbox containing all of their text joined in checklist order (top → bottom), and removes the originals.

## First-principles reasoning
- `splitCurrentWith` is the inverse of what we need: 1 row → many. We need many → 1.
- We already have a clean precedent for bulk multi-row mutations in `case "uncheck-all"` in `src/pages/Checklist.tsx` (optimistic state update + Supabase mutation + rollback on error). We model the new action on it.
- The combined row should land at the **position of the topmost checked item** so the merged result keeps its natural place. We then delete all the other checked rows.
- The merged item stays **checked** (preserves user intent — they had it checked) and contains the joined text. After merging, focus + speak the highest unchecked item, matching the rest of the app's UX.

## Behavior
- Source = all items where `checked === true`, in current sorted order (already sorted by `position`).
- Guards:
  - 0 checked → toast `"No checked checkboxes to combine."` and return.
  - 1 checked → toast `"Need at least 2 checked checkboxes to combine."` and return.
- Joined text: `checkedItems.map(i => i.text.trim()).filter(Boolean).join(" ")` — single-space join, preserves checklist order. Empty-text checked rows still get removed.
- Strategy:
  1. Pick the **topmost checked row** as the keeper; update its `text` to the joined string.
  2. Delete all other checked rows.
  3. Keep `checked: true` on the keeper.
  4. Clear `external_link`, `linked_checklist_id`, `media_url`, `media_type` on the keeper — the merged text no longer represents a single link/media reference.

## Changes

### 1. `src/pages/Checklist.tsx`
- Add `combineCheckedItems()` async function modeled on the `uncheck-all` case:
  - `setActionsOpen(false)` first (matches existing pattern).
  - Compute `checkedItems = items.filter(i => i.checked)` (already in position order because `items` is sorted).
  - Apply the 0 / 1 guards above.
  - `keeper = checkedItems[0]`, `rest = checkedItems.slice(1)`.
  - `joined = checkedItems.map(i => i.text.trim()).filter(Boolean).join(" ")`.
  - Build `nextItems`: replace the keeper with `{ ...keeper, text: joined, external_link: null, linked_checklist_id: null, media_url: null, media_type: null }` and drop `rest`.
  - Optimistic: `const prev = items; setItems(nextItems); primeSpeech(); focusAndSpeakHighestUnchecked(nextItems);`.
  - Persist (sequential to keep error handling simple):
    - `await supabase.from("checklist_items").update({ text: joined, external_link: null, linked_checklist_id: null, media_url: null, media_type: null }).eq("id", keeper.id);`
    - `await supabase.from("checklist_items").delete().in("id", rest.map(r => r.id));`
  - On any error: `setItems(prev)` and `toast.error("Could not combine. Try again.")`.
- Add a new branch in the action `switch` (around the `uncheck-all` case): `case "combine-checked": await combineCheckedItems(); break;`.

### 2. `src/components/ActionsSheet.tsx`
- Extend the `ActionKey` union with `"combine-checked"`.
- Import the `Combine` icon from `lucide-react`.
- Add a new entry in `STATIC_ITEMS` directly after the existing `uncheck-all` entry (both operate on checked items, so they group naturally):
  ```ts
  { key: "combine-checked", label: "Combine checked checkboxes", icon: Combine },
  ```
- Not an AI action — no entry in `AI_KEYS`.

## Out of scope
- No database migration (uses existing columns on `checklist_items`).
- No undo (matches existing destructive actions like delete and split).
- No special handling for media/link items beyond clearing those fields on the merged keeper.