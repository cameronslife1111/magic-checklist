# Switch 4 AI functions to OpenAI `gpt-5.4-2026-03-05`

Route `plan-action-sequence`, `process-action-queue` (its inline error explainer + any text-text calls), `explain-error`, and `openai-text` to OpenAI's `gpt-5.4-2026-03-05` model, called directly via `https://api.openai.com/v1/chat/completions` using the existing `OPENAI_API_KEY` secret (already configured).

> Heads-up I logged earlier and you've acknowledged: I cannot independently verify this model ID exists. If OpenAI returns 404 "model not found", **all four functions will fail simultaneously**. To make that survivable, every call gets clear error logging and surfaces the OpenAI error text back to the caller so we can diagnose in one shot and roll back if needed.

## What changes per file

### 1. `supabase/functions/openai-text/index.ts`
- Change model from the broken `gpt-5.5-2026-04-23` to `gpt-5.4-2026-03-05`.
- Keep the existing direct-OpenAI fetch and `OPENAI_API_KEY` usage.
- On non-OK response, log status + body and return the OpenAI error text in the JSON response (currently it returns a generic "openai error").

### 2. `supabase/functions/explain-error/index.ts`
- Replace the Lovable AI Gateway call (`ai.gateway.lovable.dev`, `google/gemini-2.5-flash`, `LOVABLE_API_KEY`) with a direct OpenAI call to `gpt-5.4-2026-03-05` using `OPENAI_API_KEY`.
- Keep `response_format: { type: "json_object" }` for the `{cause, fix}` JSON shape.
- Keep the same fallback behavior (return raw error truncated) if the call fails — this function must never throw, since it's called from the worker's error path.

### 3. `supabase/functions/process-action-queue/index.ts`
Two LLM call sites in this file:
- **`explainErrorInline` (line ~47-73)**: same swap as #2 — direct OpenAI, `gpt-5.4-2026-03-05`, `OPENAI_API_KEY`, JSON response_format. Same silent-fallback behavior.
- **The `text-text` action handler**: currently uses Lovable AI / `google/gemini-2.5-flash`. Swap to direct OpenAI / `gpt-5.4-2026-03-05`. Bubble OpenAI error text up into the job's `error_message` so failures are visible in the Action Queue UI instead of a generic "AI error".

### 4. `supabase/functions/plan-action-sequence/index.ts`
- Replace the Lovable AI Gateway call with direct OpenAI to `gpt-5.4-2026-03-05`.
- **Keep the tool-calling schema unchanged** — OpenAI's chat completions API supports the same `tools` + `tool_choice` shape we're already sending, so the planner's structured output contract (`decide` tool with `kind`/`step`/`steps`) carries over verbatim.
- Update the error mapping: keep 429 → "rate limited", but rename 402 → "OpenAI quota exhausted, check billing" (Lovable credits don't apply here anymore).
- Keep the safety fallback: if the model returns no tool call or invalid JSON, still return `{kind:"no_action", reason:"..."}` so the worker doesn't get stuck.

## What does NOT change
- `supabase/functions/openai-vision/index.ts` (you didn't ask to touch it; still on `gpt-4o-mini`).
- `lovable-image`, `fal-video`, `fal-avatar`, `perplexity-search` — unrelated providers.
- `supabase/config.toml` — all four functions already have correct `verify_jwt` settings.
- No DB migrations, no UI changes, no client changes.

## Secrets / config
- `OPENAI_API_KEY` is already set in Supabase secrets — no action required from you.
- `LOVABLE_API_KEY` stays in place (still used by other features); these 4 functions just stop calling it.

## Rollback plan
If `gpt-5.4-2026-03-05` returns 404 from OpenAI after deploy, the fastest fix is one of:
- (a) swap the model string to `gpt-5.2` (confirmed-available OpenAI model) in all 4 files, or
- (b) revert the three Lovable-gateway functions back to `google/gemini-2.5-flash`.

I'll watch the first deploy + a test invocation of `openai-text` and `explain-error` and report back the exact OpenAI response so we know within seconds whether the ID is valid.

## Technical details

- All four call sites use the same shape:
  ```ts
  fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-5.4-2026-03-05", messages, /* tools/response_format as needed */ }),
  })
  ```
- The planner keeps `tools: [TOOL_SCHEMA]` and `tool_choice: { type: "function", function: { name: "decide" } }` — OpenAI-compatible.
- `explain-error` and `explainErrorInline` keep `response_format: { type: "json_object" }` — OpenAI-compatible.
- Error surfacing: on non-OK, log `status` + first 500 chars of body, and (for non-silent endpoints) include `openai_status` and `openai_error` fields in the JSON error response so the Action Queue UI's existing error display shows something actionable.
