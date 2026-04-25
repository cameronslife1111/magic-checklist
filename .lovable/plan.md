## Reorder buttons in the Actions sheet

In `src/components/ActionsSheet.tsx`, move four items so they appear directly under the **Mute/Unmute speech** button (which is always rendered first), in this exact order:

1. Split current checkbox (`split`)
2. Send to checklist (`send-to`)
3. Action Queue Dashboard (`queue`)
4. Rearrange checkboxes (`rearrange`)

### Implementation
- In the `STATIC_ITEMS` array, remove the existing entries for `split`, `send-to`, `queue`, and `rearrange` from their current positions.
- Re-insert them at the very top of `STATIC_ITEMS` in the order listed above. Since `items` is built as `[muteItem, ...STATIC_ITEMS, themeItem, signOutItem]`, this places them immediately under the mute button.
- Leave all other buttons (Copy sentence, Copy full checklist, Insert checklist link, Add new checkbox, Duplicate checkbox, Media Gallery, Change checklist background, the AI buttons, Edit title, New, Duplicate, Delete) in their current relative order.
- No other files, styling, or behavior changes.