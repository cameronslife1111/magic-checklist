# Dante Watcher: Async AI Agent for Magic Checklist

Three coordinated changes that wire OpenAI GPT-5.5 into the app as an autonomous agent triggered by adding items to a "Dante Inbox" checklist.

## 1. Schema changes (`checklist_items`)

Migration adds two columns:

- `status text` — nullable, no default. Allowed values (enforced by validation trigger, not CHECK, so we can evolve): `pending`, `in_progress`, `done`, `error`. NULL = ordinary checklist item, ignored by the agent.
- `result text` — nullable. Free-form agent output / error explanation.

Update `src/lib/types.ts` `ChecklistItem` to include `status: string | null` and `result: string | null` (the generated `types.ts` will refresh automatically).

## 2. `updateItem` MCP tool — add two optional fields

In `supabase/functions/claude-mcp/index.ts`, extend the existing `updateItem` tool:

- Add `status` (string) and `result` (string) to `inputSchema.properties`.
- In the handler, mirror the existing partial-update pattern: only patch when the caller passes a string. Empty string for `result` clears it (set to `null`); for `status`, empty string is rejected with an error to avoid accidental clears.
- Validate `status` is one of `pending | in_progress | done | error` if present.
- Everything else (ownership scoping, `updated_at`, return shape) unchanged.

No other tools change.

## 3. New edge function: `dante-watcher`

Path: `supabase/functions/dante-watcher/index.ts`. Add `[functions.dante-watcher] verify_jwt = false` to `supabase/config.toml` (DB webhooks don't send JWTs; we trust because it's an internal endpoint and we gate by checklist id + service role).

### Request shape

Receives the standard Supabase DB webhook payload:
```json
{ "type": "INSERT", "table": "checklist_items", "record": { ...row... }, "schema": "public" }
```

### Flow

1. Parse `record`. Read env `DANTE_INBOX_CHECKLIST_ID`. If `record.checklist_id !== DANTE_INBOX_CHECKLIST_ID`, return 200 silently.
2. Service-role client. Set `status = 'in_progress'` on the row immediately (also sets `updated_at`). If row is already non-null status (e.g., re-delivery), short-circuit.
3. Build the OpenAI Responses API call:
   - `POST https://api.openai.com/v1/responses`
   - `Authorization: Bearer ${OPENAI_API_KEY}`
   - Body:
     ```json
     {
       "model": "gpt-5.5",
       "instructions": "${DANTE_SYSTEM_PROMPT}",
       "input": "TASK:\n<record.text>\n\nCONTEXT:\nitem_id=...\nuser_id=...\nchecklist_id=...\ncreated_at=...",
       "tools": [{
         "type": "mcp",
         "server_label": "magic-checklist",
         "server_url": "${MAGIC_CHECKLIST_MCP_URL}",
         "require_approval": "never"
       }],
       "max_output_tokens": 4096
     }
     ```
   - `AbortSignal.timeout(5 * 60 * 1000)` for the 5-minute ceiling.
4. Parse response:
   - Final text: concatenate all `output[*].content[*].text` where `type === "output_text"`.
   - Tool calls: collect any `output[*]` entries with `type === "mcp_call"` into a short summary appended to `result` (tool name + ok/error).
   - Heuristic for "agent says blocked": final text starts with `BLOCKER:` OR `mcp_call` entries contain errors AND no successful action — treat as error.
5. Update the item via the same admin client:
   - Success → `status='done'`, `checked=true`, `result=<final text + tool call summary>`.
   - Error/blocker → `status='error'`, `checked=false`, `result=<error explanation>`.
6. Top-level `try/catch`: any uncaught throw writes `status='error'` and the stringified error to `result` so CJ always sees what happened. Also catch HTTP-level OpenAI errors (429/402/5xx) and surface a friendly message.

### Env vars consumed

`OPENAI_API_KEY`, `DANTE_INBOX_CHECKLIST_ID`, `DANTE_SYSTEM_PROMPT`, `MAGIC_CHECKLIST_MCP_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. `OPENAI_API_KEY` and the Supabase ones already exist; the other three need to be added by CJ via Add Secret after deploy.

### CORS

Standard CORS headers + handle `OPTIONS`. `dante-watcher` is invoked by the DB webhook (server-to-server) so CORS is mostly defensive.

## 4. Database webhook setup

Cannot be created via SQL migration in this environment — DB webhooks are project-level config in the Supabase dashboard. After the function deploys, post-step instructions for CJ:

1. Open backend → Database → Webhooks → Create.
2. Name: `dante-watcher-trigger`. Table: `checklist_items`. Events: `Insert` only.
3. Type: HTTP Request → URL: `https://iedwmkdvwggpcmdyliii.supabase.co/functions/v1/dante-watcher`. Method: POST. HTTP headers: `Content-Type: application/json` (no auth header needed since `verify_jwt=false`).
4. The webhook fires for every INSERT; the function itself filters by `DANTE_INBOX_CHECKLIST_ID`. (Supabase webhook filters are limited; in-function filtering is simpler and safer.)

A `<lov-open-backend>` link will be included in the final reply.

## Out of scope

- No changes to `process-action-queue`, `claude-bridge`, or other tools.
- No UI changes for the `status`/`result` columns yet — agent-only fields. (Easy follow-up: render badge + result in `ItemRow` for items whose `status` is non-null.)
- No retry queue for failed Dante runs — single attempt; failures land as `status='error'` in the item.

## Files touched

- `supabase/migrations/<new>.sql` — add columns
- `supabase/functions/claude-mcp/index.ts` — extend `updateItem`
- `supabase/functions/dante-watcher/index.ts` — new
- `supabase/functions/dante-watcher/deno.json` — new (mirrors `claude-mcp/deno.json` for consistent imports)
- `supabase/config.toml` — add `[functions.dante-watcher]`
- `src/lib/types.ts` — add `status`, `result`
