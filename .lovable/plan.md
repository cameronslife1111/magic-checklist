## Problem

When the user taps "Delete current checkbox", the next unchecked item gets the yellow highlight and is spoken, but the page does not scroll to it. Toggling a checkbox scrolls correctly because the item already exists in the DOM. After deletion, the newly-highlighted item may need a fresh DOM lookup, and the current code calls the scroll helper *inside* the `setItems` updater function — before React has committed the new render — so the `itemRefs` lookup can race or use stale layout.

## Fix

In `src/pages/Checklist.tsx`, update `handleDelete` (around lines 380–392) so the focus + scroll + speak step runs *after* the state update commits, the same way it reliably works for toggling.

### Changes

1. Compute `nextList` outside the `setItems` updater (or capture it), then call `setItems(nextList)`.
2. Defer `focusAndSpeakHighestUnchecked(nextList)` until after the DOM updates by wrapping it in a double `requestAnimationFrame` (or `setTimeout(..., 0)`). This ensures the highlighted item's ref is mounted/positioned before `scrollIntoView` runs.

Result: after deleting the current checkbox, the page smoothly scrolls to the newly highlighted next checkbox, matching the behavior when toggling a box.

No other files or behavior change.