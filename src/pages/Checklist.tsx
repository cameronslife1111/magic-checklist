import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Checklist, ChecklistItem } from "@/lib/types";
import { ChecklistSearch } from "@/components/ChecklistSearch";
import { ItemRow } from "@/components/ItemRow";
import { ActionsSheet, ActionKey } from "@/components/ActionsSheet";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import { TextPromptDialog } from "@/components/TextPromptDialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ChecklistPickerDialog } from "@/components/ChecklistPickerDialog";
import { SendToChecklistDialog, SendPosition } from "@/components/SendToChecklistDialog";
import { BackgroundPickerDialog } from "@/components/BackgroundPickerDialog";
import { MediaActionDialog, GenOptions } from "@/components/MediaActionDialog";
import { MediaViewer } from "@/components/MediaViewer";
import { ScheduleActionDialog, SchedulePick } from "@/components/ScheduleActionDialog";
import { AttachedContext } from "@/components/ContextAttacher";
import { toast } from "sonner";
import { primeSpeech, speak, stopSpeech, isMuted, setMuted } from "@/lib/speech";
import { wasPickJustNow } from "@/lib/clickGuard";
import { extractFirstUrl, isUrl, splitTextWithLinks } from "@/lib/split";
import { sortChecklistsByTitle } from "@/lib/sortChecklists";
import {
  DndContext, DragEndEvent, PointerSensor, TouchSensor, KeyboardSensor,
  useSensor, useSensors, closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { SortableItemRow } from "@/components/SortableItemRow";

const POS_STEP = 1024;

type DialogState =
  | { kind: "none" }
  | { kind: "new" }
  | { kind: "edit-title" }
  | { kind: "insert-link" }
  | { kind: "send-to" }
  | { kind: "send-to-blank" }
  | { kind: "bg" }
  | { kind: "duplicate-title" }
  | { kind: "delete-checklist" }
  | { kind: "media"; action: "text-image" | "image-image" | "remix" | "image-video" | "video-video" | "analyze-image"; sourceItem: ChecklistItem };

const ChecklistPage = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [viewer, setViewer] = useState<{ url: string; type: string } | null>(null);
  const [pendingEnqueue, setPendingEnqueue] = useState<null | {
    action_type: string;
    actionLabel: string;
    payload: any;
    source_item_id: string | null;
  }>(null);
  const [pendingContext, setPendingContext] = useState<AttachedContext>({ checklists: [], media: [] });
  const [focusItemId, setFocusItemId] = useState<string | null>(null);
  const [reorderMode, setReorderMode] = useState(false);
  const [muted, setMutedState] = useState<boolean>(() => isMuted());
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    return (localStorage.getItem("mc-theme") as "light" | "dark") ?? "light";
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((i) => i.id === active.id);
    const newIndex = items.findIndex((i) => i.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(items, oldIndex, newIndex);
    const moved = reordered[newIndex];
    const before = reordered[newIndex - 1];
    const after = reordered[newIndex + 1];
    let newPos: number;
    if (!before) newPos = (after?.position ?? POS_STEP) - POS_STEP;
    else if (!after) newPos = (before.position ?? 0) + POS_STEP;
    else newPos = ((before.position ?? 0) + (after.position ?? 0)) / 2;
    const updated = reordered.map((i) => (i.id === moved.id ? { ...i, position: newPos } : i));
    setItems(updated);
    const { error } = await supabase.from("checklist_items").update({ position: newPos }).eq("id", moved.id);
    if (error) toast.error("Could not save order. Try again.");
  };

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    localStorage.setItem("mc-theme", theme);
  }, [theme]);

  const itemRefs = useRef<Record<string, HTMLLIElement | null>>({});
  const longPressTimerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);
  const actionsLongPressTimerRef = useRef<number | null>(null);
  const actionsLongPressFiredRef = useRef(false);
  const keepaliveRef = useRef<HTMLInputElement>(null);
  const didAutoFocusRef = useRef<string | null>(null);
  const registerRef = useCallback((id: string, el: HTMLLIElement | null) => {
    itemRefs.current[id] = el;
  }, []);

  // Load initial checklist
  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      // Prefer the last-opened checklist on this device, if it still exists.
      const savedId = localStorage.getItem("mc-last-checklist");
      let active: Checklist | undefined;
      if (savedId) {
        const { data } = await supabase
          .from("checklists").select("*").eq("id", savedId).maybeSingle();
        if (data) active = data as Checklist;
      }
      if (!active) {
        const { data: lists } = await supabase
          .from("checklists").select("*").order("updated_at", { ascending: false }).limit(1);
        active = lists?.[0] as Checklist | undefined;
      }
      if (!active) {
        const { data: created } = await supabase
          .from("checklists").insert({ user_id: user.id, title: "My first checklist" })
          .select().single();
        active = created as Checklist;
        if (active) {
          await supabase.from("checklist_items").insert([
            { checklist_id: active.id, user_id: user.id, text: "Welcome to Magic Checklist.", position: 1024 },
            { checklist_id: active.id, user_id: user.id, text: "Tap Actions to do more.", position: 2048 },
          ]);
        }
      }
      if (active) await openChecklist(active.id);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const openChecklist = async (id: string) => {
    didAutoFocusRef.current = null;
    stopSpeech();
    try { localStorage.setItem("mc-last-checklist", id); } catch {}
    const { data: cl } = await supabase.from("checklists").select("*").eq("id", id).single();
    const { data: its } = await supabase
      .from("checklist_items").select("*").eq("checklist_id", id).order("position", { ascending: true });
    setChecklist(cl as Checklist);
    setItems((its ?? []) as ChecklistItem[]);
  };

  const highestUnchecked = useMemo(() => items.find((i) => !i.checked) ?? null, [items]);

  // Auto-scroll & speak the highest unchecked item once per checklist load
  useEffect(() => {
    if (!checklist || !highestUnchecked) return;
    if (didAutoFocusRef.current === checklist.id) return;
    didAutoFocusRef.current = checklist.id;
    const id = highestUnchecked.id;
    const text = highestUnchecked.linked_checklist_id
      ? (highestUnchecked.text || "Open checklist")
      : highestUnchecked.text;
    requestAnimationFrame(() => {
      const el = itemRefs.current[id];
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      if (text) speak(text);
    });
  }, [checklist, highestUnchecked]);

  const scrollItemToCenter = (id: string) => {
    requestAnimationFrame(() => {
      const el = itemRefs.current[id];
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const focusAndSpeakHighestUnchecked = (list: ChecklistItem[]) => {
    const next = list.find((i) => !i.checked);
    if (!next) { stopSpeech(); return; }
    scrollItemToCenter(next.id);
    const text = next.linked_checklist_id ? (next.text || "Open checklist") : next.text;
    if (text) speak(text);
  };

  const handleToggle = async (item: ChecklistItem, next: boolean) => {
    primeSpeech();
    const targetIdx = items.findIndex((i) => i.id === item.id);
    if (targetIdx < 0) return;

    // Cascade: checking → also check all earlier unchecked items.
    // Unchecking → also uncheck all later checked items.
    const changedIds: string[] = [];
    const updated = items.map((i, idx) => {
      if (next) {
        if (idx <= targetIdx && !i.checked) {
          changedIds.push(i.id);
          return { ...i, checked: true };
        }
      } else {
        if (idx >= targetIdx && i.checked) {
          changedIds.push(i.id);
          return { ...i, checked: false };
        }
      }
      return i;
    });

    setItems(updated);

    if (changedIds.length) {
      const { error } = await supabase
        .from("checklist_items")
        .update({ checked: next })
        .in("id", changedIds);
      if (error) toast.error("Could not save. Try again.");
    }

    const nxt = updated.find((i) => !i.checked);
    if (nxt) {
      scrollItemToCenter(nxt.id);
      const speakText = nxt.linked_checklist_id ? (nxt.text || "Open checklist") : nxt.text;
      if (speakText) speak(speakText);
    } else {
      stopSpeech();
    }
  };

  const handleTextChange = async (item: ChecklistItem, text: string) => {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, text } : i)));
    // detect external link in pure-link content
    const trimmed = text.trim();
    const externalLink = isUrl(trimmed) ? trimmed : null;
    await supabase.from("checklist_items").update({ text, external_link: externalLink }).eq("id", item.id);
  };

  // Removes generated-media storage objects for the given media URLs, but skips any
  // that are tracked in media_assets (Media Gallery items the user wants to keep).
  const deleteOwnedGeneratedMedia = async (mediaUrls: (string | null | undefined)[]) => {
    const marker = "/generated-media/";
    const paths: string[] = [];
    for (const url of mediaUrls) {
      if (!url) continue;
      const idx = url.indexOf(marker);
      if (idx === -1) continue; // external URL — not in our bucket
      const path = url.slice(idx + marker.length).split("?")[0];
      if (path) paths.push(path);
    }
    if (paths.length === 0) return;
    try {
      const { data: gallery } = await supabase
        .from("media_assets")
        .select("storage_path")
        .in("storage_path", paths);
      const galleryPaths = new Set((gallery ?? []).map((r: any) => r.storage_path));
      const toDelete = paths.filter((p) => !galleryPaths.has(p));
      if (toDelete.length === 0) return;
      await supabase.storage.from("generated-media").remove(toDelete);
    } catch {
      // Best-effort: never block row deletion on storage cleanup failures.
    }
  };

  const handleDelete = async (item: ChecklistItem) => {
    await deleteOwnedGeneratedMedia([item.media_url]);
    const { error } = await supabase.from("checklist_items").delete().eq("id", item.id);
    if (error) {
      toast.error("Could not delete. Try again.");
      return;
    }
    setItems((prev) => {
      const nextList = prev.filter((i) => i.id !== item.id);
      focusAndSpeakHighestUnchecked(nextList);
      return nextList;
    });
  };

  const positionAfter = (sourceId: string | null) => {
    if (!sourceId) {
      const last = items[items.length - 1];
      return (last?.position ?? 0) + POS_STEP;
    }
    const idx = items.findIndex((i) => i.id === sourceId);
    const cur = items[idx];
    const next = items[idx + 1];
    if (!next) return (cur.position ?? 0) + POS_STEP;
    return ((cur.position ?? 0) + (next.position ?? 0)) / 2;
  };

  const positionBefore = (sourceId: string | null) => {
    if (!sourceId) {
      const first = items[0];
      if (!first) return POS_STEP;
      return (first.position ?? POS_STEP) - POS_STEP;
    }
    const idx = items.findIndex((i) => i.id === sourceId);
    const cur = items[idx];
    const prev = items[idx - 1];
    if (!prev) return (cur.position ?? POS_STEP) - POS_STEP;
    return ((prev.position ?? 0) + (cur.position ?? 0)) / 2;
  };

  const insertItemAfter = async (sourceId: string | null, payload: Partial<ChecklistItem>): Promise<ChecklistItem | null> => {
    if (!checklist || !user) return null;
    const position = positionAfter(sourceId);
    const { data, error } = await supabase
      .from("checklist_items")
      .insert({
        checklist_id: checklist.id,
        user_id: user.id,
        text: payload.text ?? "",
        position,
        external_link: payload.external_link ?? null,
        linked_checklist_id: payload.linked_checklist_id ?? null,
        media_url: payload.media_url ?? null,
        media_type: payload.media_type ?? null,
      })
      .select().single();
    if (error || !data) {
      toast.error("Could not save. Try again.");
      return null;
    }
    const newItem = data as ChecklistItem;
    setItems((prev) => {
      const idx = sourceId ? prev.findIndex((i) => i.id === sourceId) : prev.length - 1;
      const arr = [...prev];
      arr.splice(idx + 1, 0, newItem);
      return arr;
    });
    return newItem;
  };

  const insertItemBefore = async (sourceId: string | null, payload: Partial<ChecklistItem>): Promise<ChecklistItem | null> => {
    if (!checklist || !user) return null;
    const position = positionBefore(sourceId);
    const { data, error } = await supabase
      .from("checklist_items")
      .insert({
        checklist_id: checklist.id,
        user_id: user.id,
        text: payload.text ?? "",
        position,
        external_link: payload.external_link ?? null,
        linked_checklist_id: payload.linked_checklist_id ?? null,
        media_url: payload.media_url ?? null,
        media_type: payload.media_type ?? null,
      })
      .select().single();
    if (error || !data) {
      toast.error("Could not save. Try again.");
      return null;
    }
    const newItem = data as ChecklistItem;
    setItems((prev) => {
      const idx = sourceId ? prev.findIndex((i) => i.id === sourceId) : 0;
      const arr = [...prev];
      arr.splice(idx, 0, newItem);
      return arr;
    });
    return newItem;
  };

  const addNewAfterCurrent = async () => {
    const sourceId = highestUnchecked?.id ?? (items[items.length - 1]?.id ?? null);
    const created = await insertItemAfter(sourceId, { text: "" });
    if (created) setFocusItemId(created.id);
    return created;
  };

  const addNewBeforeCurrent = async () => {
    const sourceId = highestUnchecked?.id ?? (items[0]?.id ?? null);
    const created = await insertItemBefore(sourceId, { text: "" });
    if (created) setFocusItemId(created.id);
    return created;
  };

  // ---------- Action Handlers ----------


  const onPick = async (key: ActionKey) => {
    setActionsOpen(false);
    if (!checklist || !user) return;

    switch (key) {
      case "mute": {
        const next = !muted;
        setMuted(next);
        setMutedState(next);
        toast.success(next ? "Speech muted" : "Speech unmuted");
        break;
      }
      case "add": {
        await addNewAfterCurrent();
        break;
      }
      case "duplicate-item": {
        await duplicateCurrentItem();
        break;
      }
      case "uncheck-all": {
        setActionsOpen(false);
        const checkedIds = items.filter((i) => i.checked).map((i) => i.id);
        if (checkedIds.length === 0) {
          // Nothing to uncheck — still focus + speak the first item for consistency.
          primeSpeech();
          focusAndSpeakHighestUnchecked(items);
          break;
        }
        const prev = items;
        const next = items.map((i) => (i.checked ? { ...i, checked: false } : i));
        setItems(next);
        primeSpeech();
        focusAndSpeakHighestUnchecked(next);
        const { error } = await supabase
          .from("checklist_items")
          .update({ checked: false })
          .in("id", checkedIds);
        if (error) {
          toast.error("Could not uncheck items. Try again.");
          setItems(prev);
        }
        break;
      }
      case "new":
        setDialog({ kind: "new" });
        break;
      case "duplicate":
        setDialog({ kind: "duplicate-title" });
        break;
      case "delete-checklist":
        setDialog({ kind: "delete-checklist" });
        break;
      case "edit-title":
        setDialog({ kind: "edit-title" });
        break;
      case "split":
        await splitCurrent();
        break;
      case "text-text":
        await runTextToText();
        break;
      case "text-image":
      case "image-image":
      case "remix":
      case "image-video":
      case "video-video":
      case "analyze-image": {
        if (!highestUnchecked) {
          toast.error("No unchecked checkbox found.");
          return;
        }
        setDialog({ kind: "media", action: key, sourceItem: highestUnchecked });
        break;
      }
      case "insert-link":
        if (!highestUnchecked) {
          toast.error("No unchecked checkbox found.");
          return;
        }
        setDialog({ kind: "insert-link" });
        break;
      case "send-to":
        if (!highestUnchecked) {
          toast.error("No unchecked checkbox found.");
          return;
        }
        setDialog({ kind: "send-to" });
        break;
      case "send-to-blank":
        if (!highestUnchecked) {
          toast.error("No unchecked checkbox found.");
          return;
        }
        setDialog({ kind: "send-to-blank" });
        break;
      case "web-search":
        await runWebSearch();
        break;
      case "bg":
        setDialog({ kind: "bg" });
        break;
      case "rearrange":
        setReorderMode(true);
        break;
      case "copy-sentence": {
        const text = highestUnchecked?.text?.trim();
        if (!text) {
          toast.error("No sentence to copy.");
          return;
        }
        try {
          await navigator.clipboard.writeText(text);
          toast.success("Sentence copied.");
        } catch {
          toast.error("Could not copy. Try again.");
        }
        break;
      }
      case "copy-checklist": {
        const text = items.map((i) => i.text ?? "").filter((t) => t.trim().length > 0).join("\n");
        if (!text) {
          toast.error("Checklist is empty.");
          return;
        }
        try {
          await navigator.clipboard.writeText(text);
          toast.success("Checklist copied.");
        } catch {
          toast.error("Could not copy. Try again.");
        }
        break;
      }
      case "queue":
        navigate("/queue");
        break;
      case "media-gallery":
        navigate("/media");
        break;
      case "theme":
        setTheme((t) => (t === "dark" ? "light" : "dark"));
        break;
      case "sign-out":
        try { await signOut(); navigate("/login", { replace: true }); }
        catch { toast.error("Could not sign out. Try again."); }
        break;
    }
  };

  const duplicateCurrentItem = async () => {
    const src = highestUnchecked;
    if (!src) {
      toast.error("No unchecked checkbox found.");
      return;
    }
    const created = await insertItemAfter(src.id, {
      text: src.text,
      external_link: src.external_link,
      linked_checklist_id: src.linked_checklist_id,
      media_url: src.media_url,
      media_type: src.media_type,
      checked: false,
    });
    if (!created) {
      toast.error("Could not duplicate. Try again.");
      return;
    }
    if (!src.external_link && !src.linked_checklist_id) {
      setFocusItemId(created.id);
    }
    toast.success("Checkbox duplicated.");
  };

  const duplicateCurrent = async (newTitle: string) => {
    if (!checklist || !user) return;
    const title = newTitle.trim() || `${checklist.title} Copy`;
    const { data: created, error } = await supabase
      .from("checklists")
      .insert({ user_id: user.id, title, background_color: checklist.background_color })
      .select().single();
    if (error || !created) {
      toast.error("Could not duplicate checklist. Try again.");
      return;
    }
    const inserts = items.map((i) => ({
      checklist_id: created.id,
      user_id: user.id,
      text: i.text,
      checked: false,
      position: i.position,
      external_link: i.external_link,
      linked_checklist_id: i.linked_checklist_id,
      media_url: i.media_url,
      media_type: i.media_type,
    }));
    if (inserts.length) await supabase.from("checklist_items").insert(inserts);
    await openChecklist(created.id);
    toast.success("Checklist duplicated.");
  };

  const deleteCurrentChecklist = async () => {
    if (!checklist || !user) return;
    const deletedId = checklist.id;
    const { error: itemsErr } = await supabase
      .from("checklist_items").delete().eq("checklist_id", deletedId);
    if (itemsErr) { toast.error("Could not delete checklist. Try again."); return; }
    const { error: clErr } = await supabase
      .from("checklists").delete().eq("id", deletedId);
    if (clErr) { toast.error("Could not delete checklist. Try again."); return; }

    try { localStorage.removeItem("mc-last-checklist"); } catch {}
    setDialog({ kind: "none" });
    toast.success("Checklist deleted.");

    // Open next available checklist, or bootstrap a fresh one.
    const { data: next } = await supabase
      .from("checklists").select("*")
      .order("updated_at", { ascending: false }).limit(1);
    if (next && next.length > 0) {
      await openChecklist((next[0] as Checklist).id);
      return;
    }
    const { data: created } = await supabase
      .from("checklists").insert({ user_id: user.id, title: "My first checklist" })
      .select().single();
    if (created) {
      await supabase.from("checklist_items").insert([
        { checklist_id: created.id, user_id: user.id, text: "Welcome to Magic Checklist.", position: 1024 },
        { checklist_id: created.id, user_id: user.id, text: "Tap Actions to do more.", position: 2048 },
      ]);
      await openChecklist((created as Checklist).id);
    }
  };

  const splitCurrent = async () => {
    if (!checklist || !user) return;
    const src = highestUnchecked;
    if (!src) {
      toast.error("No unchecked checkbox found.");
      return;
    }
    const parts = splitTextWithLinks(src.text);
    if (parts.length <= 1) {
      toast.error("This checkbox does not have enough punctuation to split.");
      return;
    }
    // Build inserts spaced between src.position and next item's position
    const idx = items.findIndex((i) => i.id === src.id);
    const next = items[idx + 1];
    const start = src.position;
    const end = next ? next.position : start + POS_STEP * (parts.length + 1);
    const span = (end - start) / (parts.length + 1);
    const rows = parts.map((p, i) => ({
      checklist_id: checklist.id,
      user_id: user.id,
      text: p,
      checked: false,
      position: start + span * (i + 1),
      external_link: isUrl(p) ? p : null,
    }));
    const { data: inserted, error } = await supabase.from("checklist_items").insert(rows).select();
    if (error) {
      toast.error("Could not save. Try again.");
      return;
    }
    await supabase.from("checklist_items").delete().eq("id", src.id);
    setItems((prev) => {
      const without = prev.filter((i) => i.id !== src.id);
      const merged = [...without, ...((inserted ?? []) as ChecklistItem[])].sort((a, b) => a.position - b.position);
      return merged;
    });
    if (inserted?.[0]) {
      scrollItemToCenter(inserted[0].id);
      const speakText = inserted[0].text;
      if (speakText) speak(speakText);
    }
  };

  const requestEnqueue = (args: { action_type: string; actionLabel: string; payload: any; source_item_id: string | null }) => {
    setPendingContext({ checklists: [], media: [] });
    setPendingEnqueue(args);
  };

  const submitEnqueue = async (pick: SchedulePick) => {
    if (!pendingEnqueue || !checklist) { setPendingEnqueue(null); return; }
    const mergedPayload = {
      ...pendingEnqueue.payload,
      context: {
        checklists: pendingContext.checklists.map((c) => c.id),
        media: pendingContext.media.map((m) => ({ url: m.url, type: m.type, name: m.name })),
      },
    };
    const body: any = {
      action_type: pendingEnqueue.action_type,
      checklist_id: checklist.id,
      source_item_id: pendingEnqueue.source_item_id,
      payload: mergedPayload,
    };
    if (pick.mode === "later") body.scheduled_for = pick.scheduled_for;
    if (pick.mode === "recurring") {
      body.scheduled_for = pick.scheduled_for;
      body.recurrence = pick.recurrence;
    }
    const { error } = await supabase.functions.invoke("enqueue-action", { body });
    setPendingEnqueue(null);
    setPendingContext({ checklists: [], media: [] });
    setDialog({ kind: "none" });
    if (error) toast.error("Could not queue. Try again.");
    else toast.success(pick.mode === "now" ? "Queued — running in background." : "Scheduled.");
  };

  const runTextToText = () => {
    if (!highestUnchecked) { toast.error("No unchecked checkbox found."); return; }
    requestEnqueue({
      action_type: "text-text",
      actionLabel: "Text to text",
      payload: { prompt: highestUnchecked.text },
      source_item_id: highestUnchecked.id,
    });
  };

  const runWebSearch = () => {
    if (!highestUnchecked) { toast.error("No unchecked checkbox found."); return; }
    requestEnqueue({
      action_type: "web-search",
      actionLabel: "Web search",
      payload: { prompt: highestUnchecked.text },
      source_item_id: highestUnchecked.id,
    });
  };

  const fileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const uploadGeneratedToStorage = async (dataUrl: string, ext: string): Promise<string | null> => {
    if (!user) return null;
    try {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const name = `${user.id}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("generated-media").upload(name, blob, { contentType: blob.type });
      if (error) return null;
      return supabase.storage.from("generated-media").getPublicUrl(name).data.publicUrl;
    } catch { return null; }
  };

  type MediaAction = "text-image" | "image-image" | "remix" | "image-video" | "video-video" | "analyze-image";
  const MEDIA_LABELS: Record<MediaAction, string> = {
    "text-image": "Text to image",
    "image-image": "Image to image",
    "remix": "Remix images",
    "image-video": "Image to video",
    "video-video": "Video to video",
    "analyze-image": "Analyze image",
  };
  const runMediaAction = async (sourceItem: ChecklistItem, action: MediaAction, opts: GenOptions) => {
    if (!checklist) return;
    try {
      const payload: any = { prompt: sourceItem.text, aspectRatio: opts.aspectRatio, quality: opts.quality };
      const assets = opts.assets ?? [];
      if (action === "image-image" || action === "remix") {
        if (assets.length === 0) throw new Error("missing image");
        payload.refImageUrls = assets.map((a) => a.url);
      } else if (action === "image-video" || action === "video-video") {
        if (assets.length === 0) throw new Error("missing media");
        payload.sourceUrl = assets[0].url;
        if (action === "image-video") {
          payload.duration = opts.duration;
          payload.generateAudio = opts.generateAudio;
          payload.negativePrompt = opts.negativePrompt;
          payload.cfgScale = opts.cfgScale;
          if (opts.endImageAsset) payload.endImageUrl = opts.endImageAsset.url;
          // Kling V3 pro doesn't take aspect ratio — drop it from the payload.
          delete payload.aspectRatio;
        }
      } else if (action === "analyze-image") {
        if (assets.length === 0) throw new Error("missing image");
        payload.imageUrl = assets[0].url;
      }
      setDialog({ kind: "none" });
      requestEnqueue({
        action_type: action,
        actionLabel: MEDIA_LABELS[action],
        payload,
        source_item_id: sourceItem.id,
      });
    } catch {
      toast.error("Could not prepare action. Try again.");
      setDialog({ kind: "none" });
    }
  };

  const handleSendTo = async (targetId: string, _title: string, where: SendPosition) => {
    if (!user) return;
    const src = highestUnchecked;
    if (!src) {
      toast.error("No unchecked checkbox found.");
      setDialog({ kind: "none" });
      return;
    }
    try {
      const { data: targetItems, error: fetchErr } = await supabase
        .from("checklist_items")
        .select("id,position,checked")
        .eq("checklist_id", targetId)
        .order("position", { ascending: true });
      if (fetchErr) throw fetchErr;
      const list = (targetItems ?? []) as { id: string; position: number; checked: boolean }[];

      let position: number;
      if (list.length === 0) {
        position = POS_STEP;
      } else if (where === "top") {
        position = list[0].position - POS_STEP;
      } else if (where === "bottom") {
        position = list[list.length - 1].position + POS_STEP;
      } else {
        const idx = list.findIndex((i) => !i.checked);
        if (idx === -1) {
          position = list[list.length - 1].position + POS_STEP;
        } else {
          const cur = list[idx];
          const next = list[idx + 1];
          position = next ? (cur.position + next.position) / 2 : cur.position + POS_STEP;
        }
      }

      const { error: insErr } = await supabase.from("checklist_items").insert({
        checklist_id: targetId,
        user_id: user.id,
        text: src.text ?? "",
        position,
        external_link: src.external_link ?? null,
        linked_checklist_id: src.linked_checklist_id ?? null,
        media_url: src.media_url ?? null,
        media_type: src.media_type ?? null,
      });
      if (insErr) throw insErr;

      const { error: delErr } = await supabase.from("checklist_items").delete().eq("id", src.id);
      if (delErr) throw delErr;
      setItems((prev) => {
        const nextList = prev.filter((i) => i.id !== src.id);
        focusAndSpeakHighestUnchecked(nextList);
        return nextList;
      });

      toast.success("Sent to checklist.");
    } catch {
      toast.error("Could not send. Try again.");
    } finally {
      setDialog({ kind: "none" });
    }
  };

  const handleSendToBlank = async (newTitle: string) => {
    if (!user || !checklist) return;
    const src = highestUnchecked;
    if (!src) {
      toast.error("No unchecked checkbox found.");
      setDialog({ kind: "none" });
      return;
    }
    try {
      const title = newTitle.trim() || (src.text?.slice(0, 80) || "Untitled");
      const { data: created, error: clErr } = await supabase
        .from("checklists")
        .insert({ user_id: user.id, title, background_color: checklist.background_color })
        .select().single();
      if (clErr || !created) throw clErr ?? new Error("create failed");

      const { error: insErr } = await supabase.from("checklist_items").insert({
        checklist_id: created.id,
        user_id: user.id,
        text: src.text ?? "",
        position: POS_STEP,
        external_link: src.external_link ?? null,
        linked_checklist_id: src.linked_checklist_id ?? null,
        media_url: src.media_url ?? null,
        media_type: src.media_type ?? null,
        checked: false,
      });
      if (insErr) throw insErr;

      const { error: delErr } = await supabase.from("checklist_items").delete().eq("id", src.id);
      if (delErr) throw delErr;

      setItems((prev) => {
        const next = prev.filter((i) => i.id !== src.id);
        focusAndSpeakHighestUnchecked(next);
        return next;
      });

      await openChecklist(created.id);
      toast.success("Sent to new checklist.");
    } catch {
      toast.error("Could not send. Try again.");
    } finally {
      setDialog({ kind: "none" });
    }
  };

  if (loading || !checklist) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>;
  }

  const isDark = theme === "dark";
  const pageBgStyle = isDark ? undefined : { backgroundColor: checklist.background_color };
  const headerBgStyle = isDark ? undefined : { backgroundColor: `${checklist.background_color}cc` };

  return (
    <div className={`min-h-screen flex flex-col ${isDark ? "bg-background text-foreground" : ""}`} style={pageBgStyle}>
      <header className={`sticky top-0 z-20 px-4 pt-3 pb-3 backdrop-blur-md ${isDark ? "bg-background/80" : ""}`} style={headerBgStyle}>
        <ChecklistSearch onPick={openChecklist} />
        <h1
          className="mt-3 text-xl font-semibold leading-tight cursor-text"
          onClick={() => {
            if (wasPickJustNow()) return;
            setDialog({ kind: "edit-title" });
          }}
          title="Tap to rename"
        >
          {checklist.title}
        </h1>
      </header>

      <main className="flex-1 px-3 pt-1 pb-actions">
        {reorderMode && (
          <p className="text-center text-muted-foreground text-xs pb-2">Drag the handle to rearrange. Tap Done when finished.</p>
        )}
        {items.length === 0 ? (
          <p className="text-center text-muted-foreground mt-12 text-sm">This checklist is empty.</p>
        ) : reorderMode ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              <ul className="flex flex-col gap-2 max-w-2xl mx-auto w-full">
                {items.map((it) => (
                  <SortableItemRow
                    key={it.id}
                    item={it}
                    isActive={highestUnchecked?.id === it.id}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        ) : (
          <ul className="flex flex-col gap-2 max-w-2xl mx-auto w-full">
            {items.map((it) => (
              <ItemRow
                key={it.id}
                item={it}
                autoFocus={focusItemId === it.id}
                isActive={highestUnchecked?.id === it.id}
                onToggle={handleToggle}
                onTextChange={handleTextChange}
                onOpenLinkedChecklist={openChecklist}
                onOpenMedia={(url, type) => setViewer({ url, type })}
                onDelete={handleDelete}
                registerRef={registerRef}
              />
            ))}
            {items.every((i) => i.checked) && items.length > 0 && (
              <p className="text-center text-muted-foreground mt-6 text-sm">All items are checked.</p>
            )}
          </ul>
        )}
      </main>

      <div className="fixed bottom-0 left-0 right-0 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 pointer-events-none">
        <div className="max-w-2xl mx-auto pointer-events-auto">
          {reorderMode ? (
            <Button
              onClick={() => setReorderMode(false)}
              className="w-full h-14 rounded-2xl text-base font-semibold shadow-floating"
            >
              Done
            </Button>
          ) : (
            <div className="flex gap-3">
              <Button
                onPointerDown={(e) => {
                  e.preventDefault();
                  actionsLongPressFiredRef.current = false;
                  primeSpeech();
                  if (actionsLongPressTimerRef.current) window.clearTimeout(actionsLongPressTimerRef.current);
                  actionsLongPressTimerRef.current = window.setTimeout(() => {
                    actionsLongPressFiredRef.current = true;
                    if (highestUnchecked) {
                      const text = highestUnchecked.linked_checklist_id
                        ? (highestUnchecked.text || "Open checklist")
                        : highestUnchecked.text;
                      if (text) speak(text);
                    }
                  }, 500);
                }}
                onPointerUp={() => {
                  if (actionsLongPressTimerRef.current) {
                    window.clearTimeout(actionsLongPressTimerRef.current);
                    actionsLongPressTimerRef.current = null;
                  }
                  if (!actionsLongPressFiredRef.current) {
                    stopSpeech();
                    setActionsOpen(true);
                  }
                }}
                onPointerLeave={() => {
                  if (actionsLongPressTimerRef.current) {
                    window.clearTimeout(actionsLongPressTimerRef.current);
                    actionsLongPressTimerRef.current = null;
                  }
                }}
                onPointerCancel={() => {
                  if (actionsLongPressTimerRef.current) {
                    window.clearTimeout(actionsLongPressTimerRef.current);
                    actionsLongPressTimerRef.current = null;
                  }
                }}
                onContextMenu={(e) => e.preventDefault()}
                className="flex-1 h-14 rounded-2xl text-base font-semibold shadow-floating select-none touch-none"
              >
                Actions
              </Button>
              <Button
                aria-label="Open top checklist"
                onClick={async () => {
                  const { data } = await supabase.from("checklists").select("id,title");
                  const sorted = sortChecklistsByTitle(data ?? []);
                  const top = sorted[0];
                  if (!top) return;
                  if (top.id !== checklist.id) {
                    await openChecklist(top.id);
                    return;
                  }
                  if (highestUnchecked?.linked_checklist_id) {
                    await openChecklist(highestUnchecked.linked_checklist_id);
                  }
                }}
                className="w-16 h-14 rounded-2xl text-2xl leading-none shadow-floating select-none"
              >
                🏠
              </Button>
              <Button
                aria-label="Check current and advance"
                onPointerDown={(e) => {
                  e.preventDefault();
                  longPressFiredRef.current = false;
                  // Focus the hidden keepalive input synchronously inside the
                  // user gesture. On iOS this is required so the keyboard can
                  // be shown later when we hand focus over to the new textarea.
                  keepaliveRef.current?.focus({ preventScroll: true });
                  if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
                  longPressTimerRef.current = window.setTimeout(async () => {
                    longPressFiredRef.current = true;
                    primeSpeech();
                    // Re-focus right before the async insert to keep the
                    // keyboard session alive across the await.
                    keepaliveRef.current?.focus({ preventScroll: true });
                    await addNewBeforeCurrent();
                  }, 600);
                }}
                onPointerUp={(e) => {
                  e.preventDefault();
                  if (longPressTimerRef.current) {
                    window.clearTimeout(longPressTimerRef.current);
                    longPressTimerRef.current = null;
                  }
                  if (longPressFiredRef.current) return;
                  // Short tap: drop the keepalive focus so the keyboard does
                  // not appear, then toggle the current item.
                  keepaliveRef.current?.blur();
                  if (highestUnchecked) handleToggle(highestUnchecked, true);
                }}
                onPointerCancel={() => {
                  if (longPressTimerRef.current) {
                    window.clearTimeout(longPressTimerRef.current);
                    longPressTimerRef.current = null;
                  }
                  keepaliveRef.current?.blur();
                }}
                onContextMenu={(e) => e.preventDefault()}
                className="flex-1 h-14 rounded-2xl shadow-floating select-none touch-none"
              >
                <Check className="h-6 w-6" />
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Hidden input used to keep the iOS keyboard alive across async work
          when long-pressing the Check button to add a new item. */}
      <input
        ref={keepaliveRef}
        type="text"
        aria-hidden="true"
        tabIndex={-1}
        className="fixed bottom-0 left-0 w-px h-px opacity-0 pointer-events-none"
        style={{ fontSize: "16px" }}
      />

      <ActionsSheet open={actionsOpen} onOpenChange={(o) => { if (o) stopSpeech(); setActionsOpen(o); }} onPick={onPick} currentTheme={theme} muted={muted} />

      <TextPromptDialog
        open={dialog.kind === "new"}
        title="New checklist"
        label="Checklist title"
        saveLabel="Create"
        onClose={() => setDialog({ kind: "none" })}
        onSave={async (title) => {
          if (!user) return;
          const { data, error } = await supabase
            .from("checklists").insert({ user_id: user.id, title }).select().single();
          if (error || !data) { toast.error("Could not create checklist. Try again."); return; }
          await supabase.from("checklist_items").insert([
            { checklist_id: data.id, user_id: user.id, text: "", position: 1024 },
            { checklist_id: data.id, user_id: user.id, text: "", position: 2048 },
            { checklist_id: data.id, user_id: user.id, text: "", position: 3072 },
          ]);
          await openChecklist(data.id);
          setDialog({ kind: "none" });
        }}
      />

      <TextPromptDialog
        open={dialog.kind === "edit-title"}
        title="Edit checklist title"
        label="Checklist title"
        initial={checklist.title}
        onClose={() => setDialog({ kind: "none" })}
        onSave={async (title) => {
          const { error } = await supabase.from("checklists").update({ title }).eq("id", checklist.id);
          if (error) { toast.error("Could not save title. Try again."); return; }
          setChecklist({ ...checklist, title });
          setDialog({ kind: "none" });
        }}
      />

      <TextPromptDialog
        open={dialog.kind === "duplicate-title"}
        title="Duplicate checklist"
        label="New checklist title"
        initial={`${checklist.title} Copy`}
        saveLabel="Duplicate"
        onClose={() => setDialog({ kind: "none" })}
        onSave={async (title) => {
          await duplicateCurrent(title);
          setDialog({ kind: "none" });
        }}
      />

      <AlertDialog open={dialog.kind === "delete-checklist"} onOpenChange={(o) => { if (!o) setDialog({ kind: "none" }); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this checklist?</AlertDialogTitle>
            <AlertDialogDescription>
              "{checklist.title}" and all its checkboxes will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); deleteCurrentChecklist(); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ChecklistPickerDialog
        open={dialog.kind === "insert-link"}
        excludeId={checklist.id}
        onClose={() => setDialog({ kind: "none" })}
        onPick={async (id, title) => {
          const src = highestUnchecked;
          await insertItemAfter(src?.id ?? null, { text: title, linked_checklist_id: id });
          setDialog({ kind: "none" });
        }}
      />

      <SendToChecklistDialog
        open={dialog.kind === "send-to"}
        excludeId={checklist.id}
        onClose={() => setDialog({ kind: "none" })}
        onSend={handleSendTo}
      />

      <TextPromptDialog
        open={dialog.kind === "send-to-blank"}
        title="Send to new checklist"
        label="Title for the new checklist"
        initial={highestUnchecked?.text?.slice(0, 80) ?? ""}
        saveLabel="Create & send"
        onClose={() => setDialog({ kind: "none" })}
        onSave={handleSendToBlank}
      />

      <BackgroundPickerDialog
        open={dialog.kind === "bg"}
        current={checklist.background_color}
        onClose={() => setDialog({ kind: "none" })}
        onPick={async (color) => {
          const { error } = await supabase.from("checklists").update({ background_color: color }).eq("id", checklist.id);
          if (error) { toast.error("Could not save background. Try again."); return; }
          setChecklist({ ...checklist, background_color: color });
          setDialog({ kind: "none" });
        }}
      />

      {dialog.kind === "media" && user && (
        <MediaActionDialog
          open
          title={
            dialog.action === "text-image" ? "Text to image" :
            dialog.action === "image-image" ? "Image to image" :
            dialog.action === "remix" ? "Remix multiple images" :
            dialog.action === "image-video" ? "Image to video" :
            dialog.action === "video-video" ? "Video to video" : "Analyze image"
          }
          prompt={dialog.sourceItem.text || "(empty)"}
          mode={dialog.action}
          userId={user.id}
          onClose={() => setDialog({ kind: "none" })}
          onGenerate={(opts) => runMediaAction(dialog.sourceItem, dialog.action, opts)}
          generateLabel={dialog.action === "analyze-image" ? "Analyze" : "Generate"}
        />
      )}

      <MediaViewer
        open={!!viewer}
        url={viewer?.url ?? null}
        type={viewer?.type ?? null}
        onClose={() => setViewer(null)}
      />

      <ScheduleActionDialog
        open={!!pendingEnqueue}
        actionLabel={pendingEnqueue?.actionLabel ?? ""}
        onClose={() => { setPendingEnqueue(null); setPendingContext({ checklists: [], media: [] }); }}
        onPick={submitEnqueue}
        userId={user?.id}
        excludeChecklistId={checklist?.id}
        context={pendingContext}
        onContextChange={setPendingContext}
      />
    </div>
  );
};

export default ChecklistPage;
