## Goal

Eliminate Dante's self-trigger loop and stop him from spawning new artifacts mid-thread. Three defense layers: trigger logic, server-side sanitizer, system prompt.

## Layer 1 — DB migration: switch trigger from count-based to last-turn-based

New migration replacing `detect_dante_new_turn()`:

```sql
CREATE OR REPLACE FUNCTION public.detect_dante_new_turn()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  last_crown int;
  last_robot int;
BEGIN
  IF NEW.text IS NOT DISTINCT FROM OLD.text THEN
    RETURN NEW;
  END IF;

  -- Don't override watcher mid-flight
  IF NEW.status = 'in_progress' THEN
    RETURN NEW;
  END IF;
  -- Watcher self-update path: OLD in_progress -> NEW awaiting_cj
  IF OLD.status = 'in_progress' AND NEW.status = 'awaiting_cj' THEN
    RETURN NEW;
  END IF;

  last_crown := COALESCE(NULLIF(strpos(reverse(NEW.text), reverse('👑:')), 0), 0);
  last_robot := COALESCE(NULLIF(strpos(reverse(NEW.text), reverse('🤖 Dante said:')), 0), 0);
  -- Convert reverse-positions to forward positions (smaller reverse-pos = later in text)
  -- Equivalent test: last 👑: appears AFTER last 🤖 Dante said: iff
  --   last_crown > 0 AND (last_robot = 0 OR last_crown < last_robot)

  IF last_crown > 0
     AND (last_robot = 0 OR last_crown < last_robot)
     AND COALESCE(NEW.status, '') IN ('', 'awaiting_cj', 'done', 'error')
  THEN
    NEW.status := 'awaiting_dante';
  END IF;

  RETURN NEW;
END;
$$;
```

(Trigger `dante_thread_status_trg` already exists — function replacement is enough.)

`dante_claim_items` already claims `status IS NULL OR status = 'awaiting_dante'` — no change needed.

## Layer 2 — Watcher (`supabase/functions/dante-watcher/index.ts`)

In `processItem()`, after extracting `text` from OpenAI and before building `newText`:

1. Strip leading `🤖 Dante said:` (already done via `stripDanteSaidPrefix`).
2. **NEW**: replace every `👑` character in the reply with the literal word `Crown` (server-side sanitizer). Add helper `sanitizeCrowns(s) => s.replace(/👑/g, "Crown")`.
3. Apply order: `sanitizeCrowns(stripDanteSaidPrefix(text))`.

Also harden the auto-prepend step: only auto-prepend `👑:` if the text contains neither `👑:` nor `🤖 Dante said:` AND the item was claimed from `status = NULL` (first-ever turn). Current check already covers this — keep as-is.

Keep `retry424()`, `recoverStale()`, auth, MCP headers, timeouts intact.

## Layer 3 — System prompt (manual)

Update `DANTE_SYSTEM_PROMPT` secret with the full block CJ provided (banning 👑 in output, banning new-artifact spawning mid-thread, banning self-`updateItem`).

## Files Touched

- New: `supabase/migrations/<ts>_dante_last_turn_trigger.sql` — replaces `detect_dante_new_turn()`.
- Edited: `supabase/functions/dante-watcher/index.ts` — add `sanitizeCrowns()` and apply to reply.
- Manual: update `DANTE_SYSTEM_PROMPT` secret.

## Out of Scope

- No claim-SQL change (already correct).
- No UI change.
- No `claude-mcp` change.

## Verification

1. Drop an item: `Hey Dante, what's in the 👑 Busy Bee Loop?` (deliberate stray crown). After tick: text becomes `👑: Hey Dante…\n\n🤖 Dante said: …Crown Busy Bee Loop…`, status `awaiting_cj`. Trigger does NOT re-fire because the LAST marker is `🤖 Dante said:`.
2. Edit item to append `\n\n👑: Now do the Jackson Fork list.` → trigger flips to `awaiting_dante` → next tick processes.
3. Confirm via `read_query` on `checklist_items` that no item ping-pongs between statuses without a real CJ edit.
