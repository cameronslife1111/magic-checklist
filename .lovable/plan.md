## Make full media titles always visible

The single bottleneck: each row uses `flex items-center` with the title `<button>` on `truncate text-sm font-medium`, then three icon buttons (rename, open, delete) sit beside it on the same row. On mobile that leaves ~120 px for the title — anything longer than ~18 chars gets `…`'d.

### Fix: stack the row on mobile, side-by-side on desktop

A two-line title wrap alone wouldn't be enough for long shot codes like `X245_charRef_sceneB_v3_final` — they'd still get cropped on narrow screens. Moving the actions below the title on mobile gives the title the entire card width; on desktop where there's space, we keep the current side-by-side layout.

### Changes (only `src/pages/MediaGallery.tsx`, lines ~178–230)

1. **Row container** — change `<li className="flex items-center gap-3 px-3 py-2.5 bg-card">` to `flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-3 py-2.5 bg-card`. Stacks on mobile, restores horizontal layout from `sm:` breakpoint up.

2. **Top row (icon + title block)** — wrap the kind-icon `<span>` and the `<div className="min-w-0 flex-1">` in a new `<div className="flex items-start gap-3 w-full min-w-0">`. `items-start` so the round icon aligns to the first line of a wrapped title.

3. **Title button** — replace `truncate` with `break-words whitespace-normal leading-snug`. No line clamp — full title shows, wrapping as many lines as needed. Keep `text-sm font-medium`, keep `block w-full text-left hover:underline`, keep the rename-on-click behavior.

4. **Action buttons row** — wrap the three `<Button>`s in `<div className="flex items-center gap-1 self-end sm:self-auto -mr-1 sm:mr-0">`. On mobile they sit on a second line, right-aligned (`self-end`) so they line up with the card edge and stay thumb-reachable. On desktop they revert to inline-with-title.

5. **Edit mode row** — give the inline rename `<div>` `w-full` so the input expands to full card width on mobile (currently it's constrained by the flex children).

Nothing else changes: handlers, state, multi-select (none here), MediaViewer, AlertDialog, upload buttons, filter chips, header — all untouched.

### Why this is the cleanest option
- Wrap-only would leave actions squeezing the title on mobile to ~60% width, still wrapping awkwardly into 3–4 lines for long names.
- Stack-only on every breakpoint wastes vertical space on desktop where horizontal fits fine.
- Combo (wrap + responsive stack) gives the title 100% of card width on mobile with no truncation, and preserves the existing tidy desktop row.

### Visual style
- Same `bg-card`, `divide-y divide-border`, `text-sm font-medium`, `text-xs text-muted-foreground` for the meta line, same icon button sizing — zero new tokens or colors introduced.