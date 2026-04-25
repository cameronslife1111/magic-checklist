## Add "Send to Blank Checklist" action

A new entry in the Actions sheet that takes the current yellow-highlighted (highest unchecked) item — text, image, video, or audio — prompts the user for a title for a brand-new checklist, creates that checklist, moves the item into it as the sole entry, and opens it.

### 1. `src/components/ActionsSheet.tsx`
- Extend the `ActionKey` union with `"send-to-blank"`.
- Add a new entry to `STATIC_ITEMS` placed right after the existing `"send-to"` row:
  - key: `"send-to-blank"`, label: `"Send to blank checklist"`, icon: `FilePlus2` (import from lucide-react; visually distinct from the existing "New checklist" `FilePlus`).

### 2. `src/pages/Checklist.tsx`
**Dialog state**: extend the `DialogState` union with `{ kind: "send-to-blank" }`.

**Action handler**: in the `onPick` switch, add a `"send-to-blank"` case that:
- Bails with a toast if `highestUnchecked` is missing.
- Otherwise sets `setDialog({ kind: "send-to-blank" })`.

**Dialog rendering**: reuse the existing `TextPromptDialog` component:
```tsx
<TextPromptDialog
  open={dialog.kind === "send-to-blank"}
  title="Send to new checklist"
  label="Title for the new checklist"
  initial={highestUnchecked?.text?.slice(0, 80) ?? ""}
  saveLabel="Create & send"
  onClose={() => setDialog({ kind: "none" })}
  onSave={handleSendToBlank}
/>
```
Pre-filling with the item's text (truncated) gives the user a sensible starting point they can edit or clear; matches the pattern already used by `edit-title` / `duplicate-title` dialogs.

**`handleSendToBlank(title: string)`** — new async function modeled on `duplicateCurrent` + `handleSendTo`:
1. Guard on `user`, `checklist`, and `highestUnchecked`. Capture `src = highestUnchecked`.
2. Insert a new row into `checklists` with `{ user_id, title: title.trim() || (src.text?.slice(0,80) || "Untitled"), background_color: checklist.background_color }`. On error → toast and return.
3. Insert a single row into `checklist_items` for the new checklist using all media-bearing fields from `src`:
   ```
   { checklist_id: created.id, user_id, text: src.text ?? "",
     position: POS_STEP,
     external_link: src.external_link ?? null,
     linked_checklist_id: src.linked_checklist_id ?? null,
     media_url: src.media_url ?? null,
     media_type: src.media_type ?? null,
     checked: false }
   ```
   This carries text **and** image/video/audio (which already live as `media_url` + `media_type`) — same fields `handleSendTo` copies.
4. Delete the original `src` row from the current checklist (`supabase.from("checklist_items").delete().eq("id", src.id)`), then update local `items` state via `setItems(prev => { const next = prev.filter(i => i.id !== src.id); focusAndSpeakHighestUnchecked(next); return next; })` — mirrors `handleSendTo`.
5. `await openChecklist(created.id)` so the user lands on the new single-item checklist.
6. `toast.success("Sent to new checklist.")`.
7. Always `setDialog({ kind: "none" })` in a `finally`.

### Out of scope
- No changes to `SendToChecklistDialog` (existing "Send to checklist" still targets existing lists).
- No DB migrations — schema already supports everything.
- No re-ordering of the Actions list beyond adding the new row beside `"send-to"`.
- No changes to bottom nav buttons.
