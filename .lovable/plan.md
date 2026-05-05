## Add `updateItem` MCP tool

Add a new tool to `supabase/functions/claude-mcp/index.ts` that performs a partial update of a single `checklist_items` row, scoped to the owning user.

### Behavior

- Accept `item_id` + `user_id` (both required) plus any subset of: `text`, `checked`, `position`, `linked_checklist_id`, `external_link`.
- Build the update object dynamically — only include keys the caller actually passed (so `undefined` fields are not overwritten with null).
- Treat `linked_checklist_id` and `external_link` specially: if the caller passes an empty string, set the column to `null` (lets Claude clear a link).
- Always set `updated_at = new Date().toISOString()`.
- Run the update with the service-role `admin` client but constrain it with `.eq("id", item_id).eq("user_id", user_id)` so a wrong `user_id` cannot mutate someone else's row.
- Use `.select().maybeSingle()`. If no row comes back, return `{ error: "item not found or not owned by user" }`.
- On success return `{ item: data }` (matches the shape `addItem` already returns).
- If only `item_id` + `user_id` are passed with no updatable fields, short-circuit with `{ error: "no fields to update" }`.

### Placement

Insert the new `mcp.tool("updateItem", { ... })` block in `claude-mcp/index.ts` directly after the existing `addItem` tool, so item-related tools stay grouped. No other files change. The `claude-mcp` edge function will be redeployed.

### Out of scope

- No schema changes (all fields already exist on `checklist_items`).
- No changes to `media_url` / `media_type` / `parent_item_id` / `checklist_id` — those are managed by the action-job pipeline and `addItem`, not by this generic update tool.
