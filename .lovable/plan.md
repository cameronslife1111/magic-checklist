## Goal
Add a checkbox at the top of the "Attach context" section in the action dialog that, when checked, automatically includes **the current checklist** (the one the user is on) as text context for any AI action — without having to open the picker and search for it.

## First-principles reasoning
- Current behavior: `ScheduleActionDialog` mounts `<ContextAttacher>` and passes `excludeChecklistId={checklist.id}` so the user *cannot* pick the current checklist from the search picker (sensible default — avoids self-reference confusion).
- The user's real workflow: they almost always want the current checklist included anyway. A one-tap toggle is faster than re-enabling/searching.
- The current checklist is already known on the parent (`checklist?.id`, `checklist?.title`) — no new query needed.
- The existing `value.checklists: { id, title }[]` shape on `AttachedContext` is exactly what the backend already accepts as text context. So "including the current checklist" simply means injecting `{ id, title }` into that array, then removing it on uncheck. **No backend, RLS, or edge function changes required.**
- Persisting the toggle state isn't necessary — the dialog state resets per action. Default = unchecked (preserves current behavior; no surprise auto-attaching for users who don't want it).

## Technical changes

### 1. `src/components/ContextAttacher.tsx`
- Extend `Props` with two optional fields:
  - `currentChecklist?: { id: string; title: string }` — the checklist the user is on.
- At the top of the rendered section (above the "Attach context (optional)" header / button grid), render a `<Checkbox>` + `<Label>` row only when `currentChecklist` is provided:
  > ☐ Include this checklist as context
- Derive `isCurrentIncluded` from `value.checklists.some(c => c.id === currentChecklist.id)`.
- On toggle:
  - If checking → append `{ id, title }` to `value.checklists` (guard against duplicates and the existing `MAX_PER_KIND` cap; show the same toast on overflow).
  - If unchecking → filter it out of `value.checklists`.
- Important nuance: the current checklist is still excluded from the search-picker results (`excludeChecklistId` stays as-is) so the user can't add it twice from two places. The checkbox is the *only* way to add the current one — clean and unambiguous.
- The existing chip strip will naturally render the current checklist as a removable chip when included; clicking the chip's ✕ should also untick the checkbox. Because we derive `isCurrentIncluded` from `value.checklists`, this happens automatically.

### 2. `src/components/ScheduleActionDialog.tsx`
- Extend `Props` with `currentChecklist?: { id: string; title: string }`.
- Pass it through to `<ContextAttacher currentChecklist={currentChecklist} … />`.

### 3. `src/pages/Checklist.tsx`
- Where `<ScheduleActionDialog … />` is mounted (around line 1390), pass:
  ```tsx
  currentChecklist={checklist ? { id: checklist.id, title: checklist.title } : undefined}
  ```
- No other changes — `pendingContext` already flows into `submitEnqueue` and onward to the `enqueue-action` edge function, which already accepts checklist context ids and verifies ownership via RLS.

## Edge cases handled
- **Current checklist not yet loaded**: checkbox simply isn't rendered (the prop is undefined).
- **User checks, then deletes the chip**: chip removal updates `value.checklists`, derived `isCurrentIncluded` flips to false, checkbox visually unticks. Single source of truth.
- **Title changes mid-session**: the chip will show the title that was current at the time of attach; that's fine for a one-shot run.
- **Hitting the 15-checklist context cap while toggling on**: same toast as the picker ("Max 15 checklists.") and the checkbox stays unchecked — predictable behavior.
- **Backend safety**: `enqueue-action` already validates that every checklist id in the context belongs to the user, so passing the current checklist id is automatically authorized.
- **No double-add**: search picker still excludes the current checklist via `excludeChecklistId`, so the only entry point for adding it is this checkbox.

## Files touched
- `src/components/ContextAttacher.tsx` — add checkbox row + toggle logic.
- `src/components/ScheduleActionDialog.tsx` — forward new prop.
- `src/pages/Checklist.tsx` — pass `currentChecklist` to the dialog.

No database migrations, no edge function changes, no new dependencies.
