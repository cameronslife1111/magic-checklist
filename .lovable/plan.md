## Goal

When you **long-press the Actions button**, in addition to reading the current highlighted sentence aloud (which already works), the app should also **scroll that sentence into view** — exactly the same way it does when you tap the green Check button or first open a checklist.

The yellow glow itself is already on the sentence (it's tied to "highest unchecked" in the list), so no styling change is needed — but right now if that sentence is off-screen, the long-press doesn't bring it into view. After this change, it will.

## What changes

**File:** `src/pages/Checklist.tsx` — only the long-press handler on the Actions button (around line 1382, inside `onPointerDown`).

Inside the 500ms long-press timer, right next to the existing `speak(text)` call, also call the existing helper `scrollItemToCenter(highestUnchecked.id)`. That helper already:

- Looks up the row's DOM element from `itemRefs`.
- Sets `scrollMarginTop = "180px"` so the row clears the top toolbar.
- Calls `scrollIntoView({ behavior: "smooth", block: "start" })`.

This is the same helper used by `focusAndSpeakHighestUnchecked` after a check-toggle, so the scroll behavior will match exactly.

## Behavior summary

- **Tap Actions button** → opens Actions sheet (unchanged).
- **Long-press Actions button (500ms)** → speaks the current sentence **and now also scrolls to it**. The yellow highlight is already on it.
- No other actions, no other buttons, and no styles are touched.

### Technical detail

```ts
actionsLongPressTimerRef.current = window.setTimeout(() => {
  actionsLongPressFiredRef.current = true;
  if (highestUnchecked) {
    scrollItemToCenter(highestUnchecked.id); // NEW
    const text = highestUnchecked.linked_checklist_id
      ? (highestUnchecked.text || "Open checklist")
      : highestUnchecked.text;
    if (text) speak(text);
  }
}, 500);
```
