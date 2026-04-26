// Sequentially executes a Magic Steps plan by calling typed callbacks the
// host page wires up. Steps map onto the same handlers any UI button uses.

import type { Step, Plan } from "@/lib/magicSteps";
import { fuzzyMatchActionKey } from "@/lib/magicSteps";
import type { ActionKey } from "@/components/ActionsSheet";
import type { GenOptions } from "@/components/MediaActionDialog";
import type { MediaAsset } from "@/lib/mediaAssets";
import type { ChecklistItem } from "@/lib/types";

export type ExecutorCtx = {
  pick: (k: ActionKey) => void | Promise<void>;
  setActionsOpen: (o: boolean) => void;
  // Direct media run that bypasses the dialog (Magic Steps fully automates).
  runMediaActionDirect: (
    action: "text-image" | "image-image" | "remix" | "image-video" | "video-video" | "audio-image-video" | "analyze-image",
    sourceItem: ChecklistItem,
    opts: GenOptions,
  ) => Promise<void>;
  // Direct check/uncheck of a set of items (optimistic + persisted).
  setItemsCheckedById: (ids: string[], checked: boolean) => Promise<void>;
  addItem: (text: string, afterId?: string) => Promise<void>;
  editItemText: (id: string, text: string) => Promise<void>;
  splitCurrent: () => Promise<void>;
  splitByEmoji: () => Promise<void>;
  combineChecked: () => Promise<void>;
  openChecklist: (id: string) => Promise<void>;
  newChecklist: (title: string) => Promise<void>;
  duplicateChecklist: (title?: string) => Promise<void>;
  deleteCurrentChecklist: () => Promise<void>;
  navigate: (to: string) => void;
  setTheme: (t: "light" | "dark") => void;
  setMutedState: (m: boolean) => void;
  setBackgroundColor: (color: string) => Promise<void>;
  setReorderMode: (on: boolean) => void;
  copySentence: () => Promise<void>;
  copyChecklist: () => Promise<void>;
  speak: (text: string) => void;

  // Resolution helpers needed by the executor:
  getHighestUnchecked: () => ChecklistItem | null;
  getAttachedMediaByPaths: (paths: string[]) => MediaAsset[];
};

export type ExecutorResult =
  | { ok: true; completed: number }
  | { ok: false; failedAtIndex: number; error: string };

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const runPlan = async (plan: Plan, ctx: ExecutorCtx): Promise<ExecutorResult> => {
  // Per-plan accumulators (for the media flow):
  let pendingMediaAction:
    | "text-image" | "image-image" | "remix" | "image-video" | "video-video" | "audio-image-video" | "analyze-image"
    | null = null;
  let pendingMediaSource: ChecklistItem | null = null;
  let pendingMediaOpts: Partial<GenOptions> = { aspectRatio: "1:1", quality: "standard" };

  const setMediaField = (field: string, value: any) => {
    // Normalize a few common fuzzy values.
    if (field === "aspectRatio" && typeof value === "string") {
      const norm = value.replace(/by|x/i, ":").replace(/\s+/g, "");
      const valid = ["1:1","16:9","9:16","4:3","3:4"];
      if (valid.includes(norm)) value = norm;
    }
    (pendingMediaOpts as any)[field] = value;
  };

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    const nextStep = plan.steps[i + 1];
    try {
      switch (step.kind) {
        case "openActions": {
          // If the very next step is a pickAction, the sheet flash is just
          // visual noise — the dispatcher runs the action whether the sheet
          // is open or not. Skip the toggle to keep the UI smooth.
          if (nextStep?.kind === "pickAction") break;
          ctx.setActionsOpen(true);
          break;
        }
        case "closeActions": ctx.setActionsOpen(false); break;

        case "pickAction": {
          // Validate / fuzzy-recover the action key.
          let key: ActionKey | null = step.action as ActionKey;
          // If unknown, try fuzzy matching the string.
          const known = new Set([
            "mute","queue","add","duplicate-item","new","duplicate","delete-checklist","edit-title","split","split-emoji",
            "text-text","text-image","image-image","remix","image-video","video-video","audio-image-video",
            "insert-link","analyze-image","web-search","bg","rearrange",
            "copy-sentence","copy-checklist","send-to","send-to-blank","uncheck-all","combine-checked","media-gallery","theme","sign-out",
          ]);
          if (!known.has(key as string)) {
            key = fuzzyMatchActionKey(step.action || "");
          }
          if (!key) throw new Error(`Unknown action: ${step.action}`);

          // Media actions: stash for the upcoming setMediaOption / generate sequence.
          const mediaActions = ["text-image","image-image","remix","image-video","video-video","audio-image-video","analyze-image"];
          if (mediaActions.includes(key)) {
            const src = ctx.getHighestUnchecked();
            if (!src) throw new Error("No unchecked checkbox to act on");
            pendingMediaAction = key as any;
            pendingMediaSource = src;
            pendingMediaOpts = { aspectRatio: "1:1", quality: "standard" };
          } else {
            await ctx.pick(key);
          }
          break;
        }

        case "setMediaOption":
          setMediaField(step.field, step.value);
          break;

        case "attachContextMedia": {
          // Resolve to MediaAsset[] from the user-attached context.
          const assets = ctx.getAttachedMediaByPaths(step.mediaPaths || []);
          if (pendingMediaAction) {
            // For the media run, attach all images/videos/audio appropriately.
            const images = assets.filter((a) => a.kind === "image");
            const videos = assets.filter((a) => a.kind === "video");
            const audios = assets.filter((a) => a.kind === "audio");
            if (images.length) pendingMediaOpts.assets = images;
            if (videos.length && (pendingMediaAction === "image-video" || pendingMediaAction === "video-video")) {
              pendingMediaOpts.assets = videos;
            }
            if (audios.length && pendingMediaAction === "audio-image-video") {
              pendingMediaOpts.audioAsset = audios[0];
            }
          }
          // (attachContextChecklist is currently a no-op for media — context was
          // attached up-front in the dialog; left here for forward-compat.)
          break;
        }
        case "attachContextChecklist":
          // No-op at executor level — the host page already passes checklists
          // as attached context. Kept for the prompt schema.
          break;

        case "generate": {
          if (!pendingMediaAction || !pendingMediaSource) throw new Error("generate without a pending media action");
          const opts = { aspectRatio: "1:1", quality: "standard", ...pendingMediaOpts } as GenOptions;
          await ctx.runMediaActionDirect(pendingMediaAction, pendingMediaSource, opts);
          pendingMediaAction = null;
          pendingMediaSource = null;
          pendingMediaOpts = { aspectRatio: "1:1", quality: "standard" };
          break;
        }

        case "checkItems": await ctx.setItemsCheckedById(step.ids, true); break;
        case "uncheckItems": await ctx.setItemsCheckedById(step.ids, false); break;

        case "addItem": await ctx.addItem(step.text, step.afterId); break;
        case "editItemText": await ctx.editItemText(step.id, step.text); break;

        case "splitCurrent": await ctx.splitCurrent(); break;
        case "splitByEmoji": await ctx.splitByEmoji(); break;
        case "combineChecked": await ctx.combineChecked(); break;

        case "openChecklist": await ctx.openChecklist(step.id); break;
        case "newChecklist": await ctx.newChecklist(step.title); break;
        case "duplicateChecklist": await ctx.duplicateChecklist(step.title); break;
        case "deleteChecklist": await ctx.deleteCurrentChecklist(); break;

        case "navigate": ctx.navigate(step.to); break;
        case "setTheme": ctx.setTheme(step.theme); break;
        case "setMuted": ctx.setMutedState(step.muted); break;
        case "setBackground": await ctx.setBackgroundColor(step.color); break;
        case "rearrangeMode": ctx.setReorderMode(step.on); break;

        case "copySentence": await ctx.copySentence(); break;
        case "copyChecklist": await ctx.copyChecklist(); break;
        case "speak": ctx.speak(step.text); break;
        case "wait": await wait(Math.max(0, Math.min(5000, step.ms || 0))); break;
      }
      // Tiny breath so React can flush state between steps.
      await wait(120);
    } catch (e) {
      return { ok: false, failedAtIndex: i, error: (e as Error).message };
    }
  }
  return { ok: true, completed: plan.steps.length };
};
