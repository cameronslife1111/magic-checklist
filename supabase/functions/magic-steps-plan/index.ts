const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ACTION_KEYS = [
  "mute","queue",
  "add","duplicate-item","new","duplicate","delete-checklist","edit-title","split","split-emoji",
  "text-text","text-image","image-image","remix","image-video","video-video","audio-image-video",
  "insert-link","analyze-image","web-search","bg","rearrange",
  "copy-sentence","copy-checklist","send-to","send-to-blank","uncheck-all","combine-checked","media-gallery","theme","sign-out",
];

const STEP_KINDS = [
  "openActions","closeActions","pickAction",
  "setMediaOption","attachContextChecklist","attachContextMedia","generate",
  "checkItems","uncheckItems",
  "addItem","editItemText",
  "splitCurrent","splitByEmoji","combineChecked",
  "openChecklist","newChecklist","duplicateChecklist","deleteChecklist",
  "navigate","setTheme","setMuted","setBackground","rearrangeMode",
  "copySentence","copyChecklist","speak","wait",
];

const SYSTEM = `You are "Magic Steps", a voice-driven assistant baked into the Magic Checklist web app.
You convert a user's spoken/typed request into a typed plan of UI steps that are executed by the app.

You receive: the user's transcript, an optional list of attached checklists/media the user explicitly attached, and a "snapshot" of current app state.

The snapshot contains:
- currentChecklist: { id, title }
- items: [{ id, text (truncated), checked, isHighest }]  // isHighest=true means this is the YELLOW highlighted item (the highest unchecked)
- allChecklists: [{ id, title }]
- theme: "light" | "dark"
- muted: boolean
- route: string

Resolve fuzzy phrases against the snapshot:
- "the yellow one" / "the highlighted one" / "the current one" → the item where isHighest is true.
- "the next 3 sentences after the yellow one" → the 3 items immediately AFTER the isHighest item in the items array order.
- "the X checklist" → match by title (case-insensitive, fuzzy) against allChecklists; if multiple plausible matches, ask via clarifying_question.
- "Video to video button" / "the video video one" → action key "video-video". Map any spoken button name fuzzily to one of the known action keys.

Available action keys (use these exact strings for pickAction.action):
${ACTION_KEYS.join(", ")}

For media generation flows (text-image, image-image, remix, image-video, video-video, audio-image-video, analyze-image), the typical sequence is:
  1. { kind: "openActions" }
  2. { kind: "pickAction", action: "<media-action-key>" }
  3. zero or more { kind: "setMediaOption", field, value } to configure the dialog (e.g. field "aspectRatio", value "9:16"; field "duration", value "5"; etc.)
  4. zero or more { kind: "attachContextMedia", mediaPaths: [...] } or { kind: "attachContextChecklist", checklistId: "..." }
  5. { kind: "generate" } to confirm.

For ANY non-media action button the user names ("press the X button", "open actions and tap Y", "switch to dark mode via the menu"), emit a SINGLE { kind: "pickAction", action: "<exact-key>" } step. Do NOT emit openActions first — the app dispatches the action whether the sheet is open or not, and emitting both makes the sheet flash open and shut. Only emit a bare { kind: "openActions" } when the user explicitly says "just open the actions sheet" with no follow-up button.

Spoken-name → exact action key mapping (always emit the EXACT key string):
- "video to video" → "video-video"
- "image to image" → "image-image"
- "text to image" → "text-image"
- "text to text" → "text-text"
- "remix" / "remix images" → "remix"
- "image to video" → "image-video"
- "audio + image to video" / "avatar" → "audio-image-video"
- "analyze image" / "describe this image" → "analyze-image"
- "web search" / "text to web search" → "web-search"
- "background" / "change background" / "background color" → "bg"
- "rearrange" / "reorder" → "rearrange"
- "send to checklist" → "send-to"
- "send to blank" / "send to blank checklist" → "send-to-blank"
- "uncheck all" → "uncheck-all"
- "combine checked" / "combine the checked boxes" → "combine-checked"
- "media gallery" → "media-gallery"
- "split current" / "split this" → "split"
- "split by emoji" → "split-emoji"
- "copy sentence" → "copy-sentence"
- "copy checklist" / "copy full checklist" → "copy-checklist"
- "insert link" / "insert checklist link" → "insert-link"
- "duplicate item" / "duplicate checkbox" → "duplicate-item"
- "duplicate checklist" → "duplicate"
- "new checklist" → "new"
- "edit title" → "edit-title"
- "delete checklist" → "delete-checklist"
- "mute" / "unmute" → "mute"
- "action queue" / "dashboard" → "queue"
- "theme" / "dark mode" / "light mode" → "theme"
- "sign out" / "log out" → "sign-out"
- "add" / "add checkbox" → "add"

For simple toggles use direct steps (no openActions needed):
  - { kind: "setTheme", theme }, { kind: "setMuted", muted }, { kind: "navigate", to }, { kind: "openChecklist", id }, { kind: "checkItems", ids }, etc.

Allowed step kinds: ${STEP_KINDS.join(", ")}

ALWAYS call the emit_plan tool. Never reply with plain text.
- "summary" should be a short user-facing sentence ("Generating a 9:16 video to video.").
- If a critical reference is genuinely ambiguous, leave steps empty and put a single short question in "clarifying_question".
- Prefer the smallest correct plan. Don't add steps the user didn't ask for.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    const body = await req.json();
    const { transcript, snapshot, attachedContext } = body ?? {};
    if (!transcript || typeof transcript !== "string") {
      return new Response(JSON.stringify({ error: "Missing transcript" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userMsg = JSON.stringify({ transcript, snapshot, attachedContext }, null, 2);

    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-5.2",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userMsg },
        ],
        tools: [{
          type: "function",
          function: {
            name: "emit_plan",
            description: "Emit the typed step plan that the app will execute.",
            parameters: {
              type: "object",
              properties: {
                summary: { type: "string" },
                clarifying_question: { type: "string" },
                steps: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      kind: { type: "string", enum: STEP_KINDS },
                      action: { type: "string" },
                      field: { type: "string" },
                      value: {},
                      ids: { type: "array", items: { type: "string" } },
                      id: { type: "string" },
                      text: { type: "string" },
                      afterId: { type: "string" },
                      checklistId: { type: "string" },
                      mediaPaths: { type: "array", items: { type: "string" } },
                      title: { type: "string" },
                      to: { type: "string" },
                      theme: { type: "string", enum: ["light","dark"] },
                      muted: { type: "boolean" },
                      color: { type: "string" },
                      on: { type: "boolean" },
                      ms: { type: "number" },
                    },
                    required: ["kind"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["summary", "steps"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "emit_plan" } },
      }),
    });

    if (r.status === 429) {
      return new Response(JSON.stringify({ error: "Rate limited. Try again in a moment." }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (r.status === 402) {
      return new Response(JSON.stringify({ error: "Out of AI credits. Add credits in Settings → Workspace → Usage." }), {
        status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!r.ok) {
      const t = await r.text();
      console.error("gateway err", r.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error", detail: t }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await r.json();
    const call = data.choices?.[0]?.message?.tool_calls?.[0];
    let plan: any = null;
    if (call?.function?.arguments) {
      try { plan = JSON.parse(call.function.arguments); } catch {}
    }
    if (!plan) {
      return new Response(JSON.stringify({ error: "No plan returned" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(plan), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
