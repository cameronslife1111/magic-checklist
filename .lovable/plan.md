## Goal
After the user **sends an item to another checklist** or **deletes an item via the X button**, the app should automatically:
1. Cancel any in-progress speech.
2. Scroll the new highest unchecked item into view (centered).
3. Apply the existing yellow glow highlight (already driven by `highestUnchecked`).
4. Speak the new highest unchecked sentence via Web Speech.

This mirrors what already happens when toggling a checkbox (`handleToggle`), and reuses the existing `speak()` / `stopSpeech()` / `scrollItemToCenter()` helpers in `src/pages/Checklist.tsx`.

## Root cause
- `handleSendTo` (line 638) removes the source item but never speaks/scrolls afterward.
- `handleDelete` (line 223) removes the item but also never speaks/scrolls afterward.
- The auto-focus effect at line 150 is gated by `didAutoFocusRef.current === checklist.id`, so it only fires once per checklist load and won't re-run when items change.

## Changes — `src/pages/Checklist.tsx`

### 1. Add a small helper near `scrollItemToCenter` (~line 165)
```ts
const focusAndSpeakHighestUnchecked = (list: ChecklistItem[]) => {
  const next = list.find((i) => !i.checked);
  if (!next) { stopSpeech(); return; }
  scrollItemToCenter(next.id);
  const text = next.linked_checklist_id ? (next.text || "Open checklist") : next.text;
  if (text) speak(text);
};
```
This matches the exact pattern already used at the end of `handleToggle` (lines 205–212).

### 2. Update `handleDelete` (line 223)
Replace the bare `setItems((prev) => prev.filter(...))` with:
```ts
setItems((prev) => {
  const nextList = prev.filter((i) => i.id !== item.id);
  focusAndSpeakHighestUnchecked(nextList);
  return nextList;
});
```

### 3. Update `handleSendTo` (line 687)
Same treatment after the successful insert + delete:
```ts
setItems((prev) => {
  const nextList = prev.filter((i) => i.id !== src.id);
  focusAndSpeakHighestUnchecked(nextList);
  return nextList;
});
```

## Notes
- `speak()` already calls `window.speechSynthesis.cancel()` internally, so any currently-spoken sentence (e.g. the one being sent/deleted) is cut off immediately before the next one starts.
- The existing `isActive={highestUnchecked?.id === it.id}` prop on `ItemRow` already produces the yellow `glow-active` highlight; once the items array updates, the new top unchecked item will glow automatically — no extra wiring needed.
- If no unchecked items remain, we just stop speech (no toast, no scroll).
- No changes needed to `SendToChecklistDialog`, `ItemRow`, or `speech.ts`.

## Out of scope
- Toggle/check flow (already handled).
- Mute toggle continues to suppress speech as today.