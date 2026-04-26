## Stop speech on Actions sheet open + reorder items

### 1. Stop active speech when Actions sheet opens
**File:** `src/pages/Checklist.tsx`
- Import `stopSpeech` from `@/lib/speech`.
- Wrap the trigger at line 946 and the `onOpenChange` on line 1044 so that whenever the sheet transitions to **open**, we call `stopSpeech()`. This cancels the currently speaking utterance immediately but does NOT mute — `stopSpeech()` only calls `synth.cancel()` and clears the heartbeat without touching the `muted` flag, so subsequent speech (after closing the sheet, tapping a new item, etc.) works normally.

### 2. Reorder items in the Actions sheet
**File:** `src/components/ActionsSheet.tsx`
- Today the rendered order is `[muteItem, ...STATIC_ITEMS, themeItem, signOutItem]`, with `STATIC_ITEMS` starting Split → Send to checklist → Send to blank → Action Queue Dashboard → Rearrange…
- New top-of-sheet order:
  1. **Send to checklist** (`send-to`)
  2. **Action Queue Dashboard** (`queue`)
  3. **Mute / Unmute speech** (`mute`)
  4. Then everything else in current order: Split, Send to blank checklist, Rearrange, Copy sentence, Copy full checklist, Insert link, Add, Duplicate item, Media Gallery, Change background, the AI block (Text→Text, Text→Image, Image→Image, Remix, Image→Video, Video→Video, Analyze image, Web search), Edit title, New checklist, Duplicate checklist, Delete checklist, Theme toggle, Sign out.
- Implementation: remove the `send-to` and `queue` entries from `STATIC_ITEMS`, define `sendToItem` and `queueItem` as constants beside `muteItem` inside the component, then assemble `items = [sendToItem, queueItem, muteItem, ...STATIC_ITEMS, themeItem, signOutItem]`. Existing AI blue styling, icons, and click handling are unchanged.

No other files, no DB, no backend changes.