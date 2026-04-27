
# Action Sequence v2 — step-by-step, image-aware, link-following

## What's broken today (root causes)

1. **Reference images vanish.** The planner runs once, up front, with only `{name, type}` in the gallery index — no URLs, no item IDs. The model then guesses ref strings like `"my dog photo"`. At dispatch we substring-match against `media_assets.title`, but the user's image was attached to the *checklist line itself* (a `media_url` on a `checklist_item`, not a gallery `title`), so the loose match silently returns nothing, the step is marked invalid, and we append a `⚠️ Skipped` line.
2. **Step-output reuse is fragile.** The planner emits `step:N` blindly without seeing previous outputs. If step N produced text or was skipped, later steps still try to use it as an image and fail validation.
3. **Linked checklists are ignored.** `checklist_items.linked_checklist_id` is never read by the worker. Instructions like "follow the steps from <linked checklist>" hit a wall.
4. **The plan is monolithic.** One LLM call has to decompose the entire checklist with no feedback loop. Any single bad step taints the rest.
5. **In-checklist media isn't a first-class reference source.** The planner only sees gallery titles, but users naturally attach an image directly to a checklist line and expect "use that image" to work.

## Fix — switch to a step-by-step (per-line) executor

Plan **one line at a time** instead of the whole checklist up front. The agent walks the input checklist top-to-bottom; for each line it (a) builds a rich, current catalog of every media URL it could possibly use, (b) asks the LLM "what single tool call (or no-op) does this line require?", (c) dispatches the child job, (d) waits, (e) records the output into the catalog so the next line can reference it. This single change fixes (1)–(4) because the model now sees real URLs for every reference type at decision time and gets feedback after each step.

### The unified media catalog (built fresh per step)

Every reference source becomes a single list of entries the model can pick from by name *or* by a stable handle:

```
type CatalogEntry = {
  handle: string;        // e.g. "step:3", "line:7", "gallery:42", "linked:2:5"
  name: string;          // human label (item text snippet, gallery title, "Step 3 output")
  url: string;           // resolved URL — never null
  type: "image"|"video"|"audio";
  source: "step-output"|"current-line"|"input-line"|"linked-line"|"gallery"|"attached";
}
```

Built each tick from:
- `state.outputs[*]` with media → `step:N`
- The **current input checklist line's own** `media_url` (if any) → `line:current`
- Every other input checklist line's `media_url` → `line:N`
- Every line in any **linked checklist** reachable from the input checklist (1 hop, deduped, max 5 lists) → `linked:listIdx:lineIdx`
- The first 200 `media_assets` for the user → `gallery:N`
- Anything attached via `ContextAttacher` (existing `payload.context.media`) → `attached:N`

The model sees the full catalog with `{handle, name, type}` (NOT URLs — keeps tokens down and prevents hallucinated URLs). It returns `input_refs: { images: ["handle-or-loose-name", ...] }`. The worker resolves: exact handle match first, then loose name match against the same catalog (existing `looseMatchGalleryName` extended to all sources), then fail with a precise message naming what it looked for and offering the closest 3 candidates.

### Linked-checklist traversal

In the planning preamble for each line we resolve `linked_checklist_id` on every input-checklist item once per sequence and cache in `sequence_state.linked_lists`. Each linked list contributes:
- Its **text lines** are added to the line's prompt context block (so "follow the steps from X" actually inlines those steps).
- Its **media_url items** are added to the catalog under `linked:` handles.

Hard cap: 1-hop (no recursion), max 5 linked lists, max 50 lines per linked list, total catalog capped at 300 entries.

## New flow (state machine)

```text
planning_init → for each input line:
   build_catalog → plan_one_line → dispatch_child → await_child → record_output
                                       ↑                              │
                                       └────────── next line ─────────┘
                                  (or no_action / skipped → next line)
→ completed
```

`planning_init` replaces the old single big plan. It only:
- loads input lines (in order) into `state.input_lines`
- resolves linked checklists into `state.linked_lists`
- snapshots the gallery into `state.gallery`
- sets `state.cursor = 0`

`plan_one_line` is a new fast LLM call (`google/gemini-2.5-flash`, JSON tool-call) that takes:
```
{
  current_line: string,
  current_line_attached: CatalogEntry|null,
  prior_outputs_summary: [{step, kind, name}],
  upcoming_lines_preview: string[],   // next 3 lines, for context only
  catalog: CatalogEntry[],            // {handle,name,type} only
  linked_context_text: string,        // concatenated text of linked lists
  allowed_actions: string[],
  max_images_per_step: number,
}
```
and returns exactly one of:
```
{ kind: "tool_call", step: PlanStep }
{ kind: "no_action", reason: string }   // e.g. plain narration line, header, blank
{ kind: "compound", steps: PlanStep[] }  // for "do A then B" inline; max 3 sub-steps
```

The compound case lets a single line legitimately spawn 2-3 chained children (rare but matches "generate an image of X, then turn it into a video"). The cap of 3 prevents runaway expansion. Each compound sub-step still flows through the same dispatch/await loop sequentially.

### Dispatch fix-ups

`dispatch_child` builds `childPayload` exactly like today, but with two additions:
- **Pass `media_assets` URL through unchanged** when a `gallery:` or `linked:` handle resolves to a public storage URL — these already work with `lovable-image`'s `refImageUrls`. No re-upload needed.
- **For `text-image` with refs**, currently we pass `refImageUrls` but `lovable-image` accepts that and Nano Banana will use it as style/subject reference — confirm by reading `lovable-image/index.ts` (already accepts the field). If it doesn't, switch the action to `image-image` automatically when refs are present.

### Output recording

When a child completes, in addition to writing `state.outputs[stepIdx]`, also append the resulting media URL into the catalog as `step:N` for future ticks. If the line was `compound`, store the *last* sub-step's output as `step:N` (and intermediates as `step:N.0`, `step:N.1` for advanced ref'ing — optional, keep simple first cut).

### Skip vs fail UX

- Plain narration / header lines → `no_action`, no checklist noise (don't append a "Skipped" line; just advance).
- Tool call with unresolvable refs → append `⚠️ Step N skipped — couldn't find image "X". Closest matches: "A", "B", "C". Try renaming or attaching.` Then advance (don't increment `failures` — this is a user-fixable gap, not a runtime error).
- Tool call execution failure → existing `error_friendly` flow + counts as a failure against `max_failures`.

## Concrete file changes

### `supabase/functions/plan-action-sequence/index.ts` (rewrite)

Replace the whole-plan endpoint with a **per-line planner**. New request shape matches `plan_one_line` above. Returns `{kind, step?|steps?|reason}`. System prompt is rewritten to:
- Describe each tool's required inputs in terms of catalog handles.
- Explicitly say: "If the current line has an attached image (`current_line_attached`), assume it is the primary subject unless the line says otherwise."
- "Prefer `step:N` for the most recent matching prior output, then `line:N` / `linked:*` for explicit references in the instructions, then `gallery:N` for named gallery items."
- "If the line is a heading, separator, blank, or pure narration with no actionable verb, return `{kind:'no_action'}`."
- Hard cap: max 3 sub-steps if `kind:'compound'`.

Model: `google/gemini-2.5-flash` (cheap, fast — we call it once per line, not once per sequence). Use tool-calling for structured output (per the AI Gateway docs) instead of `response_format: json_object` to eliminate parse failures.

### `supabase/functions/process-action-queue/index.ts`

In `tickSequence`:
- Replace `phase: "planning"` block with `planning_init` that loads input lines + linked lists + gallery snapshot.
- New `phase: "planning_step"` between `dispatching` and the LLM call: builds the per-step catalog, calls `plan-action-sequence` with the per-line payload, stores the returned step(s) into `state.pending_steps`, transitions to `dispatching`.
- `dispatching` consumes `state.pending_steps[0]` (instead of `state.plan.steps[cursor]`), drops it on dispatch.
- When `pending_steps` empties AND a line is fully resolved, advance `cursor` and loop back to `planning_step` (or `completed` if `cursor >= input_lines.length`).
- Extend `resolveRef` to recognize all five handle prefixes (`step:`, `line:`, `linked:`, `gallery:`, `attached:`) before falling through to loose matching.
- Loose matching uses the *unified catalog* (not just `gallery_index`), preserving the existing scoring. Returns the matched `CatalogEntry` so the error message can be specific.
- On unresolved ref, build the "closest matches" list from the top-3 candidates (any type) and append the precise skip message.

Linked-checklist loader (new helper, ~30 lines):
```ts
async function loadLinkedLists(supabase, inputChecklistId, userId): Promise<LinkedList[]>
```
Selects items where `checklist_id = inputChecklistId AND linked_checklist_id IS NOT NULL`, fetches each linked list's items in one batched `IN` query, returns `[{ list_id, title, lines: [{text, media_url, media_type}] }]`.

### `supabase/functions/enqueue-action/index.ts`

No structural change. Bump `max_steps` cap from 30 → 50 (per-line execution makes long checklists feasible) and add a soft `max_lines` (default = number of input lines, hard cap 60) so the new per-line loop has a clear ceiling.

### `src/components/RunSequenceDialog.tsx`

Minimal UX additions:
- Tooltip on the "Step budget" slider clarifying it now means "max tool calls" (not "max checklist lines").
- New helper text under the dialog explaining: "The agent reads your checklist line by line. For best results, write one instruction per line and attach reference images directly to the line that uses them."
- No new fields required.

### `.lovable/plan.md`

Replace with this v2 design document so future iterations have an accurate spec.

### Database

No schema migration required — `sequence_state jsonb` already stores everything new (`input_lines`, `linked_lists`, `gallery`, `pending_steps`, `cursor`).

## Why this hits the user's requirements

- **"Insert images" + "use reference images"** — every line's own attached `media_url` is in the catalog as `line:current`; the model is explicitly told to treat it as the primary subject. Gallery and other-line images are resolvable by name or handle.
- **"Use outputs as inputs"** — `step:N` is in the catalog and grows after every completed child; the model sees a `prior_outputs_summary` so it knows what's available.
- **"Reference any media in the gallery"** — full gallery (200 most recent) is in the catalog with both stable handles and human names; loose matching covers typos.
- **"Follow linked checklists as instructions/context"** — linked-list text is inlined into `linked_context_text`; linked-list media is in the catalog under `linked:` handles. One hop, capped, deduped.
- **"Step by step, small steps"** — that's exactly the new execution model: one LLM decision per line, immediate feedback, cumulative state.
- **"Highest probability of success"** — eliminates the single-shot whole-plan failure mode, gives the model URLs/handles for every resolvable reference, and produces precise diagnostics (named candidates) when something can't be matched.

## Out of scope (intentional)

- Recursive linked-checklist traversal (>1 hop). Easy to add later by deepening the loader.
- Cross-step text outputs as references (e.g. "use the caption from step 3"). Today step text outputs are recorded but only image/video URLs flow into the catalog. Add later if requested.
- Streaming partial progress to the client beyond the existing dashboard.

## Implementation order

1. Rewrite `plan-action-sequence` to per-line + tool-calling output.
2. Add `loadLinkedLists` helper + catalog builder in the worker.
3. Replace planning/dispatching phases in `tickSequence` with the per-line state machine.
4. Extend `resolveRef` and loose matcher to the unified catalog; rewrite the skip message.
5. Bump `enqueue-action` caps; tweak `RunSequenceDialog` copy.
6. Update `.lovable/plan.md`.
7. Smoke-test with a 5-line checklist that mixes: a line with an attached image, a line that references a gallery image by name, a line that says "make a video from the previous image", and a line that links to another checklist.
