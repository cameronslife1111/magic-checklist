## Goal
Move all toast notifications to the **top-center** of the screen, position them **below the search bar so they appear over the checklist title**, and make them **auto-dismiss after 1 second**.

## Context
The app uses Sonner (`import { toast } from "sonner"`) for all notifications — verified in `src/pages/Checklist.tsx`. The legacy `useToast` / `Toaster` components exist but aren't actively triggered anywhere in app code, so we'll only configure Sonner.

The search bar sits at the very top of the page. The checklist title (`<h1>`) is just below it. We need toasts to appear in that title region — not at the very top covering the search bar, and not at the bottom.

## Changes

### `src/components/ui/sonner.tsx`
Add three props to the `<Sonner />` component:
- `position="top-center"` — show toasts at the top-center of the viewport
- `duration={1000}` — auto-dismiss after 1 second
- `offset="64px"` — push toasts down so they sit over the title area instead of overlapping the search bar (search bar is ~56–60px tall; 64px offset clears it)

No other files need to change. Sonner is already mounted globally in `src/App.tsx` via `<Sonner />`, so this update applies app-wide.

## Out of scope
- The legacy `toast.tsx` / `toaster.tsx` components are untouched (per your earlier preference). They aren't triggered anywhere in app code.
- If the 64px offset doesn't perfectly clear the search bar on your device, we can fine-tune it after you see the result.