## Why the previous fix isn't fully working

The earlier fix added a one-shot capture-phase `click` listener on `window` to swallow the synthesized click after picking a search result. This works most of the time, but fails in two edge cases on iOS:

1. **React 17+ event delegation**: React attaches its delegated click listener to the *root container*, not `document`. While our `window` capture-phase listener should fire first, certain iOS Safari versions dispatch the synthesized click as a `pointerup`-derived event whose target gets re-evaluated *after* the dropdown closes — sometimes the listener fires for a different unrelated event (e.g., a focus-related click) and is consumed via `{ once: true }`, leaving the real ghost-click unhandled.
2. **Same-checklist pick**: When the user searches and picks the checklist they're already on, the `<h1>` doesn't remount, so it remains at the exact tap coordinates and reliably receives the ghost click.

## The robust fix — guard the title with a shared timestamp

Instead of trying to *catch* the ghost click in flight, **mark the moment a pick happened** and have the title's `onClick` ignore any click that fires within ~500ms after a pick. This is deterministic and doesn't depend on event-listener timing quirks.

### Changes

**1. New file `src/lib/clickGuard.ts`** — tiny shared module:
```ts
let lastPickAt = 0;
export const markPickJustHappened = () => { lastPickAt = Date.now(); };
export const wasPickJustNow = (windowMs = 500) => Date.now() - lastPickAt < windowMs;
```

**2. `src/components/ChecklistSearch.tsx`** — call `markPickJustHappened()` at the start of `handlePick` (keep the existing window-level swallow as belt-and-suspenders).

**3. `src/pages/Checklist.tsx`** — update the `<h1>` `onClick` (line 699) to bail out if `wasPickJustNow()` is true:
```tsx
onClick={() => {
  if (wasPickJustNow()) return;
  setDialog({ kind: "edit-title" });
}}
```

### Why this works
- The timestamp is set synchronously inside `handlePick` *before* the ghost click can fire.
- The h1's `onClick` checks the timestamp and silently returns — no dialog opens.
- After 500ms (well past the iOS synthesized-click delay of ~300ms), normal taps on the title work again.
- Works for both fresh-navigation and same-checklist picks, and is independent of React's event-delegation timing.

### What about the other requested behaviors?
The existing `openChecklist` flow in `Checklist.tsx` already:
- resets `didAutoFocusRef.current = null`,
- the existing effect scrolls the highest unchecked item to center,
- applies the yellow `glow-active` highlight via the `highestUnchecked` memo,
- calls `speak(text)` to read the sentence aloud.

So once the title-dialog bug is gone, all three desired behaviors (scroll, yellow glow, speech) already work — no additional changes needed.

## Files changed
- **New**: `src/lib/clickGuard.ts`
- **Modified**: `src/components/ChecklistSearch.tsx` — call `markPickJustHappened()` in `handlePick`
- **Modified**: `src/pages/Checklist.tsx` — guard the `<h1>` `onClick` with `wasPickJustNow()`