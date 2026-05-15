## Goal

Phase 1 only: bring Run Sequence's planner/executor up to full **Magic Checklist app-CRUD parity** with Dante. Same OpenAI key, Dante-style system prompt + routing, hardcoded 17-name roster, default fallback to `📨 Cameron Inbox`. No Google/Apple/Places/Sports/Charts/Recipes/CodeExec in this pass.

## What Run Sequence has today

- Per-line planner picks ONE tool per line: `text-text`, `web-search`, `text-image`, `image-image`, `remix`, `image-video`, `video-video`, `audio-image-video`, `analyze-image`.
- Output is appended as a new checkbox at the bottom of one chosen output checklist.
- No app-management tools (cannot rename, cannot update an existing item, cannot route to a different checklist mid-sequence, cannot search checklists, cannot create new ones).

## What's missing (vs Dante's `claude-mcp`)

| Tool | Status |
| --- | --- |
| `fetchChecklist` (ilike) | missing in planner |
| `fetchItems` | missing |
| `addItem` | partially (executor always appends to fixed output list) |
| `createItemAndTriggerJob` | missing |
| `updateItem` | missing |
| `updateChecklistTitle` | missing |
| `updateMediaTitle` | missing |
| `fetchMedia` | missing |
| `createChecklist` (gated) | missing |
| `describeAction` | missing (planner has no schema lookup) |
| `triggerJob` / `pollJob` / `getRecentJobs` | not exposed to planner |

## Changes

### 1. `supabase/functions/plan-action-sequence/index.ts`
- Expand `ALL_ACTIONS` to two groups:
  - **Generation** (existing 9).
  - **Management**: `addItem`, `updateItem`, `updateChecklistTitle`, `updateMediaTitle`, `fetchChecklist`, `fetchItems`, `fetchMedia`, `createChecklist`, `createItemAndTriggerJob`.
- Update the `decide` JSON schema so a `tool_call` step can be either a generation step (current shape with `prompt`/`input_refs`/`aspect_ratio`) OR a management step (`{ tool, args }`). One tool per line still enforced.
- Replace SYSTEM prompt with a Dante-flavored one (Auto-Execute v5 spirit, condensed):
  - Identity: "You are Dante's executor for Magic Checklist."
  - **Routing rules** (hardcoded):
    - Roster names → ilike checklist title containing that name. Embedded list: Jackson, Twan, Ava, Zamir, Andre, Layla, Brandy, James, Stella, Samantha, Mason, Destiny, Fay, Lewis, David, Marcus, Dante.
    - Roles → roster mapping baked into prompt (Jackson=content, Twan=music, Ava=Multiverse, Zamir=app code, Andre=app hygiene, Layla=automation, Brandy=forms, James=personal routines, Stella=house, Samantha=travel, Mason=phone, Destiny=communications, Fay=family/friends, Lewis=finance, David=research, Marcus=sponsorship, Dante=appointments/deadlines).
    - When destination is unspecified → `fetchChecklist` with `name: "%Cameron Inbox%"` then `addItem` there.
    - "Send to Dispatch" lane for outbound messages CJ routes manually.
  - **Execution standards**: never invent checklist titles, never create new lists unless line explicitly says "create checklist", preserve task details verbatim, appointment lines get the 4-sentence + A/B/C/D format, deadline cadence (7d/3d/1d/day-of), commute math (15-min default / 25-min high-stakes) — these are emitted as text into the target item.
- Pass-through: planner still outputs ONE decision per line.

### 2. `supabase/functions/process-action-queue/index.ts`
- In the action-sequence executor (around line 687-700) branch on the planner's decision shape:
  - Generation step → existing path (unchanged).
  - Management step → execute directly via service-role admin client, mirroring the handlers in `claude-mcp/index.ts`. Always force `user_id` to the sequence's owner (never trust planner output for that).
- Capture each management call's result into the `step:N` handle catalog so subsequent lines can reference it (e.g. a `fetchChecklist` result becomes available as `step:3.checklist_id` for a later `addItem`).
- Continue to honor `max_steps`, `max_images`, `max_videos`, `max_runtime_minutes`, and the dialog's `allowed_actions`.

### 3. `src/components/RunSequenceDialog.tsx`
- Add a second checkbox group "Allowed app actions" containing the 9 management tools, all checked by default.
- Merge both groups into `allowed_actions` on submit.
- No other UI changes (output checklist picker, sliders, aspect ratio, context attacher all stay).

### 4. Out of scope this pass (explicitly)
- Google Calendar / Gmail / Drive connector wiring.
- Apple Native iOS, Places, Maps, Sports, Image search, Charts, Recipes, file creation, code execution.
- Switching the planner to Anthropic.
- New roster table / admin UI (hardcoded in prompt instead).

## Acceptance test

A 6-line checklist:
```text
Find the Cameron Inbox
Add a note "Test from Run Sequence" to it
Rename that checklist to "📨 Cameron Inbox"
Generate a 16:9 sunset image and add it to Jackson's content list
Web-search "best espresso machines 2026"
Add the top 3 results to David's research list
```
…should plan and execute correctly, with each line producing one tool call, ilike-matching the right checklist, and never creating a new list.

## Changelog format

After implementation I'll list, per tool, **ADDED** vs **already present**, and call out any secret/connector setup needed (none expected for this phase).
