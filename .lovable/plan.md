## Add "Send to Google Drive" action

### Approach: Saved folder link (simplest)

You're right that a full Google Drive OAuth integration would be heavy (per-user Google sign-in, token storage, file uploads, etc.). The simpler, faster path — and what I recommend — is:

1. The user pastes a Google Drive **folder link** once (saved in their browser).
2. The new "Send to Google Drive" button takes the current checkbox's text (and any attached media URL) and:
   - Copies it to the clipboard, AND
   - Opens the saved Drive folder in a new tab so they can paste/drop it in.

This requires **no Google account connection, no API keys, no backend changes**. If you later want true uploads, we can swap this for the Google Drive connector — but this gets you 90% of the value with 10% of the complexity.

### Changes

**1. `src/components/ActionsSheet.tsx`**
- Add a new `ActionKey`: `"send-to-gdrive"`.
- Add a new entry in `STATIC_ITEMS` with label "Send to Google Drive" and a `HardDrive` (or `Cloud`) icon from lucide-react. Place it right under the existing "Send to blank checklist" item so all the "send to…" actions sit together.

**2. `src/pages/Checklist.tsx`**
- Add a new `case "send-to-gdrive"` in the action handler that:
  - Reads the saved Drive folder URL from `localStorage` (key: `gdrive-folder-url`).
  - If none saved → opens a small prompt dialog asking the user to paste a Google Drive folder link. Validates it starts with `https://drive.google.com/` and contains `/folders/`. Saves it to `localStorage`.
  - Once a link is saved → copies the current checkbox's text (plus media URL if present) to the clipboard and opens the saved Drive folder URL in a new tab. Shows a toast: "Copied — paste into your Drive folder."
- Add a tiny inline dialog component (or reuse an existing `Dialog`) for the first-time link entry. Also offer a "Change saved folder" option inside that dialog so the user can update it later by clearing the saved value.

### Technical notes

- No Supabase/database changes — the folder link lives in `localStorage` per device.
- No new dependencies.
- The existing `highestUnchecked` pattern (used by `send-to`, `send-to-blank`) is reused to pick which checkbox is being sent.

### Future upgrade path (not in this change)

If later you want real one-click uploads (text → a Google Doc, images → Drive files), we can add the **Google Drive connector** which handles OAuth and uploads through an edge function. That's a bigger change and only worth it if the clipboard flow feels too manual.
