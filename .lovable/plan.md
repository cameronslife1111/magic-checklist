## Add auto-reset to 🐝 Bumblebee single-tap

When the user single-taps the 🐝 button and every top-level item in the Home Favorite slot-1 checklist is already checked, automatically uncheck them all and then run the normal recycle flow so it opens the top link again.

### Current behavior (unchanged paths)

- Long-press 🐝 still toggles Locked/Unlocked.
- Lock guard at the top of `runRecycle` still wins (does nothing while locked).
- When at least one item is unchecked, behavior is identical to today: check off the first unchecked item, then follow its link if any.

### New behavior

In `runRecycle` (`src/pages/Checklist.tsx`, ~line 221), after loading slot-1 items but before the existing hop loop:

1. Fetch slot-1's top-level items (same query already used on hop 0).
2. If the list is non-empty AND every item is `checked === true`:
   - Update all of slot-1's top-level items to `checked: false` in a single `supabase.from("checklist_items").update({ checked: false }).eq("checklist_id", slot1).is("parent_item_id", null)` call.
   - Speak a brief confirmation (reuse `speak("Recycled")` — optional, matches existing speech pattern).
   - Re-run the existing hop logic from the top so the now-unchecked first item gets checked and its link is opened (the "top link"). Cleanest implementation: extract nothing — just `continue`-style restart by letting the existing `for` loop run after the reset, since the first iteration will re-fetch and find the first item unchecked.
3. If the list has any unchecked items, skip the reset and run the existing flow unchanged.

### Edge cases

- Empty slot-1 checklist: do nothing new; existing flow already breaks out and calls `openChecklist(slot1)`.
- Slot-1 missing: existing toast remains.
- Items without `linked_checklist_id`: after reset, the first item gets checked; if it has no link, the existing loop breaks and `openChecklist` opens slot-1 itself — same as today's single-tap on a fresh list.
- No persistence or schema changes. No new DB columns. No edge functions.

### Files touched

- `src/pages/Checklist.tsx` — only the body of `runRecycle`.
- `.lovable/plan.md` — updated to document the new behavior.

### Verification

- Open slot-1 checklist, check every item manually, tap 🐝 → all items become unchecked, first item gets re-checked, and the linked checklist of the first item opens.
- Tap 🐝 with at least one unchecked item → behavior identical to today.
- Long-press 🐝 → still toggles lock; reset logic does not fire.
