## Goal

Replace the webhook-driven `dante-watcher` with a robust cron-driven polling system. Every 60s, the function pulls up to 3 unclaimed items from the Dante Inbox using `FOR UPDATE SKIP LOCKED`, processes them serially via OpenAI Responses + MCP, and self-heals stuck items.

## 1. Refactor `supabase/functions/dante-watcher/index.ts`

Full rewrite. Key components:

**Auth gate** — Accept either `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` OR `x-dante-cron-secret: <DANTE_CRON_SECRET>`. Otherwise 401.

**Concurrency guard** — At entry, acquire Postgres advisory lock `7273477347347234` via a tiny RPC. Since we can't run raw SQL through `supabase-js` directly, add a SECURITY DEFINER helper function `dante_try_lock()` / `dante_unlock()` (see migration). If lock not acquired → return `{ skipped: true, reason: 'lock_held' }`. Always release in `finally`.

**Stale recovery** — Select items where `checklist_id = DANTE_INBOX_CHECKLIST_ID AND status = 'in_progress' AND updated_at < now() - interval '10 minutes'`. Reset to `status = null`, append `"Auto-recovered from stuck in_progress on <ISO>."` to `result`.

**Atomic claim** — Add a SECURITY DEFINER function `dante_claim_items(p_checklist_id uuid, p_limit int)` running the user's exact CTE with `FOR UPDATE SKIP LOCKED`, returning the claimed rows. Call via `supabase.rpc('dante_claim_items', { p_checklist_id, p_limit: 3 })`.

**Per-item processing** (serial loop, each in its own try/catch):
- 4-minute `AbortController` timeout per item.
- POST to `https://api.openai.com/v1/responses` with `model: "gpt-5.5"`, `instructions: DANTE_SYSTEM_PROMPT`, MCP tool block (`server_url: MAGIC_CHECKLIST_MCP_URL`, `require_approval: "never"`), input = task text + context block.
- Reuse existing `extractFromOpenAI` helper for text + tool summary + error detection.
- Success → `status='done', checked=true, result=<text+toolSummary>`.
- Failure/timeout → `status='error', checked=false, result=<friendly error>`.

**Logging** — Emit the prefixed log lines from the spec.

**Return** — `{ processed, recovered, errors, item_ids }`.

Webhook payload handling is removed entirely; the function now ignores request body.

## 2. Migration — `supabase/migrations/<ts>_dante_cron.sql`

- Enable extensions: `CREATE EXTENSION IF NOT EXISTS pg_cron;` and `pg_net;`
- Create SECURITY DEFINER helpers (search_path = public):
  - `dante_try_lock()` returns boolean → `pg_try_advisory_lock(7273477347347234)`
  - `dante_unlock()` returns void → `pg_advisory_unlock(...)`
  - `dante_claim_items(p_checklist_id uuid, p_limit int)` returns `setof checklist_items` running the CTE.
- `REVOKE ALL ... FROM public; GRANT EXECUTE TO service_role;` on each helper.

Note: `ALTER DATABASE postgres SET ...` is forbidden in Lovable migrations. The cron job will instead embed the cron secret directly in the scheduled SQL.

## 3. Schedule cron — separate insert (NOT migration, contains secret)

Use the Supabase insert tool to run:

```sql
SELECT cron.schedule(
  'dante-poller',
  '* * * * *',
  $$ SELECT net.http_post(
    url := 'https://iedwmkdvwggpcmdyliii.supabase.co/functions/v1/dante-watcher',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-dante-cron-secret','<DANTE_CRON_SECRET value>'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 280000
  ); $$
);
```

This step runs only after you add the `DANTE_CRON_SECRET` secret (next section), so I can read it back and bake it into the schedule.

## 4. Secrets

I'll request **`DANTE_CRON_SECRET`** via the secrets tool. You generate a random 32-char string and paste it in. (`OPENAI_API_KEY`, `DANTE_INBOX_CHECKLIST_ID`, `DANTE_SYSTEM_PROMPT`, `MAGIC_CHECKLIST_MCP_URL` are already set.)

## 5. Manual steps for you

1. Paste the random 32-char string when prompted for `DANTE_CRON_SECRET`.
2. **Disable the old webhook** in Supabase Dashboard → Database → Webhooks → `dante-watcher-trigger` → Disable/Delete (otherwise items get double-claimed by webhook + cron).
3. Wait 60s, watch `dante-watcher` logs for `tick start` and the 3 inbox items flipping to `done`.

## Out of scope
- No client/UI changes.
- `supabase/config.toml` already has `dante-watcher` with `verify_jwt = false` — no change.
- No edits to `supabase/functions/claude-mcp` or other functions.
