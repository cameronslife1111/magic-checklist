## Why downloads feel slow (first-principles)

**Single image/video download (MediaViewer):**
The current code does `fetch(url) → response.blob() → URL.createObjectURL → <a download> click`. That means the browser must pull the *entire* file into JS memory before the save dialog can appear. For a 50 MB video on a phone, that's ~30–60s of "nothing happening" before the OS save sheet shows up. There's no progress indicator either, so it feels frozen.

The only reason to do the fetch+blob dance is to control the saved filename. The plain `<a download="name.mp4" href={url}>` attribute is *ignored* when the file is on a different origin (Supabase Storage is a different host than the app), which is why we currently work around it.

**The fix:** Supabase Storage supports a `?download=<filename>` query parameter on public URLs. When present, Storage returns `Content-Disposition: attachment; filename="<name>"` — the browser streams the file straight to disk with the correct name, no JS buffering, no memory copy, dialog opens instantly. This is the same trick the Supabase docs recommend.

**"Download all media":**
Three compounding problems:
1. We `await fetch(...).blob()` for every asset, holding *every* file fully in RAM at once.
2. JSZip then builds the entire archive in memory and only emits the final blob at the end. On a gallery with a few large videos this can be hundreds of MB.
3. `Promise.all` starts every fetch simultaneously — on mobile this saturates the connection and many requests stall.

**The fix:** swap JSZip for `client-zip`, which produces a streaming `Response` whose body is a `ReadableStream`. Fetches are pulled lazily as the zip is read, memory stays flat, and the download starts almost immediately. Combine that with a small concurrency limiter (e.g., 4 parallel fetches) so the network isn't choked.

## Changes

**1. `src/lib/mediaAssets.ts`**
- Add helper `buildDownloadUrl(asset)`:
  - Computes the desired filename (existing `sanitize` + `extFor` logic, ensuring an extension).
  - Returns `${asset.url}?download=${encodeURIComponent(filename)}`.
- Replace `downloadAllMediaAsZip` with a streaming version:
  - Filter to image/video as today.
  - Resolve unique filenames up-front (same de-dup logic).
  - Use `client-zip`'s `downloadZip(asyncIterable)` to produce a streaming `Response`.
  - The async iterable yields `{ name, input: fetch(url) }` with a concurrency cap of 4 (simple semaphore — no extra dep).
  - Pipe `response.body` into a download via `URL.createObjectURL(await response.blob())` *only* if streaming-to-disk via the File System Access API isn't available. (For browsers that support `showSaveFilePicker`, pipe the stream directly so memory stays flat; otherwise fall back to blob — still faster than JSZip because client-zip doesn't buffer intermediate state.)
  - Keep the `media-gallery-YYYY-MM-DD.zip` filename and the returned count.

**2. `src/components/MediaViewer.tsx`**
- Delete the `fetch → blob → object URL` path.
- Replace with a direct anchor: `<a href={buildDownloadUrl(...)} download>` (the `download` attribute is now redundant since Storage sets `Content-Disposition`, but harmless and helps the same-origin case).
- Keep the visible Download button; on click, just programmatically click that anchor. The OS save dialog appears immediately and the file streams in the background.
- Needs `mime_type` to pick the extension. The viewer currently only receives `url` + `type`. Easiest: also pass `title` and `mime_type` (or the whole asset) from the gallery page so we can build the proper filename. Update `MediaViewer` props and the one caller in `MediaGallery.tsx`.

**3. `src/components/MediaGalleryPicker.tsx` / other viewer callers** — update only if they pass to `MediaViewer`; otherwise no change. Will verify during implementation.

**4. Dependency**
- `bun add client-zip` (tiny, no deps, ESM, browser-native streams).
- Leave `jszip` installed for now; remove only after confirming nothing else imports it.

## Expected result

- Single image/video: save dialog appears in <200 ms regardless of file size; the browser streams to disk natively.
- "Download all": zip starts downloading within ~1 second, memory usage stays low, total time is bounded by network throughput rather than `JS heap` allocation. On mobile this is the difference between "instant" and "spinner for a minute."

## Out of scope
No backend/queue changes. Edge functions and DB are not in this path — bottleneck is purely client-side. If gallery sizes ever grow into the multi-GB range we can revisit a server-built zip, but it's unnecessary now.