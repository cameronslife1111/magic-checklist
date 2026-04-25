# Fix: `UNAUTHORIZED_INVALID_JWT_FORMAT` on queued AI actions

## What's actually broken
The error you're seeing on text-to-text isn't an OpenAI issue — the AI-generated "fix" message is misleading. The raw error tells the truth:

```
openai-text 401: {"code":"UNAUTHORIZED_INVALID_JWT_FORMAT","message":"Invalid JWT"}
```

That 401 comes from Supabase's edge-function gateway, **not** from OpenAI. The request never reaches OpenAI at all.

## Why it's happening
1. `process-action-queue` (the background worker) calls the AI helper functions (`openai-text`, `openai-vision`, `lovable-image`, `fal-video`, `perplexity-search`) with the **service role key** as a Bearer token.
2. Those five functions are configured in `supabase/config.toml` with **`verify_jwt = true`**, so the gateway demands a *user* JWT signed by the project's auth signing keys.
3. The service role key isn't a user JWT — wrong issuer/format — so the gateway rejects it with `UNAUTHORIZED_INVALID_JWT_FORMAT` before the function code ever runs.
4. The error bubbles into `action_jobs.error_raw`. The AI explainer sees "401 / authentication / invalid" and incorrectly guesses it's an OpenAI key problem.

This affects **every** action_type, not just text-to-text — they all go through the same `callFn` path.

## Fix
Update `supabase/config.toml` to set `verify_jwt = false` on the five worker-called functions:

- `openai-text`
- `openai-vision`
- `lovable-image`
- `fal-video`
- `perplexity-search`

### Why this is safe
- These functions are no longer called from the browser. The end-user-facing entry point is `enqueue-action`, which keeps `verify_jwt = true` and already validates the user, checklist ownership, and context limits.
- Once a job lands in `action_jobs`, it's already trusted; the worker is just orchestrating internal calls server-to-server.
- This matches Lovable's recommended default for edge functions on the signing-keys system.
- `enqueue-action` stays protected. `process-action-queue` stays at `verify_jwt = false` (it's invoked by pg_cron). Nothing changes for the user-facing surface.

### Files changed
- `supabase/config.toml` — flip `verify_jwt` to `false` for the five functions above. No code changes needed; no DB migration; no secret changes.

## What you should see after
- Queued text-to-text jobs complete and insert a result item under the source row.
- The same fix unblocks image generation, remix, image→video, video→video, vision, and web-search jobs.
- If a real OpenAI key issue ever happens, you'll now see the actual OpenAI error body in `error_raw` (e.g. `invalid_api_key`) instead of the gateway's JWT rejection.

## Not doing
- Not touching `OPENAI_API_KEY` — it's fine.
- Not changing `enqueue-action` auth.
- Not changing `process-action-queue` auth or the cron schedule.
- Not modifying any DB tables, RLS, or storage.