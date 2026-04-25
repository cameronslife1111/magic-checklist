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
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) return { cause: error_raw.slice(0, 200), fix: "Try again later." };
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: `Translate this API error into plain English. Respond as strict JSON: {"cause":"<one short sentence, no jargon, no error codes>","fix":"<one short concrete suggestion>"}` },
          { role: "user", content: `Action: ${action_type}\nError:\n${error_raw}` },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!r.ok) return { cause: error_raw.slice(0, 200), fix: "Try the action again." };
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

async function insertResultItem(
  supabase: any,
  job: Job,
  fields: { text: string; media_url?: string | null; media_type?: string | null },
) {
  // Compute position right after source item, like client insertItemAfter
  const { data: list } = await supabase
    .from("checklist_items")
    .select("id,position")
    .eq("checklist_id", job.checklist_id)
    .order("position", { ascending: true });
  const items = (list ?? []) as { id: string; position: number }[];

  let position: number;
  if (job.source_item_id && items.length) {
    const idx = items.findIndex((i) => i.id === job.source_item_id);
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
  const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
  return `data:${blob.type || "application/octet-stream"};base64,${b64}`;
}

async function runJob(supabase: any, job: Job, signal: AbortSignal): Promise<{ result: any }> {
  const p = job.payload ?? {};
  const ctx = await resolveContext(supabase, p);
  switch (job.action_type) {
    case "text-text": {
      const prompt = buildPrompt(p.prompt, ctx, true);
      const out = await callFn("openai-text", { prompt }, signal);
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      await insertResultItem(supabase, job, { text: out.text });
      return { result: { text: out.text } };
    }
    case "web-search": {
      const prompt = buildPrompt(p.prompt, ctx, true);
      const out = await callFn("perplexity-search", { query: prompt }, signal);
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      await insertResultItem(supabase, job, { text: out.text });
      return { result: { text: out.text } };
    }
    case "text-image": {
      const prompt = buildPrompt(p.prompt, ctx, false);
      const extraRefs = await Promise.all(ctx.imageUrls.map(urlToDataUrl));
      const out = await callFn("lovable-image", { prompt, aspectRatio: p.aspectRatio, quality: p.quality, refImages: extraRefs }, signal);
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const url = await uploadDataUrl(supabase, job.user_id, out.dataUrl, "png");
      await insertResultItem(supabase, job, { text: "Generated image", media_url: url, media_type: "image" });
      return { result: { media_url: url } };
    }
    case "image-image":
    case "remix": {
      const prompt = buildPrompt(p.prompt, ctx, false);
      const extraRefs = await Promise.all(ctx.imageUrls.map(urlToDataUrl));
      // New gallery-based payload: refImageUrls. Legacy: refImages (data URLs).
      const galleryRefs = Array.isArray(p.refImageUrls)
        ? await Promise.all((p.refImageUrls as string[]).map(urlToDataUrl))
        : [];
      const refImages = [...(p.refImages ?? []), ...galleryRefs, ...extraRefs].slice(0, 16);
      const out = await callFn("lovable-image", { prompt, aspectRatio: p.aspectRatio, quality: p.quality, refImages }, signal);
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const url = await uploadDataUrl(supabase, job.user_id, out.dataUrl, "png");
      await insertResultItem(supabase, job, {
        text: job.action_type === "remix" ? "Remixed image" : "Edited image",
        media_url: url, media_type: "image",
      });
      return { result: { media_url: url } };
    }
    case "image-video":
    case "video-video": {
      const prompt = buildPrompt(p.prompt, ctx, true);
      // Prefer new gallery URL field, then legacy data URL, then context fallback.
      let sourceDataUrl = p.sourceDataUrl;
      if (!sourceDataUrl && p.sourceUrl) sourceDataUrl = await urlToDataUrl(p.sourceUrl);
      if (!sourceDataUrl) {
        const fallback = job.action_type === "video-video" ? ctx.videoUrls[0] : ctx.imageUrls[0];
        if (fallback) sourceDataUrl = await urlToDataUrl(fallback);
      }
      const out = await callFn("fal-video", {
        prompt,
        sourceDataUrl,
        sourceKind: job.action_type === "video-video" ? "video" : "image",
        aspectRatio: p.aspectRatio,
      }, signal);
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      await insertResultItem(supabase, job, { text: "Generated video", media_url: out.url, media_type: "video" });
      return { result: { media_url: out.url } };
    }
    case "analyze-image": {
      const prompt = buildPrompt(p.prompt, ctx, ctx.imageUrls.length > 1);
      let imageDataUrl = p.imageDataUrl;
      if (!imageDataUrl && p.imageUrl) imageDataUrl = await urlToDataUrl(p.imageUrl);
      if (!imageDataUrl && ctx.imageUrls[0]) imageDataUrl = await urlToDataUrl(ctx.imageUrls[0]);
      const out = await callFn("openai-vision", { prompt, imageDataUrl }, signal);
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      await insertResultItem(supabase, job, { text: out.text });
      return { result: { text: out.text } };
    }
    default:
      throw new Error(`unknown action_type: ${job.action_type}`);
  }
}

// Polls action_jobs.status; aborts the in-flight upstream fetch if the user marks the job cancelled.
async function runWithCancellation(
  supabase: any,
  jobId: string,
  work: (signal: AbortSignal) => Promise<{ result: any }>,
): Promise<{ result: any }> {
  const controller = new AbortController();
  const interval = setInterval(async () => {
    try {
      const { data } = await supabase.from("action_jobs").select("status").eq("id", jobId).maybeSingle();
      if (data?.status === "cancelled" && !controller.signal.aborted) {
        controller.abort();
      }
    } catch (_) { /* ignore poll errors */ }
  }, 2000);
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
    return new Response(JSON.stringify({ processed: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
      const { result } = await runWithCancellation(supabase, j.id, (signal) => runJob(supabase, j, signal));

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

      await supabase.from("action_jobs").update({
        status: "completed",
        result,
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

  return new Response(JSON.stringify({ processed: results.length, results }), {
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
