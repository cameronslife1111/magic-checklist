# Action Queue Dashboard

A true background job system for all 8 AI actions (text-to-text, text-to-image, image-to-image, remix, image-to-video, video-to-video, analyze-image, web search). Every AI action gets queued, runs server-side via a cron worker, and results land back in the originating checklist exactly where they would have appeared if run inline. The dashboard manages the queue, schedules, recurrence, pause, retry, and AI-explained errors.

---

## 1. Database (migration)

### `action_jobs` table
- `id uuid pk`
- `user_id uuid` (RLS: own rows)
- `checklist_id uuid`, `source_item_id uuid` — where the result inserts back
- `action_type text` — one of the 8 actions
- `status text` — `pending` | `scheduled` | `running` | `completed` | `failed` | `paused` | `cancelled`
- `payload jsonb` — prompt, aspect ratio, quality, base64-uploaded source URLs (NOT raw files; uploaded to `generated-media` first), etc.
- `result jsonb` — output URLs/text once done (kept for "save & re-run")
- `error_raw text`, `error_friendly text`, `error_fix text` — AI-translated error
- `scheduled_for timestamptz` — null = run now
- `recurrence text` — null | `hourly` | `daily` | `weekly` | `monthly` | `yearly`
- `parent_job_id uuid` — links recurring children to template
- `attempts int default 0`, `max_attempts int default 3`
- `started_at`, `completed_at`, `created_at`, `updated_at`

**RLS:** owner-only select/insert/update/delete (mirrors existing `checklists` policies).

### `action_jobs_realtime`
Add table to `supabase_realtime` publication so the dashboard updates live.

### `pg_cron` + `pg_net`
Enable extensions; schedule `process-action-queue` edge function every minute.

---

## 2. Edge functions

### `enqueue-action` (new, `verify_jwt = true`)
Single endpoint the client calls instead of invoking AI functions directly. Validates input with Zod, uploads any file payloads to `generated-media`, then inserts a row into `action_jobs`. Returns the job id.

### `process-action-queue` (new, `verify_jwt = false` — called by cron)
- Selects up to N rows where `status='pending'` AND (`scheduled_for IS NULL` OR `scheduled_for <= now()`), order by `created_at`.
- Uses Postgres `FOR UPDATE SKIP LOCKED` style claim (sets `status='running'`, `started_at=now()`) so concurrent ticks don't double-process.
- Dispatches to internal handlers that contain the same logic currently in `openai-text`, `openai-vision`, `lovable-image`, `fal-video`, `perplexity-search`. (We refactor those handlers into shared functions or have the worker call them with service-role JWT.)
- On success: writes `result`, inserts the resulting checklist item via the service role (matching existing `insertItemAfter` shape), sets `status='completed'`.
- On failure: increments `attempts`. If under `max_attempts`, leaves as `pending` with backoff via `scheduled_for`. If exhausted, sets `status='failed'`, then calls `explain-error` inline and stores the friendly explanation.
- Recurring jobs: when a recurring job completes, insert a new `pending` child for the next interval (`scheduled_for = now() + interval`).

### `explain-error` (new, `verify_jwt = false`, called server-side)
Takes raw error + action_type + payload summary, calls Lovable AI (`google/gemini-2.5-flash`) with a strict system prompt: "Return JSON `{cause, fix}` in plain English, no jargon, no error codes." Stores into `error_friendly` and `error_fix`.

### Existing AI functions
Stay deployed (used by the worker). Client no longer calls them directly.

---

## 3. Client-side changes

### `src/components/ScheduleActionDialog.tsx` (new)
Popup shown EVERY time one of the 8 AI actions is triggered. Three options:
1. **Run now** — enqueues with `scheduled_for=null`.
2. **Schedule for later** — date/time picker → `scheduled_for=<future>`.
3. **Recurring** — interval select (hourly/daily/weekly/monthly/yearly) + optional start time.

Confirms with a single button; toast says "Queued — view in Action Queue Dashboard."

### `src/pages/Checklist.tsx` (refactor)
- Replace direct `supabase.functions.invoke("openai-text" | …)` calls in `runTextToText`, `runWebSearch`, and `runMediaAction` with: open `ScheduleActionDialog`, then on confirm call `enqueue-action` with the assembled payload (files uploaded to `generated-media` first).
- Remove inline toast loaders; the dashboard owns status now.

### `src/pages/ActionQueue.tsx` (new route `/queue`)
Three tabs: **In Queue** (pending+running+scheduled), **Completed**, **Failed**. Each row shows:
- Action type icon + checklist title + truncated prompt
- Status badge (color-coded; failed = red)
- Scheduled time / recurrence chip
- Buttons: Pause/Resume, Cancel, Re-run, Save as recurring, Open source checklist
- Failed rows expand to show `error_friendly` (plain-English cause) + `error_fix` (suggestion) + collapsed raw error

Live updates via Supabase realtime subscription on `action_jobs`.

### `ActionsSheet.tsx`
Add new entry **"Action Queue Dashboard"** (icon: `ListChecks`). Picking it navigates to `/queue`.

### `App.tsx`
Register `/queue` under `RequireAuth`.

---

## 4. Behavior guarantees

- **Background:** worker runs every minute on the server via `pg_cron` → `pg_net` → `process-action-queue`. App can be closed; jobs still run.
- **Result placement:** worker inserts the new checklist item exactly after `source_item_id` using the same position math as `insertItemAfter`. Results never appear in the dashboard — only in the originating checklist.
- **Pause:** sets `status='paused'`; worker skips. Resume sets back to `pending`.
- **Save & re-run:** "Save as recurring" turns a completed one-off into a recurring template.
- **AI errors:** every failure auto-triggers `explain-error`; row turns red with friendly cause + fix.
- **Security:** RLS on `action_jobs`; worker uses service role only inside the edge function; payloads validated with Zod.

---

## Files

**New**
- `supabase/migrations/<ts>_action_jobs.sql`
- `supabase/functions/enqueue-action/index.ts`
- `supabase/functions/process-action-queue/index.ts`
- `supabase/functions/explain-error/index.ts`
- `src/components/ScheduleActionDialog.tsx`
- `src/pages/ActionQueue.tsx`

**Edited**
- `src/pages/Checklist.tsx` — route AI actions through enqueue
- `src/components/ActionsSheet.tsx` — add dashboard entry
- `src/App.tsx` — add `/queue` route
- `supabase/config.toml` — register new functions

Approve and I'll build it end-to-end.