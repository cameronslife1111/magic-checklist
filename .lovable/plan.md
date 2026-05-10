## Bee Protocol — replace Dante Inbox watcher

Goal: replace the per-item conversational Dante watcher with a "Bee Protocol" walker that, every 30 minutes, walks all checklists linked from the `🤖 Dante Inbox` checklist, triages each unprocessed item with one LLM call, and either marks it ✅ (with appended completed work) or 🐝 (with 4 options).

### Schema-reality notes (to confirm before coding)

- There is no `linked_checklist_owner_id` — `checklist_items` has only `linked_checklist_id`. Ownership check will join `checklists.user_id`.
- There is no `dante_processing` boolean column. I'll add a nullable `dante_locked_at timestamptz` on `checklist_items` for the cycle lock instead of a boolean (auto-expires after 10 min).
- Existing `dante_daily_counters` table has only `(day, count, updated_at)` — no `user_id`. Spec says "per user." Two options (will ask): keep global daily cap, or add `user_id` and key by owner of the Dante Inbox.
- Current `dante-watcher/index.ts` calls RPCs `dante_try_lock`, `dante_unlock`, `dante_claim_items` that don't exist in the DB — the existing watcher is already non-functional. Safe to fully replace.
- Central Time day boundary: use `(now() AT TIME ZONE 'America/Chicago')::date`.
- Title prefix detection must handle existing `✅ ` / `🐝 ` / `⚠️ ` prefixes idempotently.

### Step 0 — Strip old Dante logic

- Replace contents of `supabase/functions/dante-watcher/index.ts` entirely (no other function references the old conversational flow).
- Drop the obsolete RPC stubs from any migration if present (none exist in DB, so nothing to drop).
- Leave `claude-bridge`, `claude-mcp`, `openai-text`, etc. untouched — they are shared services.
- No frontend changes. `ItemRow` already renders title text, so ✅ / 🐝 prefixes appear automatically.

### Step 1 — Migration

New migration adds:

1. `checklist_items.dante_locked_at timestamptz null` — per-item soft lock (cycle-scoped, auto-expires).
2. `checklist_items.dante_fail_count int not null default 0` — for the 3-strike ⚠️ rule.
3. New table `dante_action_log`:
   - `id uuid pk`, `user_id uuid`, `checklist_id uuid`, `item_id uuid`,
   - `decision text check in ('complete','bee','error')`,
   - `model_used text`, `tokens_used int`, `error text null`,
   - `processed_at timestamptz default now()`.
   - RLS: owner can select; service role inserts.
4. Alter `dante_daily_counters` to add `user_id uuid` (nullable for back-compat) and unique `(user_id, day)`.
5. Helper SQL function `dante_inbox_checklist_id(uid uuid) returns uuid` — finds the user's checklist titled exactly `🤖 Dante Inbox` (used to avoid hardcoding via env, but we keep `DANTE_INBOX_CHECKLIST_ID` env as fallback for the single-tenant case).
6. pg_cron schedule (via `supabase--insert`, not migration, since it embeds the anon key) to call `dante-watcher` every 30 minutes.

### Step 2 — New `dante-watcher` edge function

Single Deno function. On invocation:

1. **Auth**: accept service-role bearer or `x-dante-cron-secret` (preserve existing behavior).
2. **Resolve scope**: for each owner of a `🤖 Dante Inbox` checklist (initially just the configured one via `DANTE_INBOX_CHECKLIST_ID`, extensible later):
   - Read all items in that inbox where `linked_checklist_id is not null` → set of permitted checklist IDs.
   - Filter to checklists whose `user_id` matches the inbox owner (security boundary).
3. **Daily cap**: read `dante_daily_counters` for `(user_id, today_ct)`. If `count >= 100`, skip user.
4. **Walk permitted checklists**: for each, fetch all items ordered by position. Build a numbered context list (title + checked state) for the LLM.
5. **Classify items**:
   - DONE if `checked = true` OR title starts with `✅ ` OR `🐝 `.
   - SKIP if `dante_locked_at` is within last 10 min OR `dante_fail_count >= 3` (already ⚠️-prefixed).
   - READY otherwise.
6. **Per-item processing loop** (respecting remaining daily budget):
   - Atomic claim: `update checklist_items set dante_locked_at = now() where id = ? and (dante_locked_at is null or dante_locked_at < now() - interval '10 min') returning *`. Skip if no row updated.
   - Build prompt per spec (system + user message with full checklist context + the target item).
   - Call **OpenAI** via existing `OPENAI_API_KEY` using `gpt-5.5` (same model already used in this project) with `response_format: { type: "json_object" }`. The user wrote "Claude Sonnet 4.5 OR whatever AI gateway is configured" — this project uses OpenAI; will note in chat. JSON-strict per the spec's schema.
   - Validate JSON with Zod: `{decision, reasoning_for_cj, completed_work, bee_options[]}`.
   - On `decision = "complete"`: rewrite `text` to ``✅ <original>\n\n— Dante <MM/DD h:mma CT> —\n<completed_work>``. Leave `checked = false`. (Image generation tool is out of scope for v1; if `completed_work` contains a URL we just keep it as text — note in plan.)
   - On `decision = "bee"`: rewrite `text` to ``🐝 <original>\n\n— Dante <MM/DD h:mma CT> —\nI can help in 4 ways:\nA) ...\nB) ...\nC) ...\nD) ...``.
   - "Original" is computed by stripping any leading `✅ `, `🐝 `, `⚠️ ` prefix and any prior `\n\n— Dante ` block.
   - Insert `dante_action_log` row, increment `dante_daily_counters` (upsert), clear `dante_locked_at`, reset `dante_fail_count = 0`.
7. **Errors**:
   - On LLM failure / JSON-parse failure: increment `dante_fail_count`, clear lock, log row with `decision='error'`. If count reaches 3, prefix title with `⚠️ ` (idempotent).
   - On missing checklist (link to deleted): skip silently.
   - Owner mismatch: skip (defense-in-depth even though already filtered).
8. **Never modify items inside the Dante Inbox itself.** Permitted-set explicitly excludes the inbox id.

### Step 3 — Cron

Use `supabase--insert` to register a `pg_cron` job named `dante-bee-walker` running `*/30 * * * *` that POSTs to the deployed `dante-watcher` URL with header `x-dante-cron-secret: <DANTE_CRON_SECRET>`. Does not replace any existing schedule unless one exists with the same name.

### Files

- `supabase/functions/dante-watcher/index.ts` — full rewrite.
- `supabase/functions/dante-watcher/deno.json` — keep, ensure `zod` import.
- New migration: schema additions above.
- `supabase--insert` for pg_cron schedule.
- No frontend files change.

### Open questions before I implement

1. Daily cap — global (current schema) or per-Dante-Inbox-owner (add `user_id`)?
2. Model — OK to use `openai/gpt-5.5` via the existing `OPENAI_API_KEY` (since Claude isn't wired here), or do you want me to add an `ANTHROPIC_API_KEY` and use Claude Sonnet 4.5?
3. Image-generation tool inside Dante's "complete" action — defer to v2, or wire `lovable-image`/`fal` so Dante can attach a real `media_url`?
4. Title rewrites are destructive (we overwrite `text`). Confirm that's OK (spec says so) vs. storing Dante output in `result` and only prefix-flagging the title.
