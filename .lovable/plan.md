## Goal
1. Add a new **"Delete checklist"** action to the Actions popup that asks for confirmation, then deletes only the current checklist.
2. Change **"Duplicate checklist"** so it opens a title prompt (pre-filled with `"<old title> Copy"`) before creating the duplicate, letting the user edit the new title first.

## Changes

### 1. `src/components/ActionsSheet.tsx`
- Extend `ActionKey` union with `"delete-checklist"`.
- Add a new `STATIC_ITEMS` entry:
  - **Label**: `Delete checklist`
  - **Icon**: `Trash2` (lucide-react)
  - **Position**: right after `"duplicate"` ("Duplicate checklist") so checklist-level actions sit together.

### 2. `src/pages/Checklist.tsx`

**Dialog state**: extend `DialogState` union with two new variants:
- `{ kind: "duplicate-title" }`
- `{ kind: "delete-checklist" }`

**Duplicate flow change**:
- `case "duplicate":` no longer calls `duplicateCurrent()` directly. Instead it does `setDialog({ kind: "duplicate-title" })`.
- Refactor `duplicateCurrent()` → `duplicateCurrentWithTitle(newTitle: string)` which uses the supplied title in the insert (fallback to `"${checklist.title} Copy"` if empty, but the dialog already enforces non-empty).
- Render a new `<TextPromptDialog>`:
  - `open={dialog.kind === "duplicate-title"}`
  - `title="Duplicate checklist"`, `label="New checklist title"`
  - `initial={\`${checklist.title} Copy\`}`
  - `saveLabel="Duplicate"`
  - `onSave`: call `duplicateCurrentWithTitle(title)` then close dialog.

**Delete flow**:
- New `case "delete-checklist":` → `setDialog({ kind: "delete-checklist" })`.
- New handler `deleteCurrentChecklist()`:
  - Delete `checklist_items` where `checklist_id = checklist.id` (RLS-scoped to the user).
  - Delete the row from `checklists` where `id = checklist.id`.
  - On error → `toast.error("Could not delete checklist. Try again.")` and keep dialog open.
  - On success → `toast.success("Checklist deleted.")`, clear `localStorage["mc-last-checklist"]`, then load the user's next available checklist (query `checklists` for `user_id`, order by `updated_at desc`, limit 1) and call `openChecklist` on it. If none exists, mirror the bootstrap branch (insert a fresh "Untitled" checklist with a couple of starter items) so the page never lands on an empty/null state.
- Render an `<AlertDialog>` (using existing `src/components/ui/alert-dialog.tsx`) bound to `dialog.kind === "delete-checklist"`:
  - Title: `Delete this checklist?`
  - Description: `"<title>" and all its checkboxes will be permanently deleted. This cannot be undone.`
  - Cancel + destructive Confirm button (Confirm calls `deleteCurrentChecklist`).

## Notes / Non-goals
- Only the active checklist is deleted — no cascade to other checklists or to `action_jobs`.
- No DB schema changes, no edge function changes, no new dependencies (`AlertDialog`, `Trash2`, `TextPromptDialog` all already exist).
- `duplicateCurrentItem` (checkbox duplication) is untouched.
