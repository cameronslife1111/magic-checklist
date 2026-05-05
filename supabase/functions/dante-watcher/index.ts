import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const DANTE_INBOX_CHECKLIST_ID = Deno.env.get("DANTE_INBOX_CHECKLIST_ID");
const DANTE_SYSTEM_PROMPT = Deno.env.get("DANTE_SYSTEM_PROMPT") ?? "";
const MAGIC_CHECKLIST_MCP_URL = Deno.env.get("MAGIC_CHECKLIST_MCP_URL");

const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

async function setItem(item_id: string, patch: Record<string, unknown>) {
  patch.updated_at = new Date().toISOString();
  const { error } = await admin
    .from("checklist_items")
    .update(patch)
    .eq("id", item_id);
  if (error) console.error("setItem error", item_id, error);
}

function extractFromOpenAI(data: any): { text: string; toolSummary: string; hadToolError: boolean } {
  const parts: string[] = [];
  const tools: string[] = [];
  let hadToolError = false;
  const output = Array.isArray(data?.output) ? data.output : [];
  for (const item of output) {
    if (item?.type === "message" && Array.isArray(item.content)) {
      for (const c of item.content) {
        if (c?.type === "output_text" && typeof c.text === "string") parts.push(c.text);
      }
    } else if (item?.type === "mcp_call") {
      const name = item.name ?? "tool";
      const err = item.error;
      if (err) {
        hadToolError = true;
        tools.push(`✗ ${name}: ${typeof err === "string" ? err : JSON.stringify(err)}`);
      } else {
        tools.push(`✓ ${name}`);
      }
    }
  }
  // Fallback: top-level output_text
  if (parts.length === 0 && typeof data?.output_text === "string") {
    parts.push(data.output_text);
  }
  return {
    text: parts.join("\n").trim(),
    toolSummary: tools.length ? `\n\n— Tool calls —\n${tools.join("\n")}` : "",
    hadToolError,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let item_id: string | null = null;

  try {
    const body = await req.json().catch(() => ({}));
    const record = body?.record ?? body?.new ?? null;
    if (!record?.id || !record?.checklist_id) {
      return json(200, { skipped: "no record" });
    }
    item_id = record.id;

    if (!DANTE_INBOX_CHECKLIST_ID || record.checklist_id !== DANTE_INBOX_CHECKLIST_ID) {
      return json(200, { skipped: "not dante inbox" });
    }

    // Re-delivery guard: only process when status is null
    if (record.status != null) {
      return json(200, { skipped: `already ${record.status}` });
    }

    // Validate config
    if (!OPENAI_API_KEY) {
      await setItem(item_id!, { status: "error", result: "OPENAI_API_KEY not configured" });
      return json(200, { error: "missing OPENAI_API_KEY" });
    }
    if (!MAGIC_CHECKLIST_MCP_URL) {
      await setItem(item_id!, { status: "error", result: "MAGIC_CHECKLIST_MCP_URL not configured" });
      return json(200, { error: "missing MAGIC_CHECKLIST_MCP_URL" });
    }

    // Mark in_progress
    await setItem(item_id!, { status: "in_progress" });

    const userInput =
      `TASK:\n${record.text ?? ""}\n\nCONTEXT:\n` +
      `item_id=${record.id}\n` +
      `user_id=${record.user_id}\n` +
      `checklist_id=${record.checklist_id}\n` +
      `created_at=${record.created_at}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000);

    let openaiResp: Response;
    try {
      openaiResp = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-5.5",
          instructions: DANTE_SYSTEM_PROMPT,
          input: userInput,
          tools: [
            {
              type: "mcp",
              server_label: "magic-checklist",
              server_url: MAGIC_CHECKLIST_MCP_URL,
              require_approval: "never",
            },
          ],
          max_output_tokens: 4096,
        }),
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!openaiResp.ok) {
      const errBody = await openaiResp.text();
      console.error("openai error", openaiResp.status, errBody.slice(0, 1000));
      const friendly =
        openaiResp.status === 429 ? "OpenAI rate-limited (429)." :
        openaiResp.status === 402 ? "OpenAI payment required (402)." :
        `OpenAI ${openaiResp.status}`;
      await setItem(item_id!, {
        status: "error",
        result: `${friendly}\n\n${errBody.slice(0, 2000)}`,
      });
      return json(200, { error: friendly });
    }

    const data = await openaiResp.json();
    const { text: finalText, toolSummary, hadToolError } = extractFromOpenAI(data);

    const blocked =
      /^BLOCKER:/i.test(finalText.trim()) ||
      (hadToolError && finalText.trim().length === 0);

    const fullResult = (finalText || "(no text returned)") + toolSummary;

    if (blocked) {
      await setItem(item_id!, { status: "error", checked: false, result: fullResult });
    } else {
      await setItem(item_id!, { status: "done", checked: true, result: fullResult });
    }

    return json(200, { ok: true, blocked });
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.error("dante-watcher fatal", msg);
    if (item_id) {
      await setItem(item_id, { status: "error", result: `Watcher exception: ${msg}` });
    }
    return json(200, { error: msg });
  }
});
