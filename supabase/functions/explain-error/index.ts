// AI-translate raw API errors into plain-English cause + suggested fix.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export async function explainError(action_type: string, error_raw: string): Promise<{ cause: string; fix: string }> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) return { cause: error_raw, fix: "Try again later." };

  const sys = `You translate technical API errors into plain English for a non-technical user.
You will be given an action type and a raw error message.
Respond with a strict JSON object: {"cause": "<one short sentence in plain English explaining what went wrong, no error codes, no jargon>", "fix": "<one short sentence with a concrete suggestion the user can try>"}.
No markdown, no extra text.`;

  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: `Action: ${action_type}\nError:\n${error_raw}` },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!r.ok) return { cause: error_raw.slice(0, 200), fix: "Try the action again." };
    const data = await r.json();
    const content = data.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content);
    return {
      cause: String(parsed.cause ?? error_raw).slice(0, 500),
      fix: String(parsed.fix ?? "Try again later.").slice(0, 500),
    };
  } catch (e) {
    console.error("explain-error", e);
    return { cause: error_raw.slice(0, 200), fix: "Try the action again." };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { action_type, error_raw } = await req.json();
    const out = await explainError(action_type ?? "unknown", String(error_raw ?? ""));
    return new Response(JSON.stringify(out), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
