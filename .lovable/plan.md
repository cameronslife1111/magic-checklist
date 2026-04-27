# Fix: Speech stops working after using microphone dictation

## Symptom
After tapping the mic/keyboard dictation in an item textarea, the app stops speaking even though it's "unmuted." The only thing that revives it is toggling Mute → Unmute (or refreshing).

## First-principles analysis

The Web Speech API has three failure modes that all apply here:

1. **Audio-route hijack** — On iOS/Android, dictation grabs the microphone audio session. When it releases, `speechSynthesis` is left in a state where `speak()` is accepted (no error) but no audio comes out.
2. **Lost user-gesture activation** — `speak()` works the first time because it's inside a tap. After dictation completes via `onBlur` (which is *not* a fresh user gesture on mobile keyboards), the activation token is gone.
3. **"Primed" flag drift** — `src/lib/speech.ts` keeps a module-level `primed` boolean. Once true, `speak()` skips re-priming. But after dictation, the engine is effectively un-primed even though the flag still says `true`.

### Why the Mute → Unmute toggle "fixes" it
Looking at `setMuted(v)` (speech.ts:229):
- On mute: `cancel()` + `stopHeartbeat()`
- On unmute: sets `primed = false`

Then the user taps Unmute (a real gesture), which fires the global `pointerup` → `notifyUserGesture()` → `primeSpeech()` inside a *fresh* gesture. That's the only path in the code that reliably re-arms the engine after dictation.

### Why the existing "fix" doesn't work
`notifyDictationEnd()` runs inside `onBlur`, which on mobile is *not* a user gesture. So `resetEngine()` + `nudgeAudioRoute()` + `primeSpeech()` all run, but the subsequent `speak()` has no gesture activation. The `installGestureRearm` listener *should* catch the next tap and re-prime — but:
- `notifyUserGesture()` early-returns if `primed === true`
- `notifyDictationEnd()` already set `primed = true` synthetically
- So the next real tap does nothing, and `speak()` runs against a dead engine

That's the bug.

## Fix

Three small, surgical changes in `src/lib/speech.ts`:

### 1. Track a "needs re-arm" flag separate from `primed`
Add `needsRearm = false`. Set it `true` in `notifyDictationEnd()` (and don't optimistically prime there — priming outside a gesture is what creates the false-positive `primed` state).

### 2. Make `notifyUserGesture()` honor the re-arm flag
```ts
export function notifyUserGesture() {
  if (muted) return;
  if (needsRearm) {
    resetEngine();          // hard reset, clears primed
    nudgeAudioRoute();      // iOS audio route nudge
    primeSpeech();          // now inside a real gesture
    needsRearm = false;
    return;
  }
  if (!primed) primeSpeech();
}
```

### 3. Make `speak()` defensive when `needsRearm` is set
If `speak()` is called while `needsRearm` is still true (e.g., user taps a checkbox that triggers speech in the same handler chain), fall through to a hard reset + prime + a small `setTimeout` before speaking, since `cancel()`-then-`speak()` synchronously is the known zombie trigger (already documented in the file).

### 4. Drop the in-blur `primeSpeech()` call
Remove the optimistic `primeSpeech()` from `notifyDictationEnd()`. It's the line that sets `primed = true` while the engine is actually dead, defeating the gesture re-arm path.

## Files changed
- `src/lib/speech.ts` — the four edits above. No other files touched.

## Why this has the highest probability of working
- It mirrors exactly what the **Mute → Unmute** workaround does (which the user confirmed works), but triggers it automatically on the next real tap instead of requiring the toggle.
- It does **not** try to speak from `onBlur` (which is fundamentally not a gesture on mobile) — it defers re-arm to the next real `pointerup`/`touchend`, which `installGestureRearm` already captures.
- It keeps all the existing Chrome-15s heartbeat, iOS audio-route nudge, and chunking logic intact.
- Zero changes to UI, components, or call sites.

## Risk / regressions
- After dictation, the *first* `speak()` triggered programmatically (without any tap in between) will still be silent — but in this app every speak is downstream of a user tap (toggle, check, open item), so the next tap will re-arm before/at the moment speech is requested.
- No change to the muted persistence or the existing `setMuted` behavior.