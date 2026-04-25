## Bug
On mobile, tapping a search result correctly opens the picked checklist, but the synthesized click from that same touch then lands on the `<h1>` title (which sits directly below the search dropdown) and opens the "Edit checklist title" dialog.

## Root cause
In `src/components/ChecklistSearch.tsx`, each result row uses `onPointerDown` + `e.preventDefault()` to pick a checklist. On iOS Safari, after the dropdown closes synchronously, the browser still dispatches the follow-up `click` event for that touch. With the dropdown gone, the click lands on the `<h1>` in `src/pages/Checklist.tsx` (line 697-703) whose `onClick` opens the rename dialog.

## Fix (minimal, targeted)

### 1. `src/components/ChecklistSearch.tsx` — swallow the trailing click
- Keep the existing `onPointerDown` selection behavior (so it still feels instant).
- Track `pickingRef = useRef(false)`. Set it to `true` inside `handlePick`, then clear it on a short timeout (~400ms).
- While `pickingRef.current` is true, attach a one-shot capture-phase `click` listener to `document` that calls `e.stopPropagation()` and `e.preventDefault()`, then removes itself. This blocks the synthesized click from reaching the `<h1>` underneath.
- Alternative simpler version: in `handlePick`, install a `window.addEventListener('click', handler, { capture: true, once: true })` that swallows the next click. This is the approach we'll use — smaller and self-contained.

### 2. `src/pages/Checklist.tsx` — defensive guard on the title (small hardening)
- Change the `<h1>` `onClick` to also check that the click target is the `<h1>` itself (not bubbling weirdness). Not strictly required once #1 is in, but cheap insurance.

## What about the "scroll + highlight + speak" behavior?
`openChecklist` already resets `didAutoFocusRef.current = null`, and the existing effect on lines 138-151 scrolls the highest unchecked item to center, applies the `glow-active` highlight (via `highestUnchecked` memo), and calls `speak(text)`. So once the title-dialog bug is gone, the requested behavior (scroll to highest unchecked, yellow glow, speech reads it) already works. No additional changes needed there.

## Files changed
- `src/components/ChecklistSearch.tsx` — swallow the next click after a pick.
- `src/pages/Checklist.tsx` — minor defensive tweak on the title `onClick` (optional but included).