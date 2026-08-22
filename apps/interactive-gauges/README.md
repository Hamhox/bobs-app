# Interactive Gauges

This static app runs a normalized version of the recovered Trail Tech Voyager linked-document prototype. The runtime is plain HTML, CSS, and JavaScript so it remains consistent with Bob's App.

## Archive conversion

The original ZIP is intentionally not part of the public site. Extract it to a reviewed local directory, then run:

```powershell
node tools/build-voyager-manifest.mjs --source <path-to-extracted-gps_demo3>
node tools/validate-voyager-manifest.mjs
node tools/validate-voyager-menu-runtime.mjs
```

The generator reads every historical HTML state, keeps the explicit screen filename as audit metadata, records all eight control transitions, preserves `href="#"` as a null transition, records meta-refresh declarations, and verifies the source archive's referenced 504 by 303 GIFs. The historical GIFs remain outside the public app and are not copied into production assets.

The checked-in audit currently verifies:

- 146 HTML states and 146 historical screen references
- 156 available screen GIFs in the reviewed archive
- 330 explicit no-op controls
- 15 meta-refresh declarations, 14 active and one commented in the source
- 145 states reachable through physical actions and active timers
- 146 states reachable when the original non-control archive links are included
- 29 states whose explicit screen basename differs from the HTML state ID

The runtime manifest is `data/voyager-states.json`. Presentation code does not contain historical transition rules.

## Live UI conversion

The live renderer preserves the manifest as the navigation authority and renders all 146 archived states with a
reusable `504 x 303` SVG stage in `voyager-live-runtime.js`. `voyager-live-screens.js` is the screen registry for the 29
states in the startup and seven gauge families—Main, Map, Temperature, Altitude, User, Navigation, and Satellite—including tab
chrome, primary and secondary views, captured map controls, graph interactions, and stable public IDs. The data-driven
`voyager-menu-registry.js` and
`voyager-menu-renderer.js` cover all 119 Main Menu, Ride Menu, Settings, and modal states with shared menu shells,
confirmation, waypoint-map, keyboard, digit-input, settings-list, and brightness renderers. The timed startup frame uses
the approved Trail Tech wordmark as live vector geometry, so the production runtime has no screen-image fallback.

The live MAIN family also includes the device's optional third tachbar page in tabs-visible and tabs-hidden forms. Its
15-segment arc, temperature, clock, speed, and RPM fill are rendered as live SVG; recorded GPX RPM wins when present and
the emulator derives a deterministic engine-speed fallback for older ride files without sensor extensions. Vehicle
Sensors > Tachbar Screen removes the page from the physical-control cycle when disabled, while Tach Scale controls its
fill thresholds. The manual BMP captures remain external visual references and are not shipped as runtime assets.

The three Add Waypoint paths now produce persistent local waypoint records: current position samples the shared ride
engine, latitude/longitude uses the entered archive coordinate, and crosshairs samples the displayed track position.
Saved waypoints appear in both the menu map flows and the live gauge map. Delete Waypoint and New Ride update the same
local record, so none of the waypoint workflows end at a visual-only confirmation.

`data/voyager-live-coverage.json` inventories all 146 known states, their input coverage, composition family, renderer,
and conversion status; regenerate it with `node tools/build-voyager-live-coverage.mjs` from this app directory.

The live slice uses `voyager-straight-photo.webp`, an alpha-preserving conversion of the publication-approved source photograph. Its measured transparent LCD opening and the
recalibrated physical-control coordinates are recorded in `assets/device/voyager-screen-placement.json`. The UI always
retains the historical `504:303` display ratio inside that opening.

The live screen and menu renderers reuse the publication-approved pixel artwork in
`assets/ui/voyager-ui-icons.svg` for compass, temperature, pan/zoom, playback, screen indicator, keyboard,
radio, crosshair, and confirmation controls. Regenerate the runtime-only icon sheet from a reviewed source export with:

```powershell
node tools/build-voyager-ui-kit.mjs --source <path-to-voyager-ui-kit.svg>
```

The generator performs a safety check and publishes only the named `ICONS` group; the source kit's reference board is
not copied into the app.

The active live-screen face is Bob's Font 6 Pixel v1.003. Its bundled symbol map documents the keyboard, radio,
status, and narrow/wide circled-digit glyphs. Menu data-block selectors use the font's circled digits for the authored
ride-memory 1 and 2 variants; the tuned SVG keyboard and radio controls remain in place.

Asset intake record: the reviewed source was `voyager-ui-kit_v2.svg` with SHA-256
`1258690247AD16F016A6682F3156894F0FC86C113E05265804B58CBE2E72EB4F`. The user confirmed publication approval for
the supplied assets; the protected source file itself remains outside the repository.

The map renderer is deliberately track-only. It draws the current recording and loaded local GPX track/route geometry,
position, heading, waypoints, scale, and pan/zoom state. It contains no basemap, terrain tiles, road layer, route planning,
or third-party map service. The fake memory card exposes the reviewed Baker West Desert and Jordan Creek riding areas
alongside two reviewed single rides (`cmra-trail-2.gpx` and `blackdog-2016.gpx`). Choosing Ride Menu, Edit Rides, Saved
Rides and Load selects the highlighted card entry and resets both map views around its geometry. Loading either riding-area
entry chooses a different real recorded loop when possible while retaining the area's complete multi-track network as map
context. The ride engine keeps recorded speed, heading,
distance, elevation, engine temperature, ambient temperature, graphs, and map position synchronized. It supports play,
pause, reset, seek, playback speed, and loop behavior. Graph cursor input seeks that shared timeline rather than maintaining
a disconnected display-only cursor.

`voyager-ride-catalog.js` is the single content authority beneath the ride engine, map, SD-card screens, destination
picker, and Memory panel. It owns loaded track/route resources, riding-area selections, saved rides, saved waypoints,
content labels, byte totals, and a revision-cached immutable inventory snapshot. The menu's loaded-track and route lists
are derived from that catalog rather than a second handwritten file list.

Device preferences and active behavior are intentionally separate. `voyager-setting-rules.js` declares sensor
requirements, derived values, and effective fallbacks. Disabling a sensor can therefore show and use the device's GPS,
engine, or wheel fallback without erasing the rider's stored source preference; re-enabling the sensor restores that
preference. The live renderer consumes one cached effective-settings snapshot per menu revision, so unchanged settings
are not recalculated on conductor ticks.

The checked-in real-ride files are reduced, publication-safe derivatives rather than copies of the source library. Rebuild
them from a reviewed local GPX directory with:

```powershell
node tools/build-voyager-ride-assets.mjs <path-to-reviewed-gpx-library>
```

The generator extracts CMRA Trail 2 and the first 2016 Blackdog recording, reduces point density, rebases timestamps while
preserving their intervals, and retains the recorded coordinates, elevation, speed, RPM, engine temperature, and ambient
temperature needed by the emulator. The original GPX library remains outside the repository.

The multi-track area packs use a separate compact JSON derivative so GPX track and route segments remain distinct and do
not acquire false connector lines. Rebuild and verify Baker West and Jordan Creek from the reviewed `ai-working` directory
with:

```powershell
node tools/build-voyager-area-assets.mjs <path-to-ai-working>
node tools/validate-voyager-area-assets.mjs
```

The area builder caps display segments at 240 points and playback rides at 1,600 points, preserves real ride telemetry,
records each source SHA-256, and never copies the source GPX files into the public app. The supplied national state-context
geometry remains outside the runtime: including it in local fit bounds would collapse a riding area to an unreadable dot.

The public command accepts stable state IDs and optional ride parameters. For example,
`navigateToVoyagerState("gauge.altitude.graph", { rideId: "mountain-run", progress: 0.4 })` selects the second local GPX
and opens its synchronized altitude graph.

The active state is mirrored to the `voyager` URL parameter using the same stable ID, so a copied URL restores the live
device and browser Back/Forward restores direct map or manual jumps. Physical and keyboard input replace the current URL
state instead of creating a history entry for every button press. Page-level instructions can opt into the same runtime
without importing emulator code by using `data-voyager-state` on a link or button and optional JSON in
`data-voyager-parameters`. The runtime marks matching destinations with `data-voyager-active`, emits a
`voyager:statechange` document event, and keeps the architecture board's matching SVG groups highlighted. This is the
shared integration boundary for the architecture map and field manual.

## Field manual

The compact field-manual deck is a selective vector reconstruction of the original 41-page Voyager user's manual. It
publishes eight interface-relevant pages rather than embedding the source PDF or reproducing the full document:

- page 3, Controls
- page 20, Main screens
- page 21, Map screen
- page 23, Temperature and altitude graphs
- page 26, Navigation screen
- page 27, Quick Menu
- page 30, Waypoints
- page 33, Settings menu

The reviewed artwork is stored in `assets/manual` as self-contained SVG files with the original text converted to paths.
The source PDF is not copied into the public app. Each page has one stable `data-voyager-state` handoff; physical,
keyboard, guide, history and architecture-map navigation emit the same `voyager:statechange` event and bring the nearest
matching manual page forward. Page images are decoded before the deck swaps them, and only the immediate previous and
next pages are preloaded during browser idle time.

The architecture viewer uses `assets/system/voyager-screens-b3.svg`, a publication-approved, font-backed export with
named screen, menu, flowchart, connector, and region groups. Its embedded Bob's Font 3.110 web face preserves the artwork
in both the standalone preview and injected viewer. The viewer frames the authored `screen-layout-screens`, `menu-screens`,
and `flowchart-screens` groups from their live SVG `getBBox()` measurements. Individual named screen groups are selectable;
groups that resolve to a manifest state can open that state in the working gauge, while unmatched groups are identified as
design-only rather than being assigned an uncertain prototype route. When the live device changes through any input path,
every matching screen group on the board receives the current-state highlight.

The compact display-type lab uses the approved 8-pixel face from Bob's Font 3.110. Its slider scales
that one face from 8pt through 96pt, while the single download action provides a three-file OTF, TTF,
and WOFF pack.
