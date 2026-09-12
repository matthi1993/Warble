# Storage, sidecars, and cross-device sync

Warble now keeps portable, per-photo state beside the original image while
using SQLite as a rebuildable local index. This makes ratings, non-destructive
edits, and filter metadata available after moving a photo folder to another
Mac or iPad. There is exactly one SQLite catalog per device; it is never
opened, exported, or shared as a library document.

## Design and ownership

```text
IMG_0001.CR3                    original source image
IMG_0001.xmp                    shared rating + colour label (XMP)
IMG_0001.CR3.warble.json        Warble-only edits, effects, and fast EXIF
app_data_dir/active-library.warble  device-local SQLite catalog
app-cache/...                    disposable local thumbnail/HD caches
```

The original, its XMP sidecar, and its `.warble.json` sidecar form the
portable photo footprint. The SQLite database and app cache improve speed, but
are not required to preserve the photo's rating or Warble-specific edit recipe.

The exact-file Warble filename is intentional. `IMG_0001.CR3.warble.json` is
unambiguous when `IMG_0001.CR3` and `IMG_0001.jpg` share the same stem. XMP
uses the standard base-name convention, `IMG_0001.xmp`, so a RAW/JPEG pair can
share a rating and label as other photo applications expect.

## Current storage map

| Data | Authoritative portable location | Local index/cache | Notes |
| --- | --- | --- | --- |
| Original pixels | The source image file | None | Warble does not modify image pixels for normal ratings or non-destructive edits. |
| Star rating and colour label | `IMG_0001.xmp` using `xmp:Rating` and `xmp:Label` | `photo_ratings` in SQLite | XMP is written before the SQLite row. Existing XMP fields are preserved when rating/label attributes are updated. |
| Crop, tone, curve, and colour edits | `IMG_0001.ext.warble.json` | `photo_edits` in SQLite | Warble applies the recipe on the canvas; Capture One will not interpret it. |
| Per-photo sharpen and grain | `IMG_0001.ext.warble.json` | `photo_effects_v1` JSON in SQLite `app_settings` | The detailed schema remains frontend-owned JSON. |
| Parsed EXIF and orientation | `IMG_0001.ext.warble.json` after first metadata read | `photo_exif` in SQLite | The sidecar stores the full Warble EXIF projection, not just the filter fields. |
| Imported media roots and path mapping | Device-local SQLite catalog | Same | Stores root IDs and relative portable paths. Each device has its own permission/bookmark mapping for those roots. |
| Variant choice | Device-local SQLite `photo_variants` | Same | Not yet stored beside the source. |
| Saved post-processing presets | Device-local SQLite `app_settings.post_process_presets_v1` | Same | Device-local and not part of a single photo's footprint. |
| Current global post-processing look | Browser `localStorage` (`warble.postProcess.v3`) | Same | Device-local. It is not yet portable, so it can make two devices display the same edited photo differently. |
| Generated thumbnails | None beside the image yet | Renderer LRU and optional `app_cache_dir/thumbnails` | Disposable; disk cache is disabled by default. |
| Generated HD previews | None beside the image yet | Renderer LRU and optional `app_cache_dir/hd_images` | Disposable; disk cache is disabled by default. |
| Folder permissions, bookmarks, and cache settings | None | `app_data_dir/device-state.json` | Deliberately device-local. An iPad must grant its own access to the photo folder. |

`active-library.warble` lives in the platform app-data directory: Application
Support on macOS and the app sandbox's Application Support directory on iPad.
Warble creates it on first launch and writes changes directly to it. SQLite
commits make catalog changes atomic and durable; it is not a user-facing file
and is deliberately not synchronized between devices.

## XMP ratings and labels

Warble writes a standard XMP sidecar beside the image, for example:

```xml
<rdf:Description
  xmlns:xmp="http://ns.adobe.com/xap/1.0/"
  xmp:Rating="4"
  xmp:Label="green" />
```

`xmp:Rating` is an integer from 0 to 5. The current Warble label values are
`green`, `blue`, `yellow`, and `red`; they are written as the corresponding
`xmp:Label` string.

This is the interoperability bridge to Capture One and similar DAM software.
Applications may still keep their own catalog state or require an explicit
“load/sync metadata” action before an externally changed XMP sidecar appears.
The exact Capture One version and RAW/JPEG/DNG workflow should be round-trip
tested before promising automatic live sync.

Warble currently uses adjacent XMP sidecars for every source type. It does not
embed XMP into JPEG, TIFF, or DNG originals. That keeps originals unchanged but
means an application that ignores sidecars for a particular editable format
will not see the rating until embedded-XMP support is added.

## Warble sidecar format

The current JSON shape is intentionally small and versioned:

```json
{
  "schema": 1,
  "source": {
    "filename": "IMG_0001.CR3",
    "size": 42891321,
    "modifiedAt": 1760000000
  },
  "orientation": 1,
  "metadataReady": true,
  "metadata": {
    "cameraModel": "...",
    "lensModel": "...",
    "focalLengthMm": 35,
    "dateTaken": "2026:09:12 12:34:56"
  },
  "edits": {
    "crop": null,
    "tone": null,
    "curve": null,
    "color": null
  },
  "effects": {
    "sharpen": null,
    "grain": null
  },
  "updatedAt": 1760000001
}
```

Empty fields may be omitted by serialization. Ratings and labels are not
duplicated in this file: XMP is the authoritative portable representation for
those shared fields.

The source fingerprint currently uses the exact filename, byte size, and
modification time in seconds. A mismatch invalidates the Warble sidecar so its
edits/metadata are never applied to a replacement image. This is a practical
fast check, but it is not cryptographically strong: a future version should
add an optional content hash for unreliable file providers or same-size,
same-second replacements.

## Synchronization and local-index rebuild

When Warble scans, reconnects, or refreshes a media root, it processes every
discovered photo as follows:

1. Read XMP if it has an explicit rating or label and hydrate `photo_ratings`.
2. Read a valid `.warble.json` sidecar and hydrate `photo_edits`, per-photo
   effects, and `photo_exif`.
3. For existing local catalog entries, seed missing XMP/Warble sidecars from
   their existing ratings, edits, and effects before relying on the files next
   time.
   Empty EXIF sidecars are not created for every untouched photo during
   startup; EXIF becomes portable the first time that photo is used for a
   filter, detail panel, or image render.
4. Keep processing other photos if one item is read-only, malformed, or
   temporarily unavailable.

This means SQLite remains fast to query but can be repopulated from files that
move with the image. The implementation is deliberately non-destructive: it
does not yet purge index rows for images that disappeared while a root was
offline.

When the filter metadata request runs, the EXIF cache follows this read path:

1. Use a SQLite `photo_exif` row whose source size/mtime still matches.
2. On a local cache miss, load valid metadata from `.warble.json` and restore
   the SQLite row without opening the source image.
3. Only then open and parse the original image; write the result back to both
   SQLite and `.warble.json`.

The filters therefore use the sidecar metadata on a new device while retaining
the fast SQLite path for repeated filtering. They do not parse every JSON file
again when a user changes a filter control.

## Write behaviour

- Changing a star rating or label atomically writes the XMP sidecar, then
  updates `photo_ratings`.
- Changing crop/tone/curve/colour edits atomically writes `.warble.json`, then
  updates `photo_edits`.
- Changing per-photo sharpening/grain updates the relevant Warble sidecars and
  then the aggregate SQLite setting.
- Parsing EXIF metadata fills/refreshes the Warble sidecar as well as SQLite.

Sidecars are written using a temporary file in the same directory followed by
rename, so readers do not see a partially written JSON/XMP file on normal local
filesystems. The frontend coalesces rapid slider changes for 150 ms before
writing, so a drag produces one final sidecar/database update rather than a
write per pointer event. Cloud and SMB providers can still surface
synchronization conflicts; the current implementation does not yet offer
field-level merges or a conflict UI.

## iPad and Mac implications

The portable files work best in a normal folder shared through iCloud Drive,
SMB, an external SSD, or another Files provider. Both devices need permission
to the containing folder and should wait for image/sidecar downloads to finish
before editing offline copies.

Avoid editing the same photo concurrently on two disconnected devices. XMP and
Warble JSON are individual files, so a cloud provider's last-writer-wins or
conflicted-copy behaviour applies. The source fingerprint prevents stale edits
being applied to a different image, but it does not merge two valid edit
recipes.

The current portable footprint is sufficient to reproduce a photo's rating and
per-photo Warble edits on another device running Warble. It does **not** yet
include generated thumbnail/HD JPEGs, the selected variant, or the global post
processing look. Those remaining items are the gap between reproducible photo
state and fully identical immediate rendering.

## Next work

1. Add a file-change watcher or explicit sidecar refresh indicator so XMP
   changes made in Capture One are discovered without a folder rescan.
2. Add conflict detection using sidecar revision/device IDs and retain conflict
   copies instead of silently accepting the provider's winner.
3. Decide whether the global post-processing look and variant choice are
   library-level settings or should become part of each photo's portable state.
4. Add optional adjacent thumbnail and HD JPEG assets, fingerprinted by source,
   edit revision, dimensions, quality, and pipeline version, for identical
   fast previews across devices.
5. Add an optional content hash to strengthen source identity on cloud/SMB
   providers.
