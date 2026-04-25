// Image generation:
// - Text-to-image  -> fal openai/gpt-image-2 (high quality)
// - Image edits / remix (refImages present) -> fal openai/gpt-image-2/edit (high quality)
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
  for (let i = 0; i < 120; i++) {
    // Faster polling early (1s for first 10 polls), then 2s. Most image edits finish within 5-15s.
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

async function editWithGptImage2Edit(
  prompt: string,
  aspectRatio: string | undefined,
  refImages: string[],
): Promise<string> {
  const falKey = Deno.env.get("FAL_KEY");
  if (!falKey) throw new Error("FAL_KEY not configured");

  // If the caller passed a known aspect, use it; otherwise let the model infer from inputs.
  const image_size = aspectRatio ? (ASPECT_TO_SIZE[aspectRatio] ?? "auto") : "auto";

  const submit = await fetch("https://queue.fal.run/openai/gpt-image-2/edit", {
    method: "POST",
    headers: { Authorization: `Key ${falKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      image_urls: refImages.slice(0, 16),
      image_size,
      quality: "high",
      num_images: 1,
      output_format: "png",
    }),
  });
  if (!submit.ok) {
    const t = await submit.text();
    console.error("fal gpt-image-2/edit submit err", submit.status, t);
    throw new Error(`fal gpt-image-2/edit ${submit.status}: ${t.slice(0, 300)}`);
  }
  const queued = await submit.json();
  const result = await pollFal(falKey, queued.status_url, queued.response_url);
  const url = result?.images?.[0]?.url;
  if (!url) throw new Error("no image url returned");
  return await urlToDataUrl(url);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { prompt, aspectRatio, refImages, refImageUrls } = await req.json();
    if (!prompt) {
      return new Response(JSON.stringify({ error: "Missing prompt" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Prefer public URLs (fast path: pass straight to fal, no fetch/base64/re-upload).
    const urlRefs: string[] = Array.isArray(refImageUrls) ? refImageUrls.filter((u) => typeof u === "string") : [];
    const dataUrlRefs: string[] = Array.isArray(refImages) ? refImages.filter((u) => typeof u === "string") : [];
    const allRefs = [...urlRefs, ...dataUrlRefs].slice(0, 16);

    if (allRefs.length === 0) {
      // Text-to-image -> GPT Image 2 via fal
      const dataUrl = await generateWithGptImage2(prompt, aspectRatio);
      return new Response(JSON.stringify({ dataUrl }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Image-to-image / remix -> GPT Image 2 Edit via fal (URLs go directly, data URLs fal also accepts).
    const dataUrl = await editWithGptImage2Edit(prompt, aspectRatio, allRefs);
    return new Response(JSON.stringify({ dataUrl }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
