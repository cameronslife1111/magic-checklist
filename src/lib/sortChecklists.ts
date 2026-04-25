// Sort checklists by title with custom bucket order:
// 0 = emoji/symbol, 1 = number, 2 = letter, 3 = empty
const bucket = (title: string): number => {
  const ch = (title ?? "").trim();
  if (!ch) return 3;
  const cp = ch.codePointAt(0)!;
  const first = String.fromCodePoint(cp);
  if (/\p{L}/u.test(first)) return 2;
  if (/\p{N}/u.test(first)) return 1;
  return 0;
};

export function sortChecklistsByTitle<T extends { title: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const ba = bucket(a.title);
    const bb = bucket(b.title);
    if (ba !== bb) return ba - bb;
    return a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true });
  });
}
