// claude-mcp: MCP (Model Context Protocol) Streamable HTTP server exposing
// the same actions as claude-bridge as native MCP tools.
// Auth: shared secret in `x-claude-key` header (compared against CLAUDE_BRIDGE_KEY).

import { Hono } from "hono";
import { McpServer, StreamableHttpTransport } from "mcp-lite";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BRIDGE_KEY = Deno.env.get("CLAUDE_BRIDGE_KEY") ?? "";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const VALID_JOB_ACTIONS = [
  "text-text", "text-image", "image-image", "remix",
  "image-video", "video-video", "audio-image-video",
  "analyze-image", "web-search", "action-sequence",
];

function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

const text = (obj: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }],
});

const mcp = new McpServer({
  name: "magic-checklist-bridge",
  version: "1.0.0",
});

mcp.tool("fetchChecklist", {
  description: "Find checklists for a user by (case-insensitive) title match. Returns up to 10 matches.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Checklist title (supports % wildcards for ilike)" },
      user_id: { type: "string", description: "Owner user UUID" },
    },
    required: ["name", "user_id"],
  },
  handler: async ({ name, user_id }: any) => {
    const { data, error } = await admin
      .from("checklists").select("*")
      .eq("user_id", user_id).ilike("title", name)
      .order("updated_at", { ascending: false }).limit(10);
    if (error) return text({ error: error.message });
    return text({ checklists: data ?? [] });
  },
});

mcp.tool("fetchItems", {
  description: "Fetch all items in a checklist, ordered by position.",
  inputSchema: {
    type: "object",
    properties: { checklist_id: { type: "string" } },
    required: ["checklist_id"],
  },
  handler: async ({ checklist_id }: any) => {
    const { data, error } = await admin
      .from("checklist_items").select("*")
      .eq("checklist_id", checklist_id)
      .order("position", { ascending: true });
    if (error) return text({ error: error.message });
    return text({ items: data ?? [] });
  },
});

mcp.tool("addItem", {
  description: "Add a new item to a checklist.",
  inputSchema: {
    type: "object",
    properties: {
      checklist_id: { type: "string" },
      user_id: { type: "string" },
      text: { type: "string" },
      position: { type: "number" },
      parent_item_id: { type: "string" },
    },
    required: ["checklist_id", "user_id", "text"],
  },
  handler: async (args: any) => {
    const { data, error } = await admin
      .from("checklist_items").insert({
        checklist_id: args.checklist_id,
        user_id: args.user_id,
        text: args.text,
        position: typeof args.position === "number" ? args.position : Date.now(),
        parent_item_id: args.parent_item_id ?? null,
      }).select().single();
    if (error) return text({ error: error.message });
    return text({ item: data });
  },
});

mcp.tool("triggerJob", {
  description: `Enqueue an action job (image/video/text generation, analysis, etc). action_type must be one of: ${VALID_JOB_ACTIONS.join(", ")}.`,
  inputSchema: {
    type: "object",
    properties: {
      user_id: { type: "string" },
      checklist_id: { type: "string" },
      action_type: { type: "string", enum: VALID_JOB_ACTIONS },
      payload: { type: "object", description: "Action-specific payload (e.g. { prompt, model, ... })" },
      source_item_id: { type: "string" },
      scheduled_for: { type: "string", description: "ISO timestamp; if set, job is scheduled instead of pending" },
      recurrence: { type: "object" },
    },
    required: ["user_id", "checklist_id", "action_type"],
  },
  handler: async (args: any) => {
    if (!VALID_JOB_ACTIONS.includes(args.action_type)) {
      return text({ error: `invalid action_type. allowed: ${VALID_JOB_ACTIONS.join(", ")}` });
    }
    const status = args.scheduled_for ? "scheduled" : "pending";
    const promptPreview = typeof args.payload?.prompt === "string"
      ? String(args.payload.prompt).slice(0, 500) : null;

    const { data, error } = await admin
      .from("action_jobs").insert({
        user_id: args.user_id,
        checklist_id: args.checklist_id,
        source_item_id: args.source_item_id ?? null,
        action_type: args.action_type,
        status,
        payload: args.payload ?? {},
        prompt_preview: promptPreview,
        scheduled_for: args.scheduled_for ?? null,
        recurrence: args.recurrence ?? null,
      }).select("id, status").single();
    if (error) return text({ error: error.message });

    if (status === "pending") {
      fetch(`${SUPABASE_URL}/functions/v1/process-action-queue`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SERVICE_ROLE}`,
          apikey: SERVICE_ROLE,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ trigger: "claude-mcp", id: data.id }),
      }).catch((err) => console.error("worker kick failed", err));
    }
    return text({ job_id: data.id, status: data.status });
  },
});

mcp.tool("pollJob", {
  description: "Get the current status and result of a job by id.",
  inputSchema: {
    type: "object",
    properties: { job_id: { type: "string" } },
    required: ["job_id"],
  },
  handler: async ({ job_id }: any) => {
    const { data, error } = await admin
      .from("action_jobs")
      .select("id, status, action_type, result, error_friendly, error_raw, created_at, started_at, completed_at, attempts")
      .eq("id", job_id).maybeSingle();
    if (error) return text({ error: error.message });
    if (!data) return text({ error: "job not found" });
    return text({ job: data });
  },
});

mcp.tool("getRecentJobs", {
  description: "List recent jobs for a user, optionally filtered by status.",
  inputSchema: {
    type: "object",
    properties: {
      user_id: { type: "string" },
      limit: { type: "number" },
      status: { type: "string" },
    },
    required: ["user_id"],
  },
  handler: async ({ user_id, limit = 20, status }: any) => {
    let q = admin.from("action_jobs")
      .select("id, status, action_type, prompt_preview, created_at, completed_at, error_friendly")
      .eq("user_id", user_id)
      .order("created_at", { ascending: false })
      .limit(Math.min(Math.max(Number(limit) || 20, 1), 100));
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) return text({ error: error.message });
    return text({ jobs: data ?? [] });
  },
});

const transport = new StreamableHttpTransport();
const app = new Hono();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-claude-key, mcp-session-id",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Expose-Headers": "mcp-session-id",
};

app.options("/*", (c) => new Response(null, { headers: corsHeaders }));

app.all("/*", async (c) => {
  if (!BRIDGE_KEY) {
    return new Response(JSON.stringify({ error: "Bridge not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const provided = c.req.header("x-claude-key")
    ?? c.req.query("key")
    ?? "";
  if (!timingSafeEqual(BRIDGE_KEY, provided)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const res = await transport.handleRequest(c.req.raw, mcp);
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
});

Deno.serve(app.fetch);
