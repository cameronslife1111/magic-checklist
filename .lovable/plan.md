# Auto-load inline checklist links into Run Sequence context

## Goal

When the Run Sequence agent starts, it should automatically read every checklist you've inserted via the "insert checklist link" button on the input checklist — including links nested one level inside those linked checklists. The Context Attacher in the Run dialog stays as an additive option.

## Changes

### 1. `supabase/functions/process-action-queue/index.ts`

Rewrite `loadLinkedLists()` (currently lines ~376–404) to do a bounded breadth-first traversal:

- Start from the input checklist.
- Follow `linked_checklist_id` references up to **2 hops deep**.
- Cap at **15 unique checklists** total, **100 items per list**.
- Skip the input checklist itself; dedupe by id (cycle-safe).
- Bulk-fetch titles + items in two queries after collecting ids (same pattern as today, just larger caps).
- Return the same shape, plus a new `depth` field per list (1 = directly linked, 2 = nested).

Then merge with any checklists the user attached via the Context Attacher (already passed through `payload.context.checklists` / `state.linked_lists` seed):

- Inline-linked lists take priority.
- Attached lists are appended, deduped by id.
- Final array still capped at 15.

### 2. `buildLinkedContextText()` (same file, ~line 493)

Annotate nested lists in the planner's text context so it knows depth:

```
### Steps from linked checklist "Brand Voice"
- ...

### Steps from linked checklist "Tone Examples" (nested inside "Brand Voice")
- ...
```

No other planner changes needed — handles `linked:<list>:<item>` and `linked_context_text` already flow through.

### 3. No schema, no UI changes

- `checklist_items.linked_checklist_id` already exists and is already populated by the "insert checklist link" button.
- Run Sequence dialog stays exactly as is — Context Attacher remains for ad-hoc additions.

## Behavior after the change

| Scenario | Result |
|---|---|
| Drop a checklist link onto your sequence checklist | Auto-read every run, no attaching needed |
| Linked checklist itself contains another checklist link | Also auto-read (1 nested hop) |
| Attach a checklist via the Run dialog | Still works, additive |
| Same checklist linked AND attached | Loaded once (dedupe) |
| 20 checklists linked transitively | First 15 loaded (bounded for planner speed) |

## Verification

After deploy:
1. Pull a recent `action-sequence` job and inspect `sequence_state.linked_lists` to confirm inline links and nested links appear.
2. Trigger one run on a checklist with at least one inline link and confirm the planner's per-step decisions reference `linked:0:N` handles.

## Files touched

- `supabase/functions/process-action-queue/index.ts` — only file changed.
