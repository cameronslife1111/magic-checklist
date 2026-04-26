## Goal
Add a new **"Uncheck all"** button to the Actions sheet. When tapped it:
1. Unchecks every item on the **current** checklist only (no other lists touched).
2. Scrolls to the first item, marks it as the active/highlighted item (yellow highlight, same as normal), and speaks it via the existing web-speech flow.

## First-principles look at how things already work
- The "active/yellow highlight" is purely derived from `highestUnchecked` (the first item with `checked === false`). It's passed into rows via `isActive={highestUnchecked?.id === it.id}`. So as soon as all items become unchecked in state, the first item automatically becomes active and highlighted — no extra UI plumbing needed.
- Speech + scroll for the active item is already encapsulated in `focusAndSpeakHighestUnchecked(list)` in `Checklist.tsx`. We'll reuse it directly so behavior matches "load a fresh checklist" exactly.
- Persisting changes goes through Supabase `checklist_items.update({ checked: false })` filtered by `checklist_id` — the same pattern used by `handleToggle`.

## Changes

### 1. `src/components/ActionsSheet.tsx`
- Extend `ActionKey` with `"uncheck-all"`.
- Add a new entry to `STATIC_ITEMS`, placed near the other quick-list utilities (right under `"add"` / `"duplicate-item"` makes the most sense, before `media-gallery`):
  - key: `"uncheck-all"`
  - label: `"Uncheck all checkboxes"`
  - icon: `Square` from `lucide-react` (empty checkbox visual; clearly conveys "uncheck"). Import it alongside the existing icons.

### 2. `src/pages/Checklist.tsx`
- Add a new case in the `onPick` switch:
  ```ts
  case "uncheck-all": {
    setActionsOpen(false);
    const checkedIds = items.filter(i => i.checked).map(i => i.id);
    if (checkedIds.length === 0) {
      // Nothing to uncheck — still focus + speak the first item for consistency.
      focusAndSpeakHighestUnchecked(items);
      break;
    }
    const next = items.map(i => ({ ...i, checked: false }));
    setItems(next);                        // optimistic — yellow highlight jumps to first item immediately
    primeSpeech();
    focusAndSpeakHighestUnchecked(next);   // scroll-to-center + speak first sentence
    const { error } = await supabase
      .from("checklist_items")
      .update({ checked: false })
      .in("id", checkedIds);               // scoped to this checklist's items only
    if (error) {
      toast.error("Could not uncheck items. Try again.");
      // best-effort revert
      setItems(items);
    }
    break;
  }
  ```
- No other state needs to change. The `highestUnchecked` memo recomputes from `items`, which automatically re-applies the yellow active highlight to the first row.

## Why this is safe and consistent
- Uses the exact helper (`focusAndSpeakHighestUnchecked`) that the page already uses on load, after delete, and after toggling — so highlight/scroll/speech behavior matches everywhere.
- Calls `primeSpeech()` first (matches the `handleToggle` pattern), keeping iOS/Safari speech reliable since the click is a user gesture.
- The Supabase update is filtered by the specific checked item IDs, so it cannot affect other checklists.
- The Actions sheet's existing `onOpenChange` already calls `stopSpeech()` on open, so the prior utterance is cancelled before we speak the first sentence — no overlapping speech.