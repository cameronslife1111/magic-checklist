// Image generation:
// - Text-to-image  -> fal openai/gpt-image-2 (high quality)
// - Image edits / remix (refImages present) -> Lovable AI Gateway (Nano Banana)
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

async function urlToDataUrl(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch image failed: ${r.status}`);
  const blob = await r.blob();
  const buf = await blob.arrayBuffer();
  // Chunked base64 to avoid blowing the call stack on large images.
  const bytes = new Uint8Array(buf);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const b64 = btoa(binary);
  return `data:${blob.type || "image/png"};base64,${b64}`;
}

async function pollFal(falKey: string, statusUrl: string, resultUrl: string): Promise<any> {
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 2000));
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

async function generateWithGptImage2(prompt: string, aspectRatio: string | undefined): Promise<string> {
  const falKey = Deno.env.get("FAL_KEY");
  if (!falKey) throw new Error("FAL_KEY not configured");
  const image_size = ASPECT_TO_SIZE[aspectRatio ?? "1:1"] ?? "square_hd";

  const submit = await fetch("https://queue.fal.run/openai/gpt-image-2", {
    method: "POST",
    headers: { Authorization: `Key ${falKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      image_size,
      quality: "high",
      num_images: 1,
      output_format: "png",
    }),
  });
  if (!submit.ok) {
    const t = await submit.text();
    console.error("fal gpt-image-2 submit err", submit.status, t);
    throw new Error(`fal gpt-image-2 ${submit.status}: ${t.slice(0, 300)}`);
  }
  const queued = await submit.json();
  const result = await pollFal(falKey, queued.status_url, queued.response_url);
  const url = result?.images?.[0]?.url;
  if (!url) throw new Error("no image url returned");
  return await urlToDataUrl(url);
}

async function generateWithNanoBanana(
  prompt: string,
  aspectRatio: string | undefined,
  quality: string | undefined,
  refImages: string[] | undefined,
): Promise<{ ok: true; dataUrl: string } | { ok: false; status: number; error: string }> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) throw new Error("LOVABLE_API_KEY not configured");
  const model = quality === "high" ? "google/gemini-3-pro-image-preview" : "google/gemini-2.5-flash-image";

  const userContent: any[] = [
    { type: "text", text: `${prompt}\n\nAspect ratio: ${aspectRatio ?? "1:1"}.` },
  ];
  if (Array.isArray(refImages)) {
    for (const url of refImages.slice(0, 16)) {
      userContent.push({ type: "image_url", image_url: { url } });
    }
  }

  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: userContent }],
      modalities: ["image", "text"],
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    console.error("lovable image err", r.status, t);
    if (r.status === 429) return { ok: false, status: 429, error: "Rate limited" };
    if (r.status === 402) return { ok: false, status: 402, error: "Out of credits" };
    return { ok: false, status: 500, error: `image gen failed: ${t.slice(0, 200)}` };
  }
  const data = await r.json();
  const dataUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!dataUrl) throw new Error("no image returned");
  return { ok: true, dataUrl };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { prompt, aspectRatio, quality, refImages } = await req.json();
    if (!prompt) {
      return new Response(JSON.stringify({ error: "Missing prompt" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const hasRefs = Array.isArray(refImages) && refImages.length > 0;

    if (!hasRefs) {
      // Text-to-image -> GPT Image 2 via fal
      const dataUrl = await generateWithGptImage2(prompt, aspectRatio);
      return new Response(JSON.stringify({ dataUrl }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Edits / remix -> Nano Banana
    const out = await generateWithNanoBanana(prompt, aspectRatio, quality, refImages);
    if (!out.ok) {
      return new Response(JSON.stringify({ error: out.error }), { status: out.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ dataUrl: out.dataUrl }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
