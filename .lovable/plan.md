## Goal
The Web Speech function should ignore emojis. Strip all emoji characters from text before passing it to `SpeechSynthesisUtterance`, so they're silently skipped.

## Change — `src/lib/speech.ts`

Add a small `stripEmojis(text)` helper and use it inside `speak()`:

```ts
function stripEmojis(text: string) {
  // Remove emoji + pictographic symbols, variation selectors, ZWJ, regional indicators, skin tones
  return text
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\p{Emoji_Modifier}/gu, "")
    .replace(/\p{Regional_Indicator}/gu, "")
    .replace(/[\u200D\uFE0F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function speak(text: string) {
  if (muted) return;
  if (!("speechSynthesis" in window)) return;
  const cleaned = stripEmojis(text);
  if (!cleaned) { window.speechSynthesis.cancel(); return; }
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(cleaned);
    u.rate = 1;
    u.pitch = 1;
    window.speechSynthesis.speak(u);
  } catch {}
}
```

## Why this approach
- Centralizing the strip inside `speak()` means every call site (toggle, delete, send-to, auto-focus) automatically benefits — no other files need to change.
- Uses Unicode property escapes (`\p{Extended_Pictographic}`, etc.) which cover the full modern emoji set including flags, skin-tone modifiers, and ZWJ sequences (e.g. 👨‍👩‍👧).
- If the resulting string is empty (item was only emojis), we just cancel current speech and stay silent rather than speaking nothing.

## Out of scope
- Visual display of emojis in the checklist UI is unchanged — emojis still show on screen, they're only skipped by the voice.
- No changes to mute toggle, scroll, or highlight behavior.
