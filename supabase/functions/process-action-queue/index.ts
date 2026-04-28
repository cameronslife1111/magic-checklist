// Background worker invoked every minute by pg_cron.
// Claims pending/scheduled AI jobs, runs them, writes results back to checklist_items.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const POS_STEP = 1024;
const MAX_BATCH = 5;

type Job = {
  id: string;
  user_id: string;
  checklist_id: string;
  source_item_id: string | null;
  action_type: string;
  payload: any;
  attempts: number;
  max_attempts: number;
  recurrence: string | null;
  // Async provider state (for long-running Fal video/avatar jobs)
  provider: string | null;
  provider_request_id: string | null;
  provider_status_url: string | null;
  provider_response_url: string | null;
  // Sequence parent state (only set on action-sequence parent rows)
  sequence_state?: any;
  parent_job_id?: string | null;
  sequence_step?: number | null;
};

function recurrenceToInterval(r: string | null): string | null {
  switch (r) {
    case "hourly": return "1 hour";
    case "daily": return "1 day";
    case "weekly": return "7 days";
    case "monthly": return "1 month";
    case "yearly": return "1 year";
    default: return null;
  }
}

async function explainErrorInline(action_type: string, error_raw: string): Promise<{ cause: string; fix: string }> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return { cause: error_raw.slice(0, 200), fix: "Try again later." };
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.4-2026-03-05",
        messages: [
          { role: "system", content: `Translate this API error into plain English. Respond as strict JSON: {"cause":"<one short sentence, no jargon, no error codes>","fix":"<one short concrete suggestion>"}` },
          { role: "user", content: `Action: ${action_type}\nError:\n${error_raw}` },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      console.error(`explainErrorInline openai status=${r.status} body=${t.slice(0, 300)}`);
      return { cause: error_raw.slice(0, 200), fix: "Try the action again." };
    }
    const data = await r.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
    return {
      cause: String(parsed.cause ?? error_raw).slice(0, 500),
      fix: String(parsed.fix ?? "Try again later.").slice(0, 500),
    };
  } catch {
    return { cause: error_raw.slice(0, 200), fix: "Try again later." };
  }
}

async function callFn(name: string, body: any, signal?: AbortSignal) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", apikey: SERVICE_KEY },
    body: JSON.stringify(body),
    signal,
  });
  const text = await r.text();
  let json: any = {};
  try { json = JSON.parse(text); } catch { /* keep raw */ }
  if (!r.ok || json?.error) {
    throw new Error(json?.error ?? `${name} ${r.status}: ${text.slice(0, 300)}`);
  }
  return json;
}

async function uploadDataUrl(supabase: any, userId: string, dataUrl: string, ext: string): Promise<string> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const name = `${userId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("generated-media").upload(name, blob, { contentType: blob.type });
  if (error) throw new Error(`storage upload failed: ${error.message}`);
  return supabase.storage.from("generated-media").getPublicUrl(name).data.publicUrl;
}

// Picks the next "<baseLabel> N" title for a user, based on existing media_assets rows.
async function nextTitleForKind(supabase: any, userId: string, baseLabel: string): Promise<string> {
  try {
    const { data } = await supabase
      .from("media_assets")
      .select("title")
      .eq("user_id", userId)
      .ilike("title", `${baseLabel}%`);
    let max = 0;
    const re = new RegExp(`^${baseLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+(\\d+)$`, "i");
    for (const r of (data ?? []) as { title: string }[]) {
      const m = r.title?.match(re);
      if (m) {
        const n = parseInt(m[1], 10);
        if (Number.isFinite(n) && n > max) max = n;
      }
    }
    return `${baseLabel} ${max + 1}`;
  } catch {
    return `${baseLabel} 1`;
  }
}

// Adds a generated file to the user's Media Gallery and returns the unique title.
// Best-effort: never throws — if the gallery insert fails we still fall back to a
// numbered title so the checklist row keeps a sensible name.
async function registerGeneratedAsset(
  supabase: any,
  job: Job,
  args: { url: string; kind: "image" | "video"; mimeType: string; baseLabel: string },
): Promise<string> {
  const title = await nextTitleForKind(supabase, job.user_id, args.baseLabel);
  try {
    const marker = "/generated-media/";
    const idx = args.url.indexOf(marker);
    const storage_path = idx === -1 ? args.url : args.url.slice(idx + marker.length).split("?")[0];
    await supabase.from("media_assets").insert({
      user_id: job.user_id,
      title,
      kind: args.kind,
      url: args.url,
      storage_path,
      mime_type: args.mimeType,
    });
  } catch (e) {
    console.error("registerGeneratedAsset failed", e);
  }
  return title;
}

async function insertResultItem(
  supabase: any,
  job: Job,
  fields: { text: string; media_url?: string | null; media_type?: string | null },
) {
  // Sequence-aware: if this child job was dispatched by a Run Sequence parent,
  // attach the output as a child of the active checklist line (parent_item_id)
  // and place it immediately after that line. This makes the lineage visible
  // in the UI and gives each step a stable owner.
  const seqParentItemId: string | null = (job.payload as any)?.__sequence_parent_item_id ?? null;

  // Compute position right after either the active sequence line or the source item.
  const anchorItemId = seqParentItemId ?? job.source_item_id;

  const { data: list } = await supabase
    .from("checklist_items")
    .select("id,position,parent_item_id")
    .eq("checklist_id", job.checklist_id)
    .order("position", { ascending: true });
  const items = (list ?? []) as { id: string; position: number; parent_item_id: string | null }[];

  let position: number;
  if (seqParentItemId) {
    // Place after the parent line AND after any existing children of that line.
    const parentIdx = items.findIndex((i) => i.id === seqParentItemId);
    if (parentIdx === -1) {
      position = (items[items.length - 1]?.position ?? 0) + POS_STEP;
    } else {
      // Find the last existing child of this parent (consecutive children are
      // expected to come right after the parent in position order, but be
      // defensive and scan the whole list).
      let anchorPos = items[parentIdx].position;
      let nextPos: number | null = items[parentIdx + 1]?.position ?? null;
      for (let k = parentIdx + 1; k < items.length; k++) {
        if (items[k].parent_item_id === seqParentItemId) {
          anchorPos = items[k].position;
          nextPos = items[k + 1]?.position ?? null;
        } else {
          break;
        }
      }
      position = nextPos != null ? (anchorPos + nextPos) / 2 : anchorPos + POS_STEP;
    }
  } else if (anchorItemId && items.length) {
    const idx = items.findIndex((i) => i.id === anchorItemId);
    if (idx === -1) {
      position = (items[items.length - 1]?.position ?? 0) + POS_STEP;
    } else {
      const cur = items[idx];
      const next = items[idx + 1];
      position = next ? (cur.position + next.position) / 2 : cur.position + POS_STEP;
    }
  } else if (items.length) {
    position = items[items.length - 1].position + POS_STEP;
  } else {
    position = POS_STEP;
  }

  const { error } = await supabase.from("checklist_items").insert({
    checklist_id: job.checklist_id,
    user_id: job.user_id,
    text: fields.text,
    position,
    media_url: fields.media_url ?? null,
    media_type: fields.media_type ?? null,
    parent_item_id: seqParentItemId,
  });
  if (error) throw new Error(`insert item failed: ${error.message}`);
}

type ResolvedContext = {
  textBlock: string;
  imageUrls: string[];
  videoUrls: string[];
  audioUrls: string[];
  mediaRefsBlock: string;
};

async function resolveContext(supabase: any, payload: any): Promise<ResolvedContext> {
  const ctx = payload?.context ?? {};
  const checklistIds: string[] = Array.isArray(ctx.checklists) ? ctx.checklists : [];
  const media: { url: string; type: string; name: string }[] = Array.isArray(ctx.media) ? ctx.media : [];

  let textBlock = "";
  if (checklistIds.length) {
    const { data: lists } = await supabase.from("checklists").select("id,title").in("id", checklistIds);
    const { data: items } = await supabase
      .from("checklist_items")
      .select("checklist_id,text,position")
      .in("checklist_id", checklistIds)
      .order("position", { ascending: true });
    const titleMap = new Map((lists ?? []).map((l: any) => [l.id, l.title]));
    const grouped = new Map<string, string[]>();
    for (const it of (items ?? []) as any[]) {
      if (!it.text) continue;
      const arr = grouped.get(it.checklist_id) ?? [];
      arr.push(it.text);
      grouped.set(it.checklist_id, arr);
    }
    const blocks: string[] = [];
    for (const id of checklistIds) {
      const title = titleMap.get(id) ?? "Untitled";
      const lines = grouped.get(id) ?? [];
      blocks.push(`### Context from checklist "${title}"\n${lines.map((l) => `- ${l}`).join("\n")}`);
    }
    textBlock = blocks.join("\n\n");
  }

  const imageUrls = media.filter((m) => m.type === "image").map((m) => m.url);
  const videoUrls = media.filter((m) => m.type === "video").map((m) => m.url);
  const audioUrls = media.filter((m) => m.type === "audio").map((m) => m.url);
  const mediaRefsLines: string[] = [];
  for (const m of media) mediaRefsLines.push(`- ${m.url} (${m.type}${m.name ? `: ${m.name}` : ""})`);
  const mediaRefsBlock = mediaRefsLines.length ? `### Attached media references\n${mediaRefsLines.join("\n")}` : "";

  return { textBlock, imageUrls, videoUrls, audioUrls, mediaRefsBlock };
}

function buildPrompt(basePrompt: string, ctx: ResolvedContext, includeMediaRefs: boolean): string {
  const parts: string[] = [];
  if (ctx.textBlock) parts.push(ctx.textBlock);
  if (includeMediaRefs && ctx.mediaRefsBlock) parts.push(ctx.mediaRefsBlock);
  parts.push(basePrompt ?? "");
  return parts.filter(Boolean).join("\n\n");
}

async function urlToDataUrl(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch context url failed: ${r.status}`);
  const blob = await r.blob();
  const buf = await blob.arrayBuffer();
  // Chunked base64 to avoid stack overflow on large images.
  const bytes = new Uint8Array(buf);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`;
}

type JobOutcome =
  | { kind: "result"; result: any }
  | { kind: "handoff"; provider: string; status_url: string; response_url: string; request_id: string | null }
  | { kind: "sequence-tick" };

// Append a plain text item to the bottom of a checklist (used for sequence outputs / aborts).
async function appendItemToChecklist(
  supabase: any,
  args: { user_id: string; checklist_id: string; text: string; media_url?: string | null; media_type?: string | null },
) {
  const { data: list } = await supabase
    .from("checklist_items")
    .select("position")
    .eq("checklist_id", args.checklist_id)
    .order("position", { ascending: false })
    .limit(1);
  const last = (list ?? [])[0]?.position ?? 0;
  await supabase.from("checklist_items").insert({
    checklist_id: args.checklist_id,
    user_id: args.user_id,
    text: args.text,
    position: last + POS_STEP,
    media_url: args.media_url ?? null,
    media_type: args.media_type ?? null,
  });
}

// Unified media catalog entry the per-line planner can pick from.
type CatalogEntry = {
  handle: string;
  name: string;
  url: string;
  type: "image" | "video" | "audio";
  source: string;
};

const norm = (s: string) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

function looseMatchCatalog(needle: string, catalog: CatalogEntry[], wantType?: "image" | "video" | "audio") {
  if (!needle) return null;
  const n = norm(needle);
  if (!n) return null;
  const candidates = wantType ? catalog.filter((c) => c.type === wantType) : catalog;
  let best: { item: CatalogEntry; score: number } | null = null;
  for (const g of candidates) {
    const gn = norm(g.name);
    let score = 0;
    if (gn === n) score = 1000;
    else if (gn.includes(n) || n.includes(gn)) score = 500 - Math.abs(gn.length - n.length);
    else {
      const ts = new Set(gn.split(/\s+/));
      const overlap = n.split(/\s+/).filter((t) => t && ts.has(t)).length;
      if (overlap > 0) score = overlap * 10;
    }
    if (score > 0 && (!best || score > best.score)) best = { item: g, score };
  }
  return best?.item ?? null;
}

function topNCatalog(needle: string, catalog: CatalogEntry[], n = 3): CatalogEntry[] {
  const nn = norm(needle);
  if (!nn) return catalog.slice(0, n);
  const scored = catalog.map((c) => {
    const gn = norm(c.name);
    let score = 0;
    if (gn === nn) score = 1000;
    else if (gn.includes(nn) || nn.includes(gn)) score = 500 - Math.abs(gn.length - nn.length);
    else {
      const ts = new Set(gn.split(/\s+/));
      const overlap = nn.split(/\s+/).filter((t) => t && ts.has(t)).length;
      score = overlap * 10;
    }
    return { c, score };
  }).sort((a, b) => b.score - a.score);
  return scored.slice(0, n).map((x) => x.c);
}

// Resolve a planner ref string to a CatalogEntry. STRICT: exact-handle match
// only. We do NOT loose-match by name anymore — the catalog is per-line and
// already filtered, so name-based fallbacks were the main source of "wrong
// video" errors. The planner is instructed to always emit handles.
function resolveRef(ref: string, kind: "image" | "video" | "audio", catalog: CatalogEntry[]): CatalogEntry | null {
  if (!ref) return null;
  for (const c of catalog) {
    if (c.handle === ref) return c.type === kind ? c : null;
  }
  return null;
}

// Snippet for human-readable labels.
const snip = (s: string, n = 60) => {
  const t = (s ?? "").trim().replace(/\s+/g, " ");
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

function detectKind(mediaType: string | null | undefined, url: string | null | undefined): "image" | "video" | "audio" | null {
  if (mediaType === "image" || mediaType === "video" || mediaType === "audio") return mediaType;
  if (typeof url === "string") {
    if (/\.(mp4|webm|mov|m4v)(\?|$)/i.test(url)) return "video";
    if (/\.(mp3|wav|m4a|ogg|aac)(\?|$)/i.test(url)) return "audio";
    if (/\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(url)) return "image";
  }
  return null;
}

// Load ONLY the checklists the user explicitly attached via the Run Sequence
// Context Attacher. We deliberately do NOT follow inline `linked_checklist_id`
// references on the input checklist's items — that auto-discovery was confusing
// the planner with unrelated lists. The Run Sequence dialog is the single
// source of truth for context now.
async function loadAttachedLists(
  supabase: any,
  attachedChecklistIds: string[] = [],
) {
  const MAX_LISTS = 15;
  const MAX_ITEMS_PER_LIST = 100;

  const ids = (attachedChecklistIds ?? [])
    .filter((x): x is string => typeof x === "string")
    .slice(0, MAX_LISTS);
  if (ids.length === 0) return [];

  const { data: lists } = await supabase.from("checklists").select("id,title").in("id", ids);
  const { data: items } = await supabase
    .from("checklist_items")
    .select("checklist_id, text, position, media_url, media_type")
    .in("checklist_id", ids)
    .order("position", { ascending: true });
  const titleMap = new Map(((lists ?? []) as any[]).map((l) => [l.id, l.title]));
  const grouped = new Map<string, any[]>();
  for (const it of (items ?? []) as any[]) {
    const arr = grouped.get(it.checklist_id) ?? [];
    if (arr.length < MAX_ITEMS_PER_LIST) arr.push(it);
    grouped.set(it.checklist_id, arr);
  }
  return ids.map((id, idx) => ({
    list_idx: idx,
    list_id: id,
    title: titleMap.get(id) ?? "Untitled",
    depth: 1,
    via_title: null,
    items: grouped.get(id) ?? [],
  }));
}

// Detects whether the current checklist line back-references prior step
// outputs. If it does, prior step outputs are exposed in this line's catalog;
// otherwise they are hidden, so the planner can't accidentally grab a stale
// asset for a fresh, unrelated line.
const BACKREF_RE = /\b(previous|prior|the\s+result|that\s+(image|video|audio|file|one)|what\s+we\s+(just|previously)\s+made|step\s+\d+|above|earlier|just\s+made|last\s+(image|video|output))\b/i;
function lineBackReferences(text: string, priorOutputs: any[]): boolean {
  if (!text) return false;
  if (BACKREF_RE.test(text)) return true;
  // Also expose prior outputs if the line names one of them.
  const t = norm(text);
  for (const o of priorOutputs ?? []) {
    if (!o?.name) continue;
    const n = norm(o.name);
    if (n && t.includes(n)) return true;
  }
  return false;
}

// Build the per-LINE catalog for the planner. Scope is intentionally narrow:
//  - The current line's own attached media (line:image/video/audio).
//  - Media inside the line's own linked checklist (linked-line:I).
//  - Global media attached in the Run Sequence dialog (attached:N).
//  - Prior step outputs (step:N) — ONLY if this line clearly back-references
//    a prior result, otherwise hidden.
//  - Global linked checklists from the Run Sequence dialog: their TEXT goes
//    into linked_context_text only; their MEDIA is intentionally NOT in the
//    catalog for media tools (that's how the planner used to grab the wrong
//    video). If the user wants a specific media file used, they attach it
//    via the gallery picker (attached:N).
function buildLineCatalog(state: any, lineIdx: number): { catalog: CatalogEntry[] } {
  const out: CatalogEntry[] = [];
  const line = (state.input_lines ?? [])[lineIdx];
  if (!line) return { catalog: [] };

  // 1) The line's own attached media.
  if (line.media_url) {
    const k = detectKind(line.media_type, line.media_url);
    if (k) {
      out.push({
        handle: `line:${k}:0`,
        name: `This line's ${k}`,
        url: line.media_url,
        type: k,
        source: "line-media",
      });
    }
  }

  // 2) Media inside the line's own linked checklist.
  const lineLinked = state.line_linked_lists?.[line.linked_checklist_id];
  if (lineLinked && Array.isArray(lineLinked.items)) {
    lineLinked.items.forEach((it: any, iIdx: number) => {
      if (!it?.media_url) return;
      const k = detectKind(it.media_type, it.media_url);
      if (!k) return;
      out.push({
        handle: `linked-line:${iIdx}`,
        name: `${lineLinked.title} – ${snip(it.text || `Line ${iIdx + 1}`, 40)}`,
        url: it.media_url,
        type: k,
        source: "line-linked",
      });
    });
  }

  // 3) Global attached media (from Run Sequence dialog).
  const attached: any[] = state.attached_media ?? [];
  attached.forEach((m, i) => {
    if (!m?.url) return;
    const k = detectKind(m.type, m.url);
    if (!k) return;
    out.push({
      handle: `attached:${i}`,
      name: m.name ?? `Attached ${i + 1}`,
      url: m.url,
      type: k,
      source: "attached",
    });
  });

  // 4) Prior step outputs — gated by back-reference detection.
  const outputs: any[] = state.outputs ?? [];
  if (lineBackReferences(line.text, outputs)) {
    outputs.forEach((o, i) => {
      if (!o || !o.media_url) return;
      const k = detectKind(o.media_type, o.media_url);
      if (!k) return;
      out.push({
        handle: `step:${i}`,
        name: o.name ?? `Step ${i + 1} output`,
        url: o.media_url,
        type: k,
        source: "step-output",
      });
    });
  }

  return { catalog: out.slice(0, 100) };
}

function buildLinkedContextText(state: any, lineIdx: number): string {
  const blocks: string[] = [];

  // Full input checklist (text-only) so the agent knows what's coming.
  const inputLines: any[] = state.input_lines ?? [];
  if (inputLines.length) {
    const lines = inputLines.map((l: any, i: number) => `${i + 1}. ${l.text}`).filter((s: string) => s.trim());
    if (lines.length) blocks.push(`### Full input checklist (for context only)\n${lines.join("\n")}`);
  }

  // Global linked checklists (Run Sequence dialog) — TEXT only.
  const linked: any[] = state.linked_lists ?? [];
  for (const ll of linked) {
    const lines = (ll.items ?? []).map((it: any) => it.text).filter((t: any) => typeof t === "string" && t.trim());
    if (lines.length === 0) continue;
    blocks.push(`### Reference checklist "${ll.title}"\n${lines.map((l: string) => `- ${l}`).join("\n")}`);
  }

  // The current line's own linked checklist — TEXT only.
  const line = inputLines[lineIdx];
  const own = line ? state.line_linked_lists?.[line.linked_checklist_id] : null;
  if (own && Array.isArray(own.items)) {
    const lines = own.items.map((it: any) => it.text).filter((t: any) => typeof t === "string" && t.trim());
    if (lines.length) blocks.push(`### This line's linked checklist "${own.title}"\n${lines.map((l: string) => `- ${l}`).join("\n")}`);
  }

  return blocks.join("\n\n");
}

// One state-machine tick for an action-sequence parent. Idempotent and bounded.
async function tickSequence(supabase: any, parent: Job): Promise<{ done: boolean; aborted?: string }> {
  const state = (parent.sequence_state && Object.keys(parent.sequence_state).length ? parent.sequence_state : null) ?? {
    phase: "planning_init",
    cursor: 0,            // index into input_lines
    pending_steps: [] as any[],   // queued sub-steps for the current line (for compound)
    outputs: [] as any[],         // outputs[stepGlobalIdx] (one per dispatched step)
    steps_used: 0,
    images_used: 0,
    videos_used: 0,
    failures: 0,
  };
  const payload = parent.payload ?? {};
  const maxSteps = Number(payload.max_steps ?? 12);
  const maxImages = Number(payload.max_images ?? 12);
  const maxVideos = Number(payload.max_videos ?? 4);
  const maxRuntimeMin = Number(payload.max_runtime_minutes ?? 30);
  const maxFailures = Number(payload.max_failures ?? 2);
  const outputChecklistId: string = payload.output_checklist_id ?? parent.checklist_id;

  const persist = async () => {
    await supabase.from("action_jobs").update({ sequence_state: state }).eq("id", parent.id);
  };

  const clearActiveLine = async () => {
    try { await supabase.from("action_jobs").update({ active_line_item_id: null }).eq("id", parent.id); } catch {}
  };

  const abortSequence = async (reason: string) => {
    state.phase = "aborted";
    state.abort_reason = reason;
    await supabase.from("action_jobs").update({
      status: "failed",
      sequence_state: state,
      active_line_item_id: null,
      error_raw: reason,
      error_friendly: `Sequence stopped: ${reason}`,
      error_fix: "Open the parent action and re-run with adjusted budgets or instructions.",
      completed_at: new Date().toISOString(),
    }).eq("id", parent.id);
    await appendItemToChecklist(supabase, {
      user_id: parent.user_id,
      checklist_id: outputChecklistId,
      text: `⚠️ Sequence stopped: ${reason}`,
    });
    return { done: true, aborted: reason };
  };

  const finishOk = async () => {
    state.phase = "completed";
    await supabase.from("action_jobs").update({
      status: "completed",
      sequence_state: state,
      active_line_item_id: null,
      result: { steps: state.outputs.length, lines: (state.input_lines ?? []).length },
      completed_at: new Date().toISOString(),
    }).eq("id", parent.id);
    const ok = state.outputs.filter((o: any) => o && !o.failed && !o.skipped && !o.no_action).length;
    await appendItemToChecklist(supabase, {
      user_id: parent.user_id,
      checklist_id: outputChecklistId,
      text: `✅ Sequence finished — ${ok} step(s) completed`,
    });
    return { done: true };
  };

  // Runtime/failure budgets (always enforced).
  const startedAt = state.started_at ? new Date(state.started_at).getTime() : Date.now();
  if (!state.started_at) state.started_at = new Date(startedAt).toISOString();
  if (Date.now() - startedAt > maxRuntimeMin * 60_000) {
    return abortSequence(`exceeded ${maxRuntimeMin} minute runtime budget`);
  }
  if (state.failures >= maxFailures) {
    return abortSequence(`${state.failures} step(s) failed (limit ${maxFailures})`);
  }

  // ── PHASE: planning_init ────────────────────────────────────────────────
  if (state.phase === "planning_init") {
    const { data: items } = await supabase
      .from("checklist_items")
      .select("text, position, media_url, media_type")
      .eq("checklist_id", parent.checklist_id)
      .order("position", { ascending: true });
    const inputLines = ((items ?? []) as any[])
      .map((i) => ({ text: (i.text ?? "").trim(), media_url: i.media_url ?? null, media_type: i.media_type ?? null }));
    if (inputLines.length === 0) return abortSequence("input checklist is empty");
    state.input_lines = inputLines.slice(0, 60);

    const ctx = payload?.context ?? {};
    const attachedChecklistIds: string[] = Array.isArray(ctx.checklists)
      ? ctx.checklists.filter((x: any) => typeof x === "string")
      : [];
    // Only load checklists the user explicitly attached. No BFS over inline
    // checklist links, no full-gallery snapshot.
    state.linked_lists = await loadAttachedLists(supabase, attachedChecklistIds);
    state.gallery = [];

    state.attached_media = Array.isArray(ctx.media)
      ? ctx.media.filter((m: any) => m && typeof m.url === "string").slice(0, 30)
      : [];

    state.phase = "planning_step";
    state.cursor = 0;
    await persist();
    // fall through
  }

  // ── PHASE: planning_step ────────────────────────────────────────────────
  if (state.phase === "planning_step") {
    if (state.cursor >= (state.input_lines ?? []).length || state.steps_used >= maxSteps) {
      return finishOk();
    }
    const lineIdx: number = state.cursor;
    const line = state.input_lines[lineIdx];
    if (!line || !line.text) {
      state.outputs.push({ no_action: true, line_idx: lineIdx, reason: "blank line" });
      state.cursor += 1;
      await persist();
      return { done: false };
    }
    const { catalog } = buildCatalog(state);
    const linkedText = buildLinkedContextText(state);
    const upcoming = (state.input_lines ?? []).slice(lineIdx + 1, lineIdx + 4).map((l: any) => l.text).filter(Boolean);
    const priorOutputsSummary = (state.outputs ?? []).map((o: any, i: number) => {
      if (!o) return null;
      if (o.no_action) return null;
      if (o.skipped) return { step: i, kind: "skipped" };
      if (o.failed) return { step: i, kind: "failed" };
      const k = detectKind(o.media_type, o.media_url);
      return { step: i, kind: k ?? (o.text ? "text" : "unknown"), name: o.name ?? `Step ${i + 1} output` };
    }).filter(Boolean).slice(-12);

    const allowed = Array.isArray(payload.allowed_actions) && payload.allowed_actions.length
      ? payload.allowed_actions
      : ["text-text","text-image","image-image","remix","image-video","video-video","audio-image-video","analyze-image","web-search"];

    let decision: any;
    try {
      decision = await callFn("plan-action-sequence", {
        current_line: line.text,
        prior_outputs_summary: priorOutputsSummary,
        upcoming_lines_preview: upcoming,
        catalog,
        linked_context_text: linkedText,
        allowed_actions: allowed,
        max_images_per_step: Number(payload.max_images_per_step ?? 2),
      });
    } catch (e) {
      state.outputs.push({ failed: true, line_idx: lineIdx, reason: `planner error: ${(e as Error).message.slice(0, 200)}` });
      state.failures += 1;
      state.cursor += 1;
      await appendItemToChecklist(supabase, {
        user_id: parent.user_id,
        checklist_id: outputChecklistId,
        text: `⚠️ Step ${lineIdx + 1}: planner failed — ${(e as Error).message.slice(0, 200)}`,
      });
      await persist();
      return { done: false };
    }

    if (!decision || decision.kind === "no_action") {
      state.outputs.push({ no_action: true, line_idx: lineIdx, reason: decision?.reason ?? "" });
      state.cursor += 1;
      await persist();
      return { done: false };
    }
    const steps: any[] = decision.kind === "compound" ? (decision.steps ?? []) : [decision.step];
    state.pending_steps = steps.filter(Boolean).map((s: any) => ({ ...s, line_idx: lineIdx }));
    state.current_step_in_line = 0;
    state.phase = "dispatching";
    await persist();
    // fall through
  }

  // ── PHASE: dispatching ──────────────────────────────────────────────────
  if (state.phase === "dispatching") {
    if (!state.pending_steps || state.pending_steps.length === 0) {
      state.cursor += 1;
      state.phase = "planning_step";
      await persist();
      return { done: false };
    }
    if (state.steps_used >= maxSteps) {
      return abortSequence(`step budget reached (${maxSteps})`);
    }
    const step = state.pending_steps[0];
    const lineIdx: number = step.line_idx ?? state.cursor;

    const willMakeImage = step.action_type === "text-image" || step.action_type === "image-image" || step.action_type === "remix";
    const willMakeVideo = step.action_type === "image-video" || step.action_type === "video-video" || step.action_type === "audio-image-video";
    if (willMakeImage && state.images_used >= maxImages) {
      return abortSequence(`image budget reached (${maxImages})`);
    }
    if (willMakeVideo && state.videos_used >= maxVideos) {
      return abortSequence(`video budget reached (${maxVideos})`);
    }

    const { catalog } = buildCatalog(state);
    const refs = step.input_refs ?? {};

    const resolveList = (arr: any[], kind: "image" | "video" | "audio") => {
      const matched: { url: string; name: string }[] = [];
      const missed: string[] = [];
      for (const r of arr) {
        if (typeof r !== "string") continue;
        const m = resolveRef(r, kind, catalog);
        if (m) matched.push({ url: m.url, name: m.name });
        else missed.push(r);
      }
      return { matched, missed };
    };
    const imgRes = resolveList(refs.images ?? [], "image");
    const vidRes = resolveList(refs.videos ?? [], "video");
    const audRes = resolveList(refs.audios ?? [], "audio");

    const actionType: string = step.action_type;
    const childPayload: any = { prompt: step.prompt };
    if (step.aspect_ratio) childPayload.aspectRatio = step.aspect_ratio;
    if (step.quality) childPayload.quality = step.quality;
    let valid = true;
    let invalidReason = "";
    let missedRefs: string[] = [];
    const imageUrls = imgRes.matched.map((m) => m.url);
    const videoUrls = vidRes.matched.map((m) => m.url);
    const audioUrls = audRes.matched.map((m) => m.url);

    switch (actionType) {
      case "text-text":
      case "web-search":
        break;
      case "text-image":
        if (imageUrls.length) childPayload.refImageUrls = imageUrls.slice(0, 16);
        break;
      case "image-image":
        if (imageUrls.length === 0) { valid = false; invalidReason = "needs an image reference"; missedRefs = imgRes.missed; }
        else childPayload.refImageUrls = imageUrls.slice(0, 16);
        break;
      case "remix":
        if (imageUrls.length < 1) { valid = false; invalidReason = "needs at least one image to remix"; missedRefs = imgRes.missed; }
        else childPayload.refImageUrls = imageUrls.slice(0, 16);
        break;
      case "image-video":
        if (imageUrls.length === 0) { valid = false; invalidReason = "needs an image to animate"; missedRefs = imgRes.missed; }
        else childPayload.sourceUrl = imageUrls[0];
        break;
      case "video-video":
        if (videoUrls.length === 0) { valid = false; invalidReason = "needs a video to edit"; missedRefs = vidRes.missed; }
        else childPayload.sourceUrl = videoUrls[0];
        break;
      case "audio-image-video":
        if (imageUrls.length === 0 || audioUrls.length === 0) {
          valid = false;
          invalidReason = "needs both an image and an audio file";
          missedRefs = [...imgRes.missed, ...audRes.missed];
        } else { childPayload.imageUrl = imageUrls[0]; childPayload.audioUrl = audioUrls[0]; }
        break;
      case "analyze-image":
        if (imageUrls.length === 0) { valid = false; invalidReason = "needs an image to analyze"; missedRefs = imgRes.missed; }
        else childPayload.imageUrl = imageUrls[0];
        break;
      default:
        valid = false; invalidReason = `unknown action ${actionType}`;
    }

    if (!valid) {
      const wanted = missedRefs[0] ?? "(no name given)";
      const closest = topNCatalog(wanted, catalog, 3).map((c) => `"${c.name}"`).join(", ");
      const hint = closest ? ` Closest in your library: ${closest}.` : "";
      await appendItemToChecklist(supabase, {
        user_id: parent.user_id,
        checklist_id: outputChecklistId,
        text: `⚠️ Line ${lineIdx + 1}: ${invalidReason}. Asked for "${wanted}".${hint} Try renaming the file or attaching it to this line.`,
      });
      state.outputs.push({ skipped: true, line_idx: lineIdx, reason: invalidReason, wanted });
      state.pending_steps.shift();
      state.steps_used += 1;
      await persist();
      return { done: false };
    }

    const count = Math.max(1, Number(step.count ?? 1));
    const insertRows: any[] = [];
    const stepGlobalIdx = state.outputs.length;
    for (let i = 0; i < count; i++) {
      insertRows.push({
        user_id: parent.user_id,
        checklist_id: outputChecklistId,
        source_item_id: null,
        action_type: actionType,
        status: "pending",
        payload: childPayload,
        prompt_preview: String(step.prompt).slice(0, 500),
        parent_job_id: parent.id,
        sequence_step: stepGlobalIdx,
      });
    }
    const { data: inserted, error: insErr } = await supabase
      .from("action_jobs").insert(insertRows).select("id");
    if (insErr) {
      await appendItemToChecklist(supabase, {
        user_id: parent.user_id,
        checklist_id: outputChecklistId,
        text: `⚠️ Could not queue line ${lineIdx + 1}: ${insErr.message}`,
      });
      state.outputs.push({ failed: true, line_idx: lineIdx, reason: insErr.message });
      state.failures += 1;
      state.pending_steps.shift();
      state.steps_used += 1;
      await persist();
      return { done: false };
    }
    state.phase = "awaiting_children";
    state.current_child_ids = (inserted ?? []).map((r: any) => r.id);
    state.current_step_global_idx = stepGlobalIdx;
    state.current_step_action = actionType;
    state.current_step_note = step.note ?? null;
    state.current_step_line_idx = lineIdx;
    await persist();
    return { done: false };
  }

  // ── PHASE: awaiting_children ────────────────────────────────────────────
  if (state.phase === "awaiting_children") {
    const childIds: string[] = state.current_child_ids ?? [];
    if (childIds.length === 0) {
      state.phase = "dispatching";
      await persist();
      return { done: false };
    }
    const { data: children } = await supabase
      .from("action_jobs")
      .select("id, status, result, error_friendly, error_raw")
      .in("id", childIds);
    const rows = (children ?? []) as any[];
    const allTerminal = rows.length === childIds.length && rows.every((c) =>
      c.status === "completed" || c.status === "failed" || c.status === "cancelled");
    if (!allTerminal) return { done: false };

    const stepGlobalIdx: number = state.current_step_global_idx ?? state.outputs.length;
    const lineIdx: number = state.current_step_line_idx ?? state.cursor;
    const completed = rows.find((c) => c.status === "completed");
    const noteName = state.current_step_note ?? null;

    if (completed) {
      const result = completed.result ?? {};
      const url = result.media_url ?? null;
      const k = detectKind(null, url);
      state.outputs[stepGlobalIdx] = {
        line_idx: lineIdx,
        media_url: url,
        media_type: k,
        text: result.text ?? null,
        name: noteName ?? (k ? `Step ${stepGlobalIdx + 1} ${k}` : `Step ${stepGlobalIdx + 1} output`),
      };
    } else {
      const failed = rows.find((c) => c.status === "failed");
      state.outputs[stepGlobalIdx] = {
        line_idx: lineIdx,
        failed: true,
        reason: failed?.error_friendly ?? failed?.error_raw ?? "step failed",
      };
      state.failures += 1;
    }

    for (const c of rows) {
      if (c.status !== "completed") continue;
      const url = (c.result ?? {}).media_url;
      if (typeof url === "string") {
        if (/\.(mp4|webm|mov|m4v)/i.test(url)) state.videos_used += 1;
        else state.images_used += 1;
      }
    }

    state.steps_used += 1;
    state.current_child_ids = [];
    state.current_step_global_idx = null;
    state.current_step_line_idx = null;
    state.current_step_action = null;
    state.current_step_note = null;
    if (state.pending_steps && state.pending_steps.length > 0) {
      state.pending_steps.shift();
    }
    state.phase = "dispatching";
    await persist();
    return { done: false };
  }

  return { done: true };
}

async function runJob(supabase: any, job: Job, signal: AbortSignal): Promise<JobOutcome> {
  const p = job.payload ?? {};
  if (job.action_type === "action-sequence") {
    // Sequence parents are managed by tickSequence, not by this synchronous path.
    // Returning sequence-tick prevents the normal complete/insert flow from running.
    return { kind: "sequence-tick" };
  }
  const ctx = await resolveContext(supabase, p);
  switch (job.action_type) {
    case "text-text": {
      const prompt = buildPrompt(p.prompt, ctx, true);
      const out = await callFn("openai-text", { prompt }, signal);
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      await insertResultItem(supabase, job, { text: out.text });
      return { kind: "result", result: { text: out.text } };
    }
    case "web-search": {
      const prompt = buildPrompt(p.prompt, ctx, true);
      const out = await callFn("perplexity-search", { query: prompt }, signal);
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      await insertResultItem(supabase, job, { text: out.text });
      return { kind: "result", result: { text: out.text } };
    }
    case "text-image": {
      // ASYNC: submit to Fal and hand off. The poll loop completes the job on
      // a later tick, so the worker never waits past the 150s edge-fn limit.
      const prompt = buildPrompt(p.prompt, ctx, false);
      const out = await callFn("lovable-image", {
        mode: "submit",
        prompt, aspectRatio: p.aspectRatio, quality: p.quality,
        refImageUrls: ctx.imageUrls,
      }, signal);
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (!out.status_url || !out.response_url) throw new Error("lovable-image did not return a queue handle");
      return {
        kind: "handoff",
        provider: "lovable-image",
        status_url: out.status_url,
        response_url: out.response_url,
        request_id: out.request_id ?? null,
      };
    }
    case "image-image":
    case "remix": {
      // ASYNC: same submit/poll handoff as text-image.
      const prompt = buildPrompt(p.prompt, ctx, false);
      const galleryUrls: string[] = Array.isArray(p.refImageUrls) ? p.refImageUrls : [];
      const refImageUrls = [...galleryUrls, ...ctx.imageUrls].slice(0, 16);
      const refImages: string[] = Array.isArray(p.refImages) ? p.refImages : [];
      const out = await callFn("lovable-image", {
        mode: "submit",
        prompt, aspectRatio: p.aspectRatio, quality: p.quality,
        refImageUrls, refImages,
      }, signal);
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (!out.status_url || !out.response_url) throw new Error("lovable-image did not return a queue handle");
      return {
        kind: "handoff",
        provider: "lovable-image",
        status_url: out.status_url,
        response_url: out.response_url,
        request_id: out.request_id ?? null,
      };
    }
    case "image-video":
    case "video-video": {
      // ASYNC: submit to Fal, return a handoff. The worker stores the queue handle
      // on the job row and polls it on subsequent ticks (no synchronous wait → no 150s timeout).
      const prompt = buildPrompt(p.prompt, ctx, true);
      let sourceUrl: string | undefined = p.sourceUrl;
      if (!sourceUrl) {
        const fallback = job.action_type === "video-video" ? ctx.videoUrls[0] : ctx.imageUrls[0];
        if (fallback) sourceUrl = fallback;
      }
      const body: any = {
        mode: "submit",
        prompt,
        sourceKind: job.action_type === "video-video" ? "video" : "image",
      };
      if (job.action_type === "image-video") {
        if (p.duration) body.duration = p.duration;
        if (typeof p.generateAudio === "boolean") body.generateAudio = p.generateAudio;
        if (p.negativePrompt) body.negativePrompt = p.negativePrompt;
        if (typeof p.cfgScale === "number") body.cfgScale = p.cfgScale;
        if (p.endImageUrl) body.endImageUrl = p.endImageUrl;
      } else {
        if (p.imageUrl) body.imageUrl = p.imageUrl;
        if (p.characterOrientation) body.characterOrientation = p.characterOrientation;
        if (typeof p.keepOriginalSound === "boolean") body.keepOriginalSound = p.keepOriginalSound;
        if (p.elementImageUrl) body.elementImageUrl = p.elementImageUrl;
      }
      if (sourceUrl) body.sourceUrl = sourceUrl;
      else if (p.sourceDataUrl) body.sourceDataUrl = p.sourceDataUrl;
      const out = await callFn("fal-video", body, signal);
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (!out.status_url || !out.response_url) throw new Error("fal-video did not return a queue handle");
      return {
        kind: "handoff",
        provider: "fal-video",
        status_url: out.status_url,
        response_url: out.response_url,
        request_id: out.request_id ?? null,
      };
    }
    case "audio-image-video": {
      // ASYNC: same submit/poll handoff pattern as the Kling video models.
      const prompt = buildPrompt(p.prompt, ctx, false);
      const imageUrl = p.imageUrl ?? ctx.imageUrls[0];
      const audioUrl = p.audioUrl ?? ctx.audioUrls[0];
      if (!imageUrl) throw new Error("missing reference image");
      const out = await callFn("fal-avatar", {
        mode: "submit",
        imageUrl,
        audioUrl,
        prompt,
        voice: p.voice,
        talkingStyle: p.talkingStyle,
        resolution: p.resolution,
        aspectRatio: p.aspectRatio,
        caption: p.caption,
      }, signal);
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (!out.status_url || !out.response_url) throw new Error("fal-avatar did not return a queue handle");
      return {
        kind: "handoff",
        provider: "fal-avatar",
        status_url: out.status_url,
        response_url: out.response_url,
        request_id: out.request_id ?? null,
      };
    }
    case "analyze-image": {
      const prompt = buildPrompt(p.prompt, ctx, ctx.imageUrls.length > 1);
      let imageDataUrl = p.imageDataUrl;
      if (!imageDataUrl && p.imageUrl) imageDataUrl = await urlToDataUrl(p.imageUrl);
      if (!imageDataUrl && ctx.imageUrls[0]) imageDataUrl = await urlToDataUrl(ctx.imageUrls[0]);
      const out = await callFn("openai-vision", { prompt, imageDataUrl }, signal);
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      await insertResultItem(supabase, job, { text: out.text });
      return { kind: "result", result: { text: out.text } };
    }
    default:
      throw new Error(`unknown action_type: ${job.action_type}`);
  }
}

// Polls action_jobs.status; aborts the in-flight upstream fetch if the user marks the job cancelled.
async function runWithCancellation(
  supabase: any,
  jobId: string,
  work: (signal: AbortSignal) => Promise<JobOutcome>,
): Promise<JobOutcome> {
  const controller = new AbortController();
  const interval = setInterval(async () => {
    try {
      const { data } = await supabase.from("action_jobs").select("status").eq("id", jobId).maybeSingle();
      if (data?.status === "cancelled" && !controller.signal.aborted) {
        controller.abort();
      }
    } catch (_) { /* ignore poll errors */ }
  }, 5000);
  try {
    return await work(controller.signal);
  } finally {
    clearInterval(interval);
  }
}

function isAbortError(e: unknown): boolean {
  return e instanceof Error && (e.name === "AbortError" || /aborted/i.test(e.message));
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE 1 — Poll any jobs already handed off to an async provider (Fal).
  // We never wait long here: each poll is one HTTP round-trip per job.
  // Throttle: only re-poll a job if it hasn't been polled in the last 8s.
  // ─────────────────────────────────────────────────────────────────────────
  const pollResults: any[] = [];
  const pollCutoff = new Date(Date.now() - 8_000).toISOString();
  const { data: pollJobs } = await supabase
    .from("action_jobs")
    .select("*")
    .eq("status", "awaiting_provider")
    .or(`provider_polled_at.is.null,provider_polled_at.lte.${pollCutoff}`)
    .order("provider_polled_at", { ascending: true, nullsFirst: true })
    .limit(MAX_BATCH);

  for (const j of ((pollJobs ?? []) as Job[])) {
    if (!j.provider_status_url || !j.provider_response_url) continue;
    const isImage = j.provider === "lovable-image";
    const fnName = isImage
      ? "lovable-image"
      : (j.provider === "fal-avatar" ? "fal-avatar" : "fal-video");
    try {
      // Mark polled-at first so a slow poll doesn't get re-claimed by an overlapping tick.
      await supabase.from("action_jobs")
        .update({ provider_polled_at: new Date().toISOString() })
        .eq("id", j.id);

      const r = await fetch(`${SUPABASE_URL}/functions/v1/${fnName}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", apikey: SERVICE_KEY },
        body: JSON.stringify({
          mode: "poll",
          statusUrl: j.provider_status_url,
          responseUrl: j.provider_response_url,
        }),
      });
      const out = await r.json().catch(() => ({}));

      if (isImage) {
        // ── Image poll branch ──────────────────────────────────────────────
        if (out?.status === "COMPLETED" && out?.dataUrl) {
          const url = await uploadDataUrl(supabase, j.user_id, out.dataUrl, "png");
          const baseLabel =
            j.action_type === "remix" ? "Remixed image" :
            j.action_type === "image-image" ? "Edited image" :
            "Generated image";
          const title = await registerGeneratedAsset(supabase, j, {
            url, kind: "image", mimeType: "image/png", baseLabel,
          });
          await insertResultItem(supabase, j, {
            text: title, media_url: url, media_type: "image",
          });
          await supabase.from("action_jobs").update({
            status: "completed",
            result: { media_url: url },
            completed_at: new Date().toISOString(),
          }).eq("id", j.id);

          const interval = recurrenceToInterval(j.recurrence);
          if (interval) {
            const nextRun = new Date(Date.now() + intervalMs(j.recurrence!)).toISOString();
            await supabase.from("action_jobs").insert({
              user_id: j.user_id,
              checklist_id: j.checklist_id,
              source_item_id: j.source_item_id,
              action_type: j.action_type,
              status: "scheduled",
              payload: j.payload,
              scheduled_for: nextRun,
              recurrence: j.recurrence,
              parent_job_id: j.id,
            });
          }
          pollResults.push({ id: j.id, ok: true });
        } else if (out?.status === "FAILED") {
          const errMsg = String(out?.error ?? "image generation failed");
          const friendly = await explainErrorInline(j.action_type, errMsg);
          await supabase.from("action_jobs").update({
            status: "failed",
            error_raw: errMsg,
            error_friendly: friendly.cause,
            error_fix: friendly.fix,
            completed_at: new Date().toISOString(),
          }).eq("id", j.id);
          pollResults.push({ id: j.id, ok: false, error: errMsg });
        } else {
          pollResults.push({ id: j.id, ok: true, awaiting: true });
        }
        continue;
      }

      // ── Video / avatar poll branch (existing behavior) ──────────────────
      if (out?.status === "COMPLETED" && out?.url) {
        const isAvatar = j.action_type === "audio-image-video";
        const baseLabel = isAvatar ? "Generated talking video" : "Generated video";
        const title = await registerGeneratedAsset(supabase, j, {
          url: out.url, kind: "video", mimeType: "video/mp4", baseLabel,
        });
        await insertResultItem(supabase, j, {
          text: title,
          media_url: out.url,
          media_type: "video",
        });
        await supabase.from("action_jobs").update({
          status: "completed",
          result: { media_url: out.url },
          completed_at: new Date().toISOString(),
        }).eq("id", j.id);

        // Recurring: enqueue next occurrence (mirrors the sync path below).
        const interval = recurrenceToInterval(j.recurrence);
        if (interval) {
          const nextRun = new Date(Date.now() + intervalMs(j.recurrence!)).toISOString();
          await supabase.from("action_jobs").insert({
            user_id: j.user_id,
            checklist_id: j.checklist_id,
            source_item_id: j.source_item_id,
            action_type: j.action_type,
            status: "scheduled",
            payload: j.payload,
            scheduled_for: nextRun,
            recurrence: j.recurrence,
            parent_job_id: j.id,
          });
        }
        pollResults.push({ id: j.id, ok: true });
      } else if (out?.status === "FAILED") {
        const errMsg = String(out?.error ?? "fal job failed");
        const friendly = await explainErrorInline(j.action_type, errMsg);
        await supabase.from("action_jobs").update({
          status: "failed",
          error_raw: errMsg,
          error_friendly: friendly.cause,
          error_fix: friendly.fix,
          completed_at: new Date().toISOString(),
        }).eq("id", j.id);
        pollResults.push({ id: j.id, ok: false, error: errMsg });
      } else {
        // IN_PROGRESS — leave as-is; we'll check again next tick.
        pollResults.push({ id: j.id, ok: true, awaiting: true });
      }
    } catch (e) {
      console.error("poll err", j.id, e);
      pollResults.push({ id: j.id, ok: false, error: (e as Error).message });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE 2 — Claim & run new pending/scheduled jobs (existing flow).
  // ─────────────────────────────────────────────────────────────────────────
  const nowIso = new Date().toISOString();
  const { data: dueJobs, error: dueErr } = await supabase
    .from("action_jobs")
    .select("id")
    .in("status", ["pending", "scheduled"])
    .or(`scheduled_for.is.null,scheduled_for.lte.${nowIso}`)
    .order("created_at", { ascending: true })
    .limit(MAX_BATCH);

  if (dueErr) {
    console.error("due query err", dueErr);
    return new Response(JSON.stringify({ error: dueErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const ids = (dueJobs ?? []).map((j) => j.id);
  if (ids.length === 0) {
    return new Response(JSON.stringify({ processed: pollResults.length, polled: pollResults }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Claim by setting status=running only where still pending/scheduled (prevents double-run)
  const { data: jobs, error: claimErr2 } = await supabase
    .from("action_jobs")
    .update({ status: "running", started_at: nowIso })
    .in("id", ids)
    .in("status", ["pending", "scheduled"])
    .select("*");

  if (claimErr2) {
    console.error("claim err", claimErr2);
    return new Response(JSON.stringify({ error: claimErr2.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const results: any[] = [];
  for (const j of (jobs ?? []) as Job[]) {
    try {
      // Safety: if a legacy job somehow still has a giant inline media payload,
      // fail it cleanly instead of OOM-crashing the worker (which would leave it stuck "running").
      const payloadSize = new TextEncoder().encode(JSON.stringify(j.payload ?? {})).length;
      if (payloadSize > 200_000) {
        await supabase.from("action_jobs").update({
          status: "failed",
          error_raw: `payload too large (${payloadSize} bytes)`,
          error_friendly: "This action was queued with files attached inline and is too large to run.",
          error_fix: "Re-run it from the checklist using images selected from your Media Gallery.",
          completed_at: new Date().toISOString(),
          attempts: j.attempts + 1,
        }).eq("id", j.id);
        results.push({ id: j.id, ok: false, error: "payload too large" });
        continue;
      }

      const outcome = await runWithCancellation(supabase, j.id, (signal) => runJob(supabase, j, signal));

      // If user cancelled mid-flight but inner work still resolved, treat as cancelled.
      const { data: cur } = await supabase.from("action_jobs").select("status").eq("id", j.id).maybeSingle();
      if (cur?.status === "cancelled") {
        await supabase.from("action_jobs").update({
          status: "cancelled",
          completed_at: new Date().toISOString(),
          attempts: j.attempts + 1,
        }).eq("id", j.id);
        results.push({ id: j.id, ok: false, cancelled: true });
        continue;
      }

      if (outcome.kind === "handoff") {
        // Async provider — record the queue handle. The polling block at the
        // top of this handler will check it on subsequent cron ticks.
        await supabase.from("action_jobs").update({
          status: "awaiting_provider",
          provider: outcome.provider,
          provider_request_id: outcome.request_id,
          provider_status_url: outcome.status_url,
          provider_response_url: outcome.response_url,
          provider_polled_at: new Date().toISOString(),
          attempts: j.attempts + 1,
        }).eq("id", j.id);
        results.push({ id: j.id, ok: true, awaiting: true });
        continue;
      }

      if (outcome.kind === "sequence-tick") {
        // Sequence parent — drive the state machine. Put the parent back to
        // pending so subsequent worker ticks (cron + child-completion kicks)
        // continue to process it without it appearing "running" forever.
        const tickResult = await tickSequence(supabase, j);
        if (!tickResult.done) {
          await supabase.from("action_jobs").update({
            status: "pending",
            attempts: j.attempts, // sequence ticks don't count against per-job retries
            started_at: null,
          }).eq("id", j.id);
        }
        results.push({ id: j.id, ok: true, sequence: true, done: tickResult.done });
        continue;
      }

      await supabase.from("action_jobs").update({
        status: "completed",
        result: outcome.result,
        completed_at: new Date().toISOString(),
        attempts: j.attempts + 1,
      }).eq("id", j.id);

      // Recurring: enqueue next occurrence
      const interval = recurrenceToInterval(j.recurrence);
      if (interval) {
        const nextRun = new Date(Date.now() + intervalMs(j.recurrence!)).toISOString();
        await supabase.from("action_jobs").insert({
          user_id: j.user_id,
          checklist_id: j.checklist_id,
          source_item_id: j.source_item_id,
          action_type: j.action_type,
          status: "scheduled",
          payload: j.payload,
          scheduled_for: nextRun,
          recurrence: j.recurrence,
          parent_job_id: j.id,
        });
      }

      results.push({ id: j.id, ok: true });
    } catch (e) {
      const errMsg = (e as Error).message ?? String(e);

      // Check if this was a user-initiated cancellation.
      const aborted = isAbortError(e);
      let cancelledInDb = false;
      if (!aborted) {
        const { data: cur } = await supabase.from("action_jobs").select("status").eq("id", j.id).maybeSingle();
        cancelledInDb = cur?.status === "cancelled";
      }
      if (aborted || cancelledInDb) {
        await supabase.from("action_jobs").update({
          status: "cancelled",
          completed_at: new Date().toISOString(),
          attempts: j.attempts + 1,
        }).eq("id", j.id);
        results.push({ id: j.id, ok: false, cancelled: true });
        continue;
      }

      const nextAttempts = j.attempts + 1;
      const exhausted = nextAttempts >= j.max_attempts;
      if (exhausted) {
        const friendly = await explainErrorInline(j.action_type, errMsg);
        await supabase.from("action_jobs").update({
          status: "failed",
          error_raw: errMsg,
          error_friendly: friendly.cause,
          error_fix: friendly.fix,
          attempts: nextAttempts,
          completed_at: new Date().toISOString(),
        }).eq("id", j.id);
      } else {
        // Backoff: 2^attempts minutes
        const backoff = new Date(Date.now() + Math.pow(2, nextAttempts) * 60_000).toISOString();
        await supabase.from("action_jobs").update({
          status: "pending",
          attempts: nextAttempts,
          error_raw: errMsg,
          scheduled_for: backoff,
          started_at: null,
        }).eq("id", j.id);
      }
      results.push({ id: j.id, ok: false, error: errMsg });
    }
  }

  return new Response(JSON.stringify({ processed: results.length + pollResults.length, results, polled: pollResults }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

function intervalMs(r: string): number {
  switch (r) {
    case "hourly": return 60 * 60 * 1000;
    case "daily": return 24 * 60 * 60 * 1000;
    case "weekly": return 7 * 24 * 60 * 60 * 1000;
    case "monthly": return 30 * 24 * 60 * 60 * 1000;
    case "yearly": return 365 * 24 * 60 * 60 * 1000;
    default: return 0;
  }
}
