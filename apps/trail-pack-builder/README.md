# Trail Pack Builder

Local Bob's Artifact prototype for choosing one of 46 authored riding areas and
downloading its exact, prebuilt GPX file.

The map uses a local raster PMTiles archive when one is available. Missing
archive tiles intentionally reveal the built-in paper, state-outline, and city
context; losing map detail never disables selection or GPX download. Trails remain
a separate canvas overlay and are never baked into the basemap.

The overlay uses named riding-area circles below zoom 6, persistent selection
labels from zoom 6 upward, a 500-meter simplified trail tier from zoom 6 to
7.5, and the 30-meter preview above zoom 7.5. A circle click opens an area; a
double-click, or one label click, selects its complete connector-safe trail set
and smoothly frames it. A collection appears as one low-zoom circle, then yields
to its member-area labels at closer zooms. The collection pack retains ambiguous
or otherwise unpartitioned trails that are intentionally omitted from its more
specific member packs.
Viewport groups load automatically at zoom 6 and above. A sparse spatial index
keeps pan rendering local to the visible map cells. Selected trails always use
the detailed preview. The galleon and sea-serpent PNGs in `assets/` load only
when their low-zoom ornament range becomes visible.

## Desktop map shortcuts

The compass opens a short, keyboard-accessible guide to riding-area selection,
desktop shortcuts, GPX download, and the trail-age warning.

Shortcuts are active only while the map canvas has focus and the browser reports
a fine pointer. Hold `Space` for a temporary hand/pan tool and press `Z` for the
zoom tool. The zoom cursor starts in zoom-in mode; hold `Alt` to switch it to
zoom-out before clicking the map. `Ctrl+0` fits the complete trail map instantly,
while `Ctrl+1` instantly fits the selected riding area.
`Ctrl++` and `Ctrl+-` zoom immediately around the center of the map. The toolbar
`+` and `-` buttons continue to zoom immediately without changing the active
tool.

## Data boundary

Distribution rights for the source database have been secured. The corpus still
stays outside Git while the artifact is being finalized. The public browser app
does not read canonical source GPXs; it uses compact map chunks and downloads
only the selected prebuilt release file.

Generate the compact browser index inside the external database:

```powershell
python apps/trail-pack-builder/tools/build-local-trail-data.py `
  --database "C:\path\to\trails-database" `
  --context "C:\path\to\usa-lower-48-state-context.geojson"
```

The command creates a content-addressed generation under
`trails-database/web-map/v2/` with a small manifest, a riding-area overview,
one compact 30-meter preview chunk per location tile, and the Census context
layer. Transport chunks remain separate from semantic riding areas; the latter
are generated across chunk boundaries. DBSCAN output is treated as a topology
microcluster, not automatically as the final product boundary. Stable generated
IDs still come only from immutable core membership. A second, non-chaining pass
can attach otherwise unassigned nearby trails when length-weighted geometry,
center agreement, and connector guards all resolve to one core.

Reviewed `semanticRegions` in `tools/riding-areas.json` replace related source
areas with stable, rider-scale products. These definitions can also claim
otherwise-unassigned trails from an exact source-path prefix or an explicit ID
list. A source-path rule never steals a trail from another area; any intentional
move must be listed under `reassignTrailIds`. Likewise, a matching trail that is
deliberately kept in its existing area must be enumerated under
`retainAssignedTrailIds`; undeclared conflicts fail the build. This keeps broad
folders and long connector files from silently chaining unrelated systems. The
review artifact records the replaced areas, claim evidence, retained conflicts,
exact membership hash, and any name
still awaiting editorial review.

Automatic names use a local GeoNames `cities1000` gazetteer at build time only;
the gazetteer is not shipped or loaded by the browser. `tools/riding-areas.json`
remains the manual override, split, and merge layer. Each generation includes
`riding-area-review.json` with naming-confidence and subdivision QA flags. The
same curation file can define one-level collections whose connected source
clusters are partitioned into nonoverlapping member packs by deterministic,
confidence-gated anchor voting. The launch curation does not use collections;
Tillamook is one exact riding-area pack.
The manifest is published only after the complete generation passes its
integrity checks. Existing v1 map files, prior content-addressed generations,
the basemap, and canonical GPX files are not modified.

Mount or junction the external database at the ignored
`apps/trail-pack-builder/local-data` path. Mount the verified production release
separately at `apps/trail-pack-builder/local-voyager-release`; do not copy it back
into the canonical research database. Then serve the Bob's App repository root on
`127.0.0.1` and open `/apps/trail-pack-builder/`. PMTiles requires HTTP byte range
support, so use the included local server instead of Python's basic static server:

```powershell
node apps/trail-pack-builder/tools/serve-local.mjs --port=8949
```

Use the local mounts as development overrides:

```text
/apps/trail-pack-builder/?data=./local-data&release=./local-voyager-release
```

The public app defaults to the tracked `runtime/map` and `runtime/release`
payload. A fresh launch payload can be staged from the two ignored mounts with:

```powershell
node apps/trail-pack-builder/tools/stage-launch-runtime.mjs
```

The staging tool copies only the compact map closure, the 46 prebuilt riding-area
GPXs, and the optional context add-on. It strips canonical GPX paths from the map
chunks and deliberately refuses to overwrite an existing runtime directory; move
or remove the old generated payload before restaging. Same-origin `?data=` and
`?release=` URLs remain available as development-only overrides.

## Local grouping board

Open `/apps/trail-pack-builder/?data=./local-data&curate=1` on `localhost` or
`127.0.0.1` to use the temporary pack-curation workspace. The query flag is
ignored on non-loopback hosts, its module is loaded only after an explicit local
opt-in, and it never changes the current map generation or production GPX
release.

The board loads the complete catalog. Existing named areas seed ordinary
layers, collection remainders seed their own layers, and every remaining
transport group becomes a provisional `Loose` layer. As a result, every source
trail starts in exactly one layer rather than disappearing into an implicit
remainder. Select trails on the map, then create a layer or add, replace, or
unassign the selection. Layer eyes control editor visibility; checkboxes support
bulk merge. Undo and redo cover grouping edits, while the draft autosaves in the
local browser.

The `Select` toolbar control and its `V` / `A` shortcuts exist only in this
loopback curation mode. They are not part of the public pack-downloading app.

`Export grouping JSON` writes exact, deterministic membership for every trail.
Validate an export against the mounted catalog before using it as a production
handoff:

```powershell
node apps/trail-pack-builder/tools/validate-curation-project.mjs `
  "C:\path\to\bobs-trail-pack-curation.json"
```

The export deliberately reports source trail and point totals, not final
Voyager path capacity. Joining and retrace can change those totals; the
production packer remains the authority for device capacity.

The editor export is the human-authored handoff. Compile it against the map
generation that seeded the editor before rebuilding production data:

```powershell
node apps/trail-pack-builder/tools/compile-curation-project.mjs `
  apps/trail-pack-builder/tools/final-riding-area-curation.json `
  apps/trail-pack-builder/local-data/web-map/v2/manifest.json `
  apps/trail-pack-builder/tools/final-production-curation.json
```

The compiler preserves exact trail IDs. Packs named `DELETE`, `DELETE2`, and
so on are merged into one audited discard bucket. Existing map collections are
preserved only when one authored pack exactly matches the collection's full
membership; this keeps one logical map label while retaining device-safe member
downloads. It refuses to overwrite an existing output file.

Build the local map from the compiled project with automatic clustering fully
disabled:

```powershell
python apps/trail-pack-builder/tools/build-local-trail-data.py `
  --database apps/trail-pack-builder/local-data `
  --context apps/trail-pack-builder/local-data/web-map/context.geojson `
  --curation-project apps/trail-pack-builder/tools/final-production-curation.json
```

Discarded trails are omitted only from the derived product map and Voyager
release. Their canonical GPX and catalog provenance remain untouched.

## Pirate-map intake

Keep the incoming archive outside Git at this stable location:

```text
C:\Users\sunte\Desktop\gpx-library\trails-database\web-map\basemap\bobs-pirate-map.pmtiles
```

The ignored `local-data` junction exposes it to the app. Replacing that one file
and reloading the page is the entire runtime handoff. Use `?basemap=off` to test
the deterministic paper fallback. The archive may contain sparse z8-z10 detail;
z10 is overzoomed above its native maximum.

Runtime map credit remains available in the selected pack's `About this data`
disclosure because the rendered archive incorporates OpenFreeMap / OpenMapTiles,
OpenStreetMap data, and elevation derived from AWS Terrain Tiles / U.S. Geological
Survey sources.
Generated place names are derived from GeoNames and carry the shipped
`Place names: GeoNames · CC BY 4.0` attribution.

## Download contract

- Each named riding area downloads its exact, prebuilt, capacity-checked Voyager
  GPX instead of rebuilding source trails in the browser.
- Tillamook downloads as one GPX. The product curation excludes the 52 shortest
  wholly isolated anonymous fragments, preserving every human-named Tillamook
  trail and reducing the exact graph to 590 paths.
- The lower-48 outline remains a separate optional download under `About this
  data` and is never silently included with an area. Dense area packs may not
  have enough remaining track slots to install it at the same time.
- The public app downloads only named, prebuilt riding-area GPXs. It does not
  fetch canonical source GPXs or assemble custom files in the browser.
- The loopback-only `?curate=1` grouping board retains trail and box selection
  for maintaining the authored riding-area assignments. Those controls never
  appear in the public app and do not create downloadable GPX files.

## Voyager riding-area pilot

The physical A/B test established the importer's actual behavior: Voyager counts
every GPX `<trkseg>` as one track, regardless of its parent `<trk>`. Both test
files stopped at 300 segments. The reported 23% and 19% point usage exactly
matched the first 300 segments in their respective serialization orders.

Pilot C converts the complete riding-area network to a graph at every exact
source coordinate. It joins through those real junctions and, where necessary,
retraces shortest paths over existing graph edges. It never snaps coordinates,
invents connectors, or omits source geometry. The generated GPX uses one
`<trk>/<trkseg>` per continuous walk so both Voyager limits are enforced before
publication.

Generate the current Yacolt Burn hardware test with:

```powershell
python apps/trail-pack-builder/tools/build-voyager-area-pilot.py `
  "C:\path\to\trails-database" `
  --area-id yacolt-burn `
  --output "C:\path\to\voyager-yacolt-pilot-c"
```

The tool creates one compact Pilot C GPX, an exhaustive source/duplicate-edge
manifest, and a physical import checklist. Derived packs omit elevation and XML
formatting whitespace to reduce file size; canonical database files remain
untouched and retain their elevation. The validator proves that every source
atomic edge appears, every extra traversal follows an existing source edge, no
virtual pairing edge reaches the GPX, and the final track and point totals stay
within the 300-track / 72,500-point Voyager limits. Pilot C intentionally uses
a distinct output directory and refuses to replace the earlier A/B hardware-test
bundle.

The current deterministic Yacolt Burn build uses 300 tracks and 69,420 points,
leaving 3,080 points of device headroom. It covers all 63,985 source atomic edges
and retraces 5,135 existing atomic edges; those extra traversals are the cost of
reducing the exact-coordinate graph from 948 continuous walks to 300.

### Production Voyager riding-area release

Physical stress testing confirmed that Voyager's 72,500 track-point and 72,500
route-point capacities are independent. The production builder prefers ordinary
tracks; routes absorb path-count or track-point-capacity overflow. Production
packs stop at 290 tracks, preserving ten empty track slots, and may use up to 300
routes. Voyager's **Show Routes as Tracks** setting makes the overflow paths
behave like the rest of the riding-area network.

Generate the complete local release with:

```powershell
python apps/trail-pack-builder/tools/build-voyager-production-packs.py `
  "C:\path\to\trails-database" `
  --state-context "C:\path\to\usa-lower-48-state-context.gpx" `
  --output "C:\path\to\voyager-production-release"
```

The current staged release has 46 mutually exclusive riding-area files. The
finished curation covers all 15,170 retained product trails exactly once. The 205 explicitly
discarded trails are absent from the derived map and GPX release while remaining
recoverable in the canonical research database.

Tillamook contains 1,050 source trails in one GPX: 290 tracks / 37,760 track
points and 300 routes / 37,824 route points. Its 52 excluded fragments are
anonymous isolated pieces totaling 5.15 miles and 890 source points.

Every pack is rebuilt from canonical GPX, joined only at exact numeric decimal
coordinates, and exhaustively reparsed. Equivalent decimal spellings can
normalize to the first canonical occurrence without moving a point. Derived files contain zero waypoints,
elevation, timestamps, or extensions. Every source atomic edge is represented;
when a dense graph exceeds 590 continuous walks, deterministic shortest-first
retracing follows existing source edges only. No connector geometry is invented.
Device path names contain a globally unique seven-character target code derived
only from the stable target ID, so adding or renaming another area cannot change
an existing code. Names remain unique after conservative 12-character
truncation across the release.

The builder stages the entire release beside the requested output, writes
per-pack source/topology/capacity manifests, validates all files and global
catalog invariants, then rehashes every canonical GPX, the state-context source,
the database manifest, and its own generator modules before publishing with one
directory rename. It refuses an existing output directory and never writes
inside the canonical database.

### Optional USA outline add-on

The release writes the lower-48 outline as a separate track-only GPX instead of
baking nationwide geometry into every area. This preserves the device's useful
local **Fit Map** behavior unless the rider deliberately installs the add-on.
All 49 source city waypoints are discarded. The approved 5,000-meter spherical
cross-track simplification preserves topology-segment endpoints and produces 70
tracks / 1,260 points with no doubled borders, moved coordinates, fabricated
connectors, or proper crossings.

The default 5,000-meter spherical cross-track simplification runs independently
on each source topology segment and preserves its endpoints. The current source
goes from 170 segments / 1,924 points to 1,360 segment-stage points, then exact
endpoint chaining produces 70 tracks / 1,260 track points. Maximum deviation is
4,986.679 meters, with no doubled or retraced borders, moved coordinates,
fabricated connectors, or proper crossings.

### QA-only full route/track stress test

`build-voyager-route-pool-stress.py` is deliberately separate from Pilot D. It
accepts only the physically validated Pilot C GPX hash and mirrors each of its
300 tracks to one short-named route without changing coordinates or point
order:

```powershell
python apps/trail-pack-builder/tools/build-voyager-route-pool-stress.py `
  "C:\path\to\yacolt-burn-voyager-pilot-c-single-device-pack.gpx" `
  --output "C:\path\to\voyager-route-pool-stress"
```

The QA bundle contains a 300-route / 69,420-route-point file and a combined
300-track + 300-route file with 69,420 points in each pool. That successful
physical import established the independent pools now used by the production
builder. Both files contain zero waypoints, elevation, time, or extensions;
routes precede tracks in GPX 1.1 order. The manifest maps every numbered route
to its source track coordinate hash. This diagnostic must never be offered as a
production download.
