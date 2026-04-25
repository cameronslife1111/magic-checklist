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

async function callFn(name: string, body: any) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", apikey: SERVICE_KEY },
    body: JSON.stringify(body),
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

async function runJob(supabase: any, job: Job): Promise<{ result: any }> {
  const p = job.payload ?? {};
  switch (job.action_type) {
    case "text-text": {
      const out = await callFn("openai-text", { prompt: p.prompt });
      await insertResultItem(supabase, job, { text: out.text });
      return { result: { text: out.text } };
    }
    case "web-search": {
      const out = await callFn("perplexity-search", { query: p.prompt });
      await insertResultItem(supabase, job, { text: out.text });
      return { result: { text: out.text } };
    }
    case "text-image": {
      const out = await callFn("lovable-image", { prompt: p.prompt, aspectRatio: p.aspectRatio, quality: p.quality });
      const url = await uploadDataUrl(supabase, job.user_id, out.dataUrl, "png");
      await insertResultItem(supabase, job, { text: "Generated image", media_url: url, media_type: "image" });
      return { result: { media_url: url } };
    }
    case "image-image":
    case "remix": {
      const out = await callFn("lovable-image", {
        prompt: p.prompt, aspectRatio: p.aspectRatio, quality: p.quality, refImages: p.refImages ?? [],
      });
      const url = await uploadDataUrl(supabase, job.user_id, out.dataUrl, "png");
      await insertResultItem(supabase, job, {
        text: job.action_type === "remix" ? "Remixed image" : "Edited image",
        media_url: url, media_type: "image",
      });
      return { result: { media_url: url } };
    }
    case "image-video":
    case "video-video": {
      const out = await callFn("fal-video", {
        prompt: p.prompt,
        sourceDataUrl: p.sourceDataUrl,
        sourceKind: job.action_type === "video-video" ? "video" : "image",
        aspectRatio: p.aspectRatio,
      });
      await insertResultItem(supabase, job, { text: "Generated video", media_url: out.url, media_type: "video" });
      return { result: { media_url: out.url } };
    }
    case "analyze-image": {
      const out = await callFn("openai-vision", { prompt: p.prompt, imageDataUrl: p.imageDataUrl });
      await insertResultItem(supabase, job, { text: out.text });
      return { result: { text: out.text } };
    }
    default:
      throw new Error(`unknown action_type: ${job.action_type}`);
  }
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
      const { result } = await runJob(supabase, j);

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
