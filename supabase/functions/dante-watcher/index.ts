import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-dante-cron-secret",
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
const DANTE_CRON_SECRET = Deno.env.get("DANTE_CRON_SECRET");
const CLAUDE_BRIDGE_KEY = Deno.env.get("CLAUDE_BRIDGE_KEY");

const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

const ITEM_TIMEOUT_MS = 4 * 60 * 1000;
const STALE_AFTER = "10 minutes";
const BATCH_SIZE = 3;

async function setItem(item_id: string, patch: Record<string, unknown>) {
  patch.updated_at = new Date().toISOString();
  const { error } = await admin
    .from("checklist_items")
    .update(patch)
    .eq("id", item_id);
  if (error) console.error("[dante-watcher] setItem error", item_id, error);
}

function extractFromOpenAI(data: any): {
  text: string;
  toolSummary: string;
  hadToolError: boolean;
} {
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
  if (parts.length === 0 && typeof data?.output_text === "string") {
    parts.push(data.output_text);
  }
  return {
    text: parts.join("\n").trim(),
    toolSummary: tools.length ? `\n\n— Tool calls —\n${tools.join("\n")}` : "",
    hadToolError,
  };
}

function authorized(req: Request): boolean {
  const auth = req.headers.get("authorization") ?? "";
  if (auth === `Bearer ${SERVICE_ROLE}`) return true;
  const cronSecret = req.headers.get("x-dante-cron-secret");
  if (DANTE_CRON_SECRET && cronSecret === DANTE_CRON_SECRET) return true;
  return false;
}

async function recoverStale(): Promise<number> {
  const cutoffIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from("checklist_items")
    .select("id, result")
    .eq("checklist_id", DANTE_INBOX_CHECKLIST_ID!)
    .eq("status", "in_progress")
    .lt("updated_at", cutoffIso);
  if (error) {
    console.error("[dante-watcher] recoverStale select error", error);
    return 0;
  }
  if (!data || data.length === 0) return 0;
  for (const row of data) {
    const note = `Auto-recovered from stuck in_progress on ${new Date().toISOString()}.`;
    const newResult = row.result ? `${row.result}\n${note}` : note;
    await setItem(row.id, { status: null, result: newResult });
  }
  return data.length;
}

async function retry424(): Promise<number> {
  const { data, error } = await admin
    .from("checklist_items")
    .select("id")
    .eq("checklist_id", DANTE_INBOX_CHECKLIST_ID!)
    .eq("status", "error")
    .or("result.ilike.%424%MCP server%,result.ilike.%Failed Dependency%");
  if (error) {
    console.error("[dante-watcher] retry424 select error", error);
    return 0;
  }
  if (!data || data.length === 0) return 0;
  for (const row of data) {
    await setItem(row.id, { status: null });
  }
  return data.length;
}

function stripDanteSaidPrefix(s: string): string {
  return s.replace(/^\s*🤖\s*Dante\s*said\s*:\s*/i, "").trimStart();
}

function sanitizeCrowns(s: string): string {
  // Defense in depth: strip 👑 from Dante's reply so a stray crown can't
  // re-trigger the awaiting_dante status via the DB trigger.
  return s.replace(/👑/g, "Crown");
}

async function processItem(item: any): Promise<{ ok: boolean }> {
  const preview = (item.text ?? "").slice(0, 60);
  console.log(`[dante-watcher] claimed item ${item.id} "${preview}"`);

  if (!OPENAI_API_KEY) {
    await setItem(item.id, { status: "error", checked: false, result: "OPENAI_API_KEY not configured" });
    return { ok: false };
  }
  if (!MAGIC_CHECKLIST_MCP_URL) {
    await setItem(item.id, { status: "error", checked: false, result: "MAGIC_CHECKLIST_MCP_URL not configured" });
    return { ok: false };
  }
  if (!CLAUDE_BRIDGE_KEY) {
    await setItem(item.id, { status: "error", checked: false, result: "CLAUDE_BRIDGE_KEY not configured" });
    return { ok: false };
  }

  // Auto-prepend 👑: on first turn if missing
  let currentText = item.text ?? "";
  if (!currentText.includes("👑:") && !currentText.includes("🤖 Dante said:")) {
    currentText = `👑: ${currentText}`.trimEnd();
    await setItem(item.id, { text: currentText });
  }

  const userInput =
    `${currentText}\n\n---\nThe above is the full conversation thread for this checklist item.\n` +
    `Respond ONLY to the most recent 👑 turn. Output ONLY your reply text — do NOT include "🤖 Dante said:" prefix; the system adds it automatically.\n\n` +
    `CONTEXT:\nitem_id=${item.id}\nuser_id=${item.user_id}\nchecklist_id=${item.checklist_id}\ncreated_at=${item.created_at}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ITEM_TIMEOUT_MS);

  try {
    const resp = await fetch("https://api.openai.com/v1/responses", {
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
            headers: { "x-claude-key": CLAUDE_BRIDGE_KEY },
          },
        ],
        max_output_tokens: 4096,
      }),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      const friendly =
        resp.status === 429 ? "OpenAI rate-limited (429)." :
        resp.status === 402 ? "OpenAI payment required (402)." :
        `OpenAI ${resp.status}`;
      await setItem(item.id, {
        status: "error",
        checked: false,
        result: `${friendly}\n\n${errBody.slice(0, 2000)}`,
      });
      console.log(`[dante-watcher] item ${item.id} -> error (${friendly})`);
      return { ok: false };
    }

    const data = await resp.json();
    const { text, toolSummary, hadToolError } = extractFromOpenAI(data);
    const replyRaw = stripDanteSaidPrefix(text || "(no text returned)");
    const blocked = /^BLOCKER:/i.test(replyRaw.trim()) || (hadToolError && replyRaw.trim().length === 0);
    const newText = `${currentText}\n\n🤖 Dante said: ${replyRaw}`;
    const metaResult =
      `[${new Date().toISOString()}] ${blocked ? "blocked" : "ok"}` +
      (toolSummary ? toolSummary : "");

    await setItem(item.id, {
      text: newText,
      status: "awaiting_cj",
      checked: false,
      result: metaResult,
    });
    console.log(`[dante-watcher] item ${item.id} -> awaiting_cj${blocked ? " (blocker)" : ""}`);
    return { ok: !blocked };
  } catch (e) {
    const aborted = (e as any)?.name === "AbortError";
    const msg = aborted
      ? `Timed out after ${ITEM_TIMEOUT_MS / 1000}s.`
      : e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    await setItem(item.id, { status: "error", checked: false, result: msg });
    console.log(`[dante-watcher] item ${item.id} -> error (${aborted ? "timeout" : "exception"})`);
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (!authorized(req)) {
    return json(401, { error: "unauthorized" });
  }

  if (!DANTE_INBOX_CHECKLIST_ID) {
    return json(200, { error: "DANTE_INBOX_CHECKLIST_ID not configured" });
  }

  const tickStart = new Date().toISOString();
  console.log(`[dante-watcher] tick start ${tickStart}`);

  // Concurrency guard
  const { data: lockData, error: lockErr } = await admin.rpc("dante_try_lock");
  if (lockErr) {
    console.error("[dante-watcher] try_lock error", lockErr);
    return json(200, { error: "lock_error", detail: lockErr.message });
  }
  if (lockData !== true) {
    console.log("[dante-watcher] skipped: lock held");
    return json(200, { skipped: true, reason: "lock_held" });
  }

  let processed = 0;
  let errors = 0;
  let recovered = 0;
  let retried = 0;
  const item_ids: string[] = [];

  try {
    retried = await retry424();
    if (retried > 0) console.log(`[dante-watcher] retried ${retried} 424/MCP errors`);

    recovered = await recoverStale();
    if (recovered > 0) console.log(`[dante-watcher] recovered ${recovered} stale items`);

    const { data: claimed, error: claimErr } = await admin.rpc("dante_claim_items", {
      p_checklist_id: DANTE_INBOX_CHECKLIST_ID,
      p_limit: BATCH_SIZE,
    });
    if (claimErr) {
      console.error("[dante-watcher] claim error", claimErr);
      return json(200, { error: "claim_error", detail: claimErr.message });
    }

    const items = (claimed ?? []) as any[];
    for (const item of items) {
      item_ids.push(item.id);
      try {
        const { ok } = await processItem(item);
        processed += 1;
        if (!ok) errors += 1;
      } catch (e) {
        errors += 1;
        const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        console.error(`[dante-watcher] item ${item.id} unhandled`, msg);
        await setItem(item.id, { status: "error", checked: false, result: `Watcher exception: ${msg}` });
      }
    }
  } finally {
    const { error: unlockErr } = await admin.rpc("dante_unlock");
    if (unlockErr) console.error("[dante-watcher] unlock error", unlockErr);
  }

  const summary = { processed, recovered, retried, errors, item_ids };
  console.log(`[dante-watcher] tick complete:`, summary);
  return json(200, summary);
});
