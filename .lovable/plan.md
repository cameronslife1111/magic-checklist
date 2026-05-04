## Change image-to-video dialog defaults

In `src/components/MediaActionDialog.tsx`, update two initial state values used only by the Kling image-to-video form:

- Line 78: `useState<boolean>(true)` → `useState<boolean>(false)` for `generateAudio` (toggle starts off).
- Line 80: `useState<number>(0.5)` → `useState<number>(1)` for `cfgScale` (slider starts at 1.00).

No other dialogs, payload logic, or backend code changes — only the initial defaults shown when the image-to-video popup opens.