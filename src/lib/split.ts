// Split text by . ! ? ; while keeping URLs intact and as their own parts.
const URL_RE = /\bhttps?:\/\/[^\s)]+/gi;

export function splitTextWithLinks(input: string): string[] {
  const text = input ?? "";
  if (!text.trim()) return [];

  const tokens: { type: "text" | "url"; value: string }[] = [];
  let lastIndex = 0;
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    if (start > lastIndex) tokens.push({ type: "text", value: text.slice(lastIndex, start) });
    tokens.push({ type: "url", value: m[0] });
    lastIndex = start + m[0].length;
  }
  if (lastIndex < text.length) tokens.push({ type: "text", value: text.slice(lastIndex) });

  const parts: string[] = [];
  for (const tok of tokens) {
    if (tok.type === "url") {
      parts.push(tok.value);
    } else {
      // Split on . ! ? ; — keep delimiter via lookbehind
      const pieces = tok.value.split(/(?<=[.!?;])\s+/);
      for (const p of pieces) {
        const sub = p.split(/(?<=[.!?;])(?=\S)/); // also split adjacent like "a.b"
        for (const s of sub) {
          const t = s.trim();
          if (t) parts.push(t);
        }
      }
    }
  }
  return parts.filter((p) => p.replace(/[.!?;\s]/g, "").length > 0 || /^https?:\/\//i.test(p));
}

// Split text into chunks where each chunk starts at an emoji boundary.
// Multi-codepoint emoji (ZWJ sequences, skin-tone modifiers, regional indicator
// flags, variation selectors) stay intact. URLs are preserved verbatim and
// never split mid-URL.
export function splitTextByEmoji(input: string): string[] {
  const text = input ?? "";
  if (!text.trim()) return [];

  // Tokenize URLs first so we never split inside one.
  type Tok = { type: "text" | "url"; value: string };
  const tokens: Tok[] = [];
  let lastIndex = 0;
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    if (start > lastIndex) tokens.push({ type: "text", value: text.slice(lastIndex, start) });
    tokens.push({ type: "url", value: m[0] });
    lastIndex = start + m[0].length;
  }
  if (lastIndex < text.length) tokens.push({ type: "text", value: text.slice(lastIndex) });

  // Match a complete emoji "grapheme": an Extended_Pictographic base (with
  // optional variation selector) plus optional skin-tone modifier, then any
  // ZWJ-joined continuations; OR a regional indicator flag pair.
  const EMOJI_RE =
    /(?:\p{Regional_Indicator}\p{Regional_Indicator})|(?:\p{Extended_Pictographic}(?:\uFE0F)?(?:\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F)?(?:\p{Emoji_Modifier})?)*)/gu;

  const chunks: string[] = [];
  let buf = "";
  const push = () => {
    const t = buf.trim();
    if (t) chunks.push(t);
    buf = "";
  };

  for (const tok of tokens) {
    if (tok.type === "url") {
      buf += tok.value;
      continue;
    }
    const s = tok.value;
    let cursor = 0;
    EMOJI_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = EMOJI_RE.exec(s)) !== null) {
      const start = m.index;
      // Append any text before the emoji to the current buffer.
      if (start > cursor) buf += s.slice(cursor, start);
      // Emoji starts a NEW chunk — flush whatever we have, then start fresh
      // with the emoji as the first character of the new chunk.
      push();
      buf = m[0];
      cursor = start + m[0].length;
    }
    if (cursor < s.length) buf += s.slice(cursor);
  }
  push();

  if (chunks.length <= 1) return [text.trim()].filter(Boolean);
  return chunks;
}

export function isUrl(s: string): boolean {
  return /^https?:\/\/\S+$/i.test(s.trim());
}

export function extractFirstUrl(s: string): string | null {
  const m = s.match(URL_RE);
  return m ? m[0] : null;
}
