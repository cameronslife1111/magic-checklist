// Fal.ai video generation: image-to-video (Kling V3 pro) or video-to-video (Luma Ray-2 modify).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function uploadToFal(falKey: string, dataUrl: string): Promise<string> {
  const match = dataUrl.match(/^data:(.+);base64,(.+)$/);
  if (!match) throw new Error("invalid data url");
  const contentType = match[1];
  const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
  const ext = contentType.split("/")[1]?.split(";")[0] ?? "bin";
  const initRes = await fetch("https://rest.alpha.fal.ai/storage/upload/initiate", {
    method: "POST",
    headers: { Authorization: `Key ${falKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ content_type: contentType, file_name: `upload.${ext}` }),
  });
  if (!initRes.ok) {
    const t = await initRes.text();
    throw new Error(`fal upload init failed: ${initRes.status} ${t}`);
  }
  const { upload_url, file_url } = await initRes.json();
  const putRes = await fetch(upload_url, { method: "PUT", headers: { "Content-Type": contentType }, body: bytes });
  if (!putRes.ok) throw new Error(`fal upload put failed: ${putRes.status}`);
  return file_url;
}

async function pollFal(falKey: string, statusUrl: string, resultUrl: string): Promise<any> {
  // Kling V3 pro can take several minutes; allow ~8 min total.
  for (let i = 0; i < 240; i++) {
    await new Promise((r) => setTimeout(r, i < 10 ? 1000 : 2000));
    const s = await fetch(statusUrl, { headers: { Authorization: `Key ${falKey}` } });
    if (!s.ok) continue;
    const j = await s.json();
    if (j.status === "COMPLETED") {
      const r = await fetch(resultUrl, { headers: { Authorization: `Key ${falKey}` } });
      return await r.json();
    }
    if (j.status === "FAILED") throw new Error("fal job failed");
  }
  throw new Error("fal job timeout");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const {
      prompt, sourceDataUrl, sourceUrl, sourceKind, aspectRatio,
      // Kling V3 pro options (image-video only)
      duration, generateAudio, negativePrompt, cfgScale, endImageUrl,
    } = await req.json();
    if (!prompt || (!sourceDataUrl && !sourceUrl) || !sourceKind) {
      return new Response(JSON.stringify({ error: "Missing inputs" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const falKey = Deno.env.get("FAL_KEY");
    if (!falKey) throw new Error("FAL_KEY not configured");

    const hostedUrl = sourceUrl ?? await uploadToFal(falKey, sourceDataUrl);

    const model = sourceKind === "video"
      ? "fal-ai/luma-dream-machine/ray-2/modify"
      : "fal-ai/kling-video/v3/pro/image-to-video";

    const body: any = { prompt };
    if (sourceKind === "video") {
      body.video_url = hostedUrl;
      if (aspectRatio) body.aspect_ratio = aspectRatio;
    } else {
      // Kling V3 pro image-to-video schema.
      body.start_image_url = hostedUrl;
      if (duration) body.duration = String(duration);                 // enum string "3"…"15"
      if (typeof generateAudio === "boolean") body.generate_audio = generateAudio;
      if (negativePrompt) body.negative_prompt = negativePrompt;
      if (typeof cfgScale === "number") body.cfg_scale = cfgScale;
      if (endImageUrl) body.end_image_url = endImageUrl;
      // V3 pro does NOT accept aspect_ratio — intentionally omitted.
    }

    const submit = await fetch(`https://queue.fal.run/${model}`, {
      method: "POST",
      headers: { Authorization: `Key ${falKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!submit.ok) {
      const t = await submit.text();
      console.error("fal submit err", submit.status, t);
      return new Response(JSON.stringify({ error: `fal error ${submit.status}: ${t.slice(0, 300)}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const queued = await submit.json();
    const result = await pollFal(falKey, queued.status_url, queued.response_url);
    const url = result?.video?.url ?? result?.output?.video?.url ?? result?.url;
    if (!url) throw new Error("no video url returned");
    return new Response(JSON.stringify({ url }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
