# Make Web Speech reliable (recover from stuck state)

## Problem

`window.speechSynthesis` periodically gets stuck (especially on Chrome and Safari) and stops speaking until the user refreshes the page. The current `src/lib/speech.ts` does not protect against the well-known browser bugs that cause this:

1. **Chrome's ~15-second stall bug** — utterances longer than ~15 seconds, or rapid `cancel()` → `speak()` sequences, leave the engine in a `speaking + paused` zombie state. Subsequent `speak()` calls queue forever and never play.
2. **`cancel()` immediately followed by `speak()`** in the same tick (which `speak()` does today) is a known trigger of the zombie state on Safari/iOS and some Chrome versions.
3. **Tab visibility changes** — backgrounding the tab can leave synthesis paused on return.
4. **No recovery path** — once stuck, nothing in the app nudges the engine back; only a full page refresh works.
5. **`primeSpeech` is one-shot** — even after `setMuted(true)` then `setMuted(false)`, or after a stall, the engine is never re-primed.

## Fix — rewrite `src/lib/speech.ts` with proven workarounds

All changes are localized to `src/lib/speech.ts`. The exported API (`speak`, `stopSpeech`, `primeSpeech`, `isMuted`, `setMuted`) stays identical — no callers need to change.

### Changes

1. **Defer `speak()` after `cancel()`** — when there is something currently speaking/queued, call `cancel()` and schedule the new `speak()` via `setTimeout(..., 50)` instead of running both synchronously. This avoids the Safari/Chrome zombie state. When idle, speak immediately so user-gesture context is preserved.

2. **Keep-alive heartbeat while speaking** — start a `setInterval` (every 10 s) that runs `speechSynthesis.pause(); speechSynthesis.resume();` whenever an utterance is active. This is the standard workaround for the Chrome 15-second stall. Stop the interval on `utterance.onend` / `onerror` and when nothing is queued.

3. **Auto-recover stuck engine before each `speak()`** — at the top of `speak()`, detect the zombie state (`speechSynthesis.speaking && speechSynthesis.paused`) and call `resume()` then `cancel()` to reset, before queueing the new utterance.

4. **Visibility handler** — add a single `document.visibilitychange` listener that, on `visible`, calls `resume()` if synthesis is paused-but-speaking. Registered once at module load.

5. **Re-prime on demand** — change `primeSpeech` so it can re-prime after `setMuted(true) → setMuted(false)`, and after a recovered stall (clear `primed` when we detect/clear a zombie state).

6. **`utterance.onerror` handler** — log to console and clear the heartbeat so a single failed utterance doesn't poison subsequent ones.

7. **Chunk long text (safety net)** — split text >180 chars on sentence boundaries and queue sequential utterances. Keeps each utterance well under the 15-second threshold so the stall rarely triggers in the first place.

### Files touched
- `src/lib/speech.ts` (rewrite, same exported API)

### Files NOT touched
- `src/pages/Checklist.tsx`, `src/components/ItemRow.tsx`, `src/pages/ActionQueue.tsx` — they keep calling `speak`/`stopSpeech`/`primeSpeech` exactly as today.

## Expected result

Speech keeps working indefinitely without page refreshes — through long sessions, long items, tab switches, and rapid checkbox toggling. If the engine ever does enter the zombie state, the next `speak()` call automatically recovers it instead of silently failing.