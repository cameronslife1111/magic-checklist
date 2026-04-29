## Fix highlight scroll: top of yellow lands just below sticky header

**Problem:** After switching to `block: "start"`, the highlighted checkbox now scrolls behind the sticky header (search bar + title) and is hidden from view.

**Goal:** The **top of the yellow highlight** should land in the upper portion of the visible area — just below the sticky header — not at the absolute top of the page (where it's hidden) and not at the center (where long items hide their first lines).

### Technical change

Single file: `src/pages/Checklist.tsx`, in the two `scrollIntoView` calls (around lines 254 and 262).

Set `scrollMarginTop` on the target element before scrolling. The CSS `scroll-margin-top` property tells `scrollIntoView` to leave that much space at the top — perfect for clearing sticky headers.

The sticky header (line 1185) contains the `ChecklistSearch` (~48px) + `mt-3` + `text-xl` title (~28px) + padding (~24px) ≈ ~110-120px. Use **120px** as the offset.

```ts
// Both scroll sites:
const el = itemRefs.current[id];
if (el) {
  el.style.scrollMarginTop = "120px";
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}
```

Result: top of the highlighted item sits just below the search/title header, fully visible, with the rest of the item's text flowing down the screen.

No other files, no schema changes.
