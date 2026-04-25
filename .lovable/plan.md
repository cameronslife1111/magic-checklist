
# Goal
Switch all AI **text-to-text** generation in the app to OpenAI's new `gpt-5.5-2026-04-23` model. Action Queue (Now / Schedule / Recurring) keeps working unchanged — the worker just calls the same edge function, which now hits the new model.

# Where text-to-text actually runs
There's exactly **one** edge function handling text-to-text in this app:

- **`supabase/functions/openai-text/index.ts`** — currently calls `gpt-4o-mini`.

The Action Queue worker (`process-action-queue`) routes the `text-text` action_type to this function via `callFn("openai-text", { prompt }, signal)`. Now / Schedule / Recurring all flow through the same worker, so updating this one file covers every path.

# What I will NOT change (intentional)
These also use AI but are **not** "text-to-text generation" the way you described — leaving them on their current models avoids breaking working flows:

- `openai-vision` (`gpt-4o-mini`) — image **analysis** (vision input). Different capability.
- `perplexity-search` (`sonar`) — web search via Perplexity, not OpenAI.
- `process-action-queue` + `explain-error` (`google/gemini-2.5-flash` via Lovable AI) — internal error-translation helper, not user-facing generation.

If you want any of these moved to gpt-5.5 too, say the word and I'll add them.

# The change

**File: `supabase/functions/openai-text/index.ts`**

Single line swap:

```ts
// before
model: "gpt-4o-mini",

// after
model: "gpt-5.5-2026-04-23",
```

Everything else in the function stays identical:
- Same request shape (`/v1/chat/completions`, `messages` with system + user)
- Same system prompt ("You are a concise assistant…")
- Same response parsing (`data.choices[0].message.content`)
- Same CORS, error handling, abort behavior

# Why this safely keeps the Action Queue working
- `process-action-queue` calls this function the same way for **Now**, **Schedule**, and **Recurring** jobs (recurring re-enqueues a fresh job which eventually re-invokes `openai-text`).
- The cancellation/Stop button logic is upstream of the model call (it aborts the fetch via `AbortSignal`) — model name has no effect on it.
- Result insertion into `checklist_items` is unchanged, so output continues to appear in the dashboard and on the destination checklist.

# Deployment
After the edit I'll deploy `openai-text` and do a quick live curl through the worker path to confirm the new model responds. If OpenAI rejects the model ID, I'll surface the exact error and we'll adjust the ID — no other code changes required.

Approve and I'll ship it.
