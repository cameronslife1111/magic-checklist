# Add prev/next navigation in Media Viewer

## Goal
When a user opens any item from the Media Gallery, show a left and right arrow inside the viewer so they can cycle through the filtered list without closing the modal. Sizing must adapt cleanly to phone and desktop viewports.

## Changes

### 1. `src/components/MediaViewer.tsx`
- Change props: replace single `url/type/title/mimeType/storagePath` with:
  - `items: MediaAsset[]` (the currently filtered list)
  - `index: number | null` (which one is open; null = closed)
  - `onIndexChange: (i: number) => void`
  - `onClose: () => void`
- Derive the active asset from `items[index]`. Render image/video/audio as today, keyed by asset id so the media element fully resets when navigating (prevents stale playback / flicker).
- Add two overlay buttons:
  - Left arrow (`ChevronLeft`) on the left edge, vertically centered.
  - Right arrow (`ChevronRight`) on the right edge.
  - Hidden when there is only one item. Disabled state at the ends (no wrap), or wrap-around — recommend wrap-around so cycling never dead-ends. Will use wrap-around.
- Keyboard support: ArrowLeft / ArrowRight while open call prev/next; Escape already handled by Dialog.
- Touch swipe (optional, lightweight): track `touchstart`/`touchend` X delta on the content container; >50px triggers prev/next. Keeps it usable on phones without arrows feeling cramped.
- Responsive sizing:
  - DialogContent: `max-w-[95vw] sm:max-w-3xl max-h-[90vh] p-2 flex flex-col`
  - Media wrapper: `flex-1 min-h-0 flex items-center justify-center overflow-hidden`
  - `<img>` / `<video>`: `max-h-[80vh] max-w-full w-auto h-auto object-contain`
  - Arrow buttons: `absolute top-1/2 -translate-y-1/2 left-2 / right-2`, `h-10 w-10 rounded-full`, `secondary` variant with `shadow-md`, larger tap target on mobile.
- Download button stays in the top-right area; use the active asset's fields.

### 2. `src/pages/MediaGallery.tsx`
- Replace `viewer` state (`MediaAsset | null`) with `viewerIndex: number | null`.
- When user clicks the eye icon, set `viewerIndex` to that item's index in `filtered`.
- Pass `items={filtered}`, `index={viewerIndex}`, `onIndexChange={setViewerIndex}`, `onClose={() => setViewerIndex(null)}` to `MediaViewer`.
- If `filtered` shrinks (e.g. delete from elsewhere) below current index, clamp or close.

## Out of scope
- No changes to download logic, autoplay behavior, gallery list UI, selection mode, or backend.

## Verification
- Open image on mobile viewport (390px): arrows visible at left/right edges, image fits without overflow, swipe works.
- Open video on desktop: arrows cycle, video resets between items (no audio bleed).
- Single-item filter: arrows hidden.
- Keyboard arrows cycle on desktop; Escape closes.
