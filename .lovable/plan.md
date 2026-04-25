## Plan

### 1. Per-item delete button (X)
**`src/components/ItemRow.tsx`**
- Add an `onDelete: (item) => void` prop.
- Render a small ghost icon button (lucide `X`) on the right side of each row, vertically centered, with `aria-label="Delete item"`. Visible on all sizes (tap-friendly on iPhone — h-8 w-8).
- Clicking calls `onDelete(item)`.

**`src/pages/Checklist.tsx`**
- Implement `handleDelete(item)`:
  1. If `item.media_url` is a public URL pointing to the `generated-media` bucket, parse out the object path (after `/generated-media/`) and call `supabase.storage.from("generated-media").remove([path])` to remove the stored file.
  2. Delete the row: `supabase.from("checklist_items").delete().eq("id", item.id)`.
  3. Update local state by filtering it out.
  4. On error, `toast.error("Could not delete. Try again.")`.
- Pass `onDelete={handleDelete}` to `<ItemRow />`.

Note: externally uploaded reference media is never persisted (per spec), so storage cleanup only applies to generated images/videos in the `generated-media` bucket. Fal video URLs (hosted by Fal) aren't in our storage, so we skip remove for non-bucket URLs.

### 2. Yellow glow on highest unchecked item
**`src/index.css`**
- Add a utility class `.glow-active` with a soft yellow ring + box-shadow that works in both light and dark mode, e.g.:
  ```css
  .glow-active {
    box-shadow: 0 0 0 2px hsl(48 96% 60% / 0.55), 0 0 18px 2px hsl(48 96% 60% / 0.45);
    background-color: hsl(48 96% 60% / 0.08);
  }
  ```
- Respect `prefers-reduced-motion` is N/A (no animation), but we'll keep the glow static so it's accessible.

**`src/components/ItemRow.tsx`**
- Add `isActive?: boolean` prop. When true, append `glow-active` to the `<li>` className.

**`src/pages/Checklist.tsx`**
- Pass `isActive={highestUnchecked?.id === it.id}` to each `<ItemRow />`. The existing `highestUnchecked` memo already finds the first unchecked item, so the glow updates automatically as items are checked/added/deleted.

### 3. Light/Dark mode toggle in Actions
**`src/components/ActionsSheet.tsx`**
- Add a new action key `"theme"` to `ActionKey` union.
- Add a new menu entry near the bottom (above "Sign out"): label dynamic — "Switch to dark mode" / "Switch to light mode" depending on current theme. Icon: `Moon` when light, `Sun` when dark.
- Accept a `currentTheme: "light" | "dark"` prop to render the right label/icon.

**`src/pages/Checklist.tsx`**
- Add a `theme` state initialized from `localStorage.getItem("mc-theme")` (fallback `"light"`).
- On mount and whenever `theme` changes: toggle `document.documentElement.classList` `"dark"` and persist to `localStorage`.
- In `onPick`, handle `case "theme"`: flip `theme` between `"light"` and `"dark"`. (Dark theme tokens already exist in `src/index.css` under `.dark`.)
- Pass `currentTheme={theme}` to `<ActionsSheet />`.

### Notes
- No DB schema changes required.
- No new dependencies — `Moon`, `Sun`, `X` are all in `lucide-react`.
- Header background uses `checklist.background_color` (per-checklist solid color). That stays as-is; the dark mode toggle changes the rest of the app chrome (cards, text, borders) via CSS variables. Existing checklist background still wins on the main surface, which matches the spec ("solid background per checklist").

### Acceptance
- Each row shows an X button; tapping it removes the row from the UI, DB, and (when applicable) storage.
- The first unchecked item always has a yellow glow; the glow moves as items are checked/deleted/added.
- Actions menu has a theme toggle that switches between light and dark and persists across reloads.
