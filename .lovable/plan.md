# Home button: always drill into linked checklists

## Current behavior

A short tap on the 🏠 Home button does this (in `src/pages/Checklist.tsx`, lines 1334–1355):

1. Look up the alphabetically-top checklist.
2. If you are **not** already on it → navigate to the top checklist.
3. If you **are** on the top checklist → if the highest unchecked item links to another checklist, drill into it; otherwise do nothing.

Result: from a deep checklist with a linked-checklist item highlighted yellow, the Home button takes you all the way back to the top checklist, even though the more useful action is to drill one level deeper into the link you're already pointed at.

## New behavior

Priority becomes: **drill in if you can, otherwise go home.**

On a short tap of the Home button:

1. If the current checklist's highest unchecked item has a `linked_checklist_id` → open that linked checklist. (Works on every checklist, including the top one. Lets you keep tapping Home to go deeper and deeper.)
2. Otherwise → navigate to the alphabetically-top checklist (unless you're already on it, in which case do nothing).

Plain text items, external links, and items with media but no internal link all fall through to step 2 — same "go home" behavior as a regular checkbox today.

Long-press behavior (insert new item) is unchanged.

## Technical change

Single edit in `src/pages/Checklist.tsx` inside the Home button's `onPointerUp` handler (around lines 1340–1355). Replace the current "find top checklist first, then maybe drill" logic with:

```ts
if (homeLongPressFiredRef.current) return;
keepaliveRef.current?.blur();

// Drill-first: if the highlighted item links to another checklist,
// open it — regardless of which checklist we're currently on.
if (highestUnchecked?.linked_checklist_id) {
  await openChecklist(highestUnchecked.linked_checklist_id);
  return;
}

// Otherwise, go back to the alphabetically-top checklist.
const { data } = await supabase.from("checklists").select("id,title");
const sorted = sortChecklistsByTitle(data ?? []);
const top = sorted[0];
if (!top || top.id === checklist.id) return;
await openChecklist(top.id);
```

No other files, no schema changes, no new state.
