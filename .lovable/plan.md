# Media Gallery — Plan

A central library for every image / video / audio the user wants to use with AI actions. Uploads happen once into the Gallery; AI dialogs (`image-image`, `remix`, `image-video`, `video-video`, `analyze-image`) and the Context Attacher all **pick from the Gallery** instead of the local device. Selections are **ordered and numbered** so prompts can reference "image 1", "image 2", etc.

---

## 1. Database

New migration:

**Table `media_assets`**
- `id uuid pk default gen_random_uuid()`
- `user_id uuid not null` (RLS = `auth.uid() = user_id`, mirroring existing tables)
- `title text not null default 'Untitled'` — user-editable label, shown in the list
- `kind text not null check (kind in ('image','video','audio'))`
- `url text not null` — public URL in `generated-media` bucket
- `storage_path text not null` — path in bucket so we can delete the underlying object
- `mime_type text`
- `size_bytes bigint`
- `duration_seconds numeric` (nullable, for video/audio)
- `width int`, `height int` (nullable, for image/video)
- `created_at`, `updated_at` with `update_updated_at_column()` trigger

RLS: own select / insert / update / delete (same shape as `checklist_items`). Index `(user_id, created_at desc)`.

Bucket stays `generated-media` (already public). New uploads from the Gallery use path `${user_id}/gallery/${uuid}.${ext}`.

## 2. Routing & Navigation

- New route `/media` → `src/pages/MediaGallery.tsx`.
- Add **"Media Gallery"** entry to `ActionsSheet.tsx` near the top utilities (after "Action Queue Dashboard"), icon `Library` from lucide. Clicking it navigates to `/media`. Not styled blue — it's a navigation utility, not an AI action.

## 3. `MediaGallery` page (list view, not grid)

Layout follows existing `ActionQueue` page conventions (header with back button, list with separators).

- **Top bar**: back arrow → `/`, page title "Media Gallery", overflow with simple filter chips: All / Images / Videos / Audio.
- **Upload bar**: three buttons — "Upload image", "Upload video", "Upload audio" — each opens a hidden file `<input>` (multi-select). Files are uploaded to storage, then a `media_assets` row is inserted with `title` defaulting to the filename minus extension. Show inline progress.
- **List**: one row per asset. Each row shows:
  - Small kind icon (Image / Video / Music)
  - Editable **title** (click pencil → inline rename, saves on blur / Enter)
  - Subtle metadata line: kind + relative date
  - Trailing actions: **Open** (eye → opens existing `MediaViewer`), **Delete** (trash → confirm dialog → removes storage object then row)
- Empty state: short copy + same upload buttons.
- No grid view, no thumbnails — pure list as requested.

## 4. New shared component: `MediaGalleryPicker`

`src/components/MediaGalleryPicker.tsx` — modal used by every AI dialog that needs media.

Props:
```ts
{
  open: boolean;
  userId: string;
  kind: "image" | "video" | "audio";
  mode: "single" | "multi";   // multi caps at 16 (matches current remix limit)
  initialSelected?: string[]; // asset ids
  onClose: () => void;
  onConfirm: (assets: MediaAsset[]) => void; // returned in selection order
}
```

Behavior:
- Lists user's `media_assets` filtered by `kind`, newest first, with a search box over `title`.
- Each row has a tap target. On tap:
  - **single** mode: replaces selection.
  - **multi** mode: toggles. Selection stores an **ordered array**; tapping an unselected item appends; tapping a selected one removes it and re-numbers the rest.
- Selected rows show a **prominent circular badge with the order number (1, 2, 3 …)** on the left edge, plus a checkmark. This is the key UX detail the user called out — the number reflects the order it will be sent to the model.
- Footer: "Selected: 2 / 16" + Cancel / Done buttons.
- "Upload new" button at top opens the same upload flow as the gallery page, then auto-selects the new asset.

This component is the single point of integration.

## 5. Wire AI actions to the Gallery (no more local file pickers)

### `MediaActionDialog.tsx`
Replace the `<Input type="file">` block with a **"Choose from Media Gallery"** button that opens `MediaGalleryPicker`:
- `image-image`, `analyze-image` → `kind="image"`, `mode="single"`
- `remix` → `kind="image"`, `mode="multi"` (max 16)
- `image-video` → `kind="image"`, `mode="single"`
- `video-video` → `kind="video"`, `mode="single"`

After picking, the dialog displays the **ordered selected items** (numbered chips: "① name.png ② face.jpg …") so the user can see exactly what will be sent and in what order, helping them write prompts like "use image 1's face on image 2's body".

`GenOptions.files?: File[]` becomes `GenOptions.assets?: MediaAsset[]` (carrying `{ id, url, kind, title }`). The submit handler in `Checklist.tsx` builds the enqueue payload from URLs (no more reading local Files / dataURLs on the client for these flows — see §6).

### `ContextAttacher.tsx`
Replace the three "Add Image / Video / Audio Context" file inputs with three buttons that open `MediaGalleryPicker` in `multi` mode for each kind. The existing `AttachedMedia` shape stays the same (`{ url, path, type, name }`); we map gallery assets into it. `removeMedia` only removes from the attachment list — it must **not** delete the underlying gallery object (only the Gallery page deletes assets).

## 6. Edge function changes (`process-action-queue`)

Today the worker accepts:
- `payload.refImages: string[]` (data URLs) for image-image / remix
- `payload.sourceDataUrl` for image-video / video-video / analyze-image

We add a parallel, preferred shape that uses **public URLs from the Gallery**:
- `payload.refImageUrls: string[]`
- `payload.sourceUrl: string`
- `payload.imageUrl: string` (for analyze-image)

In `runJob`, before calling the upstream function, convert any URL inputs to data URLs via the existing `urlToDataUrl` helper. The worker prefers `*Url(s)` if present, falls back to legacy `*DataUrl` for backward compatibility with already-queued jobs.

This keeps payloads small (no base64 in `action_jobs.payload`), makes scheduled and recurring jobs durable, and aligns with multi-step chains later.

## 7. Client enqueue path

In `Checklist.tsx`, for the AI media actions:
- Stop reading `File` → dataURL on the client.
- Build `payload` with `refImageUrls` / `sourceUrl` / `imageUrl` from the picked gallery assets.
- Show the same toast and queue behavior as today.

## 8. Migration & backward compatibility

- Existing `checklist_items.media_url` rows are untouched.
- Existing pending `action_jobs` keep working — worker still understands the legacy `*DataUrl` fields.
- No automatic backfill of past uploads into `media_assets` (those were one-shot context uploads). Users can upload anything they need going forward.

## 9. Files touched

**New**
- `supabase/migrations/<timestamp>_media_gallery.sql`
- `src/pages/MediaGallery.tsx`
- `src/components/MediaGalleryPicker.tsx`
- `src/lib/mediaAssets.ts` (small helpers: upload, list, rename, delete)

**Modified**
- `src/App.tsx` — add `/media` route
- `src/components/ActionsSheet.tsx` — add "Media Gallery" item + `Library` icon, wire key `"media-gallery"`
- `src/pages/Checklist.tsx` — handle new action key (navigate to `/media`), update payload building for AI media actions
- `src/components/MediaActionDialog.tsx` — replace file input with gallery picker, show numbered selection
- `src/components/ContextAttacher.tsx` — replace file inputs with gallery picker buttons
- `supabase/functions/process-action-queue/index.ts` — accept `refImageUrls` / `sourceUrl` / `imageUrl`

## 10. Acceptance checklist

- [ ] `/media` lists, renames, deletes assets; uploads go to `generated-media` and create `media_assets` rows.
- [ ] Actions sheet has a non-blue "Media Gallery" entry that navigates to `/media`.
- [ ] `image-image`, `remix`, `image-video`, `video-video`, `analyze-image` dialogs no longer show a local file input — only "Choose from Media Gallery".
- [ ] Multi-select picker shows a clear **1, 2, 3…** badge in selection order, and the dialog reflects that order in numbered chips.
- [ ] Context Attacher uses the Gallery for image/video/audio context.
- [ ] Queued jobs run successfully using URL-based payloads; legacy data-URL payloads still work.
- [ ] All `media_assets` reads/writes are RLS-scoped to the owner.
