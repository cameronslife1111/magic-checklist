# Remember the last-opened checklist across sessions

## Problem
When you reopen the app (new tab visit, refresh, or returning later), it doesn't restore the checklist you last had open. Instead, the initial load query picks whichever checklist was most recently *edited* (`order("updated_at", { ascending: false }).limit(1)`). So if you were viewing Checklist B but Checklist A had newer edits, you land back on A.

There is currently no persistence of "which checklist was last open" anywhere.

## Fix
Persist the last-opened checklist id in `localStorage` and prefer it on initial load.

### Changes — `src/pages/Checklist.tsx`

1. **In `openChecklist(id)`** — save the id every time a checklist is opened:
   ```ts
   localStorage.setItem("mc-last-checklist", id);
   ```

2. **In the initial-load `useEffect`** — try the saved id first, fall back to the existing "most recently updated" query, then fall back to the existing "create first checklist" path:
   ```ts
   const savedId = localStorage.getItem("mc-last-checklist");
   let active: Checklist | undefined;
   if (savedId) {
     const { data } = await supabase
       .from("checklists").select("*").eq("id", savedId).maybeSingle();
     if (data) active = data as Checklist;
   }
   if (!active) {
     const { data: lists } = await supabase
       .from("checklists").select("*").order("updated_at", { ascending: false }).limit(1);
     active = lists?.[0] as Checklist | undefined;
   }
   // ...existing "no lists yet → create first checklist" block stays the same
   ```

3. **On checklist deletion** — if the deleted id matches the saved one, clear the key so we don't try to reopen a deleted list on next visit.

### Why localStorage (not the database)
- "Where I left off on this device" is exactly what localStorage is for.
- No schema changes, no extra columns.
- RLS already protects the lookup: if the saved id is invalid or not accessible, the query returns nothing and we gracefully fall back.

### Out of scope
- No changes to search, speech, title-edit, or navigation behavior.
- No new UI.