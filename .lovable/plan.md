# Context Groups

A **context group** is a saved, named bundle of checklists. Once created, the user can pick a group from a dropdown in any "Attach context" panel — and it expands into its checklists exactly as if they had picked them one-by-one. No change to how AI requests are generated.

## What the user will see

### 1. New button in the Actions sheet
- Label: **"Manage Context Groups"** with a `Layers` (or `FolderOpen`) icon.
- Position: directly **above the blue AI buttons** (right before "Run as Action Sequence").
- Tapping it opens the **Context Groups manager** dialog.

### 2. Context Groups manager dialog
- Lists existing groups (title + checklist count). Each row has Edit and Delete.
- **"+ New group"** button opens an editor with:
  - Title input.
  - Checklist multi-picker (reuses the same picker already inside `ContextAttacher`, with the 15-checklist cap).
- Save / Cancel.

### 3. New dropdown inside the "Attach context" panel
Wherever `ContextAttacher` is shown today (Text/Image/Video/Audio prompts via `Checklist.tsx`, plus `ScheduleActionDialog` and `RunSequenceDialog`), add a **"Context group"** dropdown at the top of the panel:

```text
[ Context group:  ▾  None ]   ← default
                     My morning routine (4)
                     Recipes (7)
                     ...
```

- Default: **None** (no group applied — current behavior unchanged).
- Selecting a group **merges its checklists into the existing checklist chips**, deduped by id, respecting the 15 cap (extras are dropped with a toast). Media is untouched.
- Selecting **None** removes the chips that came from the group (chips the user added manually stay).
- The selected group id is remembered for that session/dialog so the user can switch groups cleanly.

This keeps the downstream payload identical to today: the AI/edge functions still just receive a flat list of checklist ids — they don't need to know groups exist.

## Technical plan

### Data model (Lovable Cloud / Supabase)
Two new tables, both with `auth.uid() = user_id` RLS (mirrors existing tables):

- `context_groups`
  - `id uuid pk default gen_random_uuid()`
  - `user_id uuid not null`
  - `title text not null default 'Untitled group'`
  - `created_at`, `updated_at` timestamptz
- `context_group_checklists`
  - `id uuid pk`
  - `user_id uuid not null` (for RLS)
  - `group_id uuid not null` (no FK to keep parity with existing tables; cascade handled in app + a `before delete` trigger that removes child rows)
  - `checklist_id uuid not null`
  - `position double precision not null default 0`
  - unique `(group_id, checklist_id)`

Trigger: on delete of `context_groups`, delete matching `context_group_checklists`. Also delete child rows when a checklist is deleted (optional; otherwise we just filter missing ids when expanding).

### New files
- `src/lib/contextGroups.ts` — typed helpers: `listGroups()`, `getGroupChecklists(groupId)`, `createGroup(title, checklistIds)`, `updateGroup(...)`, `deleteGroup(id)`. All go through `supabase` client.
- `src/components/ContextGroupsManager.tsx` — the manage dialog (list + create/edit/delete).
- `src/components/ContextGroupEditor.tsx` — title input + reuses `ChecklistMultiPicker` extracted from `ContextAttacher.tsx`.

### Refactors
- **`src/components/ContextAttacher.tsx`**
  - Export `ChecklistMultiPicker` so the group editor can reuse it.
  - Add a "Context group" `Select` at the top. On change:
    - Load `getGroupChecklists(groupId)` (returns `{id,title}[]`, filtered by what still exists).
    - Diff against current `value.checklists`; merge new ones (cap 15, dedupe).
    - Track `appliedGroupIds: { groupId, checklistIds }` in local state so switching/clearing only touches group-sourced chips.
  - No changes to the `AttachedContext` shape — chips remain the source of truth, so all consumers keep working unchanged.

- **`src/components/ActionsSheet.tsx`**
  - Add new `ActionKey`: `"manage-context-groups"`.
  - Insert above the AI block (just before `run-sequence`) with a `Layers` icon.

- **`src/pages/Checklist.tsx`**
  - Handle the new action key by opening `ContextGroupsManager`.

### Why this design
- **Zero changes to AI payload / edge functions.** Groups are pure UX sugar that expand into the existing `checklists` array.
- **Reuses the existing multi-picker** so behavior, search, and the 15-item cap are identical to today.
- **Tracking which chips came from a group** prevents "I switched groups and now my manually-picked checklist disappeared" surprises.
- **Default = None** preserves current behavior for every existing flow.

### Out of scope (not doing now)
- Sharing groups between users.
- Including media in groups (only checklists, per your description).
- Auto-syncing if a checklist inside a group is renamed/deleted later — we just resolve titles at expansion time and silently skip missing ones.

