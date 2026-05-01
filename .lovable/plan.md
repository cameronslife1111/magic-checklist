## Swap "Send to blank checklist" and "Uncheck all checkboxes" positions

In `src/components/ActionsSheet.tsx`, swap these two entries in the `STATIC_ITEMS` array:

- `send-to-blank` ("Send to blank checklist") — currently 3rd item (top group)
- `uncheck-all` ("Uncheck all checkboxes") — currently lower down in the quick utilities group

### Change

Move `uncheck-all` up to the 3rd position where `send-to-blank` currently sits, and move `send-to-blank` down to where `uncheck-all` currently sits.

No other files or logic affected.