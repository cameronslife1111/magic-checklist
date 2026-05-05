// claude-bridge: gateway for Claude AI to interact with the checklist app.
// Auth: shared secret in `x-claude-key` header (compared against CLAUDE_BRIDGE_KEY).
// Uses SUPABASE_SERVICE_ROLE_KEY to bypass RLS — caller must specify user_id
// in params for any user-scoped action.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-claude-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BRIDGE_KEY = Deno.env.get("CLAUDE_BRIDGE_KEY") ?? "";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Action =
  | "fetchChecklist"
  | "fetchItems"
  | "addItem"
  | "triggerJob"
  | "pollJob"
  | "getRecentJobs";

const VALID_ACTIONS: Action[] = [
  "fetchChecklist", "fetchItems", "addItem", "triggerJob", "pollJob", "getRecentJobs",
];

const VALID_JOB_ACTIONS = new Set([
  "text-text", "text-image", "image-image", "remix",
  "image-video", "video-video", "audio-image-video",
  "analyze-image", "web-search", "action-sequence",
]);

async function handle(action: Action, params: Record<string, any>) {
  switch (action) {
    case "fetchChecklist": {
      const { name, user_id } = params;
      if (!name || !user_id) return json({ error: "name and user_id required" }, 400);
      const { data, error } = await admin
        .from("checklists")
        .select("*")
        .eq("user_id", user_id)
        .ilike("title", name)
        .order("updated_at", { ascending: false })
        .limit(10);
      if (error) return json({ error: error.message }, 500);
      return json({ checklists: data ?? [] });
    }

    case "fetchItems": {
      const { checklist_id } = params;
      if (!checklist_id) return json({ error: "checklist_id required" }, 400);
      const { data, error } = await admin
        .from("checklist_items")
        .select("*")
        .eq("checklist_id", checklist_id)
        .order("position", { ascending: true });
      if (error) return json({ error: error.message }, 500);
      return json({ items: data ?? [] });
    }

    case "addItem": {
      const { checklist_id, user_id, text, position, parent_item_id } = params;
      if (!checklist_id || !user_id || typeof text !== "string") {
        return json({ error: "checklist_id, user_id, text required" }, 400);
      }
      const { data, error } = await admin
        .from("checklist_items")
        .insert({
          checklist_id,
          user_id,
          text,
          position: typeof position === "number" ? position : Date.now(),
          parent_item_id: parent_item_id ?? null,
        })
        .select()
        .single();
      if (error) return json({ error: error.message }, 500);
      return json({ item: data });
    }

    case "triggerJob": {
      const {
        user_id, checklist_id, action_type, payload,
        source_item_id, scheduled_for, recurrence,
      } = params;
      if (!user_id || !checklist_id || !action_type) {
        return json({ error: "user_id, checklist_id, action_type required" }, 400);
      }
      if (!VALID_JOB_ACTIONS.has(action_type)) {
        return json({ error: `invalid action_type. allowed: ${[...VALID_JOB_ACTIONS].join(", ")}` }, 400);
      }
      const status = scheduled_for ? "scheduled" : "pending";
      const promptPreview = typeof payload?.prompt === "string"
        ? String(payload.prompt).slice(0, 500) : null;

      const { data, error } = await admin
        .from("action_jobs")
        .insert({
          user_id,
          checklist_id,
          source_item_id: source_item_id ?? null,
          action_type,
          status,
          payload: payload ?? {},
          prompt_preview: promptPreview,
          scheduled_for: scheduled_for ?? null,
          recurrence: recurrence ?? null,
        })
        .select("id, status")
        .single();
      if (error) return json({ error: error.message }, 500);

      // Kick the worker so the job starts ASAP (matches enqueue-action behavior).
      if (status === "pending") {
        fetch(`${SUPABASE_URL}/functions/v1/process-action-queue`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SERVICE_ROLE}`,
            apikey: SERVICE_ROLE,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ trigger: "claude-bridge", id: data.id }),
        }).catch((err) => console.error("worker kick failed", err));
      }

      return json({ job_id: data.id, status: data.status });
    }

    case "pollJob": {
      const { job_id } = params;
      if (!job_id) return json({ error: "job_id required" }, 400);
      const { data, error } = await admin
        .from("action_jobs")
        .select("id, status, action_type, result, error_friendly, error_raw, created_at, started_at, completed_at, attempts")
        .eq("id", job_id)
        .maybeSingle();
      if (error) return json({ error: error.message }, 500);
      if (!data) return json({ error: "job not found" }, 404);
      return json({ job: data });
    }

    case "getRecentJobs": {
      const { user_id, limit = 20, status } = params;
      if (!user_id) return json({ error: "user_id required" }, 400);
      let q = admin
        .from("action_jobs")
        .select("id, status, action_type, prompt_preview, created_at, completed_at, error_friendly")
        .eq("user_id", user_id)
        .order("created_at", { ascending: false })
        .limit(Math.min(Math.max(Number(limit) || 20, 1), 100));
      if (status) q = q.eq("status", status);
      const { data, error } = await q;
      if (error) return json({ error: error.message }, 500);
      return json({ jobs: data ?? [] });
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (!BRIDGE_KEY) return json({ error: "Bridge not configured" }, 500);
  const provided = req.headers.get("x-claude-key") ?? "";
  if (!timingSafeEqual(BRIDGE_KEY, provided)) return json({ error: "Unauthorized" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }

  const { action, params } = body ?? {};
  if (!VALID_ACTIONS.includes(action)) {
    return json({ error: `invalid action. allowed: ${VALID_ACTIONS.join(", ")}` }, 400);
  }
  try {
    return await handle(action, params ?? {});
  } catch (e) {
    console.error("claude-bridge error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
