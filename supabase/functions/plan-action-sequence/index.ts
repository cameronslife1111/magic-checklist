// Per-line planner for the Action Sequence agent.
// ONE checklist line in → ONE tool call (or no_action) out. No compound steps.
// The planner sees only:
//   - the current line text
//   - the user-attached text context (concatenated checklists)
//   - the user-attached media catalog (handle + name + type)
//   - prior step outputs ONLY when this line clearly back-references them
//   - the allowed tool list and a default aspect ratio
// It does NOT see the rest of the input checklist, upcoming lines, or
// auto-discovered linked checklists. This keeps each decision focused.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALL_ACTIONS = [
  "text-text", "text-image", "image-image", "remix",
  "image-video", "video-video", "audio-image-video",
  "analyze-image", "web-search",
] as const;

type ActionType = typeof ALL_ACTIONS[number];

type CatalogEntry = {
  handle: string;
  name: string;
  type: "image" | "video" | "audio";
  source: string;
};

type PlanStep = {
  action_type: ActionType;
  prompt: string;
  input_refs?: { images?: string[]; videos?: string[]; audios?: string[] };
  aspect_ratio?: string;
  quality?: string;
  count?: number;
  note?: string;
};

const SYSTEM = `You are an EXECUTOR for a multi-step AI agent. The user has a checklist; you receive ONE line at a time and must DECIDE THE SINGLE NEXT TOOL CALL for that one line. You never talk to the user. You never ask questions. You never reply with "please provide context" or "I need more information" — those are forbidden.

Hard rules:
- ALWAYS return exactly one tool call ("tool_call") OR "no_action". NEVER return multiple steps. Do NOT split a line into sub-steps. The user already broke their work into lines; one line = one tool call.
- If the line says something like "first write a prompt, then make the image", just do the IMAGE tool with a clean visual prompt. The user will write a separate prompt line if they want a separate text step.
- "no_action" is ONLY for: blank/heading/narration lines, OR when the line strictly requires a media reference that does not exist in the catalog. NEVER use it because text context is missing — the attached_text_context block IS the context. NEVER use it to ask the user a question.

Inputs you receive:
- current_line: the single instruction to act on.
- attached_text_context: text the user attached in the Run Sequence dialog. APPROVED, READY-TO-USE working context. The downstream text/web tools also receive this automatically — you do NOT need to copy it into your prompt.
- catalog: the ONLY media you may reference. Each entry has a "handle" string (e.g. "line:image:0", "attached:0", "step:N"). You MUST use exact handles in input_refs — never names, never made-up handles. If a needed reference isn't in the catalog, return no_action.
- allowed_actions: which tools you may pick from.
- default_aspect_ratio: use this UNLESS current_line clearly says otherwise (vertical/portrait → 9:16, landscape/horizontal → 16:9, square → 1:1).

Tool reference rules:
- text-image: image refs optional.
- image-image: REQUIRES >=1 image ref.
- remix: REQUIRES >=1 image ref (>=2 preferred).
- image-video: REQUIRES exactly 1 image ref.
- video-video: REQUIRES 1 video ref.
- audio-image-video: REQUIRES 1 image AND 1 audio ref.
- analyze-image: REQUIRES 1 image ref.
- text-text, web-search: no refs needed.

Prompt rules:
- For media tools (text-image / image-image / remix / image-video / video-video / audio-image-video): write a CLEAN VISUAL PROMPT only. Do NOT paste the line verbatim. Do NOT include checklist text, narration, or instructions. The image/video tool sees ONLY your prompt + refs + aspect_ratio.
- For text-text / web-search / analyze-image: you may phrase the instruction naturally; the attached_text_context is appended automatically by the executor for text/web tools.
- count: only > 1 when the line explicitly asks for multiple identical outputs (max 5).`;

const TOOL_SCHEMA = {
  type: "function",
  function: {
    name: "decide",
    description: "Decide the single next action for this checklist line.",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["tool_call", "no_action"] },
        reason: { type: "string", description: "Required when kind=no_action; brief." },
        step: {
          type: "object",
          description: "Required when kind=tool_call.",
          properties: {
            action_type: { type: "string", enum: [...ALL_ACTIONS] as any },
            prompt: { type: "string" },
            input_refs: {
              type: "object",
              properties: {
                images: { type: "array", items: { type: "string" } },
                videos: { type: "array", items: { type: "string" } },
                audios: { type: "array", items: { type: "string" } },
              },
              additionalProperties: false,
            },
            aspect_ratio: { type: "string", enum: ["1:1", "16:9", "9:16", "4:3", "3:4"] },
            quality: { type: "string", enum: ["auto", "standard", "hd"] },
            count: { type: "integer", minimum: 1, maximum: 5 },
            note: { type: "string" },
          },
          required: ["action_type", "prompt"],
        },
      },
      required: ["kind"],
    },
  },
};

function bad(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function clampStep(s: any, allowed: Set<string>, maxImagesPerStep: number, defaultAspect: string): PlanStep | null {
  if (!s || typeof s !== "object") return null;
  if (typeof s.action_type !== "string" || !allowed.has(s.action_type)) return null;
  if (typeof s.prompt !== "string" || !s.prompt.trim()) return null;
  const out: PlanStep = {
    action_type: s.action_type as ActionType,
    prompt: String(s.prompt).slice(0, 4000),
  };
  if (s.input_refs && typeof s.input_refs === "object") {
    const refs: PlanStep["input_refs"] = {};
    for (const k of ["images", "videos", "audios"] as const) {
      if (Array.isArray((s.input_refs as any)[k])) {
        refs[k] = (s.input_refs as any)[k]
          .filter((x: any) => typeof x === "string" && x.trim())
          .map((x: string) => x.trim().slice(0, 200))
          .slice(0, 16);
      }
    }
    if (Object.keys(refs).length) out.input_refs = refs;
  }
  out.aspect_ratio = typeof s.aspect_ratio === "string" && s.aspect_ratio.trim()
    ? s.aspect_ratio.slice(0, 10)
    : defaultAspect;
  if (typeof s.quality === "string") out.quality = s.quality.slice(0, 16);
  if (typeof s.count === "number" && s.count > 0) {
    out.count = Math.min(Math.floor(s.count), maxImagesPerStep);
  }
  if (typeof s.note === "string") out.note = s.note.slice(0, 200);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    const currentLine: string = typeof body.current_line === "string" ? body.current_line : "";
    const catalog: CatalogEntry[] = Array.isArray(body.catalog) ? body.catalog.slice(0, 200) : [];
    const attachedTextContext: string = typeof body.attached_text_context === "string"
      ? body.attached_text_context.slice(0, 8000)
      : "";
    const allowedActions: string[] = Array.isArray(body.allowed_actions) && body.allowed_actions.length
      ? body.allowed_actions.filter((x: any) => (ALL_ACTIONS as readonly string[]).includes(x))
      : [...ALL_ACTIONS];
    const defaultAspect: string = typeof body.default_aspect_ratio === "string" && body.default_aspect_ratio.trim()
      ? body.default_aspect_ratio
      : "1:1";
    const maxImagesPerStep = Math.max(1, Math.min(5, Number(body.max_images_per_step) || 1));

    if (!currentLine.trim()) {
      return new Response(JSON.stringify({ kind: "no_action", reason: "blank line" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const key = Deno.env.get("OPENAI_API_KEY");
    if (!key) return bad("OPENAI_API_KEY not configured", 500);

    const userMsg = JSON.stringify({
      current_line: currentLine,
      attached_text_context: attachedTextContext || null,
      catalog: catalog.map((c) => ({ handle: c.handle, name: c.name, type: c.type, source: c.source })),
      allowed_actions: allowedActions,
      default_aspect_ratio: defaultAspect,
    });

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.4-2026-03-05",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userMsg },
        ],
        tools: [TOOL_SCHEMA],
        tool_choice: { type: "function", function: { name: "decide" } },
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      console.error(`plan-action-sequence openai status=${r.status} body=${t.slice(0, 500)}`);
      if (r.status === 429) return bad("rate limited by OpenAI", 429);
      if (r.status === 401) return bad("OpenAI auth failed (check OPENAI_API_KEY)", 401);
      if (r.status === 402) return bad("OpenAI quota exhausted, check billing", 402);
      return bad(`planner LLM error ${r.status}: ${t.slice(0, 300)}`, 502);
    }
    const data = await r.json();
    const call = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!call?.function?.arguments) {
      return new Response(JSON.stringify({ kind: "no_action", reason: "planner returned no decision" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    let parsed: any = {};
    try { parsed = JSON.parse(call.function.arguments); } catch {
      return new Response(JSON.stringify({ kind: "no_action", reason: "planner returned invalid JSON" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const allowed = new Set(allowedActions);
    const kind = parsed.kind;
    if (kind === "no_action") {
      return new Response(JSON.stringify({ kind: "no_action", reason: String(parsed.reason ?? "").slice(0, 200) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (kind === "tool_call") {
      const step = clampStep(parsed.step, allowed, maxImagesPerStep, defaultAspect);
      if (!step) {
        return new Response(JSON.stringify({ kind: "no_action", reason: "planner produced unusable step" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ kind: "tool_call", step }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ kind: "no_action", reason: "unknown decision kind" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("plan-action-sequence error", e);
    return bad((e as Error).message, 500);
  }
});
