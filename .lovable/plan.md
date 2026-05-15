# Add Lock / Unlock long-press to the 🐝 Bumblebee button

Add a long-press (≈600ms) gesture on the yellow 🐝 button that toggles a "locked to current checklist" mode. While locked, the user can still check items, add items, use Actions, dictate, and use speech — but cannot navigate away from the current checklist.

## Behavior

- Single click/tap on 🐝 — unchanged. Runs the existing Recycle flow (when unlocked). When locked, it does nothing except speak "Locked".
- Long press on 🐝 (≈600ms) — toggles lock state:
  - Unlocked → Locked: turn the 🐝 button red and speak "Locked".
  - Locked → Unlocked: restore the normal yellow metallic styling and speak "Unlocked".
- While locked:
  - 🏠 Home button: short tap is suppressed (does nothing, optional brief "Locked" toast). Long-press of Home (open current item's link) is also suppressed — both forms of Home navigate away.
  - 🐝 short tap: suppressed (speaks "Locked").
  - ✅ Green check button: works as today (toggles current item, long-press goes back one step on the same list — back-one-step does not navigate away from this checklist, so it stays allowed).
  - Actions button + sheet: works as today. Any action inside the sheet that would navigate away from the current checklist is blocked with a "Locked" toast. Specifically: Send to checklist, Send to blank checklist, New checklist, Duplicate checklist, Delete checklist, Insert checklist link (which navigates to the new link target after creating), Swap Links (if it navigates), Media Gallery, Action Queue Dashboard, and the Home Favorites cycle. Non-navigating actions (split, copy, combine, edit title, background, mute, theme, AI prompts that stay on this list, etc.) work normally.
  - Item rows: tapping a checkbox works. Tapping a linked-item's link icon to jump to another checklist is blocked with a "Locked" toast.
- Lock state is in-memory only (resets on full reload). It is per-tab, not persisted.

## Visual

- Locked state replaces `btn-metallic-yellow` with a solid red background using the existing destructive token (`bg-destructive text-destructive-foreground`) and removes the shimmer class so it reads clearly as an alert state.
- The 🐝 emoji stays. `aria-label` updates to "Unlock checklist (long-press)" while locked, and to "Recycle (long-press: lock checklist)" while unlocked.

## Implementation notes (technical)

File: `src/pages/Checklist.tsx`

1. Add state: `const [locked, setLocked] = useState(false);` plus refs `bumbleLongPressTimerRef` and `bumbleLongPressFiredRef` mirroring the existing Home/Check long-press pattern.
2. Replace the current 🐝 `onPointerUp={runRecycle}` handler with the same `onPointerDown` / `onPointerUp` / `onPointerCancel` long-press pattern used for the Home button:
   - On `pointerdown`, start a 600ms timer that sets `locked` to its inverse, calls `speak("Locked")` or `speak("Unlocked")` accordingly, and sets `bumbleLongPressFiredRef.current = true`.
   - On `pointerup`: if long-press fired, return. Otherwise, if `locked`, `speak("Locked")` and return. Else `await runRecycle()`.
3. Apply locked styling conditionally via `cn(...)`: when `locked`, use `"bg-destructive text-destructive-foreground hover:bg-destructive/90"` and drop `btn-metallic-yellow btn-shimmer`.
4. Guard navigation paths with a tiny helper `const guardNav = () => { if (locked) { speak("Locked"); toast.message("Locked"); return true; } return false; };`:
   - Wrap the 🏠 short-tap handler (line ~1683 onPointerUp) and its long-press timer body (line ~1672) so both early-return when `guardNav()` is true.
   - Wrap the body of `runRecycle` so it early-returns when locked (defensive — bumble short-tap already blocks, but `runRecycle` should not navigate either way).
   - In `onPick` (the ActionsSheet handler around line 914+), early-return with `guardNav()` for keys: `queue`, `media-gallery`, `send-to`, `send-to-blank`, `new`, `duplicate`, `delete-checklist`, `insert-link`, `insert-new-link`, `swap-links`, `manage-home-favorites` (only the navigation step — the manager dialog itself can open; if it triggers navigation that needs the same guard).
   - In `ItemRow`/`SortableItemRow`, the link-tap that calls `openChecklist(linked_checklist_id)` from within a row should be guarded. Easiest: wrap the existing `openChecklist` call site at the row level by passing `locked` down OR by checking `locked` in a small wrapper `openChecklistGuarded` and using that wrapper for any in-row "follow link" handler. (Ad-hoc audit during implementation: only wrap call sites that change checklists; do not wrap calls that load the initial checklist or recover state.)
5. The `goBackOneStep` long-press on the green ✅ button stays unguarded — it operates on the current list and does not navigate away.
6. Speech calls reuse `speak()` from `@/lib/speech`; no new audio code.

## Out of scope

- No persistence of lock state across reloads.
- No DB columns, no backend, no edge function changes.
- No changes to Action Queue, Media Gallery internals, auth, or styling tokens beyond reusing `bg-destructive`.
- No changes to the Home Favorites list, Recycle algorithm, or any other button's gestures.

## Verification

- Long-press 🐝 on an unlocked checklist: button turns red, speaks "Locked".
- While locked: short-tap 🏠 does nothing/toast. Long-press 🏠 does nothing/toast. Short-tap 🐝 speaks "Locked". Tap a checkbox → toggles. Long-press ✅ goes back one item on the same list. Open Actions → tapping "Media Gallery" toasts "Locked"; tapping "Split by punctuation" works.
- Long-press 🐝 again: returns to yellow metallic, speaks "Unlocked", all navigation works normally.
