// Per-line planner for the Action Sequence agent.
// ONE checklist line in → ONE tool call (or no_action) out.
//
// Tools come in two flavors:
//   • Generation tools: text-text, web-search, text-image, image-image, remix,
//     image-video, video-video, audio-image-video, analyze-image
//   • Management tools (Magic Checklist app CRUD): addItem, updateItem,
//     updateChecklistTitle, updateMediaTitle, fetchChecklist, fetchItems,
//     fetchMedia, createChecklist, createItemAndTriggerJob
//
// The planner mirrors Dante's identity: route to the right team-roster checklist
// (loose ilike match), default to "📨 Cameron Inbox" when no destination is given,
// never invent checklist titles, never create new lists unless the line says so.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GEN_ACTIONS = [
  "text-text", "text-image", "image-image", "remix",
  "image-video", "video-video", "audio-image-video",
  "analyze-image", "web-search",
] as const;

const MGMT_TOOLS = [
  "addItem", "updateItem", "updateChecklistTitle", "updateMediaTitle",
  "fetchChecklist", "fetchItems", "fetchMedia",
  "createChecklist", "createItemAndTriggerJob",
] as const;

const ALL_ACTIONS = [...GEN_ACTIONS, ...MGMT_TOOLS] as const;

type GenAction = typeof GEN_ACTIONS[number];
type MgmtTool = typeof MGMT_TOOLS[number];

type CatalogEntry = {
  handle: string;
  name: string;
  type: "image" | "video" | "audio";
  source: string;
};

type GenStep = {
  action_type: GenAction;
  prompt: string;
  input_refs?: { images?: string[]; videos?: string[]; audios?: string[] };
  aspect_ratio?: string;
  quality?: string;
  count?: number;
  note?: string;
};

type MgmtStep = {
  tool: MgmtTool;
  args: Record<string, any>;
  note?: string;
};

const SYSTEM = `You are Dante's executor for the Magic Checklist app. The user has a checklist; you receive ONE line at a time and must DECIDE THE SINGLE NEXT TOOL CALL for that one line. You never talk to the user. You never ask questions. You never reply with "please provide context".

You can choose ONE of:
  • a GENERATION tool ("step" field) — produces media or text that will be appended to the output checklist
  • an APP-MANAGEMENT tool ("management" field) — reads or writes the Magic Checklist app itself

Hard rules:
- Return exactly one tool call ("tool_call") OR "no_action". NEVER return multiple steps.
- Use "no_action" ONLY for blank/heading/narration lines, OR when the line strictly requires a media reference that does not exist in the catalog. NEVER use it because text context is missing — attached_text_context IS the context. NEVER use it to ask the user a question.
- One line = one tool. The user will write a separate line if they want a separate step.

═══════════════════════════════════════════════
DANTE ROUTING (use management.tool = "fetchChecklist" or "addItem")
═══════════════════════════════════════════════

Team roster — when a line names one of these people OR mentions their domain, route the work to that person's master checklist using fetchChecklist with name like "%FirstName%":

- Jackson         → content
- Twan            → music
- Ava             → Multiverse
- Zamir           → app code
- Andre           → app hygiene
- Layla           → automation
- Brandy          → forms
- James           → personal routines
- Stella          → house
- Samantha        → travel
- Mason           → phone
- Destiny         → communications
- Fay             → family / friends
- Lewis           → finance
- David           → research
- Marcus          → sponsorship
- Dante           → appointments / deadlines

Default destination — when no destination is named and no roster role obviously applies, route to "📨 Cameron Inbox" (fetchChecklist name "%Cameron Inbox%"). For outbound messages CJ routes manually, use the "🖱️ Send to Dispatch" lane (fetchChecklist name "%Send to Dispatch%").

═══════════════════════════════════════════════
EXECUTION STANDARDS
═══════════════════════════════════════════════

- NEVER invent a checklist title. ONLY reference checklists you can find via fetchChecklist with an ilike pattern.
- NEVER create a new checklist unless the current_line literally says "create checklist" or "new checklist".
- Preserve task details verbatim — every constraint, date, name carried through.
- Appointments/deadlines (Dante's lane): when adding text, use 4 short sentences followed by 4 options labeled A / B / C / D. Build in commute math: 15-min default buffer, 25-min for high-stakes appointments.
- Deadline cadence: 7d / 3d / 1d / day-of warnings.
- Confirmation culture: 24h before appointments, offer a draft confirmation in the option list.

═══════════════════════════════════════════════
GENERATION TOOL REFERENCE
═══════════════════════════════════════════════

- text-image: image refs optional.
- image-image: REQUIRES >=1 image ref.
- remix: REQUIRES >=1 image ref (>=2 preferred).
- image-video: REQUIRES exactly 1 image ref.
- video-video: REQUIRES 1 video ref.
- audio-image-video: REQUIRES 1 image AND 1 audio ref.
- analyze-image: REQUIRES 1 image ref.
- text-text, web-search: no refs needed.

For image/video tools write a CLEAN VISUAL PROMPT only. Do NOT paste the line verbatim. The image/video tool sees ONLY your prompt + refs + aspect_ratio.

For text-text / web-search / analyze-image you may phrase the instruction naturally; attached_text_context is appended automatically by the executor.

count: only > 1 when the line explicitly asks for multiple identical outputs (max 5).

═══════════════════════════════════════════════
MANAGEMENT TOOL REFERENCE
═══════════════════════════════════════════════

The executor automatically injects user_id on every management call — DO NOT include user_id in args. You CAN reference values from earlier steps in this same sequence using "step:N.field" strings (e.g. checklist_id: "step:0.checklist_id"); the executor resolves them. Examples below.

- fetchChecklist({ name }) — find by ilike. ALWAYS wildcard, e.g. "%Cameron Inbox%". Returns { checklists: [...] }; first row's id is "step:N.checklist_id".
- fetchItems({ checklist_id }) — returns { items: [...] }.
- fetchMedia({ query?, kind?, limit? }) — search media gallery.
- addItem({ checklist_id, text, position?, parent_item_id? }) — append a new item.
- updateItem({ item_id, text?, checked?, status?, result?, linked_checklist_id?, external_link? }).
- updateChecklistTitle({ checklist_id, title }).
- updateMediaTitle({ media_id, title }).
- createChecklist({ title, background_color? }) — ONLY when current_line explicitly asks for a new checklist.
- createItemAndTriggerJob({ checklist_id, text, action_type, payload, scheduled_for?, recurrence? }) — create a checklist item AND fire a generation job in one call.

Typical Dante pattern for "add X to Y's list":
  Step A: management.tool="fetchChecklist", args={ name: "%Jackson%" }
  Step B (next line): management.tool="addItem", args={ checklist_id: "step:0.checklist_id", text: "..." }

If the current_line already names the destination AND a previous step already fetched it, just emit the addItem with the step:N reference. If the destination has not yet been fetched in this sequence, emit fetchChecklist this turn.`;

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
          description: "Generation tool call. Provide EITHER step OR management, never both.",
          properties: {
            action_type: { type: "string", enum: [...GEN_ACTIONS] as any },
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
        },
        management: {
          type: "object",
          description: "Magic Checklist app CRUD call. Provide EITHER step OR management, never both. Do NOT include user_id in args; the executor injects it.",
          properties: {
            tool: { type: "string", enum: [...MGMT_TOOLS] as any },
            args: { type: "object", additionalProperties: true },
            note: { type: "string" },
          },
          required: ["tool", "args"],
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

function clampGenStep(s: any, allowed: Set<string>, maxImagesPerStep: number, defaultAspect: string): GenStep | null {
  if (!s || typeof s !== "object") return null;
  if (typeof s.action_type !== "string" || !allowed.has(s.action_type)) return null;
  if (typeof s.prompt !== "string" || !s.prompt.trim()) return null;
  const out: GenStep = {
    action_type: s.action_type as GenAction,
    prompt: String(s.prompt).slice(0, 4000),
  };
  if (s.input_refs && typeof s.input_refs === "object") {
    const refs: GenStep["input_refs"] = {};
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
    ? s.aspect_ratio.slice(0, 10) : defaultAspect;
  if (typeof s.quality === "string") out.quality = s.quality.slice(0, 16);
  if (typeof s.count === "number" && s.count > 0) {
    out.count = Math.min(Math.floor(s.count), maxImagesPerStep);
  }
  if (typeof s.note === "string") out.note = s.note.slice(0, 200);
  return out;
}

function clampMgmtStep(m: any, allowed: Set<string>): MgmtStep | null {
  if (!m || typeof m !== "object") return null;
  if (typeof m.tool !== "string" || !allowed.has(m.tool)) return null;
  if (!m.args || typeof m.args !== "object") return null;
  // Strip user_id — the executor will inject the sequence's owner.
  const args = { ...m.args };
  delete args.user_id;
  const out: MgmtStep = { tool: m.tool as MgmtTool, args };
  if (typeof m.note === "string") out.note = m.note.slice(0, 200);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    const currentLine: string = typeof body.current_line === "string" ? body.current_line : "";
    const catalog: CatalogEntry[] = Array.isArray(body.catalog) ? body.catalog.slice(0, 200) : [];
    const attachedTextContext: string = typeof body.attached_text_context === "string"
      ? body.attached_text_context.slice(0, 8000) : "";
    const allowedActions: string[] = Array.isArray(body.allowed_actions) && body.allowed_actions.length
      ? body.allowed_actions.filter((x: any) => (ALL_ACTIONS as readonly string[]).includes(x))
      : [...ALL_ACTIONS];
    const defaultAspect: string = typeof body.default_aspect_ratio === "string" && body.default_aspect_ratio.trim()
      ? body.default_aspect_ratio : "1:1";
    const maxImagesPerStep = Math.max(1, Math.min(5, Number(body.max_images_per_step) || 1));
    const priorOutputs: any[] = Array.isArray(body.prior_outputs) ? body.prior_outputs.slice(-20) : [];

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
      prior_outputs: priorOutputs.map((o, i) => ({
        handle: `step:${i}`,
        line_idx: o?.line_idx ?? null,
        kind: o?.mgmt_tool ? "management" : (o?.media_type ?? (o?.text ? "text" : null)),
        mgmt_tool: o?.mgmt_tool ?? null,
        summary: o?.mgmt_summary ?? o?.name ?? null,
        // Brief shape hint so the planner can build "step:N.field" refs.
        keys: o?.mgmt_result_keys ?? null,
      })),
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
      // Prefer management when both supplied (rare) since it's more specific.
      if (parsed.management) {
        const mgmt = clampMgmtStep(parsed.management, allowed);
        if (mgmt) {
          return new Response(JSON.stringify({ kind: "tool_call", management: mgmt }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
      const step = clampGenStep(parsed.step, allowed, maxImagesPerStep, defaultAspect);
      if (step) {
        return new Response(JSON.stringify({ kind: "tool_call", step }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ kind: "no_action", reason: "planner produced unusable step" }), {
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
