// Shared types & helpers for the Magic Steps voice assistant.
// Step shapes mirror the JSON schema in supabase/functions/magic-steps-plan/index.ts.

import type { ActionKey } from "@/components/ActionsSheet";
import type { ChecklistItem, Checklist } from "@/lib/types";

export type Step =
  | { kind: "openActions" }
  | { kind: "closeActions" }
  | { kind: "pickAction"; action: ActionKey }
  | { kind: "setMediaOption"; field: string; value: any }
  | { kind: "attachContextChecklist"; checklistId: string }
  | { kind: "attachContextMedia"; mediaPaths: string[] }
  | { kind: "generate" }
  | { kind: "checkItems"; ids: string[] }
  | { kind: "uncheckItems"; ids: string[] }
  | { kind: "addItem"; text: string; afterId?: string }
  | { kind: "editItemText"; id: string; text: string }
  | { kind: "splitCurrent" }
  | { kind: "splitByEmoji" }
  | { kind: "combineChecked" }
  | { kind: "openChecklist"; id: string }
  | { kind: "newChecklist"; title: string }
  | { kind: "duplicateChecklist"; title?: string }
  | { kind: "deleteChecklist" }
  | { kind: "navigate"; to: "/" | "/queue" | "/media" }
  | { kind: "setTheme"; theme: "light" | "dark" }
  | { kind: "setMuted"; muted: boolean }
  | { kind: "setBackground"; color: string }
  | { kind: "rearrangeMode"; on: boolean }
  | { kind: "copySentence" }
  | { kind: "copyChecklist" }
  | { kind: "speak"; text: string }
  | { kind: "wait"; ms: number };

export type Plan = {
  summary: string;
  steps: Step[];
  clarifying_question?: string;
};

export type AppSnapshot = {
  currentChecklist: { id: string; title: string };
  items: { id: string; text: string; checked: boolean; isHighest: boolean }[];
  allChecklists: { id: string; title: string }[];
  theme: "light" | "dark";
  muted: boolean;
  route: string;
};

export const buildAppSnapshot = (args: {
  checklist: Checklist;
  items: ChecklistItem[];
  allChecklists: { id: string; title: string }[];
  theme: "light" | "dark";
  muted: boolean;
  route: string;
}): AppSnapshot => {
  const highest = args.items.find((i) => !i.checked);
  return {
    currentChecklist: { id: args.checklist.id, title: args.checklist.title },
    items: args.items.map((i) => ({
      id: i.id,
      text: (i.text ?? "").slice(0, 120),
      checked: i.checked,
      isHighest: highest?.id === i.id,
    })),
    allChecklists: args.allChecklists.map((c) => ({ id: c.id, title: c.title })),
    theme: args.theme,
    muted: args.muted,
    route: args.route,
  };
};

const ACTION_LABELS: Record<string, string> = {
  "mute": "mute speech unmute speech",
  "queue": "action queue dashboard",
  "add": "add new checkbox",
  "duplicate-item": "duplicate checkbox",
  "new": "new checklist",
  "duplicate": "duplicate checklist",
  "delete-checklist": "delete checklist",
  "edit-title": "edit checklist title rename",
  "split": "split current checkbox",
  "split-emoji": "split by emoji",
  "text-text": "text to text",
  "text-image": "text to image",
  "image-image": "image to image",
  "remix": "remix multiple images",
  "image-video": "image to video",
  "video-video": "video to video",
  "audio-image-video": "audio image video heygen avatar",
  "insert-link": "insert checklist link",
  "analyze-image": "analyze image",
  "web-search": "text to web search",
  "bg": "change checklist background",
  "rearrange": "rearrange checkboxes",
  "copy-sentence": "copy sentence",
  "copy-checklist": "copy full checklist",
  "send-to": "send to checklist",
  "send-to-blank": "send to blank checklist",
  "uncheck-all": "uncheck all checkboxes",
  "combine-checked": "combine checked checkboxes",
  "media-gallery": "media gallery",
  "theme": "theme dark light mode",
  "sign-out": "sign out logout",
};

const tokenize = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((t) => t && t.length > 1 && !["the","a","an","to","button","please","can","you"].includes(t));

export const fuzzyMatchActionKey = (label: string): ActionKey | null => {
  const want = new Set(tokenize(label));
  if (want.size === 0) return null;
  let best: { key: string; score: number } | null = null;
  for (const [key, l] of Object.entries(ACTION_LABELS)) {
    const have = new Set(tokenize(l));
    let overlap = 0;
    for (const t of want) if (have.has(t)) overlap++;
    const denom = Math.max(want.size, have.size);
    const score = denom ? overlap / denom : 0;
    if (!best || score > best.score) best = { key, score };
  }
  return best && best.score >= 0.34 ? (best.key as ActionKey) : null;
};
