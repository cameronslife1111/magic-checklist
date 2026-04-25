## Goal
Add a new **"Duplicate checkbox"** action to the Actions popup. When tapped, it clones the currently active checkbox (the highest unchecked / yellow-glowing one) and inserts an identical copy directly underneath it.

## Changes

### 1. `src/components/ActionsSheet.tsx`
- Extend the `ActionKey` union with a new `"duplicate-item"` key (kept distinct from the existing `"duplicate"`, which duplicates the entire checklist).
- Add a new entry to `STATIC_ITEMS`:
  - **Label**: `Duplicate checkbox`
  - **Icon**: `CopyPlus` (from `lucide-react`) so it's visually distinct from the existing `Copy` icon used for "Duplicate checklist".
  - **Position**: placed right after the existing `"add"` ("Add new checkbox") entry so related checkbox actions sit together.

### 2. `src/pages/Checklist.tsx`
- Add a new handler `duplicateCurrentItem()`:
  - Resolve `src = highestUnchecked`. If none, `toast.error("No unchecked checkbox found.")` and return.
  - Call the existing `insertItemAfter(src.id, { ... })` helper, copying over the source item's content fields:
    - `text`
    - `external_link`
    - `linked_checklist_id`
    - `media_url`
    - `media_type`
    - `checked: false` (the duplicate always starts unchecked so it can become the next active item if appropriate)
  - On success, if the new item is a plain text item, set `setFocusItemId(created.id)` so the user can immediately edit it. For link/media duplicates, skip auto-focus (no editable textarea).
  - Show `toast.success("Checkbox duplicated.")`.
- Add a new `case "duplicate-item":` to the `onPick` switch that calls `await duplicateCurrentItem()`.

## Notes / Non-goals
- Existing `"duplicate"` action (Duplicate **checklist**) is untouched.
- Position math is handled entirely by the existing `insertItemAfter` helper, so ordering and gap-spacing logic stays consistent with `addNewAfterCurrent` and the link-insert flow.
- No DB schema changes, no edge function changes, no new dependencies.
