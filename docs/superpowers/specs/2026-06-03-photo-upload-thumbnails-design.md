# Photo Upload Modal — Thumbnail Previews for Pending Items

**Date:** 2026-06-03
**Owner:** Innei
**Scope:** `be/apps/dashboard/src/modules/photos/components/library/photo-upload/`

## Problem

In the photo upload modal's review step (and across all subsequent phases), each
queued file is rendered as a row that shows only its filename, size, status
label, and progress bar. There is no visual preview of the image itself, so
users cannot verify whether they queued the correct photos before pressing
"开始上传". For larger batches this turns the review step into an act of faith.

## Goal

Show a 40×40px thumbnail of every queued image in the upload list, for every
workflow phase (review → uploading → processing → done → error). Files whose
content the browser cannot decode (MOV, RAW, HEIC, etc.) fall back to a typed
icon placeholder so the row layout stays consistent.

Non-goals: click-to-zoom previews, server-side thumbnail generation, gallery
grid view, image cropping/editing.

## Architecture

### Data model

`FileProgressEntry` gains one field:

```ts
previewUrl: string | null   // null = not browser-previewable; UI shows icon
```

Preview URL allocation lives in `utils.ts` alongside `createFileEntries`. The
function signature changes to accept a preview cache:

```ts
type PreviewCache = Map<File, string | null>

export function createFileEntries(
  files: File[],
  cache: PreviewCache,
): FileProgressEntry[]
```

For each file:
1. If `cache.has(file)`, reuse the cached value (URL or null).
2. Otherwise call `shouldGeneratePreview(file)`:
   - Returns `true` only for MIME types the browser is guaranteed to decode:
     `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `image/bmp`,
     `image/avif`.
   - Returns `false` for HEIC/HEIF (`image/heic`, `image/heif`) — browsers
     advertise inconsistent support, so we go straight to the icon path.
   - Returns `false` for MOV, RAW, DNG, or any non-image MIME.
3. If `true`, call `URL.createObjectURL(file)` and store it in the cache.
4. If `false`, store `null` in the cache.
5. If `files.length > 500`, skip preview generation entirely for files beyond
   the cap (cache them as null). Bulk uploads value progress over previews and
   we avoid blob memory blowup.

The cache lives in the closure created by `createPhotoUploadStore` in
`store.tsx`. It is not part of zustand state — only the resulting entries are.

### Lifecycle (URL revocation)

Three release points:

1. **`removeEntry(entry)`** — when the user removes a file in the review step,
   call `URL.revokeObjectURL` on its cached URL (if any) and
   `cache.delete(file)` before rebuilding entries.
2. **`addFiles(incoming)`** — new files are appended; existing entries keep
   their cached URLs. No revocation needed.
3. **`cleanup()`** — iterate the cache, revoke every non-null URL, then
   `cache.clear()`. Called from `PhotoUploadStoreProvider`'s unmount effect
   and from `closeModal`.

`reset()` does not revoke — the underlying `files` list is unchanged, so the
URLs remain valid for the next attempt. Same for the `AbortError` rollback in
`beginUpload`.

A small helper:

```ts
export function revokePreviewUrls(
  cache: PreviewCache,
  filesToRevoke?: File[],
): void
```

When called with no filter it revokes all; with a filter it revokes only the
given files (used by `removeEntry` if we ever batch-remove).

### UI integration

`UploadFileList` row layout changes from a two-column header + full-width
progress bar into a three-column layout:

```
┌────┬──────────────────────────┬─────────┐
│ 📷 │ DSC_1234.jpg             │ pending │ ×
│    │ 4.2 MB                   │         │
├────┼──────────────────────────┴─────────┤
│    │ ▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
└────┴────────────────────────────────────┘
```

- Left column: 40×40 thumbnail or icon placeholder. Fixed width with
  `flex-shrink-0`.
- Middle column: filename + size (existing markup).
- Right column: status label + remove button (existing markup).
- Progress bar spans middle+right columns, with `ml-12` so its left edge
  aligns with the filename column.

Thumbnail rendering rules:

- If `previewUrl !== null`:
  `<img src={previewUrl} class="size-10 rounded object-cover" loading="lazy" decoding="async" alt="" />`.
  Use a local `useState` `hasLoadError`; on `onError` flip to icon fallback.
- If `previewUrl === null`: render an icon placeholder
  `<div class="size-10 rounded bg-fill/30 flex items-center justify-center text-text-tertiary">…</div>`
  with the icon chosen by file extension:
  - `.mov` → lucide `Film`
  - `.raw`, `.dng`, `.arw`, `.cr2`, `.nef` → lucide `Aperture`
  - default (HEIC, BMP-on-Safari fail, unknown) → lucide `ImageOff`

If the row stays compact, inline the thumbnail JSX in `UploadFileList`. If it
grows past ~25 lines, extract a `UploadEntryThumbnail` component in the same
folder.

### Files changed

- `photo-upload/types.ts` — add `previewUrl: string | null` to
  `FileProgressEntry`.
- `photo-upload/utils.ts` —
  - extend `createFileEntries(files, cache)`
  - add `shouldGeneratePreview(file): boolean`
  - add `revokePreviewUrls(cache, filesToRevoke?): void`
- `photo-upload/store.tsx` —
  - allocate a `Map<File, string | null>` in `createPhotoUploadStore`
  - pass it to every `createFileEntries` call
  - call `revokePreviewUrls` in `removeEntry` (for the dropped file) and in
    `cleanup` (for all)
- `photo-upload/UploadFileList.tsx` — three-column row layout, thumbnail
  rendering with image-or-icon branch.
- Possibly new `photo-upload/UploadEntryThumbnail.tsx` if the row JSX gets
  long.

## Edge cases

- **Safari private-window object URL quota**: capped by the 500-file guard.
- **createObjectURL on file with unsupported actual contents**: handled by the
  `<img onError>` → icon fallback path.
- **removeEntry index renumbering**: cache is keyed by File reference, not
  index, so re-running `createFileEntries` after removal preserves URLs for
  surviving files.
- **HEIC**: explicit MIME check skips object URL creation, so no broken `<img>`
  flashes.
- **MOV with matching image (Live Photo)**: both files exist in the queue; the
  image gets a real preview, the MOV gets a `Film` icon. That is the desired
  behavior — the user sees the photo it pairs with.

## Testing

Unit tests for `photo-upload/utils.ts` (mock `URL.createObjectURL` and
`URL.revokeObjectURL`):

- `createFileEntries` allocates `previewUrl` only for previewable MIME types in
  a mixed batch.
- Re-calling `createFileEntries` with the same File reference returns the same
  URL (cache reuse — `createObjectURL` called once).
- After a file is dropped from the input list and `revokePreviewUrls` is
  invoked for it, the cache no longer contains it and `revokeObjectURL` was
  called once.
- The 500-file cap: files beyond index 499 get `previewUrl: null`.

Manual smoke test:

1. Drop a mix of JPG + PNG + MOV + HEIC into the modal. Expect: JPG/PNG show
   thumbnails; MOV shows Film icon; HEIC shows ImageOff icon.
2. Remove a file. Expect: row disappears; no console "blob URL not revoked"
   warning.
3. Close the modal. Expect: DevTools Memory → Heap snapshot shows no residual
   blob entries from this session.
4. Re-open the modal mid-upload (existing "merge dropped photos" flow): newly
   dropped files get thumbnails on first paint.

## Non-goals (explicit)

- No server-generated thumbnails. The whole point is local-only review before
  upload.
- No EXIF orientation correction in the thumbnail — `<img>` honors the EXIF
  flag in all currently-supported browsers (Chrome 81+, Safari 13.1+,
  Firefox 77+). If a user reports a sideways thumbnail, revisit.
- No click-to-zoom. YAGNI; the row thumbnail is sufficient for "is this the
  right photo?" confirmation.
