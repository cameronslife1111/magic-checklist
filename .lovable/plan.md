## Add a 🏠 "Home" button to the bottom bar

Add a third, slightly narrower button between the **Actions** button and the **Check** button on the checklist page. It shows just a 🏠 emoji and, on tap, opens the very first checklist in the user's list using the same alphabetical/bucket ordering already used everywhere else (`sortChecklistsByTitle`).

### Behavior
- Always opens whatever checklist currently sorts to the top — if the user renames a checklist and a different one becomes #1, this button will follow that change automatically (it queries fresh on every press).
- If the user is already viewing the top checklist, it's a no-op (no reload, no toast).
- If the user has no checklists at all, do nothing silently.

### Technical changes — `src/pages/Checklist.tsx` only
1. **Import** `sortChecklistsByTitle` from `@/lib/sortChecklists`.
2. **Add a handler** `goHome`:
   - Query `supabase.from("checklists").select("id,title")` (no limit needed for first-row resolution; we sort client-side to match the app's bucket ordering exactly).
   - Run results through `sortChecklistsByTitle`.
   - Take the first entry. If its `id !== checklist.id`, call the existing `openChecklist(id)`.
3. **Insert a new `<Button>`** in the flex row at lines 867–953, positioned **between** the Actions button (ends line 909) and the Check button (starts line 910).
   - Content: the 🏠 emoji, rendered at a comfortable size (e.g. `text-2xl leading-none`).
   - Styling mirrors the other two buttons (`h-14 rounded-2xl shadow-floating select-none`) but **narrower** — uses a fixed width like `w-16` (or `w-20`) instead of `flex-1`, so Actions and Check still split the remaining width via their existing `flex-1`.
   - `aria-label="Open top checklist"`.
   - Simple `onClick={goHome}` — no long-press behavior, no speech priming.

### Out of scope
- No changes to `ActionsSheet`, no new menu entry, no settings, no database changes.
- Reorder mode (when the "Done" button replaces the row) is left untouched — the Home button only appears in the normal three-button row.
