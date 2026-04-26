// Fal.ai HeyGen Avatar 4 image-to-video.
// Inputs: a face image + (an audio clip OR prompt+voice). Output: an mp4 URL.
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
  // Avatar 4 can take several minutes; allow ~8 min total like fal-video.
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
      imageUrl, imageDataUrl,
      audioUrl, audioDataUrl,
      prompt, voice,
      talkingStyle, resolution, aspectRatio, caption,
    } = await req.json();

    if (!imageUrl && !imageDataUrl) {
      return new Response(JSON.stringify({ error: "Missing image (image_url required)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!audioUrl && !audioDataUrl && !prompt) {
      return new Response(JSON.stringify({ error: "Provide audio_url OR a prompt for the avatar to speak" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const falKey = Deno.env.get("FAL_KEY");
    if (!falKey) throw new Error("FAL_KEY not configured");

    const hostedImageUrl = imageUrl ?? await uploadToFal(falKey, imageDataUrl);
    const hostedAudioUrl = audioUrl ?? (audioDataUrl ? await uploadToFal(falKey, audioDataUrl) : undefined);

    const body: any = { image_url: hostedImageUrl };
    if (hostedAudioUrl) {
      // audio_url overrides prompt/voice per HeyGen docs
      body.audio_url = hostedAudioUrl;
    } else {
      body.prompt = prompt;
      if (voice) body.voice = voice;
    }
    if (talkingStyle) body.talking_style = talkingStyle;          // "stable" | "expressive"
    if (resolution) body.resolution = resolution;                  // "360p" … "1080p"
    if (aspectRatio) body.aspect_ratio = aspectRatio;              // "16:9" | "9:16" | "1:1"
    if (typeof caption === "boolean") body.caption = caption;

    const model = "fal-ai/heygen/avatar4/image-to-video";
    const submit = await fetch(`https://queue.fal.run/${model}`, {
      method: "POST",
      headers: { Authorization: `Key ${falKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!submit.ok) {
      const t = await submit.text();
      console.error("fal submit err", submit.status, t);
      return new Response(JSON.stringify({ error: `fal error ${submit.status}: ${t.slice(0, 300)}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
