## Swap "Copy full checklist" and "Combine checked checkboxes" buttons

In `src/components/ActionsSheet.tsx`, swap the positions of these two entries within the `STATIC_ITEMS` array:

- `copy-checklist` ("Copy full checklist") — currently near the top of the quick utilities section
- `combine-checked` ("Combine checked checkboxes") — currently lower down, after `send-to-gdrive`

After the swap:
- `combine-checked` will take the former position of `copy-checklist` (right after `copy-sentence`)
- `copy-checklist` will take the former position of `combine-checked` (right after `send-to-gdrive`)

No other items move, no logic changes, no other files touched.