## Problem

The Action Queue Dashboard sometimes shows "No queued actions" / stays in "Loading…" forever even though jobs exist in the database (verified — there are 7 jobs for your user, including one currently `running`).

## Root cause

In `src/pages/ActionQueue.tsx` the initial fetch effect has three subtle bugs that combine into the failure you're seeing:

1. **Auth race**: the effect runs as soon as `user` is non-null, but the Supabase client's auth header may not yet be attached for that request. RLS then silently returns **0 rows** instead of an error. `setJobs([])` + `setLoading(false)` fire and the dashboard "successfully" displays an empty queue.
2. **No explicit `user_id` filter**: the query relies entirely on RLS. Combined with #1, there's no defense if the token is briefly missing.
3. **Realtime never backfills**: the subscription only delivers *changes*. If the initial fetch came back empty, nothing ever repopulates until you hard-refresh — exactly what you're experiencing.
4. **`if (!user) return;` early-exit** never resets `loading`, so a user/session flip mid-mount can leave the page stuck on "Loading…".

The Media Gallery work didn't break anything in the queue itself — it just added more auth-state churn (new route, new queries) that made this latent race trigger more often.

## Fix (single file: `src/pages/ActionQueue.tsx`)

1. **Wait for auth to be ready** before fetching: use `loading` from `useAuth()` and only fetch once `loading === false` AND `user` exists. If `user` is null after auth resolves, set `loading=false` and show empty state cleanly.
2. **Add an explicit `.eq("user_id", user.id)` filter** to both the initial fetch and as a `filter` on the realtime channel — defense in depth against the RLS-returns-empty race.
3. **Re-fetch on visibility change & on realtime `SUBSCRIBED` event**: when the channel finishes (re)subscribing or the tab regains focus, run the list query again. This guarantees backfill even if the first attempt raced auth.
4. **Surface fetch errors**: if `error` is returned, show a small inline error with a "Retry" button instead of silently rendering an empty list. (Right now errors are dropped on the floor.)
5. **Add a manual "Refresh" button** in the header next to the back arrow as a final safety net.
6. **Stable channel name per user** (`action_jobs_dashboard_${user.id}`) so reconnects don't collide.

## What I will NOT change

- Database schema (data is fine, RLS is correct, jobs exist).
- Edge functions (`process-action-queue`, `enqueue-action`) — they're working; the latest job moved from `pending` → `running` correctly.
- The job-row UI, tabs, status badges, or any other behavior. Same look, just reliable loading.

## Verification after the fix

- Reload the dashboard — should populate immediately with your 7 jobs.
- Sign out / sign back in — dashboard should populate without a manual refresh.
- Trigger a new action from a checklist — should appear live via realtime, and remain after the realtime channel reconnects.
