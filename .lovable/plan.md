## Auth mechanism found

`claude-mcp/index.ts` requires header **`x-claude-key: <CLAUDE_BRIDGE_KEY>`** (timing-safe compare against the existing `CLAUDE_BRIDGE_KEY` secret). Returns 401 otherwise — that's the 424 OpenAI is bubbling up. No new secret needed; `CLAUDE_BRIDGE_KEY` is already set.

## Changes

### 1. `supabase/functions/dante-watcher/index.ts`

**a. Read the bridge key at boot:**
```ts
const CLAUDE_BRIDGE_KEY = Deno.env.get("CLAUDE_BRIDGE_KEY");
```

**b. Add `headers` to the MCP tool block in the OpenAI Responses request:**
```ts
tools: [{
  type: "mcp",
  server_label: "magic-checklist",
  server_url: MAGIC_CHECKLIST_MCP_URL,
  require_approval: "never",
  headers: { "x-claude-key": CLAUDE_BRIDGE_KEY ?? "" },
}],
```
Add an early-exit if `CLAUDE_BRIDGE_KEY` is missing (set item to `error` with a clear message, same pattern as the existing `OPENAI_API_KEY` guard).

**c. Auto-retry 424 MCP failures.** Add a new helper `retry424()` called at the top of every tick (right before `recoverStale()`):
```ts
async function retry424(): Promise<number> {
  const { data, error } = await admin
    .from("checklist_items")
    .select("id")
    .eq("checklist_id", DANTE_INBOX_CHECKLIST_ID!)
    .eq("status", "error")
    .or("result.ilike.%424%MCP server%,result.ilike.%Failed Dependency%");
  if (error) { console.error(...); return 0; }
  for (const row of data ?? []) {
    await setItem(row.id, { status: null }); // result preserved for context
  }
  return data?.length ?? 0;
}
```
Include `retried` in the tick summary log + return body. Scoped narrowly so unrelated errors aren't touched.

### 2. No DB migration, no config.toml changes, no new secret.

### 3. Manual / verification

After deploy I'll:
- Confirm `dante-watcher` redeploys.
- Trigger a tick via `supabase--curl_edge_functions` with the cron secret.
- Watch logs for the 7 errored items getting reset → re-claimed → flipping to `done`.

## Out of scope
No client/UI changes. No edits to `claude-mcp` (its existing `x-claude-key` auth is correct).
