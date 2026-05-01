## Make checkbox item text larger

Increase the font size of checklist item text so it's visually closer to (but still smaller than) the checklist title at the top.

### Reference sizes
- Title (`src/pages/Checklist.tsx` line 1263): `text-xl` → 20px
- Current item text: `text-base md:text-[15px]` → 16px mobile / 15px desktop
- New item text: `text-lg md:text-base` → 18px mobile / 16px desktop

This keeps a clear hierarchy (title 20px > item ~18px) while making items noticeably easier to read.

### Files to change

**`src/components/ItemRow.tsx`** — update three places that render item text:
1. Internal-link button label `<span>` — add `text-lg md:text-base`.
2. External-link `<a>` text — add `text-lg md:text-base`.
3. Editable `<textarea>` — replace `text-base md:text-[15px]` with `text-lg md:text-base`.
4. Hidden mirror `<textarea>` (used to measure height) — match the same size so auto-height stays accurate.

No other components need changes; the sortable/reorder view (`SortableItemRow.tsx`) already uses its own `text-[15px]` — leave it alone unless you also want reorder mode bumped (not part of this request).
