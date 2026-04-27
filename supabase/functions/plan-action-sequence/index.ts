// Plan an action sequence: turn checklist instructions + context into an
// ordered list of tool calls (text-text, text-image, image-image, remix,
// image-video, video-video, audio-image-video, analyze-image, web-search).
// Pure planner — no side effects. Returns strict JSON validated against caps.

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

type GalleryItem = { name: string; url: string; type: "image" | "video" | "audio" };

type PlanStep = {
  action_type: ActionType;
  prompt: string;
  input_refs?: { images?: string[]; videos?: string[]; audios?: string[] };
  aspect_ratio?: string;
  quality?: string;
  count?: number;
  note?: string;
};

type Plan = { steps: PlanStep[]; rationale: string };

const SYSTEM = `You are a planner for a checklist-driven AI workflow agent. The user's checklist is a list of natural-language instructions. Convert it into an ORDERED plan of tool calls.

You have these tools (and ONLY these):
- text-text: generate text from a prompt (+ optional text/image context).
- web-search: search the web and return a summary.
- text-image: generate an image from a prompt. Optionally refImages (image refs) for style.
- image-image: edit one image with a prompt. Requires 1+ image refs.
- remix: combine multiple images into a new image. Requires 2+ image refs.
- image-video: turn an image into a short video. Requires 1 image ref.
- video-video: edit a video with a prompt. Requires 1 video ref.
- audio-image-video: lip-sync / talking-head from 1 image + 1 audio.
- analyze-image: describe / answer a question about 1 image.

Rules:
1. Output STRICT JSON: {"rationale":"...", "steps":[ ... ]}. No markdown, no comments.
2. Each step: {"action_type": <tool>, "prompt": <string>, "input_refs"?: {"images"?: [...], "videos"?: [...], "audios"?: [...]}, "aspect_ratio"?: "1:1"|"16:9"|"9:16"|"4:3"|"3:4", "quality"?: "auto"|"standard"|"hd", "count"?: <int>, "note"?: <string>}.
3. Refs MUST be one of:
   (a) "step:N" — output of a previous step (0-indexed).
   (b) An exact or close substring of a name in the provided gallery_index. Use the gallery name verbatim.
   Never invent URLs. Never put URLs in input_refs.
4. Only use tools listed in allowed_actions.
5. NEVER exceed max_steps total steps. NEVER set count > max_images_per_step.
6. If the user asks for "N of each" image, you MAY emit N separate text-image / remix / image-image steps OR set count=N on a single step (worker will fan out). Prefer count when the prompt is identical.
7. Keep prompts concrete. Each step's prompt is sent verbatim to the tool.
8. For aspect ratios mentioned in the instructions (e.g., "9 by 16", "vertical", "portrait"), set aspect_ratio.
9. If an instruction is unclear or impossible (e.g., references a checklist not provided, a tool not allowed), SKIP it — don't fail the whole plan.
10. rationale: ONE sentence, max 200 chars, summarizing the plan in plain English.`;

function bad(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function clampPlan(raw: any, maxSteps: number, maxImagesPerStep: number, allowed: Set<string>): Plan {
  const out: Plan = { steps: [], rationale: typeof raw?.rationale === "string" ? raw.rationale.slice(0, 240) : "" };
  const steps: any[] = Array.isArray(raw?.steps) ? raw.steps : [];
  for (const s of steps) {
    if (out.steps.length >= maxSteps) break;
    if (!s || typeof s !== "object") continue;
    const at = s.action_type;
    if (typeof at !== "string" || !allowed.has(at)) continue;
    if (typeof s.prompt !== "string" || !s.prompt.trim()) continue;
    const step: PlanStep = {
      action_type: at as ActionType,
      prompt: String(s.prompt).slice(0, 4000),
    };
    if (s.input_refs && typeof s.input_refs === "object") {
      const refs: PlanStep["input_refs"] = {};
      for (const k of ["images", "videos", "audios"] as const) {
        if (Array.isArray((s.input_refs as any)[k])) {
          refs[k] = (s.input_refs as any)[k]
            .filter((x: any) => typeof x === "string")
            .map((x: string) => x.slice(0, 200))
            .slice(0, 16);
        }
      }
      if (Object.keys(refs).length) step.input_refs = refs;
    }
    if (typeof s.aspect_ratio === "string") step.aspect_ratio = s.aspect_ratio.slice(0, 10);
    if (typeof s.quality === "string") step.quality = s.quality.slice(0, 16);
    if (typeof s.count === "number" && s.count > 0) {
      step.count = Math.min(Math.floor(s.count), maxImagesPerStep);
    }
    if (typeof s.note === "string") step.note = s.note.slice(0, 200);
    out.steps.push(step);
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    const instructions: string[] = Array.isArray(body.instructions) ? body.instructions.filter((x: any) => typeof x === "string" && x.trim()) : [];
    const contextText: string = typeof body.context_text === "string" ? body.context_text : "";
    const galleryIndex: GalleryItem[] = Array.isArray(body.gallery_index) ? body.gallery_index.slice(0, 200) : [];
    const allowedActions: string[] = Array.isArray(body.allowed_actions) && body.allowed_actions.length
      ? body.allowed_actions.filter((x: any) => (ALL_ACTIONS as readonly string[]).includes(x))
      : [...ALL_ACTIONS];
    const maxSteps = Math.max(1, Math.min(30, Number(body.max_steps) || 12));
    const maxImagesPerStep = Math.max(1, Math.min(5, Number(body.max_images_per_step) || 2));

    if (instructions.length === 0) return bad("instructions required");

    const key = Deno.env.get("LOVABLE_API_KEY");
    if (!key) return bad("LOVABLE_API_KEY not configured", 500);

    const userMsg = JSON.stringify({
      instructions,
      additional_text_context: contextText || null,
      gallery_index: galleryIndex.map((g) => ({ name: g.name, type: g.type })),
      allowed_actions: allowedActions,
      max_steps: maxSteps,
      max_images_per_step: maxImagesPerStep,
    });

    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userMsg },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      return bad(`planner LLM error ${r.status}: ${t.slice(0, 300)}`, 502);
    }
    const data = await r.json();
    const content = data.choices?.[0]?.message?.content ?? "{}";
    let parsed: any = {};
    try { parsed = JSON.parse(content); } catch { return bad("planner returned invalid JSON", 502); }

    const allowed = new Set(allowedActions);
    const plan = clampPlan(parsed, maxSteps, maxImagesPerStep, allowed);
    if (plan.steps.length === 0) return bad("planner produced no usable steps", 422);

    return new Response(JSON.stringify(plan), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("plan-action-sequence error", e);
    return bad((e as Error).message, 500);
  }
});
