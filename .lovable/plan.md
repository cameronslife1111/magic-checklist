## Goal
Add a long-press / long-click gesture to the **Actions** button in `src/pages/Checklist.tsx` that re-reads the currently yellow-highlighted (highest unchecked) item using the Web Speech function. A normal short tap still opens the Actions sheet as it does today.

## Behavior
- **Short tap** on Actions → opens the Actions sheet (unchanged).
- **Long press (~500 ms hold)** on Actions → cancels any active speech, then speaks the current `highestUnchecked` item's text. The Actions sheet does **not** open.
- If there is no unchecked item, the long press is a no-op (silent).
- Works for both mouse and touch via `onPointerDown` / `onPointerUp` / `onPointerLeave` / `onPointerCancel`, matching the existing long-press pattern on the Done button.

## Change — `src/pages/Checklist.tsx`

1. Add two refs near the existing long-press refs:
   ```ts
   const actionsLongPressTimerRef = useRef<number | null>(null);
   const actionsLongPressFiredRef = useRef(false);
   ```

2. Replace the Actions button (currently a simple `onClick`) with the long-press-aware version:
   ```tsx
   <Button
     onPointerDown={(e) => {
       e.preventDefault();
       actionsLongPressFiredRef.current = false;
       primeSpeech();
       if (actionsLongPressTimerRef.current) window.clearTimeout(actionsLongPressTimerRef.current);
       actionsLongPressTimerRef.current = window.setTimeout(() => {
         actionsLongPressFiredRef.current = true;
         if (highestUnchecked) {
           const text = highestUnchecked.linked_checklist_id
             ? (highestUnchecked.text || "Open checklist")
             : highestUnchecked.text;
           speak(text);
         }
       }, 500);
     }}
     onPointerUp={() => {
       if (actionsLongPressTimerRef.current) {
         window.clearTimeout(actionsLongPressTimerRef.current);
         actionsLongPressTimerRef.current = null;
       }
       if (!actionsLongPressFiredRef.current) {
         setActionsOpen(true);
       }
     }}
     onPointerLeave={() => {
       if (actionsLongPressTimerRef.current) {
         window.clearTimeout(actionsLongPressTimerRef.current);
         actionsLongPressTimerRef.current = null;
       }
     }}
     onPointerCancel={() => {
       if (actionsLongPressTimerRef.current) {
         window.clearTimeout(actionsLongPressTimerRef.current);
         actionsLongPressTimerRef.current = null;
       }
     }}
     className="flex-1 h-14 rounded-2xl text-base font-semibold shadow-floating"
   >
     Actions
   </Button>
   ```

3. `speak` is already imported from `@/lib/speech` and internally calls `window.speechSynthesis.cancel()`, so any current speech is interrupted before the new one starts. The recently added emoji-stripping in `speak()` automatically applies here too.

## Why this approach
- Mirrors the proven long-press pattern already used on the Done button in the same file (refs + 500 ms `setTimeout` + `firedRef` to suppress the trailing tap), so behavior on iOS/Android is consistent.
- All logic lives inline with the existing button — no new components, no new utilities. The "highlighted sentence" is already tracked as `highestUnchecked`, so we reuse it directly.
- Short-tap behavior (opening the sheet) is preserved: the sheet only opens on `onPointerUp` when the long press did **not** fire.

## Out of scope
- No changes to the Actions sheet contents.
- No changes to scrolling or highlight styling — only re-speaking the existing highlighted item.
- No new icon/visual indicator on the Actions button.
