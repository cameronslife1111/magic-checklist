## Swap "Send to blank checklist" and "Uncheck all checkboxes" positions

In `src/components/ActionsSheet.tsx`, the `STATIC_ITEMS` array defines the order actions appear in the sheet. Currently:

- `send-to-blank` ("Send to blank checklist") sits near the top, third item under Mute
- `uncheck-all` ("Uncheck all checkboxes") sits lower, after `duplicate-item`

### Change

Swap the two entries so they trade positions exactly:

- The slot currently holding `send-to-blank` (top area, after `split-emoji`) becomes `uncheck-all` ("Uncheck all checkboxes")
- The slot currently holding `uncheck-all` (after `duplicate-item`) becomes `send-to-blank` ("Send to blank checklist")

No other items move. No styling, icon, or behavior changes — just position swap.

### File touched

- `src/components/ActionsSheet.tsx` (one swap inside the `STATIC_ITEMS` array)
