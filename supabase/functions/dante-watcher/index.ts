// Bee Protocol walker — replaces the old conversational Dante watcher.
// Every invocation: walks all checklists linked from the 🤖 Dante Inbox,
// triages each unprocessed item with one LLM call, marks ✅ (complete) or
// 🐝 (bee — 4 options). Capped at 100 items/day per inbox owner.

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
const DANTE_CRON_SECRET = Deno.env.get("DANTE_CRON_SECRET");

const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

const DAILY_CAP = 100;
const MODEL = "gpt-5.5";
const LOCK_MINUTES = 10;
const ITEM_TIMEOUT_MS = 90_000;

// ───────────────────── helpers ─────────────────────

function authorized(req: Request): boolean {
  const auth = req.headers.get("authorization") ?? "";
  if (auth === `Bearer ${SERVICE_ROLE}`) return true;
  const cronSecret = req.headers.get("x-dante-cron-secret");
  if (DANTE_CRON_SECRET && cronSecret === DANTE_CRON_SECRET) return true;
  return false;
}

function ctNow(): Date {
  return new Date();
}
function ctDateString(d = ctNow()): string {
  // YYYY-MM-DD in America/Chicago
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  return fmt.format(d);
}
function ctTimestampLabel(d = ctNow()): string {
  // MM/DD h:mma CT  (e.g., 5/10 3:42pm CT)
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "numeric", day: "numeric",
    hour: "numeric", minute: "2-digit",
    hour12: true,
  });
  // en-US gives "5/10, 3:42 PM" — normalize to "5/10 3:42pm CT"
  const raw = fmt.format(d).replace(",", "");
  return raw.replace(/\s?(AM|PM)/, (_m, ap) => ap.toLowerCase()) + " CT";
}

const PREFIX_RE = /^(?:✅|🐝|⚠️)\s+/;
const DANTE_BLOCK_RE = /\n\n— Dante [^\n]*—[\s\S]*$/;

function stripDantePrefix(text: string): string {
  let t = text ?? "";
  // strip leading status emoji
  t = t.replace(PREFIX_RE, "");
  // strip any prior Dante appendage
  t = t.replace(DANTE_BLOCK_RE, "");
  return t.trimEnd();
}

function buildCompletedTitle(original: string, completedWork: string): string {
  return `✅ ${original}\n\n— Dante ${ctTimestampLabel()} —\n${completedWork.trim()}`;
}
function buildBeeTitle(
  original: string,
  options: { letter: string; description: string }[],
): string {
  const A = options[0]?.description ?? "";
  const B = options[1]?.description ?? "";
  const C = options[2]?.description ?? "";
  const D = options[3]?.description ?? "";
  return (
    `🐝 ${original}\n\n— Dante ${ctTimestampLabel()} —\n` +
    `I can help in 4 ways:\nA) ${A}\nB) ${B}\nC) ${C}\nD) ${D}`
  );
}

// ───────────────────── LLM ─────────────────────

const SYSTEM_PROMPT = `You are Dante, an AI operator helping CJ (the user) execute work on his Magic Checklist app.

You are walking a checklist titled: "{{CHECKLIST_TITLE}}"

You will be given:
1. The full list of all items on this checklist (so you can see context)
2. The specific item you are evaluating

Your job is to decide ONE of two things:
A) "I can fully complete this task with my available tools" — in which case you complete it and write what you did.
B) "I cannot fully complete this task" — in which case you write 4 specific ways you can partially help.

Available tools you have:
- Web search (you can search the internet)
- Web fetch (you can read specific URLs)
- LLM reasoning (write text, summarize, draft messages, brainstorm, analyze)
- Magic Checklist API (read/write items in linked checklists, fetch other checklists for context)
- Image generation (you can call FAL or the configured image API to generate images and attach them to items)

Tools you do NOT have right now (skip if needed):
- Computer use (cannot control browsers, click buttons, fill forms outside this app)
- Direct access to Gmail/Slack/social media unless an MCP connector is wired
- Posting to social platforms
- Making phone calls or sending texts
- Anything requiring CJ's physical presence or on-camera work

Triage rules:
- Read the WHOLE checklist before deciding. Determine if this item is a stand-alone task or a step in a larger sequence.
- If it's a step in a sequence and you can do the WHOLE sequence, treat them together and complete all sequential steps you can.
- If it's a stand-alone task, evaluate it on its own.
- Be honest about your capability. If you're 80% sure you can do it, treat that as a bee-flag — present options, don't fake it.
- Never delete items. Never modify items outside this checklist.

Output format (JSON, strict):
{
  "decision": "complete" | "bee",
  "reasoning_for_cj": "1-2 sentences explaining what you decided and why",
  "completed_work": "If decision=complete: the actual output of the work. Could be a research summary, a draft message, a list of links with notes, a generated image URL, etc. If decision=bee: leave empty string.",
  "bee_options": [
    {"letter": "A", "description": "specific way Dante can help — 1 sentence"},
    {"letter": "B", "description": "specific way Dante can help — 1 sentence"},
    {"letter": "C", "description": "specific way Dante can help — 1 sentence"},
    {"letter": "D", "description": "specific way Dante can help — 1 sentence"}
  ]
}

If decision=complete, bee_options should be an empty array.
If decision=bee, completed_work should be an empty string.
Always return valid JSON. Never use markdown. Never include preamble.`;

interface LlmResult {
  decision: "complete" | "bee";
  reasoning_for_cj: string;
  completed_work: string;
  bee_options: { letter: string; description: string }[];
  tokens_used: number;
}

async function callLlm(
  checklistTitle: string,
  allItems: { text: string; checked: boolean }[],
  targetText: string,
): Promise<LlmResult> {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");
  const system = SYSTEM_PROMPT.replace("{{CHECKLIST_TITLE}}", checklistTitle);
  const numbered = allItems
    .map((it, i) => `${i + 1}. [${it.checked ? "x" : " "}] ${it.text}`)
    .join("\n");
  const user =
    `Full checklist context:\n${numbered}\n\n` +
    `The specific item you are evaluating right now:\n"${targetText}"\n\nDecide and respond.`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ITEM_TIMEOUT_MS);
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`OpenAI ${r.status}: ${t.slice(0, 400)}`);
    }
    const data = await r.json();
    const content: string = data.choices?.[0]?.message?.content ?? "";
    const tokens = data.usage?.total_tokens ?? 0;
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error(`Invalid JSON from model: ${content.slice(0, 300)}`);
    }
    if (parsed.decision !== "complete" && parsed.decision !== "bee") {
      throw new Error(`Bad decision: ${parsed.decision}`);
    }
    if (parsed.decision === "bee") {
      const opts = Array.isArray(parsed.bee_options) ? parsed.bee_options : [];
      if (opts.length < 4) throw new Error(`Bee response missing 4 options`);
    }
    return {
      decision: parsed.decision,
      reasoning_for_cj: String(parsed.reasoning_for_cj ?? ""),
      completed_work: String(parsed.completed_work ?? ""),
      bee_options: Array.isArray(parsed.bee_options) ? parsed.bee_options : [],
      tokens_used: tokens,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ───────────────────── DB ops ─────────────────────

async function bumpDailyCounter(userId: string, day: string): Promise<number> {
  // upsert and return the new count
  const { data: existing } = await admin
    .from("dante_daily_counters")
    .select("count")
    .eq("user_id", userId)
    .eq("day", day)
    .maybeSingle();
  const next = (existing?.count ?? 0) + 1;
  if (existing) {
    await admin
      .from("dante_daily_counters")
      .update({ count: next, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("day", day);
  } else {
    await admin
      .from("dante_daily_counters")
      .insert({ user_id: userId, day, count: next });
  }
  return next;
}

async function getDailyCount(userId: string, day: string): Promise<number> {
  const { data } = await admin
    .from("dante_daily_counters")
    .select("count")
    .eq("user_id", userId)
    .eq("day", day)
    .maybeSingle();
  return data?.count ?? 0;
}

async function logAction(row: {
  user_id: string;
  checklist_id: string;
  item_id: string;
  decision: "complete" | "bee" | "error";
  model_used?: string | null;
  tokens_used?: number | null;
  error?: string | null;
}) {
  const { error } = await admin.from("dante_action_log").insert(row);
  if (error) console.error("[bee] log insert error", error);
}

// Atomic claim: returns the item if we won the lock, null otherwise.
async function tryClaim(itemId: string): Promise<any | null> {
  const cutoff = new Date(Date.now() - LOCK_MINUTES * 60_000).toISOString();
  // Use update ... where (locked_at is null or locked_at < cutoff)
  // PostgREST: or() syntax
  const { data, error } = await admin
    .from("checklist_items")
    .update({ dante_locked_at: new Date().toISOString() })
    .eq("id", itemId)
    .or(`dante_locked_at.is.null,dante_locked_at.lt.${cutoff}`)
    .select("*")
    .maybeSingle();
  if (error) {
    console.error("[bee] claim error", itemId, error);
    return null;
  }
  return data;
}

async function clearLock(itemId: string, patch: Record<string, unknown> = {}) {
  await admin
    .from("checklist_items")
    .update({ dante_locked_at: null, updated_at: new Date().toISOString(), ...patch })
    .eq("id", itemId);
}

// ───────────────────── main ─────────────────────

interface InboxScope {
  userId: string;
  inboxId: string;
  permittedChecklistIds: string[];
}

async function resolveInboxes(): Promise<InboxScope[]> {
  // For now, single inbox via env. Easy to extend to multi-tenant later.
  if (!DANTE_INBOX_CHECKLIST_ID) return [];
  const { data: inbox, error } = await admin
    .from("checklists")
    .select("id, user_id")
    .eq("id", DANTE_INBOX_CHECKLIST_ID)
    .maybeSingle();
  if (error || !inbox) {
    console.error("[bee] inbox checklist not found", DANTE_INBOX_CHECKLIST_ID, error);
    return [];
  }
  const { data: linkRows, error: linkErr } = await admin
    .from("checklist_items")
    .select("linked_checklist_id")
    .eq("checklist_id", inbox.id)
    .not("linked_checklist_id", "is", null);
  if (linkErr) {
    console.error("[bee] link fetch error", linkErr);
    return [];
  }
  const linkedIds = Array.from(
    new Set((linkRows ?? []).map((r: any) => r.linked_checklist_id).filter(Boolean)),
  );
  if (linkedIds.length === 0) {
    return [{ userId: inbox.user_id, inboxId: inbox.id, permittedChecklistIds: [] }];
  }
  // Security: only checklists owned by the inbox owner
  const { data: owned } = await admin
    .from("checklists")
    .select("id")
    .eq("user_id", inbox.user_id)
    .in("id", linkedIds);
  const permitted = (owned ?? [])
    .map((c: any) => c.id)
    .filter((id: string) => id !== inbox.id);
  return [{ userId: inbox.user_id, inboxId: inbox.id, permittedChecklistIds: permitted }];
}

async function processItem(opts: {
  userId: string;
  checklistTitle: string;
  allItems: { text: string; checked: boolean }[];
  item: any;
}): Promise<"complete" | "bee" | "error"> {
  const { userId, checklistTitle, allItems, item } = opts;
  const original = stripDantePrefix(item.text ?? "");
  try {
    const result = await callLlm(checklistTitle, allItems, original);
    let newText: string;
    if (result.decision === "complete") {
      newText = buildCompletedTitle(original, result.completed_work || "(no output)");
    } else {
      newText = buildBeeTitle(original, result.bee_options);
    }
    await clearLock(item.id, { text: newText, dante_fail_count: 0 });
    await logAction({
      user_id: userId,
      checklist_id: item.checklist_id,
      item_id: item.id,
      decision: result.decision,
      model_used: MODEL,
      tokens_used: result.tokens_used,
    });
    return result.decision;
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.error(`[bee] item ${item.id} failed:`, msg);
    const newFails = (item.dante_fail_count ?? 0) + 1;
    const patch: Record<string, unknown> = { dante_fail_count: newFails };
    if (newFails >= 3 && !/^⚠️\s/.test(item.text ?? "")) {
      const baseTitle = stripDantePrefix(item.text ?? "");
      patch.text = `⚠️ ${baseTitle}`;
    }
    await clearLock(item.id, patch);
    await logAction({
      user_id: userId,
      checklist_id: item.checklist_id,
      item_id: item.id,
      decision: "error",
      model_used: MODEL,
      error: msg.slice(0, 800),
    });
    return "error";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (!authorized(req)) return json(401, { error: "unauthorized" });

  const tickStart = new Date().toISOString();
  console.log(`[bee] tick start ${tickStart}`);

  const scopes = await resolveInboxes();
  let totalProcessed = 0;
  let totalErrors = 0;
  const perUser: Record<string, { processed: number; errors: number; capped: boolean }> = {};

  for (const scope of scopes) {
    const day = ctDateString();
    let used = await getDailyCount(scope.userId, day);
    perUser[scope.userId] = { processed: 0, errors: 0, capped: false };
    if (used >= DAILY_CAP) {
      perUser[scope.userId].capped = true;
      console.log(`[bee] user ${scope.userId} already at daily cap (${used})`);
      continue;
    }

    for (const checklistId of scope.permittedChecklistIds) {
      if (used >= DAILY_CAP) {
        perUser[scope.userId].capped = true;
        break;
      }
      const { data: cl } = await admin
        .from("checklists")
        .select("id, title, user_id")
        .eq("id", checklistId)
        .maybeSingle();
      if (!cl) continue; // deleted
      if (cl.user_id !== scope.userId) continue; // ownership boundary
      if (cl.id === scope.inboxId) continue; // never touch the inbox itself

      const { data: itemsRaw } = await admin
        .from("checklist_items")
        .select("id, text, checked, position, dante_locked_at, dante_fail_count, checklist_id")
        .eq("checklist_id", checklistId)
        .order("position", { ascending: true });
      const items = itemsRaw ?? [];
      const allItemsForContext = items.map((it: any) => ({
        text: it.text ?? "",
        checked: !!it.checked,
      }));

      const lockCutoff = Date.now() - LOCK_MINUTES * 60_000;
      for (const it of items) {
        if (used >= DAILY_CAP) {
          perUser[scope.userId].capped = true;
          break;
        }
        const txt = it.text ?? "";
        if (it.checked) continue;
        if (PREFIX_RE.test(txt)) continue; // ✅ / 🐝 / ⚠️
        if ((it.dante_fail_count ?? 0) >= 3) continue;
        if (it.dante_locked_at && new Date(it.dante_locked_at).getTime() > lockCutoff) continue;

        const claimed = await tryClaim(it.id);
        if (!claimed) continue;

        const decision = await processItem({
          userId: scope.userId,
          checklistTitle: cl.title,
          allItems: allItemsForContext,
          item: claimed,
        });

        if (decision === "error") {
          perUser[scope.userId].errors += 1;
          totalErrors += 1;
        } else {
          perUser[scope.userId].processed += 1;
          totalProcessed += 1;
          used = await bumpDailyCounter(scope.userId, day);
        }
      }
    }
  }

  const summary = { processed: totalProcessed, errors: totalErrors, perUser, scopes: scopes.length };
  console.log(`[bee] tick complete:`, summary);
  return json(200, summary);
});
