// Enqueue an AI action into the action_jobs queue.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VALID_ACTIONS = new Set([
  "text-text", "text-image", "image-image", "remix",
  "image-video", "video-video", "audio-image-video",
  "analyze-image", "web-search",
  "action-sequence",
]);
const VALID_RECURRENCE = new Set(["hourly", "daily", "weekly", "monthly", "yearly"]);
const VALID_MEDIA_TYPES = new Set(["image", "video", "audio"]);
const MAX_CTX = 15;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bad(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return bad("Unauthorized", 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) return bad("Unauthorized", 401);
    const user = userData.user;

    const body = await req.json();
    const { action_type, checklist_id, source_item_id, payload, scheduled_for, recurrence } = body ?? {};

    if (!VALID_ACTIONS.has(action_type)) return bad("invalid action_type");
    if (!checklist_id || typeof checklist_id !== "string") return bad("checklist_id required");
    if (recurrence != null && !VALID_RECURRENCE.has(recurrence)) return bad("invalid recurrence");

    // Validate context (optional)
    const ctx = payload?.context;
    if (ctx != null) {
      if (typeof ctx !== "object") return bad("invalid context");
      const cls = ctx.checklists ?? [];
      const med = ctx.media ?? [];
      if (!Array.isArray(cls) || !Array.isArray(med)) return bad("invalid context shape");
      if (cls.length > MAX_CTX) return bad(`max ${MAX_CTX} checklist context`);
      for (const id of cls) {
        if (typeof id !== "string" || !UUID_RE.test(id)) return bad("invalid checklist context id");
      }
      // Verify ownership: select must return same count
      if (cls.length > 0) {
        const { data: owned, error: ownErr } = await supabase.from("checklists").select("id").in("id", cls);
        if (ownErr) return bad("could not verify checklist ownership", 500);
        if ((owned?.length ?? 0) !== cls.length) return bad("checklist context not accessible");
      }
      const counts = { image: 0, video: 0, audio: 0 } as Record<string, number>;
      const storagePrefix = `${supabaseUrl}/storage/v1/object/public/generated-media/`;
      for (const m of med) {
        if (!m || typeof m !== "object") return bad("invalid media item");
        if (!VALID_MEDIA_TYPES.has(m.type)) return bad("invalid media type");
        if (typeof m.url !== "string" || !m.url.startsWith(storagePrefix)) return bad("invalid media url");
        counts[m.type] = (counts[m.type] ?? 0) + 1;
        if (counts[m.type] > MAX_CTX) return bad(`max ${MAX_CTX} ${m.type} attachments`);
      }
    }

    // Hard guardrail: reject jobs with giant inline media. The Media Gallery
    // workflow stores files in Storage and only sends URLs, so legitimate jobs
    // are tiny. Anything huge is a regression that would crash the worker and
    // also make the dashboard unreadable.
    const payloadSize = new TextEncoder().encode(JSON.stringify(payload ?? {})).length;
    if (payloadSize > 200_000) {
      return bad("payload too large — pick media from the Media Gallery instead of attaching files inline");
    }

    const promptPreview = typeof payload?.prompt === "string" ? String(payload.prompt).slice(0, 500) : null;

    const status = scheduled_for ? "scheduled" : "pending";
    const { data, error } = await supabase
      .from("action_jobs")
      .insert({
        user_id: user.id,
        checklist_id,
        source_item_id: source_item_id ?? null,
        action_type,
        status,
        payload: payload ?? {},
        prompt_preview: promptPreview,
        scheduled_for: scheduled_for ?? null,
        recurrence: recurrence ?? null,
      })
      .select("id")
      .single();

    if (error) throw error;

    // Fire-and-forget: kick the worker so the job starts within ~1s instead of waiting up to 60s for pg_cron.
    if (status === "pending") {
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (serviceKey) {
        fetch(`${supabaseUrl}/functions/v1/process-action-queue`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceKey}`,
            apikey: serviceKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ trigger: "enqueue", id: data.id }),
        }).catch((err) => console.error("worker kick failed", err));
      }
    }

    return new Response(JSON.stringify({ id: data.id, status }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("enqueue-action error", e);
    return bad((e as Error).message, 500);
  }
});
