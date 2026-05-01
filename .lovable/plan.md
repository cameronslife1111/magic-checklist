## Swap "Send to blank checklist" and "Uncheck all checkboxes" positions

In `src/components/ActionsSheet.tsx`, the `STATIC_ITEMS` array defines the order of buttons in the Actions sheet. Swap the positions of these two entries:

- `uncheck-all` ("Uncheck all checkboxes") — currently near the top, third item after Split actions
- `send-to-blank` ("Send to blank checklist") — currently lower down, after "Duplicate checkbox"

### Change

Move `send-to-blank` up to where `uncheck-all` currently sits (3rd in the static list), and move `uncheck-all` down to where `send-to-blank` currently sits.

No other files or logic affected — purely a reorder of two array entries.