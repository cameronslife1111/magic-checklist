## Goal

Reshuffle long-press behaviors on the bottom button row:

1. **Home button (🏠)** — long-press now adds a new checkbox (the behavior currently on the green Check button).
2. **Green Check button** — long-press now goes **back one step**: unchecks the line directly *above* the current yellow-highlighted (highest unchecked) line, makes that the new active line, and triggers web speech to read it.
3. Short-tap behavior on both buttons stays exactly the same:
   - Home tap → open top checklist (unchanged).
   - Check tap → check current and advance (unchanged).

## Behavior Details

### Home long-press → add new item
- After ~600ms hold, insert a new empty item *before* the highest unchecked line (same as current `addNewBeforeCurrent()` flow).
- Auto-focus the new item so the keyboard appears.
- Use the same iOS keyboard keepalive pattern (synchronous focus on `keepaliveRef` inside the gesture) currently used by the Check button, so the keyboard reliably appears on iPhone.
- Short tap on Home keeps current behavior (open top checklist / drill into linked).

### Check long-press → go back one step
- Resolve the "highest unchecked" item (the yellow-highlighted one).
- Find the item directly above it in the top-level list. If it exists and is checked, uncheck just that one item (DB update + local state).
- That newly-unchecked item now becomes the highest unchecked → it auto-becomes the yellow-highlighted active line (no extra state change needed; it derives from `topLevelItems.find(!checked)`).
- Scroll it to center and call `speak(text)` to read it aloud.
- Edge cases:
  - If the highlighted line is already the very first item (no line above), do nothing (or a soft toast like "Already at the top"). No speech change.
  - If the line above is a linked-checklist row, speak its text (or "Open checklist" fallback), matching how `handleToggle` already handles that case.
  - If nothing is currently unchecked (all done) and the user long-presses Check, uncheck the last checked item and speak it.

### Short taps unchanged
- Check short tap still calls `handleToggle(highestUnchecked, true)`.
- Home short tap still opens the top-sorted checklist / drills into linked checklist.

## Technical Changes (single file: `src/pages/Checklist.tsx`)

1. **Add a helper** `goBackOneStep()`:
   - Compute `topLevelItems` view; find index of `highestUnchecked` (or use `topLevelItems.length` if none).
   - `prev = topLevelItems[idx - 1]` (or last item if all are checked).
   - If no `prev`, return.
   - Optimistically update local `items` (set `prev.checked = false`).
   - `await supabase.from("checklist_items").update({ checked: false }).eq("id", prev.id)`.
   - `scrollItemToCenter(prev.id)` and `speak(prev.linked_checklist_id ? (prev.text || "Open checklist") : prev.text)`.

2. **Swap the long-press handlers between the two buttons:**
   - **Home button (🏠)**: wrap its `onClick` logic into `onPointerUp` short-tap branch and add `onPointerDown`/`onPointerUp`/`onPointerCancel` long-press timer that calls `addNewBeforeCurrent()` after 600ms. Move the `keepaliveRef.current?.focus(...)` calls here so the iOS keyboard reliably appears for the new item.
   - **Green Check button**: keep short-tap = `handleToggle(highestUnchecked, true)`. Replace its long-press body so that after 600ms it calls the new `goBackOneStep()` helper. Remove the keepalive focus calls from this button (no keyboard needed for back-step).

3. **Reuse existing refs** `longPressTimerRef` / `longPressFiredRef` for the Check button, and `actionsLongPressTimerRef` is still used by Actions. Add a new pair of refs for the Home long-press timer (e.g. `homeLongPressTimerRef`, `homeLongPressFiredRef`).

4. **Discoverability**: update `aria-label` on the Home button to reflect the new long-press ("Open top checklist (long-press: add new item)") and on Check ("Check current (long-press: go back one)"). Also update the comment block near the hidden `keepaliveRef` input to reference the Home button instead of Check.

5. No DB schema changes, no edge function changes.

## Out of Scope

- No changes to Actions button behavior.
- No changes to web speech engine itself — we only call existing `speak()` / `stopSpeech()` from inside the gesture handlers, so the existing self-healing path still applies.
- No changes to cascade-uncheck behavior of normal checkbox taps in the list.
