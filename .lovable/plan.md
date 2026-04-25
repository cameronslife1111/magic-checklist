## Goal
Reorganize the Actions pop-up (`src/components/ActionsSheet.tsx`) so frequently used actions sit on top and rarely used / destructive ones move to the bottom. Also visually distinguish AI-powered actions by coloring their icon + label blue.

## 1. New button order

I'll reorder the `STATIC_ITEMS` array. The mute toggle stays pinned at the very top and the theme + sign-out items stay pinned at the very bottom (these are dynamic and already handled separately).

**Top (most-used / quick utilities):**
1. Copy sentence
2. Copy full checklist
3. Rearrange checkboxes
4. Insert checklist link
5. Add new checkbox
6. Duplicate checkbox
7. Split current checkbox
8. Send to checklist
9. Action Queue Dashboard
10. Change checklist background

**Middle (AI actions — these get the blue treatment):**
11. Text to text
12. Text to image
13. Image to image
14. Remix multiple images
15. Image to video
16. Video to video
17. Analyze image
18. Text to web search

**Bottom (rare / destructive):**
19. Edit checklist title
20. New checklist
21. Duplicate checklist
22. Delete checklist

Then the existing dynamic items append after `STATIC_ITEMS`: theme toggle, sign out.

## 2. Blue styling for AI actions

Define a set of AI keys:
```ts
const AI_KEYS = new Set<ActionKey>([
  "text-text", "text-image", "image-image", "remix",
  "image-video", "video-video", "analyze-image", "web-search",
]);
```

In the render loop, when `AI_KEYS.has(it.key)`:
- Apply `text-blue-500` to the `<Button>` (overriding default foreground) and a hover variant like `hover:text-blue-500` so it stays blue on hover.
- Apply `text-blue-500` to the `<Icon>` (overriding the current `text-muted-foreground`).

Non-AI items keep their current styling (icon = `text-muted-foreground`, label = default).

Using `text-blue-500` (Tailwind built-in) keeps it consistent in both light and dark modes without needing new design tokens. No other files change.

## 3. Files touched
- `src/components/ActionsSheet.tsx` — reorder `STATIC_ITEMS`, add `AI_KEYS` set, conditionally apply blue classes in the map.

No backend, routing, or behavior changes — purely presentational.