## Problem

When you press **Copy sentence** and paste, the result looks like:

```
caption:%20POV%3A%20your%20coworker%20tries%20you...
```

instead of:

```
caption: POV: your coworker tries you...
```

The `%20`, `%3A`, `%E2%80%99` etc. are URL-encoded characters (space, colon, curly apostrophe). The copy button itself works — it's faithfully copying what's stored on that checkbox. The stored text for that sentence is in URL-encoded form (likely from a share/paste path that encoded it once).

The fix is to make **Copy sentence** smart: if the text it's about to copy looks URL-encoded, decode it back into normal readable text before putting it on the clipboard.

## What will change

Only one place — the `copy-sentence` handler in `src/pages/Checklist.tsx`.

Behavior:
1. Take the sentence text as it is today.
2. Detect if it contains URL-encoded sequences (any `%` followed by two hex digits, e.g. `%20`, `%3A`, `%E2%80%99`).
3. If yes, run it through `decodeURIComponent` to convert it back to readable text. If decoding fails (malformed `%` sequences in normal text), fall back to the original text — no crash, no change in behavior.
4. Write the cleaned text to the clipboard.
5. **Copy full checklist** will get the same treatment per-line, so the same fix applies if other rows are encoded too.

Nothing else changes — the database is left alone, the displayed text in the checkbox is left alone, and other actions (Send to top/bottom, Delete, Send to checklist, etc.) are untouched.

### Technical detail

Helper added near the top of `Checklist.tsx`:

```ts
const decodeIfEncoded = (s: string) => {
  if (!/%[0-9A-Fa-f]{2}/.test(s)) return s;
  try { return decodeURIComponent(s); } catch { return s; }
};
```

Then in the `copy-sentence` case: `await navigator.clipboard.writeText(decodeIfEncoded(text));`
And in the `copy-checklist` case, map each line through `decodeIfEncoded` before joining.

## Note on the stored data

This fixes the **paste experience**, which is what you actually care about. The underlying checkbox text in the database stays URL-encoded for now — if you also want the on-screen text in the checklist to read normally (no `%20`), that's a separate one-time cleanup we can do as a follow-up. Just say the word.
