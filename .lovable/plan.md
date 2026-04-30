## Problem

Attaching a facial element image (`@element1`) to the Kling V3 Motion Control (video-to-video) action returns `fal response fetch 422`. Without the element image, it works fine.

## Root cause (verified against Fal's OpenAPI schema)

Our edge function `supabase/functions/fal-video/index.ts` currently sends:

```ts
body.elements = [{ image_url: hostedElement }];
```

But Fal's `KlingV3ImageElementInput` schema for motion-control does **not** accept `image_url`. It requires:

```json
{
  "frontal_image_url": "https://…",
  "reference_image_urls": ["https://…"]
}
```

(`reference_image_urls` description: "1-3 images supported. At least one image is required.")

Our `image_url` field is silently ignored, both required-ish fields are missing → Fal returns 422, surfaced as the generic "video input not accepted" message.

## Fix

In `supabase/functions/fal-video/index.ts`, in the motion-control branch where the element is attached, change the element payload to use Fal's actual field names. Send the same uploaded image as both the frontal image and the single reference image (the user only attaches one):

```ts
if (elementImageUrl && body.character_orientation === "video") {
  const hostedElement = await hostOnFal(falKey, elementImageUrl);
  body.elements = [{
    frontal_image_url: hostedElement,
    reference_image_urls: [hostedElement],
  }];
}
```

No frontend or queue-worker changes needed — `elementImageUrl` is already gated to `characterOrientation === "video"` in `Checklist.tsx` and `MediaActionDialog.tsx`, which matches Fal's "Element binding is only supported when character_orientation is 'video'" rule.

## Why this resolves it

- Matches the exact JSON shape Fal's validator expects for `KlingV3ImageElementInput`.
- Uses the same image for `frontal_image_url` and the one allowed `reference_image_urls` entry, which is the documented minimum (1 reference image required) and the most faithful interpretation of "attach one facial reference."
- All existing guardrails (orientation = video, hosting on Fal storage) stay in place.

## Files touched

- `supabase/functions/fal-video/index.ts` — single block, ~3 lines changed.
