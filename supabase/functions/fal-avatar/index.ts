// Fal.ai HeyGen Avatar 4 image-to-video — async two-phase mode (matches fal-video).
//
//  POST { mode: "submit", imageUrl|imageDataUrl, audioUrl|audioDataUrl, prompt?, voice?, ... }
//    -> { request_id, status_url, response_url }
//
//  POST { mode: "poll", statusUrl, responseUrl }
//    -> { status: "IN_PROGRESS" | "COMPLETED" | "FAILED", url?, error? }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: any, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

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
  if (!initRes.ok) throw new Error(`fal upload init failed: ${initRes.status} ${await initRes.text()}`);
  const { upload_url, file_url } = await initRes.json();
  const putRes = await fetch(upload_url, { method: "PUT", headers: { "Content-Type": contentType }, body: bytes });
  if (!putRes.ok) throw new Error(`fal upload put failed: ${putRes.status}`);
  return file_url;
}

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

async function handleSubmit(req: any, falKey: string) {
  const {
    imageUrl, imageDataUrl,
    audioUrl, audioDataUrl,
    prompt, voice,
    talkingStyle, resolution, aspectRatio, caption,
  } = req;

  if (!imageUrl && !imageDataUrl) return json({ error: "Missing image (image_url required)" }, 400);
  if (!audioUrl && !audioDataUrl && !prompt) return json({ error: "Provide audio_url OR a prompt for the avatar to speak" }, 400);

  const hostedImageUrl = imageUrl ?? await uploadToFal(falKey, imageDataUrl);
  const hostedAudioUrl = audioUrl ?? (audioDataUrl ? await uploadToFal(falKey, audioDataUrl) : undefined);

  const body: any = { image_url: hostedImageUrl };
  if (hostedAudioUrl) {
    body.audio_url = hostedAudioUrl;
  } else {
    body.prompt = prompt;
    if (voice) body.voice = voice;
  }
  if (talkingStyle) body.talking_style = talkingStyle;
  if (resolution) body.resolution = resolution;
  if (aspectRatio) body.aspect_ratio = aspectRatio;
  if (typeof caption === "boolean") body.caption = caption;

  const model = "fal-ai/heygen/avatar4/image-to-video";
  const submit = await fetch(`https://queue.fal.run/${model}`, {
    method: "POST",
    headers: { Authorization: `Key ${falKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!submit.ok) {
    const t = await submit.text();
    console.error("fal-avatar submit err", submit.status, t);
    return json({ error: `fal error ${submit.status}: ${t.slice(0, 400)}` }, 502);
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
  if (!s.ok) return json({ status: "IN_PROGRESS" });
  const sj = await s.json();
  if (sj.status === "FAILED") {
    const errMsg = sj.error ?? sj.message ?? JSON.stringify(sj).slice(0, 400);
    return json({ status: "FAILED", error: errMsg });
  }
  if (sj.status !== "COMPLETED") return json({ status: "IN_PROGRESS" });

  const r = await fetch(responseUrl, { headers: { Authorization: `Key ${falKey}` } });
  if (!r.ok) return json({ status: "FAILED", error: `fal response fetch ${r.status}` });
  const result = await r.json();
  const url = extractVideoUrl(result);
  if (!url) {
    console.error("fal-avatar completed but no video url. raw:", JSON.stringify(result).slice(0, 1500));
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
    const mode = body?.mode ?? "submit";

    if (mode === "submit") return await handleSubmit(body, falKey);
    if (mode === "poll") return await handlePoll(body, falKey);
    return json({ error: `unknown mode: ${mode}` }, 400);
  } catch (e) {
    console.error("fal-avatar error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
