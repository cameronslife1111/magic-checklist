// Enqueue an AI action into the action_jobs queue.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VALID_ACTIONS = new Set([
  "text-text", "text-image", "image-image", "remix",
  "image-video", "video-video", "analyze-image", "web-search",
]);
const VALID_RECURRENCE = new Set(["hourly", "daily", "weekly", "monthly", "yearly"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const user = userData.user;

    const body = await req.json();
    const { action_type, checklist_id, source_item_id, payload, scheduled_for, recurrence } = body ?? {};

    if (!VALID_ACTIONS.has(action_type)) {
      return new Response(JSON.stringify({ error: "invalid action_type" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!checklist_id || typeof checklist_id !== "string") {
      return new Response(JSON.stringify({ error: "checklist_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (recurrence != null && !VALID_RECURRENCE.has(recurrence)) {
      return new Response(JSON.stringify({ error: "invalid recurrence" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

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
        scheduled_for: scheduled_for ?? null,
        recurrence: recurrence ?? null,
      })
      .select("id")
      .single();

    if (error) throw error;
    return new Response(JSON.stringify({ id: data.id, status }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("enqueue-action error", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
