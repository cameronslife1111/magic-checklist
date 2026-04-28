
# Run Sequence v2 — Strict Per-Line Agent

## Why we're redoing this
Today's planner sees too much: full prior outputs, gallery-style catalogs, free-form refs. So when a line says "make a video" it sometimes grabs the wrong asset. We're going to lock down what the agent can see at each step, attach outputs back to the step that produced them, and visibly walk through the checklist line-by-line in green.

## How it will behave (user-facing)

1. **You attach context two ways** (not one):
   - **Run Sequence dialog**: global context (reference checklists + media available to the whole run).
   - **Per line, on the checklist itself**: each line can already have inline media + a linked checklist. Those become *that line's private context only*.
2. **Press Run.** The first line turns **green** (background highlight) — that's the active step. A small "▶ Running…" badge appears.
3. The agent processes **only that one line**, using:
   - The line's text.
   - The line's own attached media + linked checklist (private).
   - The Run Sequence global context (shared).
   - A read-only summary of the *full input checklist* so it knows what's coming (text only, no media).
   - Prior step outputs (text titles only — URLs hidden unless the line clearly references them).
   - Its tool capabilities + allowed actions.
4. When it produces output, that output is **attached to the line that produced it** (inserted as a child row directly underneath, with a "↳ from step N" label and a stable `step:N` handle). The line is then auto-checked.
5. The next line turns green. Repeat until done. At the end, the source line's row shows the final output media; intermediate steps stay attached to their lines so you can see exactly where each artifact came from.

## The core fix: scoped context per tool

This is the rule that solves the "wrong video" problem:

| Tool kind | What the agent sees |
|---|---|
| `text-text`, `web-search` | Full text context: line, attached checklists' text, full input checklist text, prior outputs' text + names |
| `text-image`, `image-image`, `remix`, `image-video`, `video-video`, `audio-image-video`, `analyze-image` | **Only** media the line itself references, OR media the line explicitly names from the catalog. Prior step outputs are visible *only* if the line uses words like "the previous", "the result", "what we just made", or names a prior step. |

The planner's job becomes: **pick exact handles** for media. The dispatcher refuses to run a media tool with refs the planner didn't explicitly choose — no "fall back to most recent image" guessing.

## Technical changes

### Database (one migration)
- Add `checklist_items.parent_item_id uuid` (nullable, FK to `checklist_items.id` ON DELETE CASCADE) — lets generated outputs hang off the line that produced them.
- Add `action_jobs.active_line_item_id uuid` (nullable) on the parent sequence job — the UI subscribes to this for the green highlight.
- Index: `idx_items_parent` on `(parent_item_id)`.

### Worker — `supabase/functions/process-action-queue/index.ts`
- **planning_init**: snapshot input lines *with their item ids*, inline `media_url`/`media_type`, and `linked_checklist_id`. Resolve each linked_checklist into a per-line linked_list block (depth 1 only, no BFS). Store as `state.input_lines[i] = { item_id, text, line_media, line_linked_list }`.
- **planning_step**: before calling planner, set `active_line_item_id = input_lines[cursor].item_id` on the parent and persist (drives green highlight). Build a *per-line catalog*:
  - `line:image|video|audio` — media on this line only.
  - `linked-line:I` — media inside the line's own linked checklist.
  - `attached:N` — global Run Sequence media.
  - `step:N` — prior outputs, but **filtered**: only included if the line text contains a back-reference token (regex: `previous|prior|that|result|step \d|above|just made|earlier`) OR matches a prior step's name.
  - Global linked checklists (from Run Sequence dialog) — included only as text in `linked_context_text`, never as media unless explicitly referenced.
- **dispatching**: when inserting child jobs, set `parent_item_id = input_lines[cursor].item_id` on the resulting checklist row (added below). Keep `parent_job_id` linkage for queue UI.
- **awaiting_children → completed step**: insert the output as a `checklist_items` row with `parent_item_id = active line.item_id`, position = right after the active line (or after its last existing child). Auto-check the source line. Clear `active_line_item_id`. Advance cursor.
- Remove the loose name-matching fallback in `resolveRef` for media tools — require exact handle match. For text tools, keep loose matching since it's harmless.

### Planner — `supabase/functions/plan-action-sequence/index.ts`
- Update SYSTEM prompt:
  - "You see ONE line. The catalog you receive is already filtered to what is legitimately available for this line. Do not invent handles. Do not reference prior `step:N` outputs unless the current line explicitly says so."
  - Tighten compound rule: max 2 sub-steps (was 3).
  - For media tools, require `input_refs` to use **only** handles present in the catalog — no name-only refs.
- Drop `prior_outputs_summary` URLs entirely; pass only `{step, kind, name}`.

### UI — `src/pages/Checklist.tsx` + `src/components/ItemRow.tsx` + `src/components/SortableItemRow.tsx`
- Subscribe (realtime) to the running sequence's parent `action_jobs` row for the current checklist; read `active_line_item_id`.
- Pass `activeLineItemId` to each rendered `ItemRow`. When `item.id === activeLineItemId`, apply a green background (`bg-green-500/15 ring-1 ring-green-500/40`) and show a small "▶ Running…" badge.
- Render child rows (`parent_item_id === item.id`) indented under the parent with a "↳ from step N" prefix. They behave like normal items (drag/edit/delete still work) but visually grouped.
- When the sequence completes/aborts, clear the highlight.

### Run Sequence dialog — `src/components/RunSequenceDialog.tsx`
- Update helper text: "The agent runs your checklist line by line. Each line can have its own attached media or linked checklist (added directly on the line). Anything you attach below is shared across all steps as global context."
- No structural changes — global context still flows through `payload.context`.

## Files to touch
- New migration (add 2 columns + index).
- `supabase/functions/process-action-queue/index.ts` (per-line context build, output attachment, active-line tracking).
- `supabase/functions/plan-action-sequence/index.ts` (stricter prompt + ref rules).
- `src/pages/Checklist.tsx` (realtime subscription, pass active line, render children).
- `src/components/ItemRow.tsx` + `SortableItemRow.tsx` (green highlight + child row label).
- `src/components/RunSequenceDialog.tsx` (helper text only).
- `src/lib/types.ts` (add `parent_item_id` to ChecklistItem).

## Out of scope (intentionally)
- No changes to non-sequence single actions.
- No new tools/modalities.
- The green highlight is realtime-driven; we won't add polling fallback unless you ask.

Approve and I'll implement it.
