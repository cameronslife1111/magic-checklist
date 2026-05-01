## Reduce default checkboxes on new checklist from 3 to 1

When the "New Checklist" button is pressed, the app currently inserts 3 empty checkbox rows into the freshly created checklist. Change this so only 1 empty row is inserted.

### File to change

**`src/pages/Checklist.tsx`** (lines 1542–1546, inside the `onSave` handler of the `dialog.kind === "new"` `TextPromptDialog`):

Replace the 3-row insert:
```ts
await supabase.from("checklist_items").insert([
  { checklist_id: data.id, user_id: user.id, text: "", position: 1024 },
  { checklist_id: data.id, user_id: user.id, text: "", position: 2048 },
  { checklist_id: data.id, user_id: user.id, text: "", position: 3072 },
]);
```

With a single-row insert:
```ts
await supabase.from("checklist_items").insert([
  { checklist_id: data.id, user_id: user.id, text: "", position: 1024 },
]);
```

### Not changing
- "Create & link new checklist" (line ~1626) — separate flow, not the New Checklist button.
- "Send to new checklist" — uses items from the source checklist, unaffected.
