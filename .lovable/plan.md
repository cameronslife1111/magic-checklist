## Goal

When the user clicks/taps the checkbox text area to start typing or editing, immediately stop any in-progress speech. Speech still works normally afterwards (next check, next item, etc.).

## Change

Single file: `src/components/ItemRow.tsx`.

1. Import `stopSpeech` (already exported by `@/lib/speech`):
   ```ts
   import { notifyDictationDetected, notifyDictationEnd, stopSpeech } from "@/lib/speech";
   ```

2. On the editable `<textarea>`, call `stopSpeech()` on both `onPointerDown` and `onFocus`:
   - `onPointerDown` fires on tap (mobile) and mouse-down (desktop) before focus, so speech cuts the instant the user touches the field.
   - `onFocus` is the fallback for keyboard navigation (Tab) and any case where pointerdown didn't fire.

   ```tsx
   onPointerDown={() => { stopSpeech(); }}
   onFocus={() => { dictatingRef.current = false; stopSpeech(); }}
   ```

That's it — no other files change. The link/internal-link variants of the row aren't editable, so they're left alone.

## Why this is safe

- `stopSpeech()` already exists and just calls `synth.cancel()` — it doesn't disable speech, so subsequent `speak()` calls (auto-scroll, check next item, long-press read) all work as before.
- We don't touch the `Checkbox` toggle path, so checking an item still triggers its scroll + speak as today.
- Works identically on mobile and desktop because `pointerdown` is a unified event.
