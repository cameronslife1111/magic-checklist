## Problems

**1. Keyboard flash on short Home tap.** Every Home `pointerdown` synchronously focuses a hidden input (`keepaliveRef`) so iOS will allow the keyboard to be shown later if a long-press fires. On a short tap we then `blur()` it on `pointerup`, but iOS has already started raising the keyboard — the user sees a brief flash.

**2. Page jumps while typing.** `ItemRow`'s textarea auto-resizes by setting `style.height = "auto"` and then to `scrollHeight` synchronously on every keystroke. The momentary collapse to `auto` reflows the page; on iOS Safari this triggers caret-keep-in-view scroll corrections, producing the "jump to top, then back" behavior.

## Fix — first principles

### Home button keyboard flash
The keepalive focus is only needed if the user actually long-presses. So defer the focus until we are committed to inserting:

- Remove the synchronous `keepaliveRef.current?.focus()` from `onPointerDown`.
- Move the focus call to the **first line inside the long-press timeout** (so it fires only after the 600ms hold completes — by then we are inserting and the keyboard should appear). This still happens before any `await`, so iOS treats it as user-gesture-initiated (the original pointerdown is still the active gesture chain at timer fire).
- On iOS, `setTimeout`-deferred focus is **not** considered a user gesture and the keyboard will be suppressed. So instead, keep one minimal trick: in `onPointerDown` start the timer, and **only** call `keepaliveRef.focus()` synchronously if the timer is still alive at a brief 80ms checkpoint — too late, that doesn't help either.
- **Correct approach:** keep the synchronous focus in `onPointerDown` (required for iOS keyboard) BUT use a non-keyboard-raising technique: focus the keepalive input with `inputmode="none"` so iOS will not raise the keyboard for *that* input, while still treating the focus as a user-gesture token. When we later focus the new textarea inside the long-press handler, the keyboard rises only then.
  - Set `<input inputMode="none" />` on the keepalive input.
  - This makes short-tap focus/blur silent (no keyboard), and the long-press path still gets a real keyboard when the textarea is focused.

### Typing-induced scroll jump
Stop the destructive `height = "auto"` reflow on every keystroke. Two complementary changes in `src/components/ItemRow.tsx`:

- Compare new `scrollHeight` to current height and only resize when needed; use a `requestAnimationFrame` so the change happens after the browser has settled the caret position.
- Better: replace the manual auto-resize with a CSS-only approach using a sizing technique that does not collapse the textarea:
  - Use a hidden mirror `<div>` with the same text + `whitespace-pre-wrap` that drives the row height, and overlay the textarea absolutely sized to the mirror. No `height = "auto"` reflow, so no scroll jumps.
  - Or simpler: keep manual resize but read `scrollHeight` from a clone, never mutate the live textarea height to `"auto"`. Implementation: keep a ref to a hidden `<textarea>` clone (visually hidden, same width/font), set its value, read its `scrollHeight`, then set the live textarea `style.height` to that pixel value directly — no intermediate `"auto"` reset on the focused element.

I'll implement the hidden-mirror approach (cleaner, no caret disturbance).

## Files to change

- `src/pages/Checklist.tsx`
  - Remove synchronous `keepaliveRef.focus()` from Home button `onPointerDown`. Move it inside the long-press timeout (still before `await`).
  - Add `inputMode="none"` to the keepalive `<input>` so even if it does briefly receive focus on other paths, no keyboard rises.
- `src/components/ItemRow.tsx`
  - Replace the `style.height = "auto"; style.height = scrollHeight + "px"` pattern with a hidden mirror `<div>` (or sibling hidden `<textarea>`) that measures required height; apply only the final pixel height to the live textarea. Never collapse the focused textarea height while typing.

## Out of scope
No behavior changes to long-press insertion, speech, or any other button.
