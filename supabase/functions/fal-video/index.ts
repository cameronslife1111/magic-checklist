// Fal.ai video generation — async two-phase mode.
//
//  POST { mode: "submit", sourceKind: "image"|"video", sourceUrl, prompt, ... }
//    -> { request_id, status_url, response_url }   (returns in <10s)
//
//  POST { mode: "poll", statusUrl, responseUrl }
//    -> { status: "IN_PROGRESS" | "COMPLETED" | "FAILED", url?, error? }
//
// Models:
//   image-to-video  -> fal-ai/kling-video/v3/pro/image-to-video
//   video-to-video  -> fal-ai/kling-video/v3/pro/motion-control

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: any, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function uploadBytesToFal(falKey: string, bytes: Uint8Array, contentType: string, fileName: string): Promise<string> {
  const initRes = await fetch("https://rest.alpha.fal.ai/storage/upload/initiate", {
    method: "POST",
    headers: { Authorization: `Key ${falKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ content_type: contentType, file_name: fileName }),
  });
  if (!initRes.ok) throw new Error(`fal upload init failed: ${initRes.status} ${await initRes.text()}`);
  const { upload_url, file_url } = await initRes.json();
  const putRes = await fetch(upload_url, { method: "PUT", headers: { "Content-Type": contentType }, body: bytes });
  if (!putRes.ok) throw new Error(`fal upload put failed: ${putRes.status}`);
  return file_url;
}

async function uploadDataUrlToFal(falKey: string, dataUrl: string): Promise<string> {
  const match = dataUrl.match(/^data:(.+);base64,(.+)$/);
  if (!match) throw new Error("invalid data url");
  const contentType = match[1];
  const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
  const ext = contentType.split("/")[1]?.split(";")[0] ?? "bin";
  return uploadBytesToFal(falKey, bytes, contentType, `upload.${ext}`);
}

// If the URL is already on Fal's CDN, pass through. Otherwise, fetch & re-upload to Fal storage.
// This eliminates 422s caused by Fal refusing/failing to fetch external (e.g. Supabase) URLs.
async function hostOnFal(falKey: string, url: string): Promise<string> {
  try {
    const u = new URL(url);
    if (/(^|\.)fal\.(media|ai|run)$/.test(u.hostname)) return url;
  } catch { /* fall through and try to upload */ }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not fetch source for re-upload (${res.status})`);
  const contentType = res.headers.get("content-type") || "application/octet-stream";
  const buf = new Uint8Array(await res.arrayBuffer());
  const guessedExt = contentType.includes("/") ? contentType.split("/")[1].split(";")[0] : "bin";
  const fileName = `rehost-${crypto.randomUUID()}.${guessedExt}`;
  return uploadBytesToFal(falKey, buf, contentType, fileName);
}

// Pull a video URL from any of the shapes Fal has been observed to return.
function extractVideoUrl(result: any): string | null {
  return (
    result?.video?.url ??
    result?.output?.video?.url ??
    result?.data?.video?.url ??
    result?.data?.output?.video?.url ??
    result?.url ??
    result?.video_url ??
    null
  );
}

// Turn whatever Fal returns on a 4xx into a single readable string.
function readableFalError(status: number, text: string): string {
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { /* not json */ }
  if (parsed) {
    if (Array.isArray(parsed.detail)) {
      const msgs = parsed.detail.map((d: any) => {
        const loc = Array.isArray(d.loc) ? d.loc.filter((x: any) => x !== "body").join(".") : "";
        return loc ? `${loc}: ${d.msg ?? "invalid"}` : (d.msg ?? "invalid");
      }).join("; ");
      if (msgs) return `Fal ${status}: ${msgs}`;
    }
    if (typeof parsed.detail === "string") return `Fal ${status}: ${parsed.detail}`;
    if (typeof parsed.message === "string") return `Fal ${status}: ${parsed.message}`;
    if (typeof parsed.error === "string") return `Fal ${status}: ${parsed.error}`;
  }
  return `Fal ${status}: ${text.slice(0, 400)}`;
}

async function handleSubmit(req: any, falKey: string) {
  const {
    prompt, sourceDataUrl, sourceUrl, sourceKind, aspectRatio,
    // image-to-video options
    duration, generateAudio, negativePrompt, cfgScale, endImageUrl,
    // motion-control options
    imageUrl, characterOrientation, keepOriginalSound, elementImageUrl,
  } = req;

  if (!prompt || (!sourceDataUrl && !sourceUrl) || !sourceKind) {
    return json({ error: "Missing inputs (prompt + source + sourceKind required)" }, 400);
  }

  // Resolve the primary source onto Fal storage.
  let hostedSourceUrl: string;
  if (sourceUrl) {
    hostedSourceUrl = await hostOnFal(falKey, sourceUrl);
  } else {
    hostedSourceUrl = await uploadDataUrlToFal(falKey, sourceDataUrl);
  }

  const model = sourceKind === "video"
    ? "fal-ai/kling-video/v3/pro/motion-control"
    : "fal-ai/kling-video/v3/pro/image-to-video";

  const body: any = { prompt };
  if (sourceKind === "video") {
    if (!imageUrl) return json({ error: "Missing reference image (image_url) for motion-control." }, 400);
    body.video_url = hostedSourceUrl;
    body.image_url = await hostOnFal(falKey, imageUrl);
    body.character_orientation = characterOrientation === "video" ? "video" : "image";
    if (typeof keepOriginalSound === "boolean") body.keep_original_sound = keepOriginalSound;
    if (elementImageUrl && body.character_orientation === "video") {
      const hostedElement = await hostOnFal(falKey, elementImageUrl);
      body.elements = [{
        frontal_image_url: hostedElement,
        reference_image_urls: [hostedElement],
      }];
    }
  } else {
    body.start_image_url = hostedSourceUrl;
    if (duration) body.duration = String(duration);
    if (typeof generateAudio === "boolean") body.generate_audio = generateAudio;
    if (negativePrompt) body.negative_prompt = negativePrompt;
    if (typeof cfgScale === "number") body.cfg_scale = cfgScale;
    if (endImageUrl) body.end_image_url = await hostOnFal(falKey, endImageUrl);
  }

  const submit = await fetch(`https://queue.fal.run/${model}`, {
    method: "POST",
    headers: { Authorization: `Key ${falKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!submit.ok) {
    const t = await submit.text();
    const msg = readableFalError(submit.status, t);
    console.error("fal submit err", submit.status, t.slice(0, 1500), "payload keys:", Object.keys(body));
    return json({ error: msg }, 502);
  }
  const queued = await submit.json();
  return json({
    request_id: queued.request_id ?? null,
    status_url: queued.status_url,
    response_url: queued.response_url,
  });
}

async function handlePoll(req: any, falKey: string) {
  const { statusUrl, responseUrl } = req;
  if (!statusUrl || !responseUrl) return json({ error: "statusUrl and responseUrl required" }, 400);

  const s = await fetch(statusUrl, { headers: { Authorization: `Key ${falKey}` } });
  if (!s.ok) {
    // Transient — let the worker try again next cron tick.
    return json({ status: "IN_PROGRESS" });
  }
  const sj = await s.json();
  if (sj.status === "FAILED") {
    const errMsg = sj.error ?? sj.message ?? JSON.stringify(sj).slice(0, 400);
    return json({ status: "FAILED", error: errMsg });
  }
  if (sj.status !== "COMPLETED") {
    return json({ status: "IN_PROGRESS" });
  }

  const r = await fetch(responseUrl, { headers: { Authorization: `Key ${falKey}` } });
  if (!r.ok) {
    return json({ status: "FAILED", error: `fal response fetch ${r.status}` });
  }
  const result = await r.json();
  const url = extractVideoUrl(result);
  if (!url) {
    // Log the raw shape so we never fly blind again on a schema drift.
    console.error("fal completed but no video url. raw:", JSON.stringify(result).slice(0, 1500));
    return json({ status: "FAILED", error: "fal completed but no video url returned" });
  }
  return json({ status: "COMPLETED", url });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const falKey = Deno.env.get("FAL_KEY");
    if (!falKey) return json({ error: "FAL_KEY not configured" }, 500);

    const body = await req.json();
    const mode = body?.mode ?? "submit"; // default to submit for back-compat with any direct callers

    if (mode === "submit") return await handleSubmit(body, falKey);
    if (mode === "poll") return await handlePoll(body, falKey);
    return json({ error: `unknown mode: ${mode}` }, 400);
  } catch (e) {
    console.error("fal-video error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
