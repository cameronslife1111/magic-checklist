## Add "Send to top" and "Send to bottom" quick actions

Add two new buttons in the Actions sheet — "Send to top" and "Send to bottom" — placed directly under "Insert checklist link". Each takes the currently focused (yellow-highlighted) sentence and moves it to the very top or very bottom of the same checklist. No dialog, no extra prompts.

### UX

- Both items appear under "Insert checklist link" in the Actions sheet.
- Tapping either one immediately moves the current sentence to the top (or bottom) of the current checklist's order, then closes the sheet.
- The moved item stays focused/highlighted after the move.
- If there is no current sentence, do nothing (consistent with other current-sentence actions).

### Technical changes

**`src/components/ActionsSheet.tsx`**
- Extend `ActionKey` with `"send-to-top"` and `"send-to-bottom"`.
- Add two entries to `STATIC_ITEMS` immediately after the `insert-link` entry:
  - `{ key: "send-to-top", label: "Send to top", icon: ArrowUpToLine }`
  - `{ key: "send-to-bottom", label: "Send to bottom", icon: ArrowDownToLine }`
- Import the two new icons from `lucide-react`.

**`src/pages/Checklist.tsx`**
- In the Actions-pick switch (around line 680), add two new cases:
  - `"send-to-top"`: compute new position as `(firstItem.position ?? POS_STEP) - POS_STEP` and update the current item's `position` in Supabase, then refresh local state so it renders at the top.
  - `"send-to-bottom"`: compute new position as `(lastItem.position ?? 0) + POS_STEP` and update similarly so it renders at the bottom.
- Both close the Actions sheet and keep the current item as the focused one.
- Reuse the existing pattern used by the rearrange logic (`supabase.from("checklist_items").update({ position }).eq("id", currentId)`).

### Out of scope

- No changes to the existing "Send to checklist" dialog or its default position.
- No changes to database schema.
