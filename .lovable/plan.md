## Change default position in Send to Checklist dialog

In `src/components/SendToChecklistDialog.tsx`, change the default selected position from `"current"` to `"top"`.

### Edits

1. Initial state:
   - `const [position, setPosition] = useState<SendPosition>("top");`

2. Reset effect (when dialog opens):
   - `setPosition("top");`

No other behavior changes — all three buttons (Top / Current / Bottom) remain available; only the default is updated.