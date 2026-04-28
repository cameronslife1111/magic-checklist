// Per-line planner for the Action Sequence agent.
// Given ONE checklist line plus a rich media catalog (handles + names + types),
// returns exactly one decision: tool_call | compound (<=3 sub-steps) | no_action.
// Uses tool-calling for structured output to avoid JSON parse failures.

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

const SYSTEM = `You are a per-line planner for a multi-step AI agent. The user has a checklist; you receive ONE line at a time.

You also receive a CATALOG of media that has ALREADY BEEN FILTERED to what is legitimately available for THIS line. The catalog may include:
- The line's own attached media ("line:image" / "line:video" / "line:audio").
- Media inside the line's own linked checklist ("linked-line:I").
- Global media the user attached in the Run Sequence dialog ("attached:N").
- Prior step outputs ("step:N") — INCLUDED ONLY IF this line's text clearly back-references a prior result (words like "previous", "prior", "the result", "what we just made", "step N", "above", "earlier") OR names a prior step's output. If you do not see "step:N" entries in the catalog, prior outputs are OFF-LIMITS for this line.

Your job: decide the SINGLE next action for this one line. You return exactly one decision via the "decide" tool.

Decision kinds:
- "tool_call": this line maps to one tool invocation. Provide the step.
- "compound": this line legitimately needs 2 chained tool calls (e.g. "make an image of X then turn it into a video"). Max 2 sub-steps. Use sparingly.
- "no_action": this line is a heading, narration, blank, comment, or otherwise not actionable, OR the line needs reference media that simply isn't in the catalog. No tool call.

Available tools (use ONLY those listed in allowed_actions):
- text-text: text from prompt.
- web-search: search the web; returns a summary.
- text-image: generate an image from a prompt.
- image-image: edit ONE image with a prompt. REQUIRES >=1 image ref.
- remix: combine MULTIPLE images. REQUIRES >=1 image ref (>=2 strongly preferred).
- image-video: turn an image into a short video. REQUIRES exactly 1 image ref.
- video-video: edit a video. REQUIRES 1 video ref.
- audio-image-video: lip-sync a talking-head from 1 image + 1 audio. REQUIRES both.
- analyze-image: describe/answer about 1 image. REQUIRES 1 image ref.

Reference rules — CRITICAL for media tools:
1. Every entry in input_refs MUST be the EXACT "handle" string of a CATALOG entry (e.g. "line:image:0", "linked-line:2", "attached:0", "step:3"). Name-only refs are REJECTED for media tools.
2. NEVER invent handles. NEVER guess. NEVER substitute unrelated media.
3. If the line clearly needs a reference image/video/audio but no suitable handle exists in the catalog, return "no_action" with a brief reason naming what was missing.
4. For text-text / web-search / analyze-image of a *general* topic, you do NOT need any refs.

Other rules:
- Each step prompt must be self-contained, concrete, and IMAGE/VIDEO PROMPTS MUST DESCRIBE THE VISUAL ONLY — do not paste the surrounding checklist context, narration, or instructions into the prompt. The image/video tool sees only the prompt + refs.
- For text tools, you may incorporate context naturally; for media tools, write a clean visual prompt.
- For aspect ratio cues ("vertical"/"portrait" -> "9:16", "landscape"/"horizontal" -> "16:9", "square" -> "1:1"), set aspect_ratio.
- count: only set when the line explicitly asks for N copies of the SAME thing (max 5).
- Do NOT include the literal line text in the prompt — rewrite it as a clean instruction for the tool.`;

const TOOL_SCHEMA = {
  type: "function",
  function: {
    name: "decide",
    description: "Decide the next action for this checklist line.",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["tool_call", "compound", "no_action"] },
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
        steps: {
          type: "array",
          description: "Required when kind=compound; 2 or 3 steps.",
          minItems: 2,
          maxItems: 2,
          items: {
            type: "object",
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
              },
              aspect_ratio: { type: "string", enum: ["1:1", "16:9", "9:16", "4:3", "3:4"] },
              quality: { type: "string", enum: ["auto", "standard", "hd"] },
              count: { type: "integer", minimum: 1, maximum: 5 },
              note: { type: "string" },
            },
            required: ["action_type", "prompt"],
          },
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

function clampStep(s: any, allowed: Set<string>, maxImagesPerStep: number): PlanStep | null {
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
  if (typeof s.aspect_ratio === "string") out.aspect_ratio = s.aspect_ratio.slice(0, 10);
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
    const priorOutputs: any[] = Array.isArray(body.prior_outputs_summary) ? body.prior_outputs_summary.slice(-20) : [];
    const upcoming: string[] = Array.isArray(body.upcoming_lines_preview) ? body.upcoming_lines_preview.slice(0, 5) : [];
    const catalog: CatalogEntry[] = Array.isArray(body.catalog) ? body.catalog.slice(0, 300) : [];
    const linkedContextText: string = typeof body.linked_context_text === "string" ? body.linked_context_text.slice(0, 6000) : "";
    const allowedActions: string[] = Array.isArray(body.allowed_actions) && body.allowed_actions.length
      ? body.allowed_actions.filter((x: any) => (ALL_ACTIONS as readonly string[]).includes(x))
      : [...ALL_ACTIONS];
    const maxImagesPerStep = Math.max(1, Math.min(5, Number(body.max_images_per_step) || 2));

    if (!currentLine.trim()) {
      return new Response(JSON.stringify({ kind: "no_action", reason: "blank line" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const key = Deno.env.get("OPENAI_API_KEY");
    if (!key) return bad("OPENAI_API_KEY not configured", 500);

    const userMsg = JSON.stringify({
      current_line: currentLine,
      prior_outputs_summary: priorOutputs,
      upcoming_lines_preview: upcoming,
      catalog: catalog.map((c) => ({ handle: c.handle, name: c.name, type: c.type, source: c.source })),
      linked_context_text: linkedContextText || null,
      allowed_actions: allowedActions,
      max_images_per_step: maxImagesPerStep,
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
      // Fallback: model declined to call the tool — treat as no_action.
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
      const step = clampStep(parsed.step, allowed, maxImagesPerStep);
      if (!step) {
        return new Response(JSON.stringify({ kind: "no_action", reason: "planner produced unusable step" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ kind: "tool_call", step }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (kind === "compound") {
      const raw = Array.isArray(parsed.steps) ? parsed.steps : [];
      const steps = raw.map((s: any) => clampStep(s, allowed, maxImagesPerStep)).filter(Boolean).slice(0, 3) as PlanStep[];
      if (steps.length === 0) {
        return new Response(JSON.stringify({ kind: "no_action", reason: "compound had no usable steps" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ kind: "compound", steps }), {
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
