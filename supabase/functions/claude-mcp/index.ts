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

mcp.tool("createItemAndTriggerJob", {
  description: `Create a new checklist item with the given text, then immediately enqueue an action job whose source_item_id is that new item. Returns { item_id, job_id }. When the job completes, its result media will be written back into the new item. action_type must be one of: ${VALID_JOB_ACTIONS.join(", ")}.`,
  inputSchema: {
    type: "object",
    properties: {
      user_id: { type: "string" },
      checklist_id: { type: "string" },
      text: { type: "string", description: "Text for the new checklist item" },
      position: { type: "number" },
      parent_item_id: { type: "string" },
      action_type: { type: "string", enum: VALID_JOB_ACTIONS },
      payload: { type: "object" },
      scheduled_for: { type: "string" },
      recurrence: { type: "object" },
    },
    required: ["user_id", "checklist_id", "text", "action_type"],
  },
  handler: async (args: any) => {
    if (!VALID_JOB_ACTIONS.includes(args.action_type)) {
      return text({ error: `invalid action_type. allowed: ${VALID_JOB_ACTIONS.join(", ")}` });
    }
    const { data: item, error: itemErr } = await admin
      .from("checklist_items").insert({
        checklist_id: args.checklist_id,
        user_id: args.user_id,
        text: args.text,
        position: typeof args.position === "number" ? args.position : Date.now(),
        parent_item_id: args.parent_item_id ?? null,
      }).select("id").single();
    if (itemErr) return text({ error: `create item failed: ${itemErr.message}` });

    const status = args.scheduled_for ? "scheduled" : "pending";
    const promptPreview = typeof args.payload?.prompt === "string"
      ? String(args.payload.prompt).slice(0, 500) : null;

    const { data: job, error: jobErr } = await admin
      .from("action_jobs").insert({
        user_id: args.user_id,
        checklist_id: args.checklist_id,
        source_item_id: item.id,
        action_type: args.action_type,
        status,
        payload: args.payload ?? {},
        prompt_preview: promptPreview,
        scheduled_for: args.scheduled_for ?? null,
        recurrence: args.recurrence ?? null,
      }).select("id, status").single();
    if (jobErr) {
      // Roll back the orphan item so we don't leave dangling rows.
      await admin.from("checklist_items").delete().eq("id", item.id);
      return text({ error: `create job failed: ${jobErr.message}` });
    }

    if (status === "pending") {
      fetch(`${SUPABASE_URL}/functions/v1/process-action-queue`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SERVICE_ROLE}`,
          apikey: SERVICE_ROLE,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ trigger: "claude-mcp", id: job.id }),
      }).catch((err) => console.error("worker kick failed", err));
    }

    return text({ item_id: item.id, job_id: job.id, status: job.status });
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

mcp.tool("fetchMedia", {
  description: "Search the user's media gallery (media_assets table). Use this to find images, videos, or audio files by fuzzy title match. If no query is given, returns the most recent items. Always scoped to user_id.",
  inputSchema: {
    type: "object",
    properties: {
      user_id: { type: "string", description: "Owner user UUID" },
      query: { type: "string", description: "Fuzzy title search (matches with %query% ilike). Omit to get most recent." },
      kind: { type: "string", enum: ["image", "video", "audio"], description: "Filter by media type" },
      limit: { type: "number", description: "Max results (default 10, max 50)" },
    },
    required: ["user_id"],
  },
  handler: async ({ user_id, query, kind, limit }: any) => {
    const cap = Math.min(Math.max(Number(limit) || 10, 1), 50);
    let q = admin
      .from("media_assets")
      .select("id, kind, url, title, mime_type, width, height, duration_seconds, size_bytes, created_at, storage_path")
      .eq("user_id", user_id)
      .order("created_at", { ascending: false })
      .limit(cap);
    if (kind) q = q.eq("kind", kind);
    if (query && String(query).trim()) {
      q = q.ilike("title", `%${String(query).trim()}%`);
    }
    const { data, error } = await q;
    if (error) return text({ error: error.message });
    return text({ media: data ?? [] });
  },
});

const ACTION_SCHEMAS: Record<string, any> = {
  "text-text": {
    description: "Generate text from a prompt (LLM call). Routes to openai-text.",
    payload: {
      prompt: { type: "string", required: true },
      model: { type: "string", required: false, note: "e.g. gpt-5, gpt-5-mini" },
      context: { type: "object", required: false, note: "{ checklists: uuid[], media: {type,url}[] } — max 15 each" },
    },
    example: { prompt: "Write a haiku about fish", model: "gpt-5-mini" },
  },
  "text-image": {
    description: "Generate an image from a text prompt. Routes to lovable-image.",
    payload: {
      prompt: { type: "string", required: true },
      aspectRatio: { type: "string", required: false, note: "1:1 | 16:9 | 9:16 | 4:3 | 3:4" },
      quality: { type: "string", required: false, note: "low | medium | high" },
    },
    example: { prompt: "A neon koi swimming through Tokyo", aspectRatio: "16:9", quality: "high" },
  },
  "image-image": {
    description: "Edit a single image with a prompt. Routes to lovable-image.",
    payload: {
      prompt: { type: "string", required: true },
      refImageUrls: { type: "string[]", required: true, note: "Public storage URLs from generated-media bucket. Min 1." },
      aspectRatio: { type: "string", required: false },
      quality: { type: "string", required: false, note: "low | medium | high" },
    },
    example: {
      prompt: "Change the background to a neon Tokyo street at night, keep the subject identical",
      refImageUrls: ["https://iedwmkdvwggpcmdyliii.supabase.co/storage/v1/object/public/generated-media/<user>/<source>.png"],
      aspectRatio: "1:1", quality: "high",
    },
  },
  "remix": {
    description: "Combine multiple reference images into a new image. Routes to lovable-image.",
    payload: {
      prompt: { type: "string", required: true },
      refImageUrls: { type: "string[]", required: true, note: "1–16 public URLs from generated-media bucket" },
      aspectRatio: { type: "string", required: false },
      quality: { type: "string", required: false },
    },
    example: {
      prompt: "Combine these characters into a single group portrait, painterly style",
      refImageUrls: [
        "https://iedwmkdvwggpcmdyliii.supabase.co/storage/v1/object/public/generated-media/<user>/<img1>.png",
        "https://iedwmkdvwggpcmdyliii.supabase.co/storage/v1/object/public/generated-media/<user>/<img2>.png",
      ],
      aspectRatio: "16:9", quality: "high",
    },
  },
  "image-video": {
    description: "Animate a still image into a video (Kling image-to-video). Routes to fal-video.",
    payload: {
      prompt: { type: "string", required: true },
      sourceUrl: { type: "string", required: true, note: "Start-frame image URL (or ctx.imageUrls[0] fallback)" },
      duration: { type: "string", required: false, note: '"5" or "10"' },
      generateAudio: { type: "boolean", required: false },
      negativePrompt: { type: "string", required: false },
      cfgScale: { type: "number", required: false, note: "Typically 0–1" },
      endImageUrl: { type: "string", required: false, note: "Optional last-frame target" },
    },
    example: {
      prompt: "Camera slowly pushes in, the fish begins to dance, bubbles rising",
      sourceUrl: "https://iedwmkdvwggpcmdyliii.supabase.co/storage/v1/object/public/generated-media/<user>/<start>.png",
      duration: "5", generateAudio: true, cfgScale: 0.5,
    },
  },
  "video-video": {
    description: "Drive a source video with a reference character (Kling motion-control). Routes to fal-video.",
    payload: {
      prompt: { type: "string", required: true },
      sourceUrl: { type: "string", required: true, note: "Source video URL" },
      imageUrl: { type: "string", required: true, note: "Reference character image URL" },
      characterOrientation: { type: "string", required: false, note: '"image" (default) | "video"' },
      keepOriginalSound: { type: "boolean", required: false },
      elementImageUrl: { type: "string", required: false, note: "Only used when characterOrientation === 'video'" },
    },
    example: {
      prompt: "A dancing fish in the same motion, underwater, cinematic",
      sourceUrl: "https://iedwmkdvwggpcmdyliii.supabase.co/storage/v1/object/public/generated-media/<user>/<clip>.mp4",
      imageUrl: "https://iedwmkdvwggpcmdyliii.supabase.co/storage/v1/object/public/generated-media/<user>/<character>.png",
      characterOrientation: "image", keepOriginalSound: false,
    },
  },
  "audio-image-video": {
    description: "Talking-avatar: drive a portrait image with audio (or generated voice). Routes to fal-avatar.",
    payload: {
      prompt: { type: "string", required: false, note: "Used when generating voice from text" },
      imageUrl: { type: "string", required: true },
      audioUrl: { type: "string", required: false, note: "Provide audioUrl OR prompt+voice" },
      voice: { type: "string", required: false },
      talkingStyle: { type: "string", required: false },
      resolution: { type: "string", required: false },
      aspectRatio: { type: "string", required: false },
      caption: { type: "string", required: false },
    },
    example: {
      imageUrl: "https://iedwmkdvwggpcmdyliii.supabase.co/storage/v1/object/public/generated-media/<user>/<face>.png",
      audioUrl: "https://iedwmkdvwggpcmdyliii.supabase.co/storage/v1/object/public/generated-media/<user>/<voice>.mp3",
      resolution: "720p", aspectRatio: "9:16",
    },
  },
  "analyze-image": {
    description: "Run a vision LLM on an image and return text. Routes to openai-vision.",
    payload: {
      prompt: { type: "string", required: true },
      imageUrl: { type: "string", required: false, note: "Or imageDataUrl, or first context image" },
      imageDataUrl: { type: "string", required: false },
    },
    example: {
      prompt: "Describe what's happening in this image in 2 sentences.",
      imageUrl: "https://iedwmkdvwggpcmdyliii.supabase.co/storage/v1/object/public/generated-media/<user>/<img>.png",
    },
  },
  "web-search": {
    description: "Run a web search via Perplexity. Routes to perplexity-search.",
    payload: {
      prompt: { type: "string", required: true, note: "The search query" },
    },
    example: { prompt: "Latest news on Kling v3 video model" },
  },
  "action-sequence": {
    description: "Plan-and-execute a multi-step sequence of other actions. Routes to plan-action-sequence.",
    payload: {
      prompt: { type: "string", required: true },
      output_checklist_id: { type: "string", required: true, note: "Checklist where step results are written" },
      max_steps: { type: "number", required: false, note: "default 12, max 50" },
      max_images: { type: "number", required: false, note: "default 12, max 30" },
      max_videos: { type: "number", required: false, note: "default 4, max 8" },
      max_runtime_minutes: { type: "number", required: false, note: "default 30, max 60" },
      max_images_per_step: { type: "number", required: false, note: "default 2, max 5" },
      max_failures: { type: "number", required: false, note: "default 2, max 5" },
      allowed_actions: { type: "string[]", required: false, note: "Subset of valid actions (excluding action-sequence)" },
    },
    example: {
      prompt: "Build a 3-shot promo: hero image, 5s animation, caption",
      output_checklist_id: "11111111-1111-1111-1111-111111111111",
      max_steps: 6, max_images: 4, max_videos: 1,
    },
  },
};

mcp.tool("describeAction", {
  description: "Return the full payload schema and a working example for a given action_type. Use this BEFORE calling triggerJob if you're unsure which fields to send. Pass no arguments to list all action types.",
  inputSchema: {
    type: "object",
    properties: {
      action_type: { type: "string", enum: VALID_JOB_ACTIONS, description: "Omit to list all action types with brief descriptions." },
    },
  },
  handler: async ({ action_type }: any) => {
    if (!action_type) {
      const all = Object.fromEntries(
        Object.entries(ACTION_SCHEMAS).map(([k, v]: any) => [k, v.description]),
      );
      return text({
        envelope: {
          user_id: "<auth.users uuid> (required)",
          checklist_id: "<checklist uuid> (required)",
          action_type: "<one of the keys below> (required)",
          source_item_id: "<optional uuid — links result back to a checklist item>",
          scheduled_for: "<optional ISO timestamp; omit to run immediately>",
          recurrence: "<null | hourly | daily | weekly | monthly | yearly>",
          payload: "<action-specific, see describeAction({ action_type })>",
        },
        actions: all,
        notes: [
          "All media URLs must be public URLs under https://iedwmkdvwggpcmdyliii.supabase.co/storage/v1/object/public/generated-media/...",
          "Use fetchMedia first to discover URLs; do not inline base64 (payload cap ~200KB).",
          "After triggerJob returns { job_id }, poll with pollJob({ job_id }) until status is 'completed' or 'failed'.",
        ],
      });
    }
    const schema = ACTION_SCHEMAS[action_type];
    if (!schema) return text({ error: `unknown action_type: ${action_type}` });
    return text({
      action_type,
      description: schema.description,
      envelope: {
        user_id: "<auth.users uuid>",
        checklist_id: "<checklist uuid>",
        action_type,
        source_item_id: "<optional>",
        scheduled_for: "<optional ISO timestamp>",
        recurrence: null,
        payload: schema.payload,
      },
      example_full_request: {
        user_id: "00000000-0000-0000-0000-000000000001",
        checklist_id: "11111111-1111-1111-1111-111111111111",
        action_type,
        payload: schema.example,
      },
    });
  },
});

const transport = new StreamableHttpTransport();
const httpHandler = transport.bind(mcp);
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

  const res = await httpHandler(c.req.raw);
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
});

Deno.serve(app.fetch);
