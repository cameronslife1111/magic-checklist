# Add "Export text file" action

## Goal
Add a new button to the Actions sheet that, when tapped, immediately downloads a `.txt` file to the user's device containing **every checklist title and every step (checkbox text)** for the signed-in user.

Filename format:
```
magic checklist text data export- HH-MM-SS DD-MM-YYYY.txt
```
(Colons in the time are replaced with `-` because iOS/Android/Windows disallow `:` in filenames. Spaces are kept as requested.)

## File contents
Plain UTF-8 text, checklists ordered the same way they appear in the app (using the existing `sortChecklists` helper), each block formatted as:

```
=== <Checklist Title> ===
[ ] Step text
[x] Completed step text
[ ] Another step

=== <Next Checklist Title> ===
...
```

A small header is added at the top:
```
Magic Checklist — Text Data Export
Generated: <local date/time>
Total checklists: N
Total steps: M

```

## Technical changes

### 1. `src/components/ActionsSheet.tsx`
- Add `"export-text"` to the `ActionKey` union.
- Add a new entry to `STATIC_ITEMS` near the other utility actions (right after `"media-gallery"` feels natural):
  ```ts
  { key: "export-text", label: "Export text file", icon: FileDown }
  ```
- Import `FileDown` from `lucide-react`.

### 2. `src/pages/Checklist.tsx`
- In the `onPick` switch (around line 393), add a new `case "export-text":` that:
  1. Closes the actions sheet.
  2. Fetches all of the current user's checklists from Supabase (`checklists` table) and all of their items (`checklist_items` table) in two queries scoped by `user_id`.
  3. Sorts checklists with the existing `sortChecklists` helper from `src/lib/sortChecklists.ts`.
  4. Sorts each checklist's items by `position`.
  5. Builds the text body in the format shown above.
  6. Generates the filename using `new Date()` with zero-padded `HH-MM-SS DD-MM-YYYY` in the user's local time.
  7. Triggers a browser download via a `Blob` + temporary `<a download>` element (no extra dependencies).
  8. Shows a toast on success ("Exported N checklists") or on error.

### 3. No backend / migration changes
- Read-only Supabase queries with existing RLS (already restrict to `auth.uid()`).
- No new dependencies; uses the standard `Blob` + anchor download pattern that works on iOS Safari, Android Chrome, and desktop.

## Edge cases handled
- Empty account → still downloads a file with the header and "Total checklists: 0".
- Items with newlines in their text → newlines are preserved as-is in the export.
- Long filenames → format is fixed length, well under filesystem limits.
- iOS Safari quirk → using `Blob` + `URL.createObjectURL` + `a.click()` + `URL.revokeObjectURL` is the standard pattern that works there.
