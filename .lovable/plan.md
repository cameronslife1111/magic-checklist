# Goal
Whenever the app shows a list of checklists to pick from, sort them by **title** in this order:
1. Emojis / symbols (anything that isn't a letter or digit) first
2. Numbers next
3. Letters last
4. Within each group, ascending alphabetical (case-insensitive, locale-aware) — e.g. `0` before `9`, `apple` before `banana`.

This matches your description: a title starting with `0` ranks above one starting with `B`, and a title starting with an emoji ranks above one starting with `0`.

# Where this applies
All four picker/search components currently sort by `updated_at desc`. They will be switched to title-based sorting:
- `src/components/SendToChecklistDialog.tsx`
- `src/components/ChecklistPickerDialog.tsx` (insert checklist link)
- `src/components/ChecklistSearch.tsx` (home screen search)
- `src/components/ContextAttacher.tsx` (attach checklist context)

# Implementation

## 1. New shared sort helper — `src/lib/sortChecklists.ts`
```ts
// Bucket: 0 = emoji/symbol, 1 = number, 2 = letter, 3 = empty/other
const bucket = (title: string): number => {
  const ch = (title ?? "").trim();
  if (!ch) return 3;
  // Use first code point to handle multi-code-unit emoji
  const cp = ch.codePointAt(0)!;
  const first = String.fromCodePoint(cp);
  if (/\p{L}/u.test(first)) return 2;       // letter
  if (/\p{N}/u.test(first)) return 1;       // number/digit
  return 0;                                  // emoji / symbol / punctuation
};

export function sortChecklistsByTitle<T extends { title: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const ba = bucket(a.title);
    const bb = bucket(b.title);
    if (ba !== bb) return ba - bb;
    return a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true });
  });
}
```
Notes:
- Uses Unicode property escapes (`\p{L}`, `\p{N}`) so accented letters and non-Latin digits behave correctly.
- `numeric: true` makes `2` sort before `10` within the number bucket.
- `sensitivity: "base"` makes letter sort case-insensitive.

## 2. Update each picker
In each of the four files, change the Supabase query and post-process with the helper:

**Before**
```ts
let query = supabase.from("checklists").select("id,title")
  .order("updated_at", { ascending: false }).limit(30);
if (q.trim()) query = query.ilike("title", `%${q.trim()}%`);
const { data } = await query;
setResults(data ?? []);
```

**After**
```ts
let query = supabase.from("checklists").select("id,title")
  .order("title", { ascending: true }).limit(200);
if (q.trim()) query = query.ilike("title", `%${q.trim()}%`);
const { data } = await query;
setResults(sortChecklistsByTitle(data ?? []));
```
Why bump the limit to 200: server-side `ORDER BY title` won't match our custom emoji/number/letter ordering, so we need a wider window to re-sort client-side and still show the right top-of-list items. 200 is a safe ceiling for these dialogs and keeps payloads small.

For `SendToChecklistDialog` and `ChecklistPickerDialog`, the existing `excludeId` filter is applied after `sortChecklistsByTitle`, unchanged.

## 3. Out of scope
- The Action Queue dashboard, the active checklist page itself, and other non-picker views are not affected.
- No DB schema changes, no RLS changes, no edge function changes.

# Verification
After approval I'll:
- Add the helper file
- Patch the four picker components
- Spot-check by viewing the diffs

Approve and I'll roll it out.