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

export function isUrl(s: string): boolean {
  return /^https?:\/\/\S+$/i.test(s.trim());
}

export function extractFirstUrl(s: string): string | null {
  const m = s.match(URL_RE);
  return m ? m[0] : null;
}
