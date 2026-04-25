import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Checklist, ChecklistItem } from "@/lib/types";
import { ChecklistSearch } from "@/components/ChecklistSearch";
import { ItemRow } from "@/components/ItemRow";
import { ActionsSheet, ActionKey } from "@/components/ActionsSheet";
import { Button } from "@/components/ui/button";
import { TextPromptDialog } from "@/components/TextPromptDialog";
import { ChecklistPickerDialog } from "@/components/ChecklistPickerDialog";
import { BackgroundPickerDialog } from "@/components/BackgroundPickerDialog";
import { MediaActionDialog, GenOptions } from "@/components/MediaActionDialog";
import { MediaViewer } from "@/components/MediaViewer";
import { toast } from "sonner";
import { primeSpeech, speak, stopSpeech } from "@/lib/speech";
import { extractFirstUrl, isUrl, splitTextWithLinks } from "@/lib/split";

const POS_STEP = 1024;

type DialogState =
  | { kind: "none" }
  | { kind: "new" }
  | { kind: "edit-title" }
  | { kind: "insert-link" }
  | { kind: "bg" }
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
  const [focusItemId, setFocusItemId] = useState<string | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    return (localStorage.getItem("mc-theme") as "light" | "dark") ?? "light";
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    localStorage.setItem("mc-theme", theme);
  }, [theme]);

  const itemRefs = useRef<Record<string, HTMLLIElement | null>>({});
  const registerRef = useCallback((id: string, el: HTMLLIElement | null) => {
    itemRefs.current[id] = el;
  }, []);

  // Load initial checklist
  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const { data: lists } = await supabase
        .from("checklists").select("*").order("updated_at", { ascending: false }).limit(1);
      let active = lists?.[0] as Checklist | undefined;
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
    const { data: cl } = await supabase.from("checklists").select("*").eq("id", id).single();
    const { data: its } = await supabase
      .from("checklist_items").select("*").eq("checklist_id", id).order("position", { ascending: true });
    setChecklist(cl as Checklist);
    setItems((its ?? []) as ChecklistItem[]);
  };

  const highestUnchecked = useMemo(() => items.find((i) => !i.checked) ?? null, [items]);

  const scrollItemToCenter = (id: string) => {
    requestAnimationFrame(() => {
      const el = itemRefs.current[id];
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const handleToggle = async (item: ChecklistItem, next: boolean) => {
    primeSpeech();
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, checked: next } : i)));
    await supabase.from("checklist_items").update({ checked: next }).eq("id", item.id);
    if (next) {
      // find next highest unchecked AFTER toggling
      const updated = items.map((i) => (i.id === item.id ? { ...i, checked: true } : i));
      const nxt = updated.find((i) => !i.checked);
      if (nxt) {
        scrollItemToCenter(nxt.id);
        const speakText = nxt.linked_checklist_id ? (nxt.text || "Open checklist") : nxt.text;
        if (speakText) speak(speakText);
      } else {
        stopSpeech();
      }
    }
  };

  const handleTextChange = async (item: ChecklistItem, text: string) => {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, text } : i)));
    // detect external link in pure-link content
    const trimmed = text.trim();
    const externalLink = isUrl(trimmed) ? trimmed : null;
    await supabase.from("checklist_items").update({ text, external_link: externalLink }).eq("id", item.id);
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

  // ---------- Action Handlers ----------

  const onPick = async (key: ActionKey) => {
    setActionsOpen(false);
    if (!checklist || !user) return;

    switch (key) {
      case "add": {
        const sourceId = highestUnchecked?.id ?? (items[items.length - 1]?.id ?? null);
        const created = await insertItemAfter(sourceId, { text: "" });
        if (created) setFocusItemId(created.id);
        break;
      }
      case "new":
        setDialog({ kind: "new" });
        break;
      case "duplicate":
        await duplicateCurrent();
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
      case "web-search":
        await runWebSearch();
        break;
      case "bg":
        setDialog({ kind: "bg" });
        break;
      case "sign-out":
        try { await signOut(); navigate("/login", { replace: true }); }
        catch { toast.error("Could not sign out. Try again."); }
        break;
    }
  };

  const duplicateCurrent = async () => {
    if (!checklist || !user) return;
    const newTitle = `${checklist.title} Copy`;
    const { data: created, error } = await supabase
      .from("checklists")
      .insert({ user_id: user.id, title: newTitle, background_color: checklist.background_color })
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

  const runTextToText = async () => {
    if (!highestUnchecked) {
      toast.error("No unchecked checkbox found.");
      return;
    }
    const src = highestUnchecked;
    const t = toast.loading("Generating text…");
    try {
      const { data, error } = await supabase.functions.invoke("openai-text", {
        body: { prompt: src.text },
      });
      if (error || !data?.text) throw new Error(data?.error ?? error?.message ?? "fail");
      await insertItemAfter(src.id, { text: data.text });
      toast.success("Done", { id: t });
    } catch {
      toast.error("Text generation failed. Try again.", { id: t });
    }
  };

  const runWebSearch = async () => {
    if (!highestUnchecked) {
      toast.error("No unchecked checkbox found.");
      return;
    }
    const src = highestUnchecked;
    const t = toast.loading("Searching the web…");
    try {
      const { data, error } = await supabase.functions.invoke("perplexity-search", {
        body: { query: src.text },
      });
      if (error || !data?.text) throw new Error(data?.error ?? error?.message ?? "fail");
      await insertItemAfter(src.id, { text: data.text });
      toast.success("Done", { id: t });
    } catch {
      toast.error("Web search failed. Try again.", { id: t });
    }
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
  const runMediaAction = async (sourceItem: ChecklistItem, action: MediaAction, opts: GenOptions) => {
    if (!checklist) return;
    const t = toast.loading("Working…");
    try {
      if (action === "text-image") {
        const { data, error } = await supabase.functions.invoke("lovable-image", {
          body: { prompt: sourceItem.text, aspectRatio: opts.aspectRatio, quality: opts.quality },
        });
        if (error || !data?.dataUrl) throw new Error(data?.error ?? "fail");
        const url = await uploadGeneratedToStorage(data.dataUrl, "png") ?? data.dataUrl;
        await insertItemAfter(sourceItem.id, { text: "Generated image", media_url: url, media_type: "image" });
        toast.success("Image ready.", { id: t });
      } else if (action === "image-image" || action === "remix") {
        const refImages = await Promise.all((opts.files ?? []).map(fileToBase64));
        const { data, error } = await supabase.functions.invoke("lovable-image", {
          body: { prompt: sourceItem.text, aspectRatio: opts.aspectRatio, quality: opts.quality, refImages },
        });
        if (error || !data?.dataUrl) throw new Error(data?.error ?? "fail");
        const url = await uploadGeneratedToStorage(data.dataUrl, "png") ?? data.dataUrl;
        await insertItemAfter(sourceItem.id, { text: action === "remix" ? "Remixed image" : "Edited image", media_url: url, media_type: "image" });
        toast.success("Image ready.", { id: t });
      } else if (action === "image-video" || action === "video-video") {
        const file = opts.files?.[0];
        if (!file) throw new Error("missing");
        const dataUrl = await fileToBase64(file);
        const { data, error } = await supabase.functions.invoke("fal-video", {
          body: {
            prompt: sourceItem.text,
            sourceDataUrl: dataUrl,
            sourceKind: action === "video-video" ? "video" : "image",
            aspectRatio: opts.aspectRatio,
          },
        });
        if (error || !data?.url) throw new Error(data?.error ?? "fail");
        await insertItemAfter(sourceItem.id, { text: "Generated video", media_url: data.url, media_type: "video" });
        toast.success("Video ready.", { id: t });
      } else if (action === "analyze-image") {
        const file = opts.files?.[0];
        if (!file) throw new Error("missing");
        const dataUrl = await fileToBase64(file);
        const { data, error } = await supabase.functions.invoke("openai-vision", {
          body: { prompt: sourceItem.text, imageDataUrl: dataUrl },
        });
        if (error || !data?.text) throw new Error(data?.error ?? "fail");
        await insertItemAfter(sourceItem.id, { text: data.text });
        toast.success("Analyzed.", { id: t });
      }
    } catch (e: any) {
      const map: Record<string, string> = {
        "text-image": "Image generation failed. Try again.",
        "image-image": "Image-to-image failed. Try again.",
        "remix": "Image remix failed. Try again.",
        "image-video": "Image-to-video failed. Try again.",
        "video-video": "Video-to-video failed. Try again.",
        "analyze-image": "Image analysis failed. Try again.",
      };
      toast.error(map[action] ?? "Failed. Try again.", { id: t });
    } finally {
      setDialog({ kind: "none" });
    }
  };

  if (loading || !checklist) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: checklist.background_color }}>
      <header className="sticky top-0 z-20 px-4 pt-3 pb-3 backdrop-blur-md" style={{ backgroundColor: `${checklist.background_color}cc` }}>
        <ChecklistSearch onPick={openChecklist} />
        <h1
          className="mt-3 text-xl font-semibold leading-tight cursor-text"
          onClick={() => setDialog({ kind: "edit-title" })}
          title="Tap to rename"
        >
          {checklist.title}
        </h1>
      </header>

      <main className="flex-1 px-3 pt-1 pb-actions">
        {items.length === 0 ? (
          <p className="text-center text-muted-foreground mt-12 text-sm">This checklist is empty.</p>
        ) : (
          <ul className="flex flex-col gap-2 max-w-2xl mx-auto w-full">
            {items.map((it) => (
              <ItemRow
                key={it.id}
                item={it}
                autoFocus={focusItemId === it.id}
                onToggle={handleToggle}
                onTextChange={handleTextChange}
                onOpenLinkedChecklist={openChecklist}
                onOpenMedia={(url, type) => setViewer({ url, type })}
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
          <Button
            onClick={() => { primeSpeech(); setActionsOpen(true); }}
            className="w-full h-14 rounded-2xl text-base font-semibold shadow-floating"
          >
            Actions
          </Button>
        </div>
      </div>

      <ActionsSheet open={actionsOpen} onOpenChange={setActionsOpen} onPick={onPick} />

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

      {dialog.kind === "media" && (
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
    </div>
  );
};

export default ChecklistPage;
