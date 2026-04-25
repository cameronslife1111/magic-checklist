## Extend 🏠 Home button with hyperlink-jump fallback

Add a secondary behavior to the existing Home button in `src/pages/Checklist.tsx` so it does double duty depending on where the user already is.

### New behavior
1. **If the user is NOT on the top checklist** → open the top checklist (existing behavior, unchanged).
2. **If the user IS already on the top checklist** → look at the currently active (yellow-highlighted) item, which is `highestUnchecked`. If that item has a `linked_checklist_id`, open that linked checklist via the existing `openChecklist(id)`.
3. **If they're on the top checklist and the active item has no link** → do nothing (silent no-op, matching the existing "no checklists" silent behavior).

### Technical change — `src/pages/Checklist.tsx` only
Replace the inline `onClick` on the 🏠 `<Button>` (lines 911–922) with logic that:
- Queries `checklists` (`id,title`), sorts via `sortChecklistsByTitle`, takes the first row as `top`.
- If `top.id !== checklist.id` → `await openChecklist(top.id)` (current behavior).
- Else if `highestUnchecked?.linked_checklist_id` is set → `await openChecklist(highestUnchecked.linked_checklist_id)`.
- Else → return silently.

No changes to styling, layout, the Actions button, the Check button, reorder mode, `ItemRow`, or any other file. No database changes.

### Out of scope
- External links (`external_link`) are not followed — only internal checklist hyperlinks (`linked_checklist_id`) per the request.
- No toast, no haptic, no long-press behavior added.