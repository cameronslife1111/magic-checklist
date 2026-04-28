## Goal

Add a new action-sheet button **"Insert new checklist link from text"** that:
1. Reads the text from the current highest-unchecked (yellow-highlighted) checkbox.
2. Opens a popup pre-asking the user for a name (defaulting to that captured text).
3. On confirm: creates a brand-new checklist with that title, seeded with one empty checkbox containing the captured text, then **converts the current highlighted checkbox in-place into a link** that points to the new checklist (preserving its position).
4. Cancel button closes the popup and does nothing.

## UX Flow

- User taps Actions → "Insert new checklist link from text".
- If there's no unchecked item, show toast `No unchecked checkbox found.` and abort.
- Popup appears titled **"Create & link new checklist"**, with the input pre-filled with the captured text. Buttons: **"Create & link"** (primary) / **"Cancel"**.
- On Create & link:
  - New checklist is created (owned by user).
  - One checkbox is seeded inside it containing the captured text.
  - The original highlighted item on the current checklist is updated in-place: `text` becomes the new checklist title, `linked_checklist_id` becomes the new checklist id, `external_link` cleared. Position is unchanged → link appears exactly where the text was.
  - Toast success; speech of the active line refreshes naturally via existing logic.

## Code Changes

### 1. `src/components/ActionsSheet.tsx`
- Add new `ActionKey`: `"insert-new-link"`.
- Add a `STATIC_ITEMS` entry: `{ key: "insert-new-link", label: "Insert new checklist link from text", icon: FilePlus2 }` (or similar — pick an existing imported icon like `Link2` paired or `FilePlus`). Place it directly **after** the existing `"insert-link"` ("Insert checklist link") entry so the two link-related actions sit together.

### 2. `src/pages/Checklist.tsx`
- Extend `DialogState` union with `| { kind: "insert-new-link" }`.
- In the `onPick` switch, add:
  ```ts
  case "insert-new-link":
    if (!highestUnchecked) { toast.error("No unchecked checkbox found."); return; }
    setDialog({ kind: "insert-new-link" });
    break;
  ```
- Render a new `<TextPromptDialog>` near the existing `"new"` and `"insert-link"` dialogs:
  ```tsx
  <TextPromptDialog
    open={dialog.kind === "insert-new-link"}
    title="Create & link new checklist"
    label="New checklist title"
    initial={highestUnchecked?.text ?? ""}
    saveLabel="Create & link"
    onClose={() => setDialog({ kind: "none" })}
    onSave={async (title) => {
      if (!user || !checklist || !highestUnchecked) { setDialog({ kind: "none" }); return; }
      const capturedText = highestUnchecked.text;
      const targetItemId = highestUnchecked.id;

      // 1. Create new checklist
      const { data: newCl, error: clErr } = await supabase
        .from("checklists").insert({ user_id: user.id, title }).select().single();
      if (clErr || !newCl) { toast.error("Could not create checklist."); return; }

      // 2. Seed it with the captured text as its first checkbox
      await supabase.from("checklist_items").insert([
        { checklist_id: newCl.id, user_id: user.id, text: capturedText, position: 1024 },
      ]);

      // 3. Convert the current highlighted item in place into a link
      const { error: updErr } = await supabase
        .from("checklist_items")
        .update({ text: title, linked_checklist_id: newCl.id, external_link: null })
        .eq("id", targetItemId);
      if (updErr) { toast.error("Could not link checklist."); return; }

      // 4. Update local state so UI reflects immediately
      setItems((prev) => prev.map((i) =>
        i.id === targetItemId
          ? { ...i, text: title, linked_checklist_id: newCl.id, external_link: null }
          : i
      ));
      setDialog({ kind: "none" });
      toast.success("Linked new checklist");
    }}
  />
  ```

## Notes
- No DB schema changes; uses existing `checklists` and `checklist_items` tables and RLS.
- Position of the original line is preserved → link appears exactly where the text was.
- The new checklist's first checkbox holds the original text so nothing is lost.
- Cancel = closing the dialog; nothing is created.