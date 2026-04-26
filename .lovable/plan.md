## What I found (first-principles diagnosis)

Per the Kling V3 Motion Control schema in your context doc, the model needs exactly:
- `image_url` — **reference image** (appearance / character / background)
- `video_url` — **reference video** (motion source)
- `character_orientation` — `"image"` (≤10s, camera moves) or `"video"` (≤30s, complex motion)
- `keep_original_sound` — boolean
- `elements` — optional facial element image (only when orientation = `"video"`)
- `prompt` — text (we already pass the checklist item text)

Looking at `src/components/MediaActionDialog.tsx`, **all of these fields actually exist** in the dialog when `mode === "video-video"`. The bug isn't missing functionality — it's that **only the "Reference video" field is visible at the top**, and the "Reference image" + orientation + sound + element fields are buried below in a single tall scroll. On a 1388×954 viewport with `max-h-[90vh] overflow-y-auto`, the reference-image field gets pushed below the fold the moment a video is selected (because the selected-asset chip expands the top block). Net effect: the popup *feels* like it's only asking for the starting video, exactly as you described.

## Proposed UX fix (the "amazing smooth solution")

Restructure the V2V section of `MediaActionDialog.tsx` so the **two required uploads are co-equal and unmissable**, then add validation that points to the missing one.

### 1. Two-up "Required inputs" header block
At the very top of the V2V section, render a single grouped card titled **"Required inputs"** with two rows (stacked on mobile, side-by-side on ≥sm):
- **① Reference video** — motion source (the existing top picker)
- **② Reference image** — appearance source (the existing `referenceImage` picker, promoted out of the lower section)

Each row gets:
- A numbered badge (1 / 2) so the order is obvious
- A red `Required` chip until filled, switching to a green ✓ + filename when picked
- Inline helper text from the docs (e.g. "Characters should occupy >5% of the image, no occlusion")

### 2. Move secondary controls into a clearly-labeled "Motion options" group
Below the required block, group `Character orientation`, `Keep original sound`, and `Facial element (optional)` under a `Motion options` subheading so they read as configuration, not as more required inputs.

### 3. Smarter validation
In `submit()`:
- If the reference video is missing → set error AND set a `highlightField: "video"` state that adds a red ring around the video picker and scrolls it into view (`scrollIntoView({ block: "center" })`).
- Same for reference image (`highlightField: "image"`).
- Replace the current generic error text with a precise message that names the field.

### 4. Sticky footer + scrollable body
Make `DialogContent` a flex column with the header sticky on top, the body `flex-1 overflow-y-auto`, and the footer sticky on bottom — so the **Generate** button is always reachable without losing sight of the required-inputs block.

### 5. No backend changes
The edge function `supabase/functions/fal-video/index.ts` already sends exactly the right payload (`image_url`, `video_url`, `character_orientation`, `keep_original_sound`, optional `elements`). The worker `process-action-queue/index.ts` already forwards `imageUrl`, `characterOrientation`, `keepOriginalSound`, `elementImageUrl`. `runMediaAction` in `Checklist.tsx` already validates `referenceImageAsset` before enqueue. **Zero backend or queue changes needed** — this is purely a dialog redesign.

## Files to change
- `src/components/MediaActionDialog.tsx` — reorder + regroup the V2V section, add `highlightField` state, sticky footer layout, refs for scroll-to-field. Also tighten the V2V `submit()` validation messages.

## Files explicitly NOT changing (and why)
- `supabase/functions/fal-video/index.ts` — already matches the Motion Control schema verbatim.
- `supabase/functions/process-action-queue/index.ts` — already forwards every V2V field.
- `src/pages/Checklist.tsx` — `runMediaAction` already packages the multi-asset payload correctly for `video-video`.
- `ActionsSheet.tsx` — routing is correct; tapping "Video to video" already opens the dialog with `mode="video-video"`.

## Validation plan after implementation
1. Open a checklist item → Actions → **Video to video**.
2. Confirm the popup shows a single **Required inputs** block with two numbered rows: ① Reference video, ② Reference image — both visible without scrolling on the standard viewport.
3. Tap Generate with neither filled → red ring + auto-scroll to the video picker, error reads "Pick a reference video".
4. Pick the video → the image row's red Required chip is still visible. Tap Generate → red ring + scroll to the image picker.
5. Pick the image → red chips become green ✓. Confirm orientation / keep-sound / facial-element controls live below under "Motion options".
6. Generate "Now" → Action Queue shows `video-video` running → completes → playable `.mp4` checkbox appears.
7. Switch orientation to `video` → confirm the Facial element picker enables.
8. Run a Later / Recurring schedule → confirm the generic queue path still works.
