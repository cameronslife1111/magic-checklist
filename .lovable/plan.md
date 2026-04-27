# Update bottom action bar: full width, taller, colored buttons

## Goals
1. The three bottom buttons (Actions, 🏠 Home, ✓ Check) should fill the full width with **no gap** between them.
2. Buttons should be **double the current height** (h-14 → h-28) for easier tapping.
3. Recolor button backgrounds:
   - **Actions** → darker orange
   - **🏠 Home** → stays blue (current default)
   - **Check (✓)** → green

## Changes (single file: `src/pages/Checklist.tsx`, ~lines 1126–1242)

### 1. Container — remove gap, drop side padding so buttons go edge-to-edge
- Outer wrapper currently: `fixed bottom-0 left-0 right-0 px-4 pb-[...] pt-3`
  → change to: `fixed bottom-0 left-0 right-0 pb-[max(0px,env(safe-area-inset-bottom))] pt-0` (remove `px-4` so bar is flush to screen edges).
- Inner row currently: `flex gap-3`
  → change to: `flex gap-0`.
- Reorder-mode "Done" button keeps its current sizing (only the 3-button row changes), but will also become `h-28` and lose rounded corners to match.

### 2. Button sizing — double height, remove rounded corners (so flush buttons look like one bar)
- Actions button: `flex-1 h-14 rounded-2xl ...` → `flex-1 h-28 rounded-none ...`
- Home button: `w-16 h-14 rounded-2xl ...` → `w-20 h-28 rounded-none ...` (slightly wider to fit the emoji comfortably at the larger height)
- Check button: `flex-1 h-14 rounded-2xl ...` → `flex-1 h-28 rounded-none ...`
- Increase the check icon from `h-6 w-6` → `h-8 w-8` so it scales with the bigger button.

### 3. Button colors
Use Tailwind utility classes overriding the default primary background:
- **Actions** → `bg-orange-700 hover:bg-orange-700/90 text-white` (darker orange, not bright).
- **🏠 Home** → no color override; keeps the existing blue primary background.
- **Check** → `bg-green-600 hover:bg-green-600/90 text-white`.

These colors render identically in light and dark mode and are accessible against white icons/text.

## Out of scope
- No changes to button behavior, long-press handlers, routing, or the Actions sheet contents.
- No changes to the floating shadow (`shadow-floating` is kept so the bar still lifts off the content).
- No changes to the home page or other routes.
