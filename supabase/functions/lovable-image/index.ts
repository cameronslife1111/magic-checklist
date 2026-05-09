// Image generation via Fal (openai/gpt-image-2).
//
// Three call modes:
//  1) mode: "submit"  -> POST to Fal queue, return { request_id, status_url, response_url } in <2s.
//  2) mode: "poll"    -> single GET on statusUrl; if COMPLETED, fetch responseUrl & return { status:"COMPLETED", dataUrl }.
//                        Otherwise { status:"IN_PROGRESS" } or { status:"FAILED", error }.
//  3) (no mode)       -> legacy synchronous path: submit + poll inside the function and return { dataUrl }.
//                        Kept for any direct UI calls. The action queue uses submit/poll to avoid the 150s edge timeout.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ASPECT_TO_SIZE: Record<string, string> = {
  "1:1": "square_hd",
  "16:9": "landscape_16_9",
  "9:16": "portrait_16_9",
  "4:3": "landscape_4_3",
  "3:4": "portrait_4_3",
};

const json = (body: any, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function urlToDataUrl(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch image failed: ${r.status}`);
  const blob = await r.blob();
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const b64 = btoa(binary);
  return `data:${blob.type || "image/png"};base64,${b64}`;
}

function pickEndpoint(hasRefs: boolean) {
  return hasRefs
    ? "https://queue.fal.run/openai/gpt-image-2/edit"
    : "https://queue.fal.run/openai/gpt-image-2";
}

function buildSubmitBody(prompt: string, aspectRatio: string | undefined, refs: string[], quality: string) {
  const hasRefs = refs.length > 0;
  const image_size = hasRefs
    ? (aspectRatio ? (ASPECT_TO_SIZE[aspectRatio] ?? "auto") : "auto")
    : (ASPECT_TO_SIZE[aspectRatio ?? "1:1"] ?? "square_hd");
  const body: Record<string, any> = {
    prompt,
    image_size,
    quality,
    num_images: 1,
    output_format: "png",
  };
  if (hasRefs) body.image_urls = refs.slice(0, 16);
  return body;
}

async function submitToFal(falKey: string, prompt: string, aspectRatio: string | undefined, refs: string[], quality: string) {
  const endpoint = pickEndpoint(refs.length > 0);
  const submit = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Key ${falKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(buildSubmitBody(prompt, aspectRatio, refs, quality)),
  });
  if (!submit.ok) {
    const t = await submit.text();
    console.error("fal submit err", submit.status, t);
    throw new Error(`fal ${submit.status}: ${t.slice(0, 300)}`);
  }
  const queued = await submit.json();
  return {
    request_id: queued.request_id ?? null,
    status_url: queued.status_url,
    response_url: queued.response_url,
  };
}

async function pollFalOnce(falKey: string, statusUrl: string, responseUrl: string) {
  const s = await fetch(statusUrl, { headers: { Authorization: `Key ${falKey}` } });
  if (!s.ok) {
    const t = await s.text();
    return { status: "IN_PROGRESS" as const, _debug: `status http ${s.status}: ${t.slice(0, 200)}` };
  }
  const j = await s.json();
  if (j.status === "COMPLETED") {
    const r = await fetch(responseUrl, { headers: { Authorization: `Key ${falKey}` } });
    if (!r.ok) {
      const t = await r.text();
      return { status: "FAILED" as const, error: `response http ${r.status}: ${t.slice(0, 200)}` };
    }
    const result = await r.json();
    const url = result?.images?.[0]?.url;
    if (!url) return { status: "FAILED" as const, error: "no image url returned" };
    const dataUrl = await urlToDataUrl(url);
    return { status: "COMPLETED" as const, dataUrl };
  }
  if (j.status === "FAILED") {
    return { status: "FAILED" as const, error: typeof j.error === "string" ? j.error : "fal job failed" };
  }
  // IN_QUEUE / IN_PROGRESS / etc
  return { status: "IN_PROGRESS" as const };
}

// Legacy synchronous path: submit then poll until done. Kept for direct UI calls
// that don't go through the action queue. Capped at ~140s so it fits inside the
// 150s edge-function ceiling — but the action queue uses submit/poll instead.
async function syncSubmitAndPoll(falKey: string, prompt: string, aspectRatio: string | undefined, refs: string[], quality: string) {
  const handle = await submitToFal(falKey, prompt, aspectRatio, refs, quality);
  if (!handle.status_url || !handle.response_url) throw new Error("fal did not return queue handle");
  const start = Date.now();
  let i = 0;
  while (Date.now() - start < 140_000) {
    const wait = i < 10 ? 1000 : 2000;
    await new Promise((r) => setTimeout(r, wait));
    i++;
    const out = await pollFalOnce(falKey, handle.status_url, handle.response_url);
    if (out.status === "COMPLETED") return out.dataUrl;
    if (out.status === "FAILED") throw new Error(out.error);
  }
  throw new Error("fal job timeout");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const falKey = Deno.env.get("FAL_KEY");
    if (!falKey) return json({ error: "FAL_KEY not configured" }, 500);

    const body = await req.json();
    const mode = body?.mode;

    // ── Mode: poll ────────────────────────────────────────────────────────
    if (mode === "poll") {
      const { statusUrl, responseUrl } = body ?? {};
      if (!statusUrl || !responseUrl) return json({ error: "statusUrl and responseUrl required" }, 400);
      const out = await pollFalOnce(falKey, statusUrl, responseUrl);
      return json(out);
    }

    // ── Shared input parsing for submit + legacy ──────────────────────────
    const { prompt, aspectRatio, refImages, refImageUrls, quality: qIn } = body ?? {};
    if (!prompt) return json({ error: "Missing prompt" }, 400);
    const urlRefs: string[] = Array.isArray(refImageUrls) ? refImageUrls.filter((u) => typeof u === "string") : [];
    const dataUrlRefs: string[] = Array.isArray(refImages) ? refImages.filter((u) => typeof u === "string") : [];
    const allRefs = [...urlRefs, ...dataUrlRefs].slice(0, 16);
    const quality = (qIn === "low" || qIn === "medium" || qIn === "high") ? qIn : "high";

    // ── Mode: submit ──────────────────────────────────────────────────────
    if (mode === "submit") {
      const handle = await submitToFal(falKey, prompt, aspectRatio, allRefs, quality);
      return json(handle);
    }

    // ── Legacy synchronous mode (no `mode` field) ─────────────────────────
    const dataUrl = await syncSubmitAndPoll(falKey, prompt, aspectRatio, allRefs, quality);
    return json({ dataUrl });
  } catch (e) {
    console.error("lovable-image error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
