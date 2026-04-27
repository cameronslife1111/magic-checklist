# Make the bottom 3 buttons feel premium & alive

Goal: Keep the same colors (orange / blue / green), same sizes, same edge-to-edge layout — but make them look glossy, metallic, and slightly animated instead of flat.

## Visual direction
Each button gets:
1. **Diagonal metallic gradient** — darker at the bottom, lighter at the top, in its own color family. Looks like brushed/polished metal.
2. **Inner highlight** — a subtle bright sheen across the top edge (inset white shadow) and a soft dark inner shadow at the bottom for depth.
3. **Animated sparkle/shimmer** — a faint diagonal light streak that slowly sweeps across each button every few seconds, giving an "alive / shiny" feel without being distracting.
4. **Press feedback** — when tapped, the button slightly darkens and the sheen dims, so it feels physical.

Colors stay the same: Actions = orange family, Home = blue family, Check = green family.

## Technical changes

### 1. `src/index.css` — add gradient + shimmer utilities
Add three new utility classes inside `@layer utilities`:

- `.btn-metallic-orange`, `.btn-metallic-blue`, `.btn-metallic-green`
  - Each sets `background-image: linear-gradient(to bottom, <lighter hsl>, <base hsl>, <darker hsl>)` using the existing `--action-orange`, `--primary`, `--action-green` tokens (with `calc()` lightness shifts so light/dark mode both work).
  - Each adds layered `box-shadow`:
    - `inset 0 1px 0 hsl(0 0% 100% / 0.35)` — top sheen
    - `inset 0 -2px 6px hsl(0 0% 0% / 0.2)` — bottom depth
    - keeps the existing `shadow-floating` outer drop shadow
  - `:active` state: shifts gradient darker and removes the top sheen to feel pressed.

- `.btn-shimmer` — a shared class that adds a `::before` pseudo-element:
  - Absolutely positioned diagonal white gradient stripe (`linear-gradient(115deg, transparent 40%, rgba(255,255,255,0.25) 50%, transparent 60%)`), 50% width, full height.
  - Animated with a new `@keyframes shimmer` that translates it from `-120%` to `220%` over ~4.5s, infinite, with a long pause between sweeps (using a non-linear timing or a 0–30% active / 30–100% offscreen keyframe split).
  - Container needs `position: relative; overflow: hidden;` (already implied by the button, but we'll set explicitly in the utility).
  - `pointer-events: none` on the pseudo-element so it doesn't block taps.

- Stagger: give each button a slightly different `animation-delay` (0s / 1.5s / 3s) so the three buttons don't shimmer in unison — feels more organic.

### 2. `src/pages/Checklist.tsx` — apply the new classes
On lines ~1136–1242, swap the flat color classes for the new metallic + shimmer ones (no structural changes):

- Actions button (line 1176):
  `bg-action-orange ... hover:bg-action-orange/90` → `btn-metallic-orange btn-shimmer`
- Home button (line 1195): add `btn-metallic-blue btn-shimmer` (alongside existing classes; default primary bg is overridden by the gradient).
- Check button (line 1238):
  `bg-action-green ... hover:bg-action-green/90` → `btn-metallic-green btn-shimmer`
- Reorder-mode "Done" button (line 1131): also gets `btn-metallic-blue btn-shimmer` so it matches the look.
- Add a per-button `style={{ animationDelay: "0s" | "1.5s" | "3s" }}` (or a small CSS variable) for the shimmer stagger.

### 3. Accessibility
Wrap the shimmer keyframes in `@media (prefers-reduced-motion: reduce)` and disable the animation for users who opt out — the metallic gradient and sheen still render, just no sweeping highlight.

## Out of scope
- No layout, sizing, color-family, routing, or behavior changes.
- No changes to other buttons in the app.
- No new dependencies.
