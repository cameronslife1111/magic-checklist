// 🤖 Dante Inbox storyboard generator.
//
// Every minute (cron), this function:
//   1. Picks up to 5 inbox items with no media attached.
//   2. Parses "<idea> — <brand> — <series>" from the title (LLM fallback).
//   3. Fuzzy-matches brand + series context checklists for that user.
//   4. Composes a 3x3 grid prompt via Lovable AI Gateway (openai/gpt-5).
//   5. Generates a 9:16 medium-quality image via the lovable-image function.
//   6. Uploads to the generated-media bucket, writes a media_assets row,
//      and attaches the URL to the original inbox item.
//   7. Logs the full prompt to a sibling "🤖 Dante Inbox — Prompt Logs" checklist.
//
// Caps: 20 successful generations per Central Time day (dante_daily_counters).
// Errors: silent skip; after 3 cycles the item is marked status='error'.

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
const DANTE_INBOX_CHECKLIST_ID = Deno.env.get("DANTE_INBOX_CHECKLIST_ID");
const DANTE_CRON_SECRET = Deno.env.get("DANTE_CRON_SECRET");
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

const JACKSON_BRAIN_ID = "97ee9cca-47f9-4267-b040-0acc5f334f93";
const MIA_3X3_ID = "5272bbaa-50ce-4622-b96a-c4d9a2721c8c";
const LOG_CHECKLIST_TITLE = "🤖 Dante Inbox — Prompt Logs";
const DAILY_CAP = 20;
const BATCH_SIZE = 5;
const BUCKET = "generated-media";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

// ─── helpers ──────────────────────────────────────────────────────────────

function authorized(req: Request): boolean {
  const auth = req.headers.get("authorization") ?? "";
  if (auth === `Bearer ${SERVICE_ROLE}`) return true;
  const cronSecret = req.headers.get("x-dante-cron-secret");
  if (DANTE_CRON_SECRET && cronSecret === DANTE_CRON_SECRET) return true;
  return false;
}

// Returns YYYY-MM-DD for the current moment in America/Chicago.
function todayCentral(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date()); // en-CA -> "2026-05-09"
}

async function getDailyCount(day: string): Promise<number> {
  const { data, error } = await admin
    .from("dante_daily_counters")
    .select("count")
    .eq("day", day)
    .maybeSingle();
  if (error) {
    console.error("[dante] getDailyCount", error);
    return 0;
  }
  return data?.count ?? 0;
}

async function bumpDailyCount(day: string): Promise<void> {
  // Upsert + increment. Two-step to keep it portable without a custom RPC.
  const current = await getDailyCount(day);
  const { error } = await admin
    .from("dante_daily_counters")
    .upsert({ day, count: current + 1, updated_at: new Date().toISOString() }, { onConflict: "day" });
  if (error) console.error("[dante] bumpDailyCount", error);
}

// Strict parse: split on em-dash / "--" / " - " into [idea, brand, series].
function strictParse(title: string): { idea: string; brand: string; series: string } | null {
  const seps = [" — ", " – ", " -- ", " - "];
  for (const sep of seps) {
    const parts = title.split(sep).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 3) {
      return { idea: parts[0], brand: parts[1], series: parts[2] };
    }
  }
  return null;
}

async function llmExtract(title: string): Promise<{ idea: string; brand: string; series: string }> {
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Lovable-API-Key": LOVABLE_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        {
          role: "system",
          content:
            "Extract the video idea, brand, and series from a casual one-line note. " +
            "Return ONLY a JSON object: {\"idea\":\"...\",\"brand\":\"...\",\"series\":\"...\"}. " +
            "If brand or series is not clearly mentioned, use the literal string \"missing\" for that field.",
        },
        { role: "user", content: title },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!resp.ok) throw new Error(`LLM extract ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  const txt = data?.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(txt);
  return {
    idea: String(parsed.idea ?? title).trim(),
    brand: String(parsed.brand ?? "missing").trim(),
    series: String(parsed.series ?? "missing").trim(),
  };
}

function tokenize(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
}

function fuzzyScore(needle: string, hay: string): number {
  const a = new Set(tokenize(needle));
  const b = new Set(tokenize(hay));
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const t of a) if (b.has(t)) overlap++;
  return overlap / a.size; // fraction of needle tokens present in haystack
}

async function fuzzyMatchChecklist(
  userId: string,
  prefix: string,
  needle: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from("checklists")
    .select("id, title")
    .eq("user_id", userId)
    .ilike("title", `${prefix}%`);
  if (error || !data) return null;
  let best: { id: string; score: number } | null = null;
  for (const row of data) {
    const tail = row.title.slice(prefix.length);
    const score = fuzzyScore(needle, tail);
    if (!best || score > best.score) best = { id: row.id, score };
  }
  return best && best.score >= 0.6 ? best.id : null;
}

async function fetchItemsText(checklistId: string): Promise<string> {
  const { data, error } = await admin
    .from("checklist_items")
    .select("text, position")
    .eq("checklist_id", checklistId)
    .order("position", { ascending: true });
  if (error || !data) return "";
  return data.map((r) => `- ${r.text}`).join("\n");
}

async function composePrompt(
  itemTitle: string,
  ctx: { mia: string; jackson: string; brand: string; series: string; brandName: string; seriesName: string },
): Promise<string> {
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
  const system =
    `MIA 3x3 GRID RULES:\n${ctx.mia}\n\n` +
    `JACKSON BRAIN PROMPT RULES:\n${ctx.jackson}\n\n` +
    `BRAND CONTEXT (${ctx.brandName}):\n${ctx.brand}\n\n` +
    `SERIES CONTEXT (${ctx.seriesName}):\n${ctx.series}`;
  const user =
    `${itemTitle}\n\nWrite the final 3x3 grid image prompt now. ` +
    `Output ONLY the image prompt as plain text. No preamble, no markdown, no explanations.`;
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Lovable-API-Key": LOVABLE_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-5",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!resp.ok) throw new Error(`composePrompt ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const data = await resp.json();
  const out = data?.choices?.[0]?.message?.content;
  if (!out || typeof out !== "string") throw new Error("composePrompt: empty response");
  return out.trim();
}

async function generateImage(prompt: string): Promise<string> {
  // Call our own lovable-image edge function in legacy sync mode.
  const url = `${SUPABASE_URL}/functions/v1/lovable-image`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt, aspectRatio: "9:16", quality: "medium" }),
  });
  if (!resp.ok) throw new Error(`generateImage ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const data = await resp.json();
  if (!data?.dataUrl) throw new Error("generateImage: no dataUrl");
  return data.dataUrl as string;
}

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; contentType: string } {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!m) throw new Error("invalid dataUrl");
  const contentType = m[1];
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, contentType };
}

async function uploadAndAttach(
  userId: string,
  itemId: string,
  itemTitle: string,
  dataUrl: string,
): Promise<string> {
  const { bytes, contentType } = dataUrlToBytes(dataUrl);
  const path = `${userId}/dante-inbox/${itemId}.png`;
  const { error: upErr } = await admin.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType, upsert: true });
  if (upErr) throw upErr;
  const publicUrl = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  const { error: insErr } = await admin.from("media_assets").insert({
    user_id: userId,
    title: itemTitle,
    kind: "image",
    url: publicUrl,
    storage_path: path,
    mime_type: contentType,
  });
  if (insErr) console.error("[dante] media_assets insert", insErr);
  const { error: updErr } = await admin
    .from("checklist_items")
    .update({
      media_url: publicUrl,
      media_type: "image",
      result: null,
      status: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", itemId);
  if (updErr) throw updErr;
  return publicUrl;
}

async function ensureLogChecklist(userId: string): Promise<string> {
  const { data: existing } = await admin
    .from("checklists")
    .select("id")
    .eq("user_id", userId)
    .eq("title", LOG_CHECKLIST_TITLE)
    .maybeSingle();
  if (existing?.id) return existing.id;
  const { data: created, error } = await admin
    .from("checklists")
    .insert({ user_id: userId, title: LOG_CHECKLIST_TITLE })
    .select("id")
    .single();
  if (error || !created) throw error ?? new Error("create log checklist failed");
  return created.id;
}

async function logPrompt(
  userId: string,
  itemTitle: string,
  prompt: string,
  brandName: string,
  seriesName: string,
): Promise<void> {
  try {
    const logId = await ensureLogChecklist(userId);
    const body =
      `${prompt}\n\n— meta —\n` +
      `timestamp: ${new Date().toISOString()}\n` +
      `brand: ${brandName}\n` +
      `series: ${seriesName}`;
    await admin.from("checklist_items").insert({
      user_id: userId,
      checklist_id: logId,
      text: itemTitle,
      result: body,
      position: Date.now(),
      checked: false,
    });
  } catch (e) {
    console.error("[dante] logPrompt failed", e);
  }
}

function parseFailCount(result: string | null): number {
  if (!result) return 0;
  const m = /dante_fail_count=(\d+)/.exec(result);
  return m ? parseInt(m[1], 10) : 0;
}

async function bumpFail(itemId: string, prevResult: string | null): Promise<void> {
  const n = parseFailCount(prevResult) + 1;
  const newResult = `dante_fail_count=${n}`;
  const patch: Record<string, unknown> = {
    result: newResult,
    updated_at: new Date().toISOString(),
  };
  if (n >= 3) patch.status = "error";
  await admin.from("checklist_items").update(patch).eq("id", itemId);
}

// ─── per-item processing ──────────────────────────────────────────────────

type ProcessOutcome = "generated" | "skipped" | "error";

async function processItem(item: any): Promise<ProcessOutcome> {
  const title: string = item.text ?? "";
  if (!title.trim()) return "skipped";

  // Step a: parse
  let parsed = strictParse(title);
  if (!parsed) {
    try {
      parsed = await llmExtract(title);
    } catch (e) {
      console.error("[dante] llmExtract failed", e);
      await bumpFail(item.id, item.result);
      return "error";
    }
  }
  if (!parsed.brand || !parsed.series || parsed.brand === "missing" || parsed.series === "missing") {
    return "skipped";
  }

  // Step b: fuzzy match
  const brandId = await fuzzyMatchChecklist(item.user_id, "Ava - Context - Brand Info - ", parsed.brand);
  if (!brandId) return "skipped";
  const seriesId = await fuzzyMatchChecklist(item.user_id, "Ava - Context - Series Info - ", parsed.series);
  if (!seriesId) return "skipped";

  try {
    // Step c: fetch context
    const [brandText, seriesText, jacksonText, miaText] = await Promise.all([
      fetchItemsText(brandId),
      fetchItemsText(seriesId),
      fetchItemsText(JACKSON_BRAIN_ID),
      fetchItemsText(MIA_3X3_ID),
    ]);

    // Step d: compose
    const storyboardPrompt = await composePrompt(title, {
      mia: miaText,
      jackson: jacksonText,
      brand: brandText,
      series: seriesText,
      brandName: parsed.brand,
      seriesName: parsed.series,
    });

    // Step e: generate image
    const dataUrl = await generateImage(storyboardPrompt);

    // Step f: upload + attach
    await uploadAndAttach(item.user_id, item.id, title, dataUrl);

    // Step h: log
    await logPrompt(item.user_id, title, storyboardPrompt, parsed.brand, parsed.series);

    return "generated";
  } catch (e) {
    console.error(`[dante] item ${item.id} failed`, e);
    await bumpFail(item.id, item.result);
    return "error";
  }
}

// ─── HTTP entry point ─────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (!authorized(req)) return json(401, { error: "unauthorized" });
  if (!DANTE_INBOX_CHECKLIST_ID) return json(200, { error: "DANTE_INBOX_CHECKLIST_ID not configured" });

  const tickStart = new Date().toISOString();
  console.log(`[dante] tick start ${tickStart}`);

  const day = todayCentral();
  let count = await getDailyCount(day);
  if (count >= DAILY_CAP) {
    console.log(`[dante] cap reached for ${day} (${count})`);
    return json(200, { skipped: "cap_reached", day, count });
  }

  const { data: items, error } = await admin
    .from("checklist_items")
    .select("id, user_id, text, result, status, media_url")
    .eq("checklist_id", DANTE_INBOX_CHECKLIST_ID)
    .or("media_url.is.null,media_url.eq.")
    .neq("status", "error")
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (error) {
    console.error("[dante] select items error", error);
    return json(200, { error: "select_failed", detail: error.message });
  }

  let generated = 0;
  let skipped = 0;
  let errors = 0;
  const ids: string[] = [];

  for (const item of items ?? []) {
    if (count >= DAILY_CAP) break;
    if (item.media_url) { skipped++; continue; } // double-check guard
    ids.push(item.id);
    const outcome = await processItem(item);
    if (outcome === "generated") {
      generated++;
      await bumpDailyCount(day);
      count++;
    } else if (outcome === "skipped") {
      skipped++;
    } else {
      errors++;
    }
  }

  const summary = { day, count_today: count, generated, skipped, errors, item_ids: ids };
  console.log(`[dante] tick complete:`, summary);
  return json(200, summary);
});
