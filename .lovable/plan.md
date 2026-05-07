## Add "Download all media" action

Add a new action sheet button that downloads every image and video from the user's Media Gallery as a single zip file, preserving each asset's gallery title (with correct extension) as the filename inside the zip.

### Changes

**1. `src/components/ActionsSheet.tsx`**
- Add new `ActionKey` value: `"download-all-media"`.
- Add a new entry to `STATIC_ITEMS` near the other Media Gallery action, labeled **"Download all media"** with the `Download` icon (from lucide-react).

**2. `src/lib/mediaAssets.ts`**
- Add helper `downloadAllMediaAsZip(userId)`:
  - Calls `listMediaAssets(userId)` and filters to `kind === "image" || kind === "video"`.
  - For each asset: `fetch(asset.url)` → `blob()`.
  - Compute filename: start from `asset.title`; if it has no extension, derive one from `mime_type` (or fall back to a sensible default by `kind`: `.png` for image, `.mp4` for video). Sanitize illegal filesystem chars (`/ \ : * ? " < > |`) to `_`.
  - De-duplicate names within the zip by appending ` (2)`, ` (3)`, etc. before the extension so two assets with the same title don't collide.
  - Use `jszip` to build the archive, then trigger a download via a temporary `<a>` link with `URL.createObjectURL(blob)`. Filename: `media-gallery-YYYY-MM-DD.zip`.

**3. `src/pages/Checklist.tsx`**
- In the `onPick` switch, add a `case "download-all-media":` that:
  - Shows a `toast.loading("Preparing zip…")`.
  - Calls `downloadAllMediaAsZip(user.id)`.
  - On success: `toast.success("Downloaded N files.")`. On empty gallery: `toast.error("No media to download.")`. On failure: `toast.error("Download failed. Try again.")`.

**4. Dependency**
- Add `jszip` via `bun add jszip` (small, browser-friendly, no native deps).

### Notes
- All downloads happen client-side; `media_assets.url` is in a public bucket so no signed URL needed.
- Large galleries: zip is built in memory. Acceptable for typical use; if it ever needs streaming we can revisit with `client-zip`.
- Filenames preserve the user's gallery titles exactly (after light sanitization), satisfying the "same name as in gallery" requirement.
