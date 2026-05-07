## Add two MCP tools to `claude-mcp`

Add `updateMediaTitle` and `updateChecklistTitle` to `supabase/functions/claude-mcp/index.ts`, registered alongside `fetchMedia` (around line 487).

Both tools follow the same pattern as existing tools (use the `admin` service-role client, return `text({...})`).

### Tool 1: `updateMediaTitle`

- **inputSchema** (required: `media_id`, `user_id`, `title`):
  - `media_id`: string — UUID of `media_assets` row
  - `user_id`: string — owner UUID for ownership check
  - `title`: string — new title (min length 1)
- **handler**:
  1. Validate `title` is a non-empty string; else return `{ error: "title must be a non-empty string" }`.
  2. Fetch the row by `id = media_id` (single). If not found → `{ error: "media not found", media_id }`.
  3. If `row.user_id !== user_id` → `{ error: "ownership mismatch: media is owned by a different user", media_id }` (no silent fail).
  4. `update({ title }).eq("id", media_id).eq("user_id", user_id).select().single()`.
  5. Return `{ media: data }` on success, `{ error: error.message }` on DB error.

### Tool 2: `updateChecklistTitle`

Same shape, against `checklists` table:
- **inputSchema** (required: `checklist_id`, `user_id`, `title`).
- **handler**: same ownership-check flow as above. Return `{ checklist: data }`.

### Deploy

Deploy `claude-mcp` after the edit so the new tools are immediately callable by Dante. Confirm both tools shipped in the reply.

No DB migrations, no schema changes, no new secrets. RLS is already enforced via `admin` + explicit `user_id` filters.
