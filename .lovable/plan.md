# Fix: MediaGalleryPicker won't scroll on iOS Chrome/Safari

## First-principles diagnosis

The picker (`MediaGalleryPicker`) is a Radix `Dialog` that opens **on top of another open Dialog** (`MediaActionDialog`). This nested-dialog pattern combined with iOS touch handling produces the bug you described.

Three compounding causes:

1. **Nested Radix Dialogs + iOS touch**
   The parent Dialog applies a body scroll-lock and `pointer-events:none` traversal. When the child Dialog mounts, on iOS WebKit the parent's overlay can still intercept the very first `touchstart`/`touchmove` sequence on the child's inner scroll area, so your initial swipe registers on the wrong layer and is silently dropped. Closing and reopening lets the layer order re-stabilize — exactly matching your "works a little better the second time" symptom.

2. **Inner list lacks iOS scroll hints**
   The scrollable `<ul>` uses only `overflow-y-auto`. iOS needs `-webkit-overflow-scrolling: touch`, `overscroll-behavior: contain`, and `touch-action: pan-y` to claim the gesture inside a fixed/locked dialog. Without them, the gesture can bubble up and get cancelled by Radix's outside-press / dismiss handlers.

3. **Dialog has no flex layout / no max-height**
   `DialogContent` here is `max-w-md p-0 gap-0` with no `max-h`. On a 390×587 viewport (your iPhone), the dialog can exceed the visible area, so the scrollable list's bottom portion sits under the footer / off-screen. The list uses `max-h-[55vh]` instead of flexing to fill remaining space, so when the async asset list loads its measured height shifts after first paint, leaving the touch target in the wrong place until the user reopens the dialog.

## Plan (file changes)

### 1. `src/components/MediaGalleryPicker.tsx` — restructure as a flex column dialog with iOS-friendly scroll

- Make `DialogContent` a bounded flex column:
  `className="max-w-md w-[calc(100vw-1.5rem)] p-0 gap-0 flex flex-col max-h-[85vh] overflow-hidden"`
- Mark header (`DialogHeader`), the search/upload row, and `DialogFooter` as `shrink-0` so they don't compete for height.
- Replace the `<ul className="... max-h-[55vh] overflow-y-auto ...">` with a scroll container that:
  - Flexes to fill: `flex-1 min-h-0 overflow-y-auto`
  - Adds iOS hints via inline style:
    `style={{ WebkitOverflowScrolling: "touch", overscrollBehavior: "contain", touchAction: "pan-y" }}`
  - Drops the brittle `max-h-[55vh]` (parent now constrains height).
- Remove the autoFocus side-effect on the search Input on touch devices to prevent the iOS keyboard popping on open and reflowing the dialog (add `autoFocus={false}` / no autofocus is already the case — verify and explicitly set `inputMode="search"`).

### 2. Stop the parent Dialog from swallowing touches under the picker

In `src/components/MediaActionDialog.tsx`, when any picker (`pickerOpen`, `endPickerOpen`, `refPickerOpen`, `elementPickerOpen`, `audioPickerOpen`) is open, render the parent `Dialog` with `modal={false}` **OR** simpler and safer: keep the parent modal but ensure the child picker's `DialogContent` calls `onOpenAutoFocus={(e) => e.preventDefault()}` and `onPointerDownOutside`/`onInteractOutside` are not stopped. The minimal, robust fix:

- Add a higher z-index to the picker's overlay/content (`z-[60]`) so it sits cleanly above the parent's `z-50` overlay — eliminates the iOS race where the parent overlay catches the first touch.
- Add `onOpenAutoFocus={(e) => e.preventDefault()}` to the picker's `DialogContent` so iOS doesn't focus the search field on mount (which is what causes the layout shift + missed first swipe).

### 3. (Defensive) `src/components/ui/dialog.tsx` — no change required, but verify
We will *not* edit the shared `Dialog` primitive. All fixes live in the picker so they don't ripple to other dialogs.

## Why this resolves the symptoms

- "Won't scroll at all on first open" → caused by (a) parent overlay intercepting first touch and (b) layout shift from autofocus + async load. Raising z-index + preventing autofocus + flex-column layout removes both.
- "Works a little better after reopen" → the layer/race condition self-corrects after one cycle today; with the fix it works the first time.
- iOS-specific → the `-webkit-overflow-scrolling`, `overscroll-behavior: contain`, and `touch-action: pan-y` hints are exactly what WebKit needs to take ownership of the gesture inside a locked dialog.

## Out of scope (intentionally)

- No change to Media Gallery data loading, selection logic, or upload flow.
- No change to other dialogs — fix is scoped to `MediaGalleryPicker`.

After approval I'll implement the changes and you can retest on iPhone Chrome.