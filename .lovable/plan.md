# Fix Media Viewer download UX on iOS

Three small problems are stacked on top of each other in `src/components/MediaViewer.tsx` and `src/lib/mediaAssets.ts`. Fix them together.

## Problems

1. **Video autoplays the moment the viewer opens.** `<video autoPlay>` is hardcoded, so tapping a video instantly starts playback — distracting and burns mobile data.
2. **Download dialog flashes and disappears.** Inside `triggerDirectDownload`, on iOS we both click an anchor *and* run `window.location.href = blobUrl` 100ms later. That second navigation tears down the current page context, which is what's making the iOS share/save sheet flash away. We should pick one path on iOS, not both.
3. **"Download" on iOS doesn't go straight to Photos.** iOS only offers "Save to Photos" when the file is presented through the native share sheet (`navigator.share` with a `File`) or when the user long-presses a video element. A plain anchor download lands the file in **Files**, not Photos.

## Plan

### 1. Stop autoplay in `src/components/MediaViewer.tsx`
- Remove `autoPlay` from the `<video>` and `<audio>` tags.
- Keep `controls` so the user taps play themselves.

### 2. Fix the flashing download in `src/lib/mediaAssets.ts` (`triggerDirectDownload`)
- On iOS, **do not** click the hidden anchor and then also navigate `window.location.href`. Pick one:
  - Preferred: use `navigator.share({ files: [new File([blob], filename, { type: mime })] })` when `navigator.canShare?.({ files })` returns true. This opens the native iOS share sheet with **Save Video / Save Image** options that route into Photos.
  - Fallback (older iOS or canShare false): open the blob URL in a new tab via `window.open(blobUrl, "_blank")` only — no anchor click, no `location.href` reassignment. The user long-presses to save.
- On non-iOS, keep the current anchor + `download` attribute path (works on desktop Chrome, Android Chrome).
- Remove the `setTimeout` that reassigns `window.location.href` — that's the source of the "dialog disappears in a split second."

### 3. Wire the share-sheet path through `MediaViewer`
- No API change needed; `triggerDirectDownload` already receives the asset. The branching lives entirely inside that helper.
- Toast copy on the share fallback should say: *"Choose 'Save Video' (or 'Save Image') to add it to Photos."*

## Technical notes

- `navigator.share` with files is supported on iOS Safari 15+ and Android Chrome. Feature-detect with `typeof navigator !== "undefined" && navigator.canShare && navigator.canShare({ files: [testFile] })`.
- Keep the existing `fetch` → `blob` step; we need the blob either way (for `File` construction or for the same-origin object URL).
- Desktop browsers will skip the share branch (no `canShare` for files) and fall through to the existing anchor-download path, so desktop behavior is unchanged.
- No backend, schema, or other UI changes.

## Files touched

- `src/components/MediaViewer.tsx` — drop `autoPlay` on `<video>` / `<audio>`.
- `src/lib/mediaAssets.ts` — rework the iOS branch of `triggerDirectDownload` to use `navigator.share` when possible, remove the `window.location.href` reassignment.
