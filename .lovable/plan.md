## Goal

Turn each Dante Inbox checklist item into an ongoing 👑/🤖 thread. The watcher does all the formatting and appending — Dante just produces a plain-text response.

## Layer 1 — System Prompt (manual)

Update the `DANTE_SYSTEM_PROMPT` secret in Lovable Cloud with the new prompt block CJ provided. No code change for this; CJ updates the secret in the Cloud settings UI (or I can use the secrets tool if preferred — confirm).

## Layer 2 — DB migration: status values + auto-detect new 👑 turns

New migration:

1. Update `validate_checklist_item_status` trigger function to accept the new statuses: `'pending','in_progress','done','error','awaiting_dante','awaiting_cj'`.

2. New function `detect_dante_new_turn()`:
   - Fires only when `checklist_id = <DANTE_INBOX_CHECKLIST_ID>` AND `text` actually changed.
   - Counts lines starting with `👑:` vs `🤖 Dante said:` in `NEW.text`.
   - If `crown_count > robot_count` AND `NEW.status` is not already `in_progress` → set `NEW.status = 'awaiting_dante'`.
   - Skip when the update is being made by the watcher itself (we'll guard via a row-level marker: if `OLD.status = 'in_progress'` and `NEW.status = 'awaiting_cj'`, do nothing).

   Implementation note: the inbox UUID is in the `DANTE_INBOX_CHECKLIST_ID` secret. Postgres triggers can't read edge-function secrets, so I'll hardcode the UUID into the trigger after fetching it via `read_query` (`SELECT id FROM checklists WHERE …`) — actually simpler: drop the checklist-id filter and run the counting logic on every `checklist_items` UPDATE where text changed. It's cheap (regex count) and correct everywhere; non-inbox items won't have 👑 emojis so it's a no-op.

3. Trigger `dante_thread_status_trg BEFORE UPDATE ON checklist_items FOR EACH ROW WHEN (OLD.text IS DISTINCT FROM NEW.text) EXECUTE FUNCTION detect_dante_new_turn();`

4. Update `dante_claim_items` SQL function: change `WHERE status IS NULL` → `WHERE status IS NULL OR status = 'awaiting_dante'`.

## Layer 3 — Watcher rewrite (`supabase/functions/dante-watcher/index.ts`)

In `processItem()`:

1. **Auto-prepend 👑** — if `item.text` doesn't start with `👑:` (and there's no existing 🤖 line), update `text = "👑: " + text` before sending to OpenAI. Persist via `setItem(item.id, { text: ... })`.

2. **Build OpenAI input** as the FULL current item text plus a trailing system note:
   ```
   <full thread text>
   
   ---
   The above is the full conversation thread. Respond to the most recent 👑 turn. Output only your reply text — do NOT include "🤖 Dante said:" prefix; the system adds it.
   ```

3. **After OpenAI responds**:
   - Strip leading `🤖 Dante said:` from `text` (case-insensitive, with optional whitespace) if Dante included it.
   - Build new item text: `${currentText}\n\n🤖 Dante said: ${strippedReply}`.
   - Build `result` field with meta only: tool-call summary + timestamp (no Dante prose).
   - On success: `setItem(id, { text: newText, result: metaSummary, status: 'awaiting_cj', checked: false })`.
   - On blocker: same as success but `status: 'awaiting_cj'` (BLOCKER text is in the appended thread reply, so CJ sees it).
   - On error: keep existing behavior — `status: 'error'`, error in `result`, leave text unchanged.

4. **Keep existing**: `retry424()`, `recoverStale()` (recoverStale should also consider `awaiting_dante` items stuck → already handles `in_progress` only, fine), authorization, OPENAI/MCP/CLAUDE_BRIDGE_KEY guards, `headers: { "x-claude-key": CLAUDE_BRIDGE_KEY }` on the MCP tool.

5. **Status semantics in summary log**: include counts for new vs awaiting_dante claims.

## Files Touched

- New: `supabase/migrations/<ts>_dante_threading.sql` (validate_status update + detect_dante_new_turn + trigger + dante_claim_items replacement).
- Edited: `supabase/functions/dante-watcher/index.ts`.
- Manual: update `DANTE_SYSTEM_PROMPT` secret value.

## Out of Scope

- No UI changes to render the thread differently (the existing `result` panel + item text display is sufficient for now).
- No edits to `claude-mcp` (auth is correct).
- No new secrets.

## Verification After Deploy

1. Add a fresh inbox item with text `Hey Dante, list the first 3 items in the Busy Bee Loop.` (no crown).
2. Within ~60s: item text becomes `👑: Hey Dante…\n\n🤖 Dante said: <reply>`, status = `awaiting_cj`.
3. Edit the item to append `\n\n👑: Now do the same for the Jackson Fork list.` → trigger flips status to `awaiting_dante` → next tick claims & appends new 🤖 turn.
4. Verify via `read_query` on `checklist_items`.
