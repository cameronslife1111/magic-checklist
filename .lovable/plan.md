# Fix Run Sequence: user-attached context only

## Problem

The Run Sequence agent is picking the wrong media and following the wrong checklists because it auto-discovers context the user never asked for:

1. **Inline checklist link following** — `loadLinkedLists` does a BFS up to depth 2 over every `linked_checklist_id` on every line of the input checklist, pulling in unrelated lists.
2. **Whole gallery snapshot** — the worker loads the user's most recent 200 media assets into the planner's catalog, so the AI freely picks images/videos the user never intended to use.
3. **Per-line attached media** is also auto-included (line:current, line:N), even when the user wanted to drive everything from the Run Sequence dialog.

Result: the planner sees a giant pile of unrelated media + checklist text and reaches for the wrong things.

## Goal

The Run Sequence dialog becomes the single source of truth for context. The agent only ever sees:
- The input checklist's own line text (still needed — that's what it iterates over).
- Step outputs it has produced during this run.
- Whatever the user explicitly attached in the dialog (checklists + media gallery items).

Nothing else. No inline link following, no gallery dump, no implicit per-line attachments.

## Changes

### 1. `supabase/functions/process-action-queue/index.ts`

In `tickSequence` → `planning_init` phase:

- **Remove `loadLinkedLists` BFS over `linked_checklist_id`.** Replace with a simple fetch of only the checklists in `payload.context.checklists` (already validated as user-owned by `enqueue-action`). Drop the `MAX_DEPTH` traversal entirely.
- **Remove the `media_assets` gallery snapshot.** Delete the `state.gallery` population block. The planner will no longer see arbitrary gallery items.
- Keep `state.attached_media` exactly as it is — that's the user's explicit picks.
- Keep `state.input_lines` (the input checklist text) — needed for iteration.

In `buildCatalog`:

- Remove the **gallery** block (handles like `gallery:N`).
- Remove the **input checklist line media** block (handles like `line:current`, `line:N`). Per-line attached media on the input checklist is no longer auto-promoted.
- Keep: `step:N` (prior outputs), `linked:L:I` (now only user-attached checklists, not BFS-discovered), `attached:N` (dialog media).

The simplified catalog the planner sees becomes:
```text
step:N      prior step outputs (this run)
linked:L:I  media on items inside user-attached checklists
attached:N  media gallery items the user attached in the dialog
```

### 2. `supabase/functions/plan-action-sequence/index.ts`

Update the SYSTEM prompt's "Reference rules":

- Remove the `line:current` / `line:N` / `gallery:N` mentions.
- Replace rule 3 (current_line_attached) with: media for this run comes only from prior step outputs (`step:N`), the user-attached checklists (`linked:L:I`), and the user-attached gallery items (`attached:N`). If the catalog has nothing suitable for what the line asks for, return `no_action` with a brief reason rather than guessing.
- Drop the `current_line_attached` field from the request body it expects.

### 3. `src/components/RunSequenceDialog.tsx`

Tighten the dialog so it's clearly the only source of context:

- Update the helper text under the title from "The agent reads your checklist line by line and decides one tool call per line. For best results, write one instruction per line and attach reference images directly to the line that uses them. The agent can also follow checklists you've linked from any line." to something like: "The agent reads your checklist line by line. It will only use the checklists and media you attach below as reference — it will not follow checklist links inside lines or pull from your gallery on its own."
- Keep the existing `ContextAttacher` (already supports attaching checklists + image/video/audio from the Media Gallery).
- No prop changes.

### 4. `src/components/ContextAttacher.tsx`

No structural changes needed — it already supports text (checklists), images, videos, and audio from the gallery, which is exactly what we want.

## Out of scope

- The per-item "Run AI on this line" actions (single-line runs from the row menu) keep their existing behavior. This change only affects "Run as Action Sequence".
- Existing in-flight sequences will keep using their already-snapshotted `sequence_state`. Only newly started sequences pick up the new behavior.

## Technical notes

- `enqueue-action` already validates `payload.context.checklists` ownership and `payload.context.media` URL prefixes — no edge function security changes needed.
- The `loadLinkedLists` function can either be deleted or simplified to a pure "load these N user-attached checklists" helper. Simpler is better — replace it with an inline fetch.
- `buildCatalog`'s signature changes (no longer needs `currentLineIdx`, no longer returns `currentAttached`); update the single caller in `planning_step`.