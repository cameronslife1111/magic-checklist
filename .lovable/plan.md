## Goal

Replace the chat-based 🤖 Dante Inbox pipeline with a storyboard generator that, every 10 minutes, finds unprocessed inbox items, parses idea/brand/series, gathers brand+series+helper+Mia context checklists, composes a 3x3 grid prompt via GPT-5, generates a 9:16 image via the existing `lovable-image` Fal pipeline, and attaches it to the item. Cap 20/day Central Time. Log prompts to a hidden audit checklist.

## 1. Remove old Dante chat pipeline

- Delete edge function `supabase/functions/dante-watcher/` (replaced by new function below). Call `supabase--delete_edge_functions` for `dante-watcher` after the new one is in place — or reuse the slot by overwriting `index.ts` (simpler, keeps the existing cron and `DANTE_CRON_SECRET` wiring). **Plan: overwrite `dante-watcher/index.ts` rather than deleting**, so any existing pg_cron schedule keeps firing.
- Migration to drop the chat-only DB surface that targets only this checklist:
  - `DROP TRIGGER IF EXISTS ... ON public.checklist_items` for the 👑→`awaiting_dante` trigger (find by `\d+ checklist_items`; tied to `detect_dante_new_turn`).
  - `DROP FUNCTION IF EXISTS public.detect_dante_new_turn();`
  - `DROP FUNCTION IF EXISTS public.dante_claim_items(uuid,int);`
  - `DROP FUNCTION IF EXISTS public.dante_try_lock();`
  - `DROP FUNCTION IF EXISTS public.dante_unlock();`
  - Leave `validate_checklist_item_status` alone (still useful, generic).
- Keep secrets `DANTE_INBOX_CHECKLIST_ID` and `DANTE_CRON_SECRET`. Drop reliance on `DANTE_SYSTEM_PROMPT`, `MAGIC_CHECKLIST_MCP_URL`, `CLAUDE_BRIDGE_KEY` for this function (don't delete the secrets — other functions like `claude-bridge` / `claude-mcp` may still use them).

## 2. New schema (one small migration)

Add a daily counter table so the 20/day cap is durable across function cold starts:

```sql
create table public.dante_daily_counters (
  day date primary key,           -- Central Time calendar day
  count integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.dante_daily_counters enable row level security;
-- no user policies; only service role writes
```

Add a per-item failure counter so we can stop after 3 bad cycles. Reuse `checklist_items.status` for the terminal `error` state (already allowed by `validate_checklist_item_status`) and `checklist_items.result` for a small JSON-ish counter string like `"dante_fail_count=2"`. No new columns needed.

## 3. New edge function: `dante-watcher` (overwrite)

File: `supabase/functions/dante-watcher/index.ts`. Same auth (`x-dante-cron-secret` or service-role bearer). Same lock pattern, but drop the old RPC — use a small `pg_try_advisory_lock` via a new tiny RPC, or just process serially without a lock (cron runs every 10 min, batch <=5, we accept rare overlap). **Plan: no lock; cap concurrency by limiting batch to 5 items and being idempotent (skip if `media_url` already set).**

Per-tick flow:

```text
1. Auth check.
2. Compute today_ct = now() in America/Chicago as YYYY-MM-DD.
3. SELECT count FROM dante_daily_counters WHERE day = today_ct. If >=20, exit { skipped: "cap_reached" }.
4. Fetch up to 5 unprocessed items:
   SELECT id, user_id, text, result FROM checklist_items
   WHERE checklist_id = DANTE_INBOX_CHECKLIST_ID
     AND (media_url IS NULL OR media_url = '')
     AND coalesce(status,'') <> 'error'
   ORDER BY created_at ASC LIMIT 5;
5. For each item, available = 20 - count_today. If 0, break.
6. Process item (see §4). On success: count++, persist counter row (upsert).
   On skip-no-context: leave untouched.
   On error: bump dante_fail_count in result; if hits 3, set status='error'.
7. Return summary.
```

## 4. Per-item processing

```text
a. Parse title:
   - Strict: split on " — " / " -- " / " - " into [idea, brand, series]; trim; require all 3 non-empty.
   - Fallback: Lovable AI (google/gemini-3-flash-preview) with Output.object schema
     { idea: string, brand: string|"missing", series: string|"missing" }.
   - If brand or series == "missing" → skip silently (no DB write).

b. Fuzzy-match brand checklist titled like "Ava - Context - Brand Info - <brand>":
   - Fetch all checklists for the item's user_id whose title ILIKE 'Ava - Context - Brand Info - %'.
   - Score each candidate: lowercased Levenshtein-ish (use a tiny inline scorer or
     simple substring + token-overlap). Pick best if score above threshold (e.g.
     >= 0.6 token overlap with brand). If none → skip silently.
   - Same for series with prefix 'Ava - Context - Series Info - '.

c. Pull items text for: matched brand checklist, matched series checklist,
   checklist 97ee9cca-47f9-4267-b040-0acc5f334f93 (Jackson Brain),
   checklist 5272bbaa-50ce-4622-b96a-c4d9a2721c8c (Mia 3x3).
   Order by position; concat each list as bullet text.

d. Compose prompt via Lovable AI Gateway, model openai/gpt-5:
   system =
     "MIA 3x3 GRID RULES:\n<mia items>\n\n
      JACKSON BRAIN PROMPT RULES:\n<jackson items>\n\n
      BRAND CONTEXT (<brand>):\n<brand items>\n\n
      SERIES CONTEXT (<series>):\n<series items>"
   user =
     "<original item title>\n\nWrite the final 3x3 grid image prompt now.
      Output ONLY the image prompt as plain text. No preamble, no markdown,
      no explanations."
   Use generateText (not stream) via `@ai-sdk/openai-compatible` provider helper
   from the ai-gateway knowledge entry.

e. Generate image: POST to lovable-image function with:
     { prompt, aspectRatio: "9:16" }   // legacy sync mode
   `lovable-image/index.ts` currently hardcodes quality:"high". **Add a
   `quality` field to the request body** so we can pass "medium". Default
   stays "high" for any other caller.
   The function returns { dataUrl }.

f. Persist asset:
   - Upload dataUrl bytes to Supabase Storage bucket `generated-media` at
     `${user_id}/dante-inbox/${item_id}.png`.
   - Get public URL.
   - INSERT into media_assets (user_id, title=<original item title>,
     kind='image', url, storage_path, mime_type='image/png').
   - UPDATE checklist_items SET media_url=<url>, media_type='image',
     updated_at=now(), result=null WHERE id=item_id.

g. Increment counter:
   INSERT INTO dante_daily_counters(day, count) VALUES(today_ct, 1)
   ON CONFLICT (day) DO UPDATE SET count = dante_daily_counters.count + 1,
                                   updated_at = now();

h. Audit log:
   - Find (or create) sibling checklist for this user_id with title
     '🤖 Dante Inbox — Prompt Logs'.
   - Insert checklist_items row (user_id, checklist_id=<log>, text=<original
     title>, result=<full prompt + ISO timestamp + brand + series matched>,
     position=now-epoch, checked=false).
```

Errors anywhere in d/e/f → catch, bump fail counter:
```text
result_str = parse "dante_fail_count=N" from current result; default 0.
new = N+1; if new>=3: status='error'; else status=null. Save result string.
```
Never modify `text`.

## 5. Schedule

A pg_cron job almost certainly already invokes the existing dante-watcher every minute. **Plan: leave the existing cron intact** — the new function is fast (<5 items, capped) so a 1-min tick is fine and naturally rate-limits via the 20/day counter. If no cron exists, add one calling the function every 10 minutes via `net.http_post` with the `x-dante-cron-secret` header. Verify with a `read_query` against `cron.job` before changing anything.

## 6. Files to change

- `supabase/functions/dante-watcher/index.ts` — full rewrite per §3–4.
- `supabase/functions/lovable-image/index.ts` — accept optional `quality` ("high"|"medium"|"low") in submit body, default "high". 1-line change in `buildSubmitBody`.
- New migration:
  - drop the 👑 trigger + `detect_dante_new_turn` + `dante_claim_items` + `dante_try_lock` + `dante_unlock`.
  - create `dante_daily_counters`.
- No frontend changes.

## 7. Out of scope

- No changes to other checklists, MCP endpoints, action queue, ItemRow rendering, or media gallery UI.
- No changes to other edge functions.
- No new secrets (LOVABLE_API_KEY + FAL_KEY already present).

## 8. Verification after deploy

1. `supabase--curl_edge_functions` POST to `/dante-watcher` with `x-dante-cron-secret`. Expect `{ processed, skipped, ... }`.
2. Manually insert one inbox item: `Joe sees a giant pizza float by — The Hendersons — Visually Stimulating Memes`. Trigger function. Confirm `media_url` populated and a row appears in the prompt-log checklist.
3. Insert an item with no brand/series. Trigger. Confirm item is untouched, no log entry, counter not incremented.
4. Set `dante_daily_counters.count = 20` for today. Trigger. Confirm short-circuit.