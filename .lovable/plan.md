
## What you're seeing

Two reproducible failures:

1. **Leave the app and come back** → speech is silent until you Mute → Unmute.
2. **Tap the keyboard mic (dictation)** → speech is silent until you Mute → Unmute.

Mute → Unmute always fixes it because internally it sets `primed = false` and the next button tap re-primes the engine inside a real user gesture. That's the only path that reliably works today, so the fix is to **route every recovery scenario through that same exact path automatically.**

## First-principles diagnosis

The Web Speech API on iOS Safari and Android Chrome has three hard rules the current code violates:

1. **`speak()` must be called inside, or shortly after, a real user gesture (tap/pointerup).** A React `onChange` from a Radix Checkbox is async — the gesture activation can already be expired by the time `speak()` runs.
2. **Any browser audio-session change (backgrounding the tab, OS dictation taking the mic, switching apps) silently kills queued utterances** but leaves `speechSynthesis.speaking === false` and `.paused === false`. There is no error event. The engine looks fine but produces no sound.
3. **Once you "prime" the engine, that prime is invalidated by ANY of the events in #2** — but the current `primed` boolean is never cleared on backgrounding or dictation-end (only on mute toggle).

Concrete bugs in the current code:

- **`primed` never invalidates on `visibilitychange`.** When you return to the app, `primed === true`, so `notifyUserGesture()` skips re-priming. The next `speak()` queues into a dead engine. → Failure #1.
- **`notifyDictationStart()` runs on every textarea `onFocus`** and calls `resetEngine()` which `cancel()`s any current speech. Just tapping a row to edit kills speech. Worse, focus does NOT reliably fire when the user taps the keyboard mic button (the textarea is already focused), so `notifyDictationEnd` may never fire either.
- **`needsRearm` is only set in `notifyDictationEnd`**, which only runs on blur AND only when `dictatingRef` was flipped by an `onInput` heuristic. On Android Chrome, dictation often inserts via composition events with non-null `data` — the heuristic misses it, `needsRearm` stays false, and the next `speak()` goes through the "idle path" into a dead engine. → Failure #2.
- **The "idle path" in `speak()` trusts `primed`.** If `primed` is true but the engine is actually dead (post-background, post-dictation-we-missed), nothing speaks.
- **`primeSpeech()` after dictation is called from inside the deferred `speak()` (60ms setTimeout), not from a user gesture.** iOS rejects this silently.

## The fix (highest-probability solution)

**One principle: treat the speech engine as untrusted. Re-prime on every fresh user gesture if anything has happened since the last successful utterance.**

### Changes to `src/lib/speech.ts`

1. **Replace the `primed` boolean with a "trust token" pattern.** Add a single `engineDirty` flag that becomes `true` on ANY of:
   - `visibilitychange` → hidden, OR → visible (always invalidate on resume)
   - `pagehide` / `pageshow` (iOS Safari fires these instead of visibility on some app switches)
   - `notifyDictationEnd`
   - any `SpeechSynthesisUtterance.onerror`
   - 30 seconds of idle since last successful `onend` (engines time out)
   - route change (called from a small hook in `App.tsx`)
   
   When `engineDirty === true`, the next `speak()` and the next user-gesture handler both perform a hard `resetEngine()` + `nudgeAudioRoute()` + `primeSpeech()` — exactly what Mute → Unmute does today.

2. **Make every `speak()` self-healing inside the calling gesture.** Instead of deferring to a `setTimeout` (which leaves the gesture context), do this synchronously:
   - If `engineDirty`: `resetEngine()` → `primeSpeech()` → `s.speak(utterance)` all in the same tick. This works because `handleToggle`, the auto-speak effect, etc. are all reached from a real tap, and the call chain is synchronous up to the first `speak()`.
   - Drop the 60ms `setTimeout` recovery entirely. It moves execution out of the gesture window and is the reason iOS still drops the first utterance after dictation.

3. **Stop killing speech on textarea focus.** Remove `notifyDictationStart()` from `onFocus`. Focus is not dictation. Only call `notifyDictationEnd()` on blur if dictation was actually detected. This stops the "tap a row → speech cuts out" side effect.

4. **Detect dictation more reliably.** Use a broader heuristic in `onInput`:
   - `inputType === "insertFromDictation"` (iOS), OR
   - `inputType === "insertCompositionText"` (Android Chrome dictation), OR
   - any `insertText` where `data` is null OR longer than 1 character AND inserted in <50ms since the previous insert.
   Track in `dictatingRef`. Also set `engineDirty = true` the moment dictation is detected (don't wait for blur), so even if blur is missed, the next gesture re-primes.

5. **Strengthen `installGestureRearm`.** On every `pointerup`/`touchend`/`click`:
   - If `engineDirty`: do the full `resetEngine()` → `nudgeAudioRoute()` → `primeSpeech()` cycle synchronously inside the gesture handler (this is the key — same as Mute→Unmute).
   - Clear `engineDirty` only after `primeSpeech()` succeeds.

6. **Add `pagehide` / `pageshow` listeners** in addition to `visibilitychange`. iOS Safari does not always fire `visibilitychange` when you switch apps via the home indicator; `pageshow` is the reliable signal.

7. **Add a watchdog**: when `speak()` queues an utterance, start a 1.5s timer; if `onstart` never fires, mark `engineDirty = true` so the *next* gesture self-heals. Today, a dropped utterance leaves no trace.

### Change to `src/components/ItemRow.tsx`

- Remove `notifyDictationStart()` from `onFocus`.
- Keep `notifyDictationEnd()` on blur, but also call it (idempotently) the moment dictation is detected in `onInput`, via the new `engineDirty` flag.

### Change to `src/App.tsx` (or `src/main.tsx`)

- Add a tiny `useEffect` (or vanilla listener in `main.tsx`) that calls a new `speech.notifyRouteChange()` on every `popstate`/route change. Route changes break the audio session on iOS the same way backgrounding does.

## Why this has the highest probability of success

The Mute → Unmute path **already works 100% of the time** in your app. This plan does exactly two things:

1. Detects every situation where the engine becomes untrusted (background, dictation, route change, dropped utterance, idle timeout).
2. Runs the exact same Mute → Unmute recovery sequence automatically inside the very next user gesture.

Nothing in this plan invents new speech APIs or fights the browser. It just makes the recovery you already have run automatically instead of requiring a manual toggle.

## Files to be edited

- `src/lib/speech.ts` — the core rewrite
- `src/components/ItemRow.tsx` — remove `onFocus` reset, broaden dictation detection
- `src/App.tsx` — add route-change notifier (one `useEffect`)
- `src/main.tsx` — already calls `installGestureRearm()`; no change needed

No backend, database, or edge function changes. No new dependencies.
