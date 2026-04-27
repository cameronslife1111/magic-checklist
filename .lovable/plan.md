
# Plan: Multi-step "Action Sequence" Agent

## First-principles framing

Today every blue button in `ActionsSheet` enqueues exactly **one** `action_jobs` row that the worker (`process-action-queue`) executes against one of nine concrete tools (`text-text`, `text-image`, `image-image`, `remix`, `image-video`, `video-video`, `audio-image-video`, `analyze-image`, `web-search`). Outputs are written back to a checklist as new items, and (for image/video) registered in `media_assets`.

A "multi-step agent" therefore decomposes into three layered problems:

1. **Planning** — turn the input checklist's lines into an ordered list of tool calls, where each call has a real `action_type`, prompt, and resolved inputs (text + media URLs).
2. **Execution** — run those calls *using the existing job pipeline* (don't reinvent it) so we automatically inherit cancellation, error reporting, the dashboard, media-gallery registration, and the explain-error layer.
3. **Safety** — hard budgets (max steps, max images/videos, max wall-time, max retries) so a malformed checklist can never burn API credits forever.

The cleanest way to express this is **a new `action_sequence` job type** that the worker recognizes and that **spawns child jobs of the existing nine types**, then watches them. No changes to any of the nine tool implementations. No second worker. One queue, one dashboard.

---

## User-facing flow

1. On a checklist, tap **Actions → "Run as Action Sequence"** (new blue button at the top of the AI block, with `Workflow` icon).
2. A new `RunSequenceDialog` opens with:
   - **Output checklist** picker (reuses `ChecklistPickerDialog`). Default = current checklist; explicit "Append to current checklist" shortcut. Outputs always go to the bottom.
   - **Step budget** slider (default 12, max 30) — hard ceiling on tool calls.
   - **Per-step image budget** (default 2, max 5).
   - **Allowed tools** — checkboxes for the 9 actions (all on by default). A user can, e.g., disable `image-video` to keep cost down.
   - The same `ContextAttacher` UI (so they can attach extra checklists / gallery media the plan can reference loosely by name).
   - "Include this checklist as instructions" is implicit (it's the source of truth, no toggle needed).
3. Tap **Run**. We enqueue **one** `action_sequence` job. Toast: "Sequence queued — see Action Queue".
4. The Action Queue dashboard shows a parent "Action sequence" row with live status. As children complete, they appear under it (visually grouped). All errors surface there with the same `error_friendly` / `error_fix` translation we already have.
5. Outputs land in the chosen output checklist, in execution order. If the sequence aborts (budget, validation, repeated failure), a final checklist line is appended: `⚠️ Sequence stopped: <plain-English reason>`.

---

## Data model changes (schema migration)

Single migration on `action_jobs`:

- Already has `parent_job_id uuid`. Good — we use that for child→parent linkage.
- Add `sequence_step int` (nullable) — child position within parent for ordered display.
- Add `sequence_state jsonb default '{}'` (nullable) on the parent — stores the planned step list, current cursor, the budget caps, and the running tally (`steps_used`, `images_used`, `videos_used`, `failures`). This is the agent's working memory and is checkpointed every tick so a function restart resumes cleanly.
- Index: `create index if not exists action_jobs_parent_idx on action_jobs(parent_job_id);` (used for "list children of sequence" queries).
- Allow new `action_type` value: `"action-sequence"`. (No DB constraint exists today, but we'll update `VALID_ACTIONS` in `enqueue-action`.)

All RLS policies already work because they key on `user_id`, which we copy from the parent.

---

## New edge function: `plan-action-sequence`

Pure planner. Takes the input checklist text + attached context + allowed tools + budgets, and returns a structured JSON plan via the Lovable AI gateway (`google/gemini-2.5-pro` for quality; we already use this gateway in `explain-error`).

- **Input**: `{ instructions: string[]; context: ResolvedContext; allowed_actions: string[]; max_steps: number; max_images_per_step: number; gallery_index: { name: string; url: string; type: "image"|"video"|"audio" }[] }`
- **Output (strict JSON, validated)**:
  ```ts
  type Plan = {
    steps: PlanStep[];
    rationale: string;          // 1–2 sentence summary surfaced in UI
  }
  type PlanStep = {
    action_type: "text-text"|"text-image"|"image-image"|"remix"|"image-video"
                |"video-video"|"audio-image-video"|"analyze-image"|"web-search";
    prompt: string;
    // refs the planner wants — strings, not URLs. Resolved at exec time.
    input_refs?: {
      // either a previous step's output, e.g. "step:3"
      // or a loose match against the gallery_index by name (case/space-insensitive substring)
      images?: string[]; videos?: string[]; audios?: string[];
    };
    aspect_ratio?: "1:1"|"16:9"|"9:16"|"4:3"|"3:4";
    quality?: "auto"|"standard"|"hd";
    count?: number;             // capped to max_images_per_step
    note?: string;              // human-readable label shown in dashboard
  }
  ```
- The model gets a system prompt that **lists the nine tools, their inputs/outputs, and the budgets**, plus an explicit instruction: "If a referenced media name doesn't appear in `gallery_index`, do NOT invent a URL — use the closest substring match or skip that reference. Never produce more than `max_steps` steps." We also reject the plan server-side if it violates any cap.
- This function does **no side effects** — it only returns the validated plan. Cheap, idempotent, easy to retry.

---

## Worker changes: `process-action-queue/index.ts`

Add a new branch for `job.action_type === "action-sequence"`. The branch is a small **state machine**, not a long-running function (we never block — we just do one tick of work per worker invocation, exactly like the existing Fal handoff/poll pattern):

States stored in `sequence_state`:

| state | meaning | next |
|---|---|---|
| `planning` | initial, no plan yet | call `plan-action-sequence`, store `plan` + `cursor=0`, `steps_used=0`, set `dispatching` |
| `dispatching` | enqueue child for `plan.steps[cursor]` | insert child `action_jobs` row with `parent_job_id=job.id`, `sequence_step=cursor`; set `awaiting_child` with `current_child_id` |
| `awaiting_child` | a child is running | check child status; if `completed` → record output (text + media_url) into `sequence_state.outputs[cursor]`, `cursor++`, increment counters, decide next state; if `failed` → `failures++`, optionally abort or skip; if `cancelled`/`paused` → mirror to parent |
| `completed` | done | terminal — append a "Sequence finished — N steps" item to output checklist |
| `aborted` | budget/error tripped | terminal — append the `⚠️ Sequence stopped: …` line |

Key implementation details:

- **No blocking sleeps.** Each tick advances by at most one transition. The existing pg_cron + the `enqueue-action` "kick" already drive ticks every minute / immediately on insert. We additionally call the worker once per child completion: when a child job finishes (success or failure), if it has a `parent_job_id` we POST to `process-action-queue` with `{ trigger: "sequence-tick", id: parent_id }`. This makes sequences feel real-time without polling.
- **Budgets enforced server-side at every tick** (defense in depth — even if the planner cheats):
  - `steps_used >= max_steps` → abort.
  - `images_used >= max_images` (default 12) / `videos_used >= max_videos` (default 4) → abort.
  - Wall clock from `created_at` exceeds `max_runtime_minutes` (default 30) → abort.
  - `failures >= max_failures` (default 2) → abort. (No silent infinite retry — the existing per-job `max_attempts` already handles transient failures inside one step.)
- **Reference resolution** at dispatch time:
  - `step:N` → look up `sequence_state.outputs[N].media_url` or `.text`.
  - Loose name → substring match against `gallery_index` (built once at `planning` time from the user's `media_assets` for stability).
  - If a required ref can't be resolved, mark **that step** as failed with an explicit error (`"Could not find image named 'X' in your media gallery"`) and proceed to the next step. Don't abort the whole sequence — let the user see the gap on the output checklist.
- **Output writing** uses the existing `insertResultItem` helper but pinned to the chosen output checklist (`payload.output_checklist_id`) and always appended at the bottom (no `source_item_id`).
- **Cancellation**: the existing dashboard "Cancel" button already updates `status='cancelled'`. We extend the sequence tick to: when parent transitions to `cancelled`, also cancel the in-flight child.

---

## Frontend changes

### `src/components/ActionsSheet.tsx`
- New `ActionKey` `"run-sequence"` and a new entry at the top of the AI block (still in blue, `Workflow` icon from `lucide-react`).
- Label: "Run as Action Sequence".

### `src/components/RunSequenceDialog.tsx` (new)
- Reuses `ChecklistPickerDialog` (output picker), `ContextAttacher` (extra context + current-checklist toggle stays useful for *additional* references), and standard `Slider`/`Switch`/`Checkbox` primitives for budgets and tool toggles.
- On submit, calls `supabase.functions.invoke("enqueue-action", { body })` with:
  ```ts
  {
    action_type: "action-sequence",
    checklist_id: <input checklist id>,
    payload: {
      output_checklist_id, max_steps, max_images, max_videos,
      max_runtime_minutes, allowed_actions,
      context: pendingContext, // existing AttachedContext shape
    }
  }
  ```

### `src/pages/Checklist.tsx`
- Wire `"run-sequence"` in the `onPick` handler to open `RunSequenceDialog`, defaulting output checklist to the current one.

### `src/pages/ActionQueue.tsx`
- Add `"action-sequence": "Action sequence"` to `ACTION_LABELS`.
- Group child jobs under their parent visually: when fetching, build a `Map<parent_id, Job[]>`; render parent `JobRow` with an indented list of children (collapsed by default, "Show 4 steps" toggle). Children already work with the existing `JobRow` — no per-child UI to invent.
- Status badge for the parent reflects sequence_state lifecycle (`planning` / `running` / `completed` / `aborted`).

### `src/components/ContextAttacher.tsx`
- No changes.

### `supabase/functions/enqueue-action/index.ts`
- Add `"action-sequence"` to `VALID_ACTIONS`.
- Validate `payload.output_checklist_id` is a UUID owned by the user (same ownership check we already do for context checklists).
- Validate budget caps stay within hard maxima (`max_steps ≤ 30`, `max_images ≤ 30`, `max_videos ≤ 8`, `max_runtime_minutes ≤ 60`).
- Keep the existing 200KB payload guard.

---

## Why this design satisfies every requirement you stated

- **"Use the text on this checklist as instructions"** → The input checklist's lines become the planner's instructions verbatim.
- **"Loose pattern matching on names"** → `gallery_index` substring matcher at dispatch time, plus the planner is told to use closest-match.
- **"It should be able to do all the blue button things"** → Children are real jobs of the nine existing types; zero changes to the tools.
- **"Use outputs as inputs"** → `step:N` refs in the plan; resolved from `sequence_state.outputs[]` at dispatch.
- **"User picks an output checklist (can be the same one)"** → `output_checklist_id` in payload; outputs always appended at bottom.
- **"Outputs go to the queue the same way"** → Children are normal `action_jobs` rows; the dashboard already handles them.
- **"Never burn tokens in a loop"** → Hard step/image/video/runtime/failure caps enforced server-side every tick; `max_attempts` per child unchanged; no recursion.
- **"If something prevents completion, say exactly what and where"** → Per-step failures use the existing `explain-error` pipeline. Sequence abort writes a single `⚠️ Sequence stopped: <reason>` line to the output checklist and is also visible on the parent row in the dashboard.

---

## Out of scope (intentionally)

- No streaming chat UI for the agent — the dashboard + output checklist are the surface.
- No tool calling beyond the nine existing actions.
- No conditional branching inside a sequence (the planner produces a linear list). If you want branching/loops later, it slots in cleanly because the worker is already a state machine.
- No changes to the nine tool functions or to `media_assets` registration.

After approval I'll implement (1) the migration, (2) `plan-action-sequence` edge function, (3) worker branch + child-completion kick, (4) `enqueue-action` validation, (5) `RunSequenceDialog` + `ActionsSheet` button + `Checklist.tsx` wiring, and (6) parent/child grouping in `ActionQueue.tsx`.
