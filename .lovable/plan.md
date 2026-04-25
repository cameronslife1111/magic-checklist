## Goal
When the user navigates to the Action Queue Dashboard (`/queue`), immediately stop any in-progress web speech (TTS) so it doesn't keep talking over the dashboard.

## Change
**File: `src/pages/ActionQueue.tsx`**
- Import `stopSpeech` from `@/lib/speech`.
- Add a `useEffect` (runs once on mount) that calls `stopSpeech()` to cancel any active `speechSynthesis` utterance the moment the dashboard mounts.

That's the entire change — minimal, isolated, and uses the existing `stopSpeech()` helper already used elsewhere (e.g. `ItemRow.tsx`). No other files, no backend changes.
