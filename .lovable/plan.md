## Plan: Temporary "reveal-service-key" edge function

Build a one-time-use edge function that returns the `SUPABASE_SERVICE_ROLE_KEY` value when called with a shared password only you know. After you copy the key, I'll delete the function.

### Step 1 — You pick a strong password
Before I build anything, you tell me a strong random password (20+ chars, mixed). I'll store it as a new secret called `REVEAL_PASSWORD` in Lovable Cloud. The function will only return the key if the request includes this exact password.

### Step 2 — Create `supabase/functions/reveal-service-key/index.ts`
The function will:
- Accept `POST` only
- Require an `x-reveal-password` header matching `REVEAL_PASSWORD`
- Use constant-time comparison to avoid timing leaks
- On match: return `{ service_role_key, supabase_url, project_ref }` as JSON
- On mismatch or missing header: return `401` with no detail
- Log nothing about the key value

It will be deployed with `verify_jwt = false` so you can curl it directly without a user token.

### Step 3 — You call it once
From your terminal:
```bash
curl -X POST https://iedwmkdvwggpcmdyliii.supabase.co/functions/v1/reveal-service-key \
  -H "x-reveal-password: <your password>" \
  -H "apikey: <anon key>"
```
Copy the `service_role_key` value out of the response and hand it to Claude Code.

### Step 4 — I delete the function and the secret
Immediately after you confirm you have the key, I:
- Delete `supabase/functions/reveal-service-key/`
- Remove the deployed function from Cloud
- Delete the `REVEAL_PASSWORD` secret

### Security notes
- The service role key bypasses all RLS — anyone with it has full read/write to every table. Only paste it into Claude Code's local config, never commit it to git or share in chat logs.
- If you ever suspect it leaked, tell me and we'll rotate it (requires Supabase dashboard access or a support request, since Lovable Cloud doesn't expose key rotation in the UI).
- Option 1 (Supabase dashboard) is still the cleaner path if you can log in — no temporary code, no cleanup. Worth trying first.

### What I need from you to start
1. Confirm you want to proceed (approve this plan).
2. Reply with the password you want to use (or say "generate one" and I'll suggest one for you to set).