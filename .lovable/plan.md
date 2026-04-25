## Goal
On the Action Queue Dashboard, every job card (regardless of status — pending, scheduled, running, paused, completed, failed, cancelled) should show:
- Any **media attached as a source** (e.g. ref images for image-image / remix, source video for video-video, source image for image-video, image for analyze-image).
- Any **context** that was attached at enqueue time: linked **checklists** (by title) and attached **media** (image / video / audio thumbnails).

Nothing about the existing layout, status logic, action buttons, tabs, or copy-error UI changes — we're just adding a small "Attachments" section inside each card.

## Where this data already lives
Each row in `action_jobs` has a `payload` jsonb that already contains everything we need:
- `payload.refImageUrls: string[]` — gallery refs for image actions
- `payload.sourceUrl: string` — source for video actions
- `payload.imageUrl: string` — source for analyze-image (legacy may also be data URL — we'll skip non-http URLs)
- `payload.context.checklists: { id, title }[]`
- `payload.context.media: { url, type: "image" | "video" | "audio", name }[]`
- `payload.imageDataUrl` (legacy) — ignore (not a public URL, can't preview safely)

The result media (for completed jobs) is already shown via the linked checklist; we are NOT touching result rendering.

## Why the dashboard currently doesn't show this
`src/pages/ActionQueue.tsx` deliberately omits `payload` from `JOB_COLS` and from the realtime row mapping ("never select payload/result here, they can be huge"). That guardrail is correct for the giant base64 legacy payloads, but with the new Storage-URL-only enqueue path, payloads are tiny (the enqueue function already rejects payloads >200 KB). We can safely fetch a **derived attachments summary** without pulling raw blobs.

## Plan

### 1. `src/pages/ActionQueue.tsx` — extend `Job` type and select
- Add an `attachments` field on the in-memory `Job` shape:
  ```ts
  attachments: {
    sources: { url: string; type: "image" | "video" }[];   // refImageUrls / sourceUrl / imageUrl
    contextChecklists: { id: string; title: string }[];
    contextMedia: { url: string; type: "image" | "video" | "audio"; name: string }[];
  }
  ```
- Update `JOB_COLS` to also select `payload` (it's now bounded to ≤200 KB by the enqueue guardrail, and we already cap the list to 200 rows → worst-case ~40 MB but realistically a few KB per row since payloads are URLs + short prompts).
- Add a small `deriveAttachments(payload)` helper that:
  - Reads `payload.refImageUrls` (filter strings starting with `http`) → push as `image` sources.
  - Reads `payload.sourceUrl` → push as `image` or `video` based on `action_type` (`image`/`video`-video → video, image-video → image).
  - Reads `payload.imageUrl` for `analyze-image` → push as `image` source (only if it starts with `http`, skip data URLs).
  - Reads `payload.context.checklists` and `payload.context.media` (validated arrays).
- Use it both in the initial `fetchJobs` map and in the realtime row builder so updates keep attachments populated.

### 2. `JobRow` rendering (same file)
Add a new compact section below the prompt preview / scheduling line and above the failure block. Only render if there's at least one attachment.

Layout:
- Section label: small uppercase muted "Attachments"
- **Source media** (if any): horizontal row of 56×56 rounded thumbnails.
  - Images → `<img>` with `loading="lazy"`, object-cover.
  - Videos → `<video>` with `muted preload="metadata"` (no controls; just a poster-style preview), with a tiny play overlay.
  - Each thumb wrapped in `<a href=url target="_blank" rel="noreferrer">` so the user can open it full-size.
- **Context checklists** (if any): inline list of small `<Badge variant="secondary">` chips with the checklist title, each clickable → `navigate(`/?c=${id}`)`.
- **Context media** (if any): same 56×56 thumbnail row as sources, but for audio show a small `<Music/>` icon tile with the file name underneath (no inline player to keep cards compact); image/video render the same way as sources.
- All thumbnail rows use `flex flex-wrap gap-1.5` so they degrade nicely on narrow screens.

Accessibility:
- Each thumbnail `<a>` gets an `aria-label` like "Open attached image" / "Open source video" / "Open checklist {title}".

### 3. No backend / migration changes
- No schema change.
- No edge function change.
- RLS already restricts `action_jobs.select` to `auth.uid() = user_id`, so re-including `payload` in the select is safe.

### 4. Out of scope (intentionally)
- We are NOT changing the dashboard layout, tabs, status badges, or any of the existing action buttons (Pause / Stop / Resume / Re-run / Make recurring / Open checklist / Delete / Copy error).
- We are NOT changing how jobs are created or processed.
- We are NOT showing the generated *result* media on the card (it already lives in the destination checklist, reachable via "Open checklist").

## Files touched
- `src/pages/ActionQueue.tsx` (only file)

## Verification after implementation
- Open Action Queue with an in-flight `image-image` or `remix` job → see the source ref images as thumbnails.
- A job enqueued with attached context checklists shows clickable chips that navigate to those checklists.
- A job enqueued with attached context media (image+video+audio) shows thumbnails for image/video and a labeled icon tile for audio.
- A plain `text-text` job with no attachments shows no Attachments section (no empty header).
- Failed jobs still show the red error block beneath the attachments row.