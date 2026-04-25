
# Add Mute toggle for Web Speech + auto-stop on typing

## 1. `src/lib/speech.ts` — Add a global "muted" gate
- Add module-level `let muted = false`.
- Export `isMuted()`, `setMuted(v: boolean)`.
- In `speak()`: early return if `muted` is true.
- In `setMuted(true)`: also call `window.speechSynthesis.cancel()` so any in-flight utterance stops immediately.
- Persist mute preference to `localStorage` (`speech-muted`) and read on module load so it survives reloads.

## 2. `src/components/ActionsSheet.tsx` — Add Mute item at the very top
- Add new `ActionKey` value: `"mute"`.
- Accept new prop `muted: boolean`.
- Build the item dynamically:
  - If `muted` → label "Unmute speech", icon `Volume2`.
  - If `!muted` → label "Mute speech", icon `VolumeX`.
- Prepend this item to `items` so it is the first row in the sheet (above "Add new checkbox").

## 3. `src/pages/Checklist.tsx` — Wire it up
- Import `isMuted`, `setMuted` from `@/lib/speech`.
- Add `const [muted, setMutedState] = useState(isMuted())`.
- Pass `muted={muted}` to `<ActionsSheet />`.
- In the actions `onPick` switch, handle `"mute"`:
  - `const next = !muted; setMuted(next); setMutedState(next);` then close the sheet and toast "Speech muted" / "Speech unmuted".

## 4. Auto-stop speech when user starts typing in a checkbox
- In `src/components/ItemRow.tsx`, add `onFocus={() => stopSpeech()}` to the `<textarea>` (import `stopSpeech` from `@/lib/speech`).
- This stops only the current utterance — it does NOT toggle the mute state, so subsequent navigation will speak again unless the user has explicitly muted.

## Notes
- `speak()` callers across the file (`handleToggle`, auto-focus effect, generation flows) need no changes — the mute check is centralized in `speak()`.
- Long-press "add new checkbox" focuses the new textarea via `autoFocus`, which will also trigger the new `onFocus` → `stopSpeech()`, matching the requested behavior automatically.
