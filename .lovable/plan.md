## Increase scroll-margin-top so previous (checked) item peeks above the highlight

Bump the `scrollMarginTop` in `src/pages/Checklist.tsx` from `120px` to `180px` at both scroll sites (lines 256 and 264).

This adds ~60px of extra space above the highlighted item, enough to show a sliver of the previous checked-off step without pushing the highlight down too far.

```ts
el.style.scrollMarginTop = "180px";
```

No other changes.
