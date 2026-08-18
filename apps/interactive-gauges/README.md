# Interactive Gauges

This static app runs a normalized version of the recovered Trail Tech Voyager linked-document prototype. The runtime is plain HTML, CSS, and JavaScript so it remains consistent with Bob's App.

## Archive conversion

The original ZIP is intentionally not part of the public site. Extract it to a reviewed local directory, then run:

```powershell
node tools/build-voyager-manifest.mjs --source <path-to-extracted-gps_demo3>
node tools/validate-voyager-manifest.mjs
```

The generator reads every historical HTML state, keeps the explicit screen reference, records all eight control transitions, preserves `href="#"` as a null transition, records meta-refresh declarations, and copies only the referenced 504 by 303 screen GIFs.

The checked-in audit currently verifies:

- 146 HTML states and 146 referenced runtime screens
- 156 available screen GIFs in the reviewed archive
- 330 explicit no-op controls
- 15 meta-refresh declarations, 14 active and one commented in the source
- 145 states reachable through physical actions and active timers
- 146 states reachable when the original non-control archive links are included
- 29 states whose explicit screen basename differs from the HTML state ID

The runtime manifest is `data/voyager-states.json`. Presentation code does not contain historical transition rules.

## Live UI conversion

The live renderer preserves the manifest as the navigation authority and replaces all 28 states in the seven gauge
families—Main, Map, Temperature, Altitude, User, Navigation, and Satellite—with a reusable `504 x 303` SVG stage in
`voyager-live-runtime.js`. `voyager-live-screens.js` is the screen registry for tab chrome, primary and secondary views,
captured map controls, graph interactions, and stable public IDs. Menu, settings, and modal states continue to use their
approved image captures as a comparison fallback until their data-driven conversion pass.

`data/voyager-live-coverage.json` inventories all 146 known states, their input coverage, composition family, renderer,
and conversion status; regenerate it with `node tools/build-voyager-live-coverage.mjs` from this app directory.

The live slice uses the publication-approved `voyager-straight-photo.png`. Its measured transparent LCD opening and the
recalibrated physical-control coordinates are recorded in `assets/device/voyager-screen-placement.json`. The UI always
retains the historical `504:303` display ratio inside that opening.

The map renderer is deliberately track-only. It draws the current recording and loaded local GPX track/route geometry,
position, heading, waypoints, scale, and pan/zoom state. It contains no basemap, terrain, tiles, roads, place labels, route
planning, or third-party map service. The ride engine loads `assets/rides/forest-loop.gpx` and
`assets/rides/mountain-run.gpx` locally and keeps ride-derived speed, heading, distance, elevation, temperature, graphs,
and map position synchronized. It supports play, pause, reset, seek, playback speed, and loop behavior. Graph cursor input
seeks that shared timeline rather than maintaining a disconnected display-only cursor.

The public command accepts stable state IDs and optional ride parameters. For example,
`navigateToVoyagerState("gauge.altitude.graph", { rideId: "mountain-run", progress: 0.4 })` selects the second local GPX
and opens its synchronized altitude graph.

The architecture viewer uses `assets/system/voyager-screens-b3.svg`, a publication-approved, font-backed export with
named screen, menu, flowchart, connector, and region groups. Its embedded Bob's Font 3.110 web face preserves the artwork
in both the standalone preview and injected viewer. The viewer frames the authored `screen-layout-screens`, `menu-screens`,
and `flowchart-screens` groups from their live SVG `getBBox()` measurements. Individual named screen groups are selectable;
groups that resolve to a manifest state can open that state in the working gauge, while unmatched groups are identified as
design-only rather than being assigned an uncertain prototype route.

The compact display-type lab uses the approved 8-pixel face from Bob's Font 3.110. Its slider scales
that one face from 8pt through 96pt, while the single download action provides a three-file OTF, TTF,
and WOFF pack.
