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

The architecture viewer uses `assets/system/voyager-screens-b2.svg`, a publication-approved export with named screen,
menu, flowchart, connector, and region groups. The viewer frames the authored `screen-layout-screens`, `menu-screens`,
and `flowchart-screens` groups from their live SVG `getBBox()` measurements.
