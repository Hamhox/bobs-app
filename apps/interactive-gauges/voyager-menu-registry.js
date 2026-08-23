import { VOYAGER_FONT_SYMBOLS } from "./voyager-font-symbols.js";

const registry = {};
const transitionIndex = {};
const DESTINATION_WAYPOINT_OPTIONS = ["CMRA TRAIL HEAD", "TRAIL 1 BAILOUT", "CIRCLE E CAMP", "A-B RESET"];

const TRIP_SCREEN_1 = VOYAGER_FONT_SYMBOLS.circledDigitNarrow1;
const TRIP_SCREEN_2 = VOYAGER_FONT_SYMBOLS.circledDigitNarrow2;
const RESET_RIDE_MEMORY_LINES = [
  "ERASE ALL",
  "TRACKS/ROUTES/WAYPOINTS",
  `AND RESET TRIP DST ${TRIP_SCREEN_1}, ${TRIP_SCREEN_2}?`,
  "UNSAVED DATA WILL BE LOST!",
];
const RESET_TRIP_1_LINES = [
  "RESET TRIP DST/TIME?",
  `(TRIP DST ${TRIP_SCREEN_1} IS VISIBLE`,
  "FROM MAIN & USER SCREEN)",
];
const RESET_TRIP_2_LINES = [
  "RESET TRIP DST/TIME?",
  `(TRIP DST ${TRIP_SCREEN_2} IS VISIBLE`,
  "ONLY FROM USER SCREEN)",
];
const RESET_STOPWATCH_LINES = ["RESET", "STOP", "WATCH?"];

const OVERLAY_KINDS = new Set([
  "brightness",
  "checklist-modal",
  "confirm",
  "keyboard",
  "notice",
  "progress",
  "settings-modal",
  "slot-input",
  "status-modal",
  "toast",
  "user-layout",
]);

function presentationFor(kind) {
  if (OVERLAY_KINDS.has(kind)) return "overlay";
  if (kind === "waypoint-map") return "workflow";
  return "page";
}

function register(id, definition, navigation = {}) {
  const parentStateId = definition.parentStateId ?? null;
  const presentation = presentationFor(definition.kind);
  registry[id] = { id, ...definition, parentStateId, presentation };
  transitionIndex[id] = {
    menu: navigation.menu ?? (presentation === "overlay" ? parentStateId : "index"),
    up: navigation.up ?? id,
    left: navigation.left ?? (parentStateId ?? null),
    center: navigation.center ?? (presentation === "page" ? navigation.enter ?? id : id),
    right: navigation.right ?? id,
    down: navigation.down ?? id,
    back: navigation.back ?? (parentStateId ?? "index"),
    enter: navigation.enter ?? (parentStateId ?? id),
  };
}

function selectableRowIndexes(rows) {
  return rows.flatMap((row, index) => row.spacer ? [] : [index]);
}

function registerPageFamily({ ids, rows, targets = [], parentStateId, ...definition }) {
  const rowIndexes = selectableRowIndexes(rows);
  if (ids.length !== rowIndexes.length) {
    throw new Error(`${definition.title} has ${rowIndexes.length} selectable rows but ${ids.length} states.`);
  }
  ids.forEach((id, index) => {
    const target = targets[index] === undefined ? id : targets[index];
    register(id, {
      ...definition,
      rows,
      rowStateIds: ids,
      parentStateId,
      selectedIndex: rowIndexes[index],
    }, {
      up: ids[(index - 1 + ids.length) % ids.length],
      left: parentStateId,
      right: target,
      down: ids[(index + 1) % ids.length],
      back: parentStateId,
      enter: target,
    });
  });
}

function registerSection({ rootId, rowIds, rows, targets, section, title, up, down, ...definition }) {
  register(rootId, { kind: "menu", section, title, rows, ...definition }, {
    menu: "index",
    up,
    left: null,
    center: null,
    right: rowIds[0],
    down,
    back: "index",
    enter: rowIds[0],
  });
  registerPageFamily({
    ids: rowIds,
    rows,
    targets,
    parentStateId: rootId,
    kind: "menu",
    section,
    title,
    ...definition,
  });
}

function registerOverlay(id, definition, parentStateId, navigation = {}) {
  register(id, { ...definition, parentStateId }, {
    menu: parentStateId,
    up: id,
    left: definition.kind === "settings-modal" || definition.kind === "slot-input" || definition.kind === "brightness"
      ? parentStateId
      : id,
    center: id,
    right: id,
    down: id,
    back: parentStateId,
    enter: parentStateId,
    ...navigation,
  });
}

const QUICK_ROWS = [
  { label: "LOG TRACK", field: "logTrack", value: "OFF" },
  { spacer: true },
  { label: "RESET RIDE MEMORY" },
  { label: "RESET TRIP DST" },
  { spacer: true },
  { label: "IMPORT RIDE" },
  { label: "EXPORT RIDE" },
  { spacer: true },
  { label: "ADD WAYPOINT (CURRENT POS)" },
  { label: "SELECT DESTINATION" },
];
const QUICK_IDS = ["m-main1-2", "m-main1-3", "m-main1-4", "m-main1-5", "m-main1-6", "m-main1-7", "m-main1-8"];

registerSection({
  rootId: "m-main1-1",
  rowIds: QUICK_IDS,
  rows: QUICK_ROWS,
  targets: ["m-main1-2-1", "m-main1-3-1", "m-main1-4-1", "m-main1-5-1", "m-main1-6-1", "m-main1-7", "m-main1-8-1"],
  section: "main",
  title: "QUICK MENU",
  up: "m-set3-1",
  down: "m-ride2-1",
  compact: true,
});
registry["m-main1-7"].outcome = "quick-add-waypoint";
registerOverlay("m-main1-2-1", {
  kind: "settings-modal", section: "main", title: "LOG TRACK", field: "logTrack", options: ["OFF", "ON"], selectedIndex: 0,
}, "m-main1-2");
registerOverlay("m-main1-3-1", {
  kind: "confirm", section: "main", title: "RESET RIDE MEMORY", outcome: "reset-ride-memory",
  lines: RESET_RIDE_MEMORY_LINES,
}, "m-main1-3");
registerOverlay("m-main1-4-1", {
  kind: "confirm", section: "main", title: "RESET TRIP DIST", outcome: "reset-trip-1",
  lines: RESET_TRIP_1_LINES,
}, "m-main1-4");
registerOverlay("m-main1-5-1", {
  kind: "settings-modal", section: "main", title: "SELECT FILE TO IMPORT", field: "importRideFile", fileBrowser: true,
  options: ["BAKER-WEST.GPX", "JORDAN-CREEK.GPX", "CMRA-TRAIL-2.GPX", "2016-BLACKDOG.GPX"], selectedIndex: 0, scroll: true,
  outcome: "import-ride",
}, "m-main1-5", { enter: "m-main1-5-progress" });
registerOverlay("m-main1-5-progress", {
  kind: "progress", section: "main", title: "IMPORTING GPX", lines: ["LOADING TRACK..."], progress: 1,
  autoTransition: { active: true, target: "m-main1-5-success", delayMs: 1400 },
}, "m-main1-5");
registerOverlay("m-main1-5-success", {
  kind: "toast", section: "main", title: "TRACK LOADED", message: ["TRACK LOADED", "OPEN MAP TO VIEW"],
  autoTransition: { active: true, target: "map", delayMs: 1800 },
}, "m-main1-5");
registerOverlay("m-main1-6-1", {
  kind: "progress", section: "main", title: "EXPORTING GPX", lines: ["WRITING FILE..."], progress: 0.68,
  outcome: "export-ride", cancelOutcome: "cancel-export",
}, "m-main1-6");
registerOverlay("m-main1-8-1", {
  kind: "settings-modal", section: "main", title: "SELECT DESTINATION WAYPOINT", field: "destinationWaypoint", options: DESTINATION_WAYPOINT_OPTIONS, selectedIndex: 0,
  destinationWaypointPicker: true, titleNarrow: true, outcome: "select-destination",
}, "m-main1-8");

const RIDE_ROWS = [
  { label: `${VOYAGER_FONT_SYMBOLS.play} TRACKS` },
  { label: `${VOYAGER_FONT_SYMBOLS.play} ROUTES` },
  { label: `${VOYAGER_FONT_SYMBOLS.play} WAYPOINTS` },
  { spacer: true },
  { label: `${VOYAGER_FONT_SYMBOLS.play} GRAPHS DISPLAY` },
  { spacer: true },
  { label: `${VOYAGER_FONT_SYMBOLS.play} RESETS` },
  { label: `${VOYAGER_FONT_SYMBOLS.play} IMPORT / EXPORT` },
  { spacer: true },
  { label: `${VOYAGER_FONT_SYMBOLS.play} MEMORY`, value: "31%", meter: 0.31 },
];
const RIDE_IDS = ["m-ride2-2", "m-ride2-3", "m-ride2-4", "m-ride2-5", "m-ride2-6", "m-ride2-7", "m-ride2-8"];
registerSection({
  rootId: "m-ride2-1",
  rowIds: RIDE_IDS,
  rows: RIDE_ROWS,
  targets: ["m-ride-tracks-1", "m-ride-routes-1", "m-ride-waypoints-1", "m-ride-graphs-display", "m-ride-resets-1", "m-ride-transfer-1", "m-ride-memory-1"],
  section: "ride",
  title: "RIDE MENU",
  up: "m-main1-1",
  down: "m-set3-1",
});

const TRACK_ROWS = [
  { label: "TRACKS DISPLAY", field: "tracksDisplay", value: "ALL" },
  { label: "RENAME A TRACK" },
  { label: "START NEW TRACK SEGMENT" },
  { spacer: true },
  { label: "ERASE ALL TRACKS" },
];
registerPageFamily({
  ids: ["m-ride-tracks-1", "m-ride-tracks-2", "m-ride-tracks-3", "m-ride-tracks-4"],
  rows: TRACK_ROWS,
  targets: ["m-ride-tracks-display", "m-ride-tracks-rename", "m-ride-tracks-segment", "m-ride-tracks-erase"],
  parentStateId: "m-ride2-2", kind: "panel", section: "ride", title: "TRACKS",
});
registerOverlay("m-ride-tracks-display", {
  kind: "settings-modal", section: "ride", title: "TRACK(S) TO DISPLAY", field: "tracksDisplay",
  options: ["NONE", "ALL", "CUSTOM"], selectedIndex: 1, optionTargets: { 2: "m-ride-tracks-custom" },
}, "m-ride-tracks-1");
registerOverlay("m-ride-tracks-custom", {
  kind: "checklist-modal", section: "ride", title: "CUSTOM TRACKS", field: "visibleTracks",
  options: ["BAKER WEST", "JORDAN CREEK", "CMRA TRAIL 2", "2016 BLACKDOG"], checkedOptions: [0, 1, 2, 3], selectedIndex: 0,
}, "m-ride-tracks-display");
registerOverlay("m-ride-tracks-rename", {
  kind: "settings-modal", section: "ride", title: "RENAME A TRACK", options: ["BAKER WEST", "JORDAN CREEK", "CMRA TRAIL 2", "2016 BLACKDOG"], selectedIndex: 0,
  optionTargets: { 0: "m-ride-track-name", 1: "m-ride-track-name", 2: "m-ride-track-name", 3: "m-ride-track-name" },
}, "m-ride-tracks-2");
registerOverlay("m-ride-track-name", {
  kind: "keyboard", section: "ride", title: "TRACK NAME", value: "BAKER WEST",
}, "m-ride-tracks-rename");
registerOverlay("m-ride-tracks-segment", {
  kind: "confirm", section: "ride", title: "START NEW TRACK SEGMENT", outcome: "start-track-segment",
  lines: ["CLOSE CURRENT SEGMENT AND", "BEGIN A NEW TRACK SEGMENT?"],
}, "m-ride-tracks-3");
registerOverlay("m-ride-tracks-erase", {
  kind: "confirm", section: "ride", title: "ERASE ALL TRACKS", outcome: "erase-tracks", lines: ["ERASE ALL TRACKS?", "UNSAVED DATA WILL BE LOST!"],
}, "m-ride-tracks-4");

const ROUTE_ROWS = [
  { label: "ROUTES DISPLAY", field: "routesDisplay", value: "ALL" },
  { label: "RENAME A ROUTE" },
  { spacer: true },
  { label: "ERASE ALL ROUTES" },
];
registerPageFamily({
  ids: ["m-ride-routes-1", "m-ride-routes-2", "m-ride-routes-3"], rows: ROUTE_ROWS,
  targets: ["m-ride-routes-display", "m-ride-routes-rename", "m-ride-routes-erase"],
  parentStateId: "m-ride2-3", kind: "panel", section: "ride", title: "ROUTES",
});
registerOverlay("m-ride-routes-display", {
  kind: "settings-modal", section: "ride", title: "ROUTE(S) TO DISPLAY", field: "routesDisplay", options: ["NONE", "ALL", "CUSTOM"], selectedIndex: 1,
}, "m-ride-routes-1");
registerOverlay("m-ride-routes-rename", {
  kind: "settings-modal", section: "ride", title: "RENAME A ROUTE", options: ["FOREST LOOP", "JUNIPER RIDGE", "WEST CONNECTOR"], selectedIndex: 0,
}, "m-ride-routes-2");
registerOverlay("m-ride-routes-erase", {
  kind: "confirm", section: "ride", title: "ERASE ALL ROUTES", outcome: "erase-routes", lines: ["ERASE ALL ROUTES?", "UNSAVED DATA WILL BE LOST!"],
}, "m-ride-routes-3");

const WAYPOINT_ROWS = [
  { label: "WAYPOINTS DISPLAY", field: "waypointsDisplay", value: "ALL" },
  { label: "RENAME A WAYPOINT" },
  { spacer: true },
  { label: "SELECT DESTINATION" },
  { label: "RESET DESTINATION" },
  { spacer: true },
  { label: `${VOYAGER_FONT_SYMBOLS.play} ADD WAYPOINT` },
  { label: `${VOYAGER_FONT_SYMBOLS.play} ERASE WAYPOINT(S)` },
];
registerPageFamily({
  ids: ["m-ride-waypoints-1", "m-ride-waypoints-2", "m-ride-waypoints-3", "m-ride-waypoints-4", "m-ride-waypoints-5", "m-ride-waypoints-6"],
  rows: WAYPOINT_ROWS,
  targets: ["m-ride-waypoints-display", "m-ride-waypoints-rename", "m-ride-waypoints-destination", "m-ride-waypoints-reset", "m-ride-waypoints-add-1", "m-ride-waypoints-erase-1"],
  parentStateId: "m-ride2-4", kind: "panel", section: "ride", title: "WAYPOINTS", compact: true,
});
registerOverlay("m-ride-waypoints-display", {
  kind: "settings-modal", section: "ride", title: "WAYPOINTS TO DISPLAY", field: "waypointsDisplay", options: ["NONE", "ALL", "CUSTOM"], selectedIndex: 1,
}, "m-ride-waypoints-1");
registerOverlay("m-ride-waypoints-rename", {
  kind: "settings-modal", section: "ride", title: "RENAME A WAYPOINT", options: DESTINATION_WAYPOINT_OPTIONS, selectedIndex: 0, destinationWaypointPicker: true, titleNarrow: true,
}, "m-ride-waypoints-2");
registerOverlay("m-ride-waypoints-destination", {
  kind: "settings-modal", section: "ride", title: "SELECT DESTINATION WAYPOINT", field: "destinationWaypoint", options: DESTINATION_WAYPOINT_OPTIONS, selectedIndex: 0,
  destinationWaypointPicker: true, titleNarrow: true, outcome: "select-destination",
}, "m-ride-waypoints-3");
registerOverlay("m-ride-waypoints-reset", {
  kind: "confirm", section: "ride", title: "RESET DESTINATION", outcome: "reset-destination", lines: ["CLEAR DESTINATION WAYPOINT?"],
}, "m-ride-waypoints-4");

const ADD_WAYPOINT_ROWS = [
  { label: "CURRENT POSITION" },
  { label: "LATITUDE / LONGITUDE" },
  { label: "MAP CROSSHAIRS" },
];
registerPageFamily({
  ids: ["m-ride-waypoints-add-1", "m-ride-waypoints-add-2", "m-ride-waypoints-add-3"], rows: ADD_WAYPOINT_ROWS,
  targets: ["m-ride-waypoint-current", "m-ride-waypoint-latitude", "m-ride-waypoint-crosshair"],
  parentStateId: "m-ride-waypoints-5", kind: "panel", section: "ride", title: "ADD WAYPOINT",
});
register("m-ride-waypoint-current", {
  kind: "waypoint-map", section: "ride", title: "ADD WAYPOINT: CONFIRM", mode: "confirm", pending: "current", parentStateId: "m-ride-waypoints-add-1", outcome: "add-waypoint-current",
}, { back: "m-ride-waypoints-add-1", enter: "m-ride-waypoints-add-1" });
registerOverlay("m-ride-waypoint-latitude", {
  kind: "slot-input", section: "ride", title: "ENTER LATITUDE", value: "N45.768892", activeDigit: 3,
}, "m-ride-waypoints-add-2", { enter: "m-ride-waypoint-longitude" });
registerOverlay("m-ride-waypoint-longitude", {
  kind: "slot-input", section: "ride", title: "ENTER LONGITUDE", value: "W122.519284", activeDigit: 4,
}, "m-ride-waypoint-latitude", { enter: "m-ride-waypoint-coordinates-confirm" });
register("m-ride-waypoint-coordinates-confirm", {
  kind: "waypoint-map", section: "ride", title: "ADD WAYPOINT: CONFIRM", mode: "confirm", pending: "coordinates", parentStateId: "m-ride-waypoint-longitude", outcome: "add-waypoint-coordinates",
}, { back: "m-ride-waypoint-longitude", enter: "m-ride-waypoints-add-2" });
register("m-ride-waypoint-crosshair", {
  kind: "waypoint-map", section: "ride", title: "ADD WAYPOINT: CROSSHAIRS", mode: "crosshair", pending: "crosshair", parentStateId: "m-ride-waypoints-add-3",
}, { up: "m-ride-waypoint-crosshair", left: "m-ride-waypoint-crosshair", center: "m-ride-waypoint-crosshair", right: "m-ride-waypoint-crosshair", down: "m-ride-waypoint-crosshair", back: "m-ride-waypoints-add-3", enter: "m-ride-waypoint-crosshair-confirm" });
register("m-ride-waypoint-crosshair-confirm", {
  kind: "waypoint-map", section: "ride", title: "ADD WAYPOINT: CONFIRM", mode: "confirm", pending: "crosshair", parentStateId: "m-ride-waypoint-crosshair", outcome: "add-waypoint-crosshair",
}, { back: "m-ride-waypoint-crosshair", enter: "m-ride-waypoints-add-3" });

const ERASE_WAYPOINT_ROWS = [
  { label: "ERASE ONE WAYPOINT" },
  { label: "ERASE ALL WAYPOINTS" },
];
registerPageFamily({
  ids: ["m-ride-waypoints-erase-1", "m-ride-waypoints-erase-2"], rows: ERASE_WAYPOINT_ROWS,
  targets: ["m-ride-waypoint-delete", "m-ride-waypoints-erase-all"], parentStateId: "m-ride-waypoints-6",
  kind: "panel", section: "ride", title: "ERASE WAYPOINT(S)",
});
register("m-ride-waypoint-delete", {
  kind: "waypoint-map", section: "ride", title: "DELETE WAYPOINT: SELECT", mode: "select-delete", parentStateId: "m-ride-waypoints-erase-1",
}, { back: "m-ride-waypoints-erase-1", enter: "m-ride-waypoint-delete-confirm" });
register("m-ride-waypoint-delete-confirm", {
  kind: "waypoint-map", section: "ride", title: "DELETE WAYPOINT: CONFIRM", mode: "confirm-delete", parentStateId: "m-ride-waypoint-delete", outcome: "erase-waypoint",
}, { back: "m-ride-waypoint-delete", enter: "m-ride-waypoints-erase-1" });
registerOverlay("m-ride-waypoints-erase-all", {
  kind: "confirm", section: "ride", title: "ERASE ALL WAYPOINTS", outcome: "erase-waypoints", lines: ["ERASE ALL WAYPOINTS?"],
}, "m-ride-waypoints-erase-2");

registerOverlay("m-ride-graphs-display", {
  kind: "settings-modal", section: "ride", title: "GRAPHS DISPLAY", graphDisplay: true, summary: "DISPLAYING: CURRENT TRACK",
  options: ["CURRENT TRACK", "OTHER TRACK", "OTHER ROUTE"], selectedIndex: 0,
}, "m-ride2-5");

const RESET_ROWS = [
  { label: "RESET RIDE MEMORY" },
  { spacer: true },
  { label: "RESET TRIP DST" },
  { label: `RESET TRIP DST ${VOYAGER_FONT_SYMBOLS.circledDigitNarrow2}` },
  { label: "RESET STOPWATCH" },
];
registerPageFamily({
  ids: ["m-ride-resets-1", "m-ride-resets-2", "m-ride-resets-3", "m-ride-resets-4"], rows: RESET_ROWS,
  targets: ["m-ride-reset-memory", "m-ride-reset-trip-1", "m-ride-reset-trip-2", "m-ride-reset-stopwatch"],
  parentStateId: "m-ride2-6", kind: "panel", section: "ride", title: "RESETS",
});
registerOverlay("m-ride-reset-memory", {
  kind: "confirm", section: "ride", title: "RESET RIDE MEMORY", outcome: "reset-ride-memory",
  lines: RESET_RIDE_MEMORY_LINES,
}, "m-ride-resets-1");
registerOverlay("m-ride-reset-trip-1", { kind: "confirm", section: "ride", title: "RESET TRIP DIST", outcome: "reset-trip-1", lines: RESET_TRIP_1_LINES }, "m-ride-resets-2");
registerOverlay("m-ride-reset-trip-2", { kind: "confirm", section: "ride", title: `RESET TRIP DIST ${TRIP_SCREEN_2}`, outcome: "reset-trip-2", lines: RESET_TRIP_2_LINES }, "m-ride-resets-3");
registerOverlay("m-ride-reset-stopwatch", { kind: "confirm", section: "ride", title: "RESET STOP WATCH", outcome: "reset-stopwatch", lines: RESET_STOPWATCH_LINES }, "m-ride-resets-4");

const TRANSFER_ROWS = [
  { label: "IMPORT RIDE" },
  { label: `${VOYAGER_FONT_SYMBOLS.play} IMPORT SETTINGS` },
  { spacer: true },
  { label: "EXPORT RIDE" },
  { label: `${VOYAGER_FONT_SYMBOLS.play} EXPORT SETTINGS` },
];
registerPageFamily({
  ids: ["m-ride-transfer-1", "m-ride-transfer-2", "m-ride-transfer-3", "m-ride-transfer-4"], rows: TRANSFER_ROWS,
  targets: ["m-ride-import-reading", "m-ride-import-settings", "m-ride-export-progress", "m-ride-export-settings"],
  parentStateId: "m-ride2-7", kind: "panel", section: "ride", title: "IMPORT / EXPORT",
});
registerOverlay("m-ride-import-reading", {
  kind: "toast", section: "ride", title: "READING CARD...", message: "READING CARD...",
  autoTransition: { active: true, target: "m-ride-import-file", delayMs: 900 },
}, "m-ride-transfer-1", {
  left: "m-ride-import-reading", center: "m-ride-import-reading", right: "m-ride-import-reading", enter: "m-ride-import-reading",
});
registerOverlay("m-ride-import-file", {
  kind: "settings-modal", section: "ride", title: "SELECT FILE TO IMPORT", field: "importRideFile", fileBrowser: true,
  options: ["BAKER-WEST.GPX", "JORDAN-CREEK.GPX", "CMRA-TRAIL-2.GPX", "2016-BLACKDOG.GPX"], selectedIndex: 0, scroll: true,
  outcome: "import-ride",
}, "m-ride-transfer-1", { enter: "m-ride-import-progress" });
registerOverlay("m-ride-import-progress", {
  kind: "progress", section: "ride", title: "IMPORTING GPX", lines: ["LOADING TRACK..."], progress: 1,
  autoTransition: { active: true, target: "m-ride-import-success", delayMs: 1400 },
}, "m-ride-transfer-1");
registerOverlay("m-ride-import-success", {
  kind: "toast", section: "ride", title: "TRACK LOADED", message: ["TRACK LOADED", "OPEN MAP TO VIEW"],
  autoTransition: { active: true, target: "map", delayMs: 1800 },
}, "m-ride-transfer-1");
registerOverlay("m-ride-import-settings", {
  kind: "settings-modal", section: "ride", title: "IMPORT OPTIONS",
  optionLabels: ["FILE TYPE", "TRACKS", "ROUTES", "WAYPOINTS", "RESOLUTION"],
  options: ["ALL", "AS TRACKS", "AS ROUTES", "ON", "FULL"], selectedIndex: 0,
}, "m-ride-transfer-2", {
  right: "m-ride-import-settings", enter: "m-ride-import-settings",
});
registerOverlay("m-ride-export-progress", {
  kind: "progress", section: "ride", title: "EXPORT GPX", lines: ["WRITING FILE..."], progress: 0.68, outcome: "export-ride", cancelOutcome: "cancel-export",
}, "m-ride-transfer-3");
registerOverlay("m-ride-export-settings", {
  kind: "settings-modal", section: "ride", title: "EXPORT OPTIONS",
  optionLabels: ["FILE TYPE", "TRACKS", "ROUTES", "WAYPOINTS", "RESOLUTION"],
  optionGroupBreaks: [1, 4], options: ["GPX", "AS TRACKS", "AS ROUTES", "ON", "FULL"], selectedIndex: 0,
}, "m-ride-transfer-4", {
  right: "m-ride-export-settings", enter: "m-ride-export-settings",
});

const memoryRatio = (value, maximum) => Math.min(1, Math.max(0, value / maximum));

export function voyagerMemoryRows({
  trackCount = 3,
  trackUsage = 0.31,
  routeCount = 4,
  routeUsage = 0.17,
  waypointCount = 9,
  microSdUsedMb = 416,
  microSdCapacityMb = 486,
} = {}) {
  return [
    { label: "TRACKS", value: `${trackCount} / 300`, meter: memoryRatio(trackCount, 300) },
    { label: "", value: `${Math.round(trackUsage * 100)}%`, meter: trackUsage },
    { spacer: true },
    { label: "ROUTES", value: `${routeCount} / 300`, meter: memoryRatio(routeCount, 300) },
    { label: "", value: `${Math.round(routeUsage * 100)}%`, meter: routeUsage },
    { spacer: true },
    { label: "WAYPOINTS", value: `${waypointCount} / 300`, meter: memoryRatio(waypointCount, 300) },
    { spacer: true },
    { label: "MICROSD", value: `${microSdUsedMb} / ${microSdCapacityMb}MB`, meter: memoryRatio(microSdUsedMb, microSdCapacityMb) },
    { spacer: true },
    { label: "RESET RIDE MEMORY" },
  ];
}

const MEMORY_ROWS = voyagerMemoryRows();
register("m-ride-memory-1", {
  rows: MEMORY_ROWS, selectedIndex: MEMORY_ROWS.length - 1,
  parentStateId: "m-ride2-8", kind: "memory", section: "ride", title: "MEMORY",
}, {
  menu: "m-ride2-8",
  up: "m-ride-memory-1",
  left: "m-ride2-8",
  center: "m-ride-memory-reset",
  right: "m-ride-memory-reset",
  down: "m-ride-memory-1",
  back: "m-ride2-8",
  enter: "m-ride-memory-reset",
});
registerOverlay("m-ride-memory-reset", {
  kind: "confirm", section: "ride", title: "RESET RIDE MEMORY", outcome: "reset-ride-memory",
  lines: RESET_RIDE_MEMORY_LINES,
}, "m-ride-memory-1");

const SET_ROWS = [
  { label: "UNIT SETTINGS", submenu: true },
  { label: "VEHICLE SENSORS", submenu: true },
  { label: "POWER SETTINGS", submenu: true },
  { label: "GPS SETTINGS", submenu: true },
  { label: "MAP SETTINGS", submenu: true },
  { label: "WARNING LED LIGHTS", submenu: true },
  { label: "UTILITY", submenu: true },
];
const SET_IDS = ["m-set3-2", "m-set3-3", "m-set3-4", "m-set3-5", "m-set3-6", "m-set3-7", "m-set3-8"];
registerSection({
  rootId: "m-set3-1", rowIds: SET_IDS, rows: SET_ROWS,
  targets: ["m-set3-2-1", "m-set3-3-1", "m-set3-4-1", "m-set3-5-1", "m-set3-6-1", "m-set3-7-1", "m-set3-8-1"],
  section: "set", title: "SETTINGS MENU", up: "m-ride2-1", down: "m-main1-1", compact: true,
});

const UNIT_ROWS = [
  { label: "SPEED/DST UNITS", field: "distanceUnits", value: "MILES", toggleValues: ["MILES", "KILOMETERS"] },
  { label: "ALTITUDE UNITS", field: "altitudeUnits", value: "FEET", toggleValues: ["FEET", "METERS"] },
  { label: "TEMP. UNITS", field: "temperatureUnits", value: "FAHRENHEIT", toggleValues: ["FAHRENHEIT", "CELSIUS"] },
  { spacer: true },
  { label: "CLOCK FORMAT", field: "clockFormat", value: "12 HOUR", toggleValues: ["12 HOUR", "24 HOUR"] },
  { label: "TIME OF DAY", field: "timeOfDay", value: "12:42:04 PM" },
  { spacer: true },
  { label: "TABS TIMEOUT", field: "tabsTimeout", value: "15 SEC" },
  { label: "DISPLAY MODE", field: "displayMode", value: "NORMAL", toggleValues: ["NORMAL", "INVERTED"] },
  { spacer: true },
  { label: "RESTORE DEFAULTS" },
];
registerPageFamily({
  ids: ["m-set3-2-1", "m-set3-2-2", "m-set3-2-3", "m-set3-2-4", "m-set3-2-5", "m-set3-2-6", "m-set3-2-7", "m-set3-2-8"], rows: UNIT_ROWS,
  targets: ["m-set3-2-1", "m-set3-2-2", "m-set3-2-3", "m-set3-2-4", "m-set3-2-time", "m-set3-2-tabs", "m-set3-2-7", "m-set3-2-8"],
  parentStateId: "m-set3-2", kind: "panel", section: "set", title: "UNIT SETTINGS", compact: true, restoreGroup: "UNIT SETTINGS",
});
registerOverlay("m-set3-2-units", { kind: "settings-modal", section: "set", title: "SPEED / DIST UNITS", field: "distanceUnits", options: ["MILES", "KILOMETERS"], selectedIndex: 0 }, "m-set3-2-1");
registerOverlay("m-set3-2-altitude", { kind: "settings-modal", section: "set", title: "ALTITUDE UNITS", field: "altitudeUnits", options: ["FEET", "METERS"], selectedIndex: 0 }, "m-set3-2-2");
registerOverlay("m-set3-2-temperature", { kind: "settings-modal", section: "set", title: "TEMPERATURE UNITS", field: "temperatureUnits", options: ["FAHRENHEIT", "CELSIUS"], selectedIndex: 0 }, "m-set3-2-3");
registerOverlay("m-set3-2-clock", { kind: "settings-modal", section: "set", title: "CLOCK FORMAT", field: "clockFormat", options: ["12 HOUR", "24 HOUR"], selectedIndex: 0 }, "m-set3-2-4");
registerOverlay("m-set3-2-time", { kind: "slot-input", section: "set", title: "TIME OF DAY", field: "timeOfDay", value: "12:42:04 PM", activeDigit: 1, slotType: "time" }, "m-set3-2-5");
registerOverlay("m-set3-2-tabs", {
  kind: "slot-input", section: "set", title: "TABS TIMEOUT", field: "tabsTimeout", value: "015 SEC", activeDigit: 1,
  note: ["SECONDSUNTIL TABS HIDE", "(000 SEC -> ALWAYS ON)", "DEFAULT: 15 SEC"],
}, "m-set3-2-6");
registerOverlay("m-set3-2-display", { kind: "settings-modal", section: "set", title: "DISPLAY MODE", field: "displayMode", options: ["NORMAL", "INVERTED"], selectedIndex: 0 }, "m-set3-2-7");

const VEHICLE_ROWS = [
  { label: "WHEEL SENSOR", field: "wheelSensor", value: "ENABLED", toggleValues: ["ENABLED", "DISABLED"] },
  { label: "  WHEEL SIZE", field: "wheelSize", value: "2110 mm" },
  { spacer: true },
  { label: "ENGINE SENSOR", field: "engineSensor", value: "ENABLED", toggleValues: ["ENABLED", "DISABLED"] },
  { label: "  PPR", field: "ppr", value: "1" },
  { label: "  SENSITIVITY", field: "sensorSensitivity", value: "LOW", toggleValues: ["LOW", "HIGH"] },
  { label: `  ${VOYAGER_FONT_SYMBOLS.play} TACHBAR`, availabilityField: "tachbarScreen" },
  { spacer: true },
  { label: "SPEED / DIST", field: "speedSource", value: "WHL SENSOR", toggleValues: ["WHL SENSOR", "GPS"] },
  { label: "ACCUM RUN TIME", field: "runTimeSource", value: "ENG OR WHL", toggleValues: ["ENG OR WHL", "GPS"] },
  { spacer: true },
  { label: "RESTORE DEFAULTS" },
];
registerPageFamily({
  ids: ["m-set3-3-1", "m-set3-3-2", "m-set3-3-3", "m-set3-3-4", "m-set3-3-5", "m-set3-3-6", "m-set3-3-7", "m-set3-3-8", "m-set3-3-9"], rows: VEHICLE_ROWS,
  targets: ["m-set3-3-1", "m-set3-3-size", "m-set3-3-3", "m-set3-3-ppr", "m-set3-3-5", "m-set3-3-tachbar", "m-set3-3-7", "m-set3-3-8", "m-set3-3-9"],
  parentStateId: "m-set3-3", kind: "panel", section: "set", title: "VEHICLE SENSORS", compact: true, restoreGroup: "VEHICLE SENSORS",
});
registerOverlay("m-set3-3-wheel", { kind: "settings-modal", section: "set", title: "WHEEL SENSOR", field: "wheelSensor", options: ["ENABLED", "DISABLED"], selectedIndex: 0 }, "m-set3-3-1");
registerOverlay("m-set3-3-size", {
  kind: "slot-input", section: "set", title: "WHEEL SIZE", field: "wheelSize", value: "2110 mm", activeDigit: 1,
  note: ["MOTORCYCLE: 2110 mm", "ATV: 1675 mm", "DEFAULT: 2110 mm"],
}, "m-set3-3-2");
registerOverlay("m-set3-3-engine", { kind: "settings-modal", section: "set", title: "ENGINE SENSOR", field: "engineSensor", options: ["ENABLED", "DISABLED"], selectedIndex: 0 }, "m-set3-3-3");
registerOverlay("m-set3-3-ppr", { kind: "settings-modal", section: "set", title: "PULSES PER REVOLUTION", field: "ppr", options: ["1", "2", "1/2"], selectedIndex: 0 }, "m-set3-3-4");
registerOverlay("m-set3-3-sensitivity", { kind: "settings-modal", section: "set", title: "SENSITIVITY", field: "sensorSensitivity", options: ["LOW", "MEDIUM", "HIGH"], selectedIndex: 0 }, "m-set3-3-5");
registerOverlay("m-set3-3-tachbar", {
  kind: "settings-modal", section: "set", title: "TACHBAR OPTIONS",
  optionLabels: ["TACHBAR SCREEN", "TACH SCALE", "MAIN SCREEN"],
  rowFields: ["tachbarScreen", "tachScale", "mainScreenMode"],
  rowToggleValues: [["ENABLED", "DISABLED"], null, ["TACHBAR", "DEFAULT"]],
  optionTargets: { 1: "m-set3-3-tach-scale" },
  options: ["ENABLED", "15000", "TACHBAR"], selectedIndex: 0,
}, "m-set3-3-6", {
  right: "m-set3-3-tachbar", enter: "m-set3-3-tachbar",
});
registerOverlay("m-set3-3-tach-scale", {
  kind: "slot-input", section: "set", title: "MAX RPM SCALE", field: "tachScale", value: "15000", activeDigit: 2,
}, "m-set3-3-tachbar");
registerOverlay("m-set3-3-source", { kind: "settings-modal", section: "set", title: "SPEED / DIST", field: "speedSource", options: ["WHL SENSOR", "GPS"], selectedIndex: 0 }, "m-set3-3-7");
registerOverlay("m-set3-3-runtime", { kind: "settings-modal", section: "set", title: "ACCUM RUN TIME", field: "runTimeSource", options: ["ENG OR WHL", "ENGINE", "WHEEL", "GPS"], selectedIndex: 0 }, "m-set3-3-8");

const POWER_ROWS = [
  { label: "BACKLIGHT LEVEL", field: "backlightLevel", value: "HIGH" },
  { label: "  TIMEOUT (BAT)", field: "backlightBattery", value: "20 SEC" },
  { label: "  TIMEOUT (EXT)", field: "backlightExternal", value: "ALWAYS ON" },
  { spacer: true },
  { label: "SLEEP (BATTERY)", field: "sleepBattery", value: "3 MIN" },
  { label: "SLEEP (EXT POWER)", field: "sleepExternal", value: "20 MIN" },
  { spacer: true },
  { label: "TURN OFF", field: "turnOff", value: "60 MIN" },
  { spacer: true },
  { label: "CHARGE MODE", field: "chargeMode", value: "VEHICLE", toggleValues: ["VEHICLE", "WALL PLUG"] },
  { spacer: true },
  { label: "RESTORE DEFAULTS", requiresConfirmation: true },
];
registerPageFamily({
  ids: ["m-set3-4-1", "m-set3-4-2", "m-set3-4-3", "m-set3-4-4", "m-set3-4-5", "m-set3-4-6", "m-set3-4-7", "m-set3-4-8"], rows: POWER_ROWS,
  targets: ["m-set3-4-level", "m-set3-4-battery", "m-set3-4-external", "m-set3-4-sleep-battery", "m-set3-4-sleep-external", "m-set3-4-turnoff", "m-set3-4-7", "m-set3-4-restore"],
  parentStateId: "m-set3-4", kind: "panel", section: "set", title: "POWER SETTINGS", compact: true, restoreGroup: "POWER SETTINGS",
});
registerOverlay("m-set3-4-level", {
  kind: "settings-modal", section: "set", title: "BACKLIGHT", field: "backlightLevel",
  options: ["OFF", "LOW", "MEDIUM", "HIGH"], selectedIndex: 3,
}, "m-set3-4-1");
registerOverlay("m-set3-4-battery", {
  kind: "slot-input", section: "set", title: "BACKLIGHT (BATTERY)", field: "backlightBattery", value: "020 SEC", activeDigit: 1,
  note: ["SECONDS BACKLIGHT LIGHTS", "WHEN USING INTERNAL BATTERY", "(000 SEC -> ALWAYS ON)", "DEFAULT: 20 SEC"],
}, "m-set3-4-2");
registerOverlay("m-set3-4-external", {
  kind: "slot-input", section: "set", title: "BACKLIGHT (EXTERNAL)", field: "backlightExternal", value: "000 SEC", activeDigit: 1,
  note: ["SECONDS BACKLIGHT LIGHTS", "WHEN USING EXTERNAL POWER", "(000 SEC -> ALWAYS ON)", "DEFAULT: ALWAYS ON"],
}, "m-set3-4-3");
registerOverlay("m-set3-4-sleep-battery", {
  kind: "slot-input", section: "set", title: "SLEEP MODE TIMEOUT", field: "sleepBattery", value: "03 MIN", activeDigit: 0,
  note: ["MINUTES UNTIL SLEEP MODE", "AFTER LAST KEY/SENSOR INPUT", "WHEN USING BATTERY POWER", "(00 MIN -> ALWAYS ON)", "DEFAULT: 3 MIN"],
}, "m-set3-4-4");
registerOverlay("m-set3-4-sleep-external", {
  kind: "slot-input", section: "set", title: "SLEEP MODE TIMEOUT", field: "sleepExternal", value: "20 MIN", activeDigit: 0,
  note: ["MINUTES UNTIL SLEEP MODE", "AFTER LAST KEY/SENSOR INPUT", "WHEN USING EXTERNAL POWER", "(00 MIN -> ALWAYS ON)", "DEFAULT: 20 MIN"],
}, "m-set3-4-5");
registerOverlay("m-set3-4-turnoff", {
  kind: "slot-input", section: "set", title: "POWER OFF TIMEOUT", field: "turnOff", value: "60 MIN", activeDigit: 0,
  note: ["MINUTES UNTIL POWER OFF", "AFTER LAST KEY/SENSOR INPUT", "(00 MIN -> ALWAYS ON)", "DEFAULT: 60 MIN"],
}, "m-set3-4-6");
registerOverlay("m-set3-4-restore", {
  kind: "confirm", section: "set", title: "RESTORE DEFAULTS", restoreGroup: "POWER SETTINGS",
  lines: ["RESTORE POWER SETTINGS", "TO FACTORY DEFAULTS?"],
}, "m-set3-4-8");

const GPS_ROWS = [
  {
    label: "LOG METHOD", field: "logMethod", value: "TIME", toggleValues: ["TIME", "DISTANCE"],
    dependentValues: { logFrequency: { TIME: "1 SEC", DISTANCE: "10 FT" } },
  },
  { label: "LOG FREQUENCY", field: "logFrequency", value: "1 SEC" },
  { label: "LOG OPTION", field: "logOption", value: "ENG OR WHL" },
  { label: "AUTO-SPLIT", field: "autoSplit", value: "5 MI GAP" },
  { spacer: true },
  { label: "COORD FORMAT", field: "coordFormat", value: "DEG, MIN.DEC" },
  { label: "SIGNAL BARS", field: "signalBars", value: "OFF", toggleValues: ["OFF", "ON"] },
  { spacer: true },
  { label: "RESTORE DEFAULTS", requiresConfirmation: true },
];
registerPageFamily({
  ids: ["m-set3-5-1", "m-set3-5-2", "m-set3-5-3", "m-set3-5-4", "m-set3-5-5", "m-set3-5-6", "m-set3-5-7"], rows: GPS_ROWS,
  targets: ["m-set3-5-1", "m-set3-5-frequency", "m-set3-5-option", "m-set3-5-split", "m-set3-5-coords", "m-set3-5-6", "m-set3-5-restore"],
  parentStateId: "m-set3-5", kind: "panel", section: "set", title: "GPS SETTINGS", compact: true, restoreGroup: "GPS SETTINGS",
});
registerOverlay("m-set3-5-frequency", {
  kind: "settings-modal", section: "set", title: "LOG FREQUENCY", field: "logFrequency",
  options: ["1 SEC", "2 SEC", "5 SEC"], selectedIndex: 0,
  optionField: "logMethod",
  optionsByValue: {
    TIME: ["1 SEC", "2 SEC", "5 SEC"],
    DISTANCE: ["1 FT", "10 FT", "50 FT"],
  },
}, "m-set3-5-2");
registerOverlay("m-set3-5-option", {
  kind: "settings-modal", section: "set", title: "LOG OPTION", field: "logOption",
  options: ["ALWAYS", "ENG SENSOR", "WHL SENSOR", "ENG OR WHL"], selectedIndex: 3,
}, "m-set3-5-3");
registerOverlay("m-set3-5-split", {
  kind: "settings-modal", section: "set", title: "LOG AUTO-SPLIT", field: "autoSplit",
  options: ["OFF", "1 MI GAP", "5 MI GAP", "10 MI GAP"], selectedIndex: 2,
}, "m-set3-5-4");
registerOverlay("m-set3-5-coords", {
  kind: "settings-modal", section: "set", title: "COORDINATE DISPLAY", field: "coordFormat",
  options: ["DEG.DEC", "DEG, MIN.DEC", "DEG, MIN, SEC"], selectedIndex: 1,
}, "m-set3-5-5");
registerOverlay("m-set3-5-restore", {
  kind: "confirm", section: "set", title: "RESTORE DEFAULTS", restoreGroup: "GPS SETTINGS",
  lines: ["RESTORE GPS SETTINGS", "TO FACTORY DEFAULTS?"],
}, "m-set3-5-7");

const MAP_ROWS = [
  { label: "ORIENTATION", field: "mapOrientation", value: "NORTH UP", toggleValues: ["NORTH UP", "TRACK UP"] },
  { label: "POINTER SIZE", field: "pointerSize", value: "MEDIUM" },
  { spacer: true },
  { label: "MAP SCREEN 1", field: "mapScreen1", value: "AUTO-CENTER", toggleValues: ["AUTO-CENTER", "FIXED"] },
  { label: "OPTIONS", submenu: true },
  { spacer: true },
  { label: "MAP SCREEN 2", field: "mapScreen2", value: "AUTO-CENTER" },
  { label: "OPTIONS", submenu: true, availabilityField: "mapScreen2Options" },
  { spacer: true },
  { label: "P/Z TIMEOUT", field: "panZoomTimeout", value: "30 SEC" },
  { spacer: true },
  { label: "RESTORE DEFAULTS", requiresConfirmation: true },
];
registerPageFamily({
  ids: ["m-set3-6-1", "m-set3-6-2", "m-set3-6-3", "m-set3-6-4", "m-set3-6-5", "m-set3-6-6", "m-set3-6-7", "m-set3-6-8"], rows: MAP_ROWS,
  targets: ["m-set3-6-1", "m-set3-6-pointer", "m-set3-6-3", "m-set3-6-options1", "m-set3-6-screen2", "m-set3-6-options2", "m-set3-6-timeout", "m-set3-6-restore"],
  parentStateId: "m-set3-6", kind: "panel", section: "set", title: "MAP SETTINGS", compact: true, restoreGroup: "MAP SETTINGS",
});
registerOverlay("m-set3-6-pointer", {
  kind: "settings-modal", section: "set", title: "MAP POINTER SIZE", field: "pointerSize",
  options: ["SMALL", "MEDIUM", "LARGE"], selectedIndex: 1,
}, "m-set3-6-2");
registerOverlay("m-set3-6-screen2", {
  kind: "settings-modal", section: "set", title: "MAP SCREEN 2 MODE", field: "mapScreen2",
  options: ["DISABLED", "FIXED", "AUTO-CENTER"], selectedIndex: 2,
}, "m-set3-6-5");

const MAP_LABEL_OPTIONS = ["OFF", "SMALL", "LARGE"];
const MAP_CLIPPING_OPTIONS = ["750 FT", "1500 FT", "3000 FT", "1 MI", "2 MI", "NEVER"];

function registerMapScreenOptions(screen) {
  const prefix = `mapScreen${screen}`;
  const statePrefix = `m-set3-6-options${screen}`;
  const rows = [
    { label: "TRACK LABELS", field: `${prefix}TrackLabels`, value: screen === 1 ? "LARGE" : "OFF" },
    { label: "  CLIPPING", field: `${prefix}TrackClipping`, value: "1500 FT" },
    { spacer: true },
    { label: "ROUTE LABELS", field: `${prefix}RouteLabels`, value: screen === 1 ? "LARGE" : "OFF" },
    { label: "  CLIPPING", field: `${prefix}RouteClipping`, value: "1500 FT" },
    { spacer: true },
    { label: "WAYPOINT ICONS", field: `${prefix}WaypointIcons`, value: "ID#", toggleValues: ["ID#", "DOT"] },
    { label: "WAYPOINT LABELS", field: `${prefix}WaypointLabels`, value: screen === 1 ? "LARGE" : "OFF" },
    { label: "  CLIPPING", field: `${prefix}WaypointClipping`, value: "1500 FT" },
  ];
  const ids = [statePrefix, ...Array.from({ length: 6 }, (_, index) => `${statePrefix}-${index + 2}`)];
  const targets = [
    `${statePrefix}-track-labels`,
    `${statePrefix}-track-clipping`,
    `${statePrefix}-route-labels`,
    `${statePrefix}-route-clipping`,
    ids[4],
    `${statePrefix}-waypoint-labels`,
    `${statePrefix}-waypoint-clipping`,
  ];
  registerPageFamily({
    ids, rows, targets, parentStateId: `m-set3-6-${screen === 1 ? 4 : 6}`,
    kind: "panel", section: "set", title: `MAP SCREEN ${screen} OPTIONS`, compact: true,
  });
  registerOverlay(`${statePrefix}-track-labels`, {
    kind: "settings-modal", section: "set", title: "TRACK LABELS", field: `${prefix}TrackLabels`,
    options: MAP_LABEL_OPTIONS, selectedIndex: screen === 1 ? 2 : 0,
  }, ids[0]);
  registerOverlay(`${statePrefix}-track-clipping`, {
    kind: "settings-modal", section: "set", title: "HIDE LABELS ABOVE:", field: `${prefix}TrackClipping`,
    options: MAP_CLIPPING_OPTIONS, selectedIndex: 1,
  }, ids[1]);
  registerOverlay(`${statePrefix}-route-labels`, {
    kind: "settings-modal", section: "set", title: "ROUTE LABELS", field: `${prefix}RouteLabels`,
    options: MAP_LABEL_OPTIONS, selectedIndex: screen === 1 ? 2 : 0,
  }, ids[2]);
  registerOverlay(`${statePrefix}-route-clipping`, {
    kind: "settings-modal", section: "set", title: "HIDE LABELS ABOVE:", field: `${prefix}RouteClipping`,
    options: MAP_CLIPPING_OPTIONS, selectedIndex: 1,
  }, ids[3]);
  registerOverlay(`${statePrefix}-waypoint-labels`, {
    kind: "settings-modal", section: "set", title: "WAYPOINT LABELS", field: `${prefix}WaypointLabels`,
    options: MAP_LABEL_OPTIONS, selectedIndex: screen === 1 ? 2 : 0,
  }, ids[5]);
  registerOverlay(`${statePrefix}-waypoint-clipping`, {
    kind: "settings-modal", section: "set", title: "HIDE LABELS ABOVE:", field: `${prefix}WaypointClipping`,
    options: MAP_CLIPPING_OPTIONS, selectedIndex: 1,
  }, ids[6]);
}

registerMapScreenOptions(1);
registerMapScreenOptions(2);

registerOverlay("m-set3-6-timeout", {
  kind: "slot-input", section: "set", title: "MAP PAN/ZOOM TIMEOUT", field: "panZoomTimeout", value: "030 SEC", activeDigit: 1,
  note: ["SECONDS UNTIL MAP RESUMES", "NORMAL MODE, IF NO KEYPRESS", "(000 SEC -> NEVER TIMEOUT)", "DEFAULT: 30 SEC"],
}, "m-set3-6-7");
registerOverlay("m-set3-6-restore", {
  kind: "confirm", section: "set", title: "RESTORE DEFAULTS", restoreGroup: "MAP SETTINGS",
  lines: ["RESTORE MAP SETTINGS", "TO FACTORY DEFAULTS?"],
}, "m-set3-6-8");

const WARNING_ROWS = [
  { label: "YELLOW LED ON", field: "yellowLedOn", value: "DISABLED" },
  { label: "RED LED ON", field: "redLedOn", value: "DISABLED" },
  { spacer: true },
  { label: "YELLOW LED FLASH", field: "yellowLedFlash", value: "DISABLED" },
  { label: "RED LED FLASH", field: "redLedFlash", value: "DISABLED" },
  { spacer: true },
  { label: "RESTORE DEFAULTS", requiresConfirmation: true },
];
registerPageFamily({
  ids: ["m-set3-7-1", "m-set3-7-2", "m-set3-7-3", "m-set3-7-4", "m-set3-7-5"], rows: WARNING_ROWS,
  targets: ["m-set3-7-yellow-on", "m-set3-7-red-on", "m-set3-7-yellow-flash", "m-set3-7-red-flash", "m-set3-7-restore"],
  parentStateId: "m-set3-7", kind: "panel", section: "set", title: "WARNING LED LIGHTS", restoreGroup: "WARNING LED LIGHTS",
});
const warningModal = (slug, title, field, parentStateId, action, side, color) => registerOverlay(`m-set3-7-${slug}`, {
  kind: "slot-input", section: "set", title, field, value: "000 °F", activeDigit: 1,
  note: [`${action} ${side} ${color} LED`, "WHEN EXCEEDED.", "(000 -> DISABLED)", "DEFAULT: DISABLED"],
}, parentStateId);
warningModal("yellow-on", "YELLOW LED ON", "yellowLedOn", "m-set3-7-1", "LIGHT", "LEFT", "YELLOW");
warningModal("red-on", "RED LED ON", "redLedOn", "m-set3-7-2", "LIGHT", "RIGHT", "RED");
warningModal("yellow-flash", "YELLOW LED FLASH", "yellowLedFlash", "m-set3-7-3", "FLASH", "LEFT", "YELLOW");
warningModal("red-flash", "YELLOW LED FLASH", "redLedFlash", "m-set3-7-4", "FLASH", "RIGHT", "RED");
registerOverlay("m-set3-7-restore", {
  kind: "confirm", section: "set", title: "RESTORE DEFAULTS", restoreGroup: "WARNING LED LIGHTS",
  lines: ["RESTORE LED SETTINGS", "TO FACTORY DEFAULTS?"],
}, "m-set3-7-5");

const UTILITY_ROWS = [
  { label: "STATUS SCREEN" },
  { label: "SOFTWARE UPDATE" },
  { label: "PERSONAL INFORMATION", submenu: true },
  { label: "DEMO MENU", submenu: true },
  { label: "SERVICE MENU", submenu: true },
  { label: "MANAGE SETTINGS", submenu: true },
];
registerPageFamily({
  ids: ["m-set3-8-1", "m-set3-8-2", "m-set3-8-3", "m-set3-8-4", "m-set3-8-5", "m-set3-8-6"], rows: UTILITY_ROWS,
  targets: ["m-set3-8-status", "m-set3-8-flash", "m-set3-8-personal", "m-set3-8-demo", "m-set3-8-service", "m-set3-8-manage"],
  parentStateId: "m-set3-8", kind: "panel", section: "set", title: "UTILITY",
});
registerOverlay("m-set3-8-status", { kind: "status-modal", section: "set", title: "STATUS SCREEN" }, "m-set3-8-1");

const SOFTWARE_FILES = ["VOYAGER-1.7.0.SWU", "VOYAGER-1.6.4.SWU", "VOYAGER-FACTORY.SWU"];
registerOverlay("m-set3-8-flash", {
  kind: "settings-modal", section: "set", title: "SELECT FLASH FILE", field: "softwareFile", fileBrowser: true,
  options: SOFTWARE_FILES, selectedIndex: 0,
  optionTargets: SOFTWARE_FILES.map(() => "m-set3-8-flash-progress"),
}, "m-set3-8-2");
registerOverlay("m-set3-8-flash-progress", {
  kind: "progress", section: "set", title: "SOFTWARE UPDATE", lines: ["INSTALLING SELECTED SWU..."], progress: 1,
  autoTransition: { active: true, target: "m-set3-8-flash-success", delayMs: 1400 },
}, "m-set3-8-flash");
registerOverlay("m-set3-8-flash-success", {
  kind: "toast", section: "set", title: "SOFTWARE UPDATE", message: ["Software update", "faked successfully."],
}, "m-set3-8-2");

const PERSONAL_ROWS = [
  { label: "NAME", field: "personalName", value: "BOB" },
  { label: "ADDR", field: "personalAddress", value: "PORTLAND, OR" },
  { label: "PHONE", field: "personalPhone", value: "555-0146" },
];
registerPageFamily({
  ids: ["m-set3-8-personal", "m-set3-8-personal-2", "m-set3-8-personal-3"], rows: PERSONAL_ROWS,
  targets: ["m-set3-8-personal-name", "m-set3-8-personal-address", "m-set3-8-personal-phone"],
  parentStateId: "m-set3-8-3", kind: "panel", section: "set", title: "PERSONAL INFORMATION",
});
registerOverlay("m-set3-8-personal-name", { kind: "keyboard", section: "set", title: "EDIT NAME", field: "personalName" }, "m-set3-8-personal");
registerOverlay("m-set3-8-personal-address", { kind: "keyboard", section: "set", title: "EDIT ADDRESS", field: "personalAddress" }, "m-set3-8-personal-2");
registerOverlay("m-set3-8-personal-phone", { kind: "keyboard", section: "set", title: "EDIT PHONE", field: "personalPhone" }, "m-set3-8-personal-3");

const DEMO_ROWS = [
  { label: "TRACK RECORDING", field: "demoRideState", value: "RUNNING", toggleValues: ["RUNNING", "PAUSED"] },
  { label: "PLAYBACK SPEED", field: "demoPlaybackSpeed", value: "1X" },
  { label: "LOOP RIDING AREA", field: "demoLoop", value: "ON", toggleValues: ["ON", "OFF"] },
  { spacer: true },
  { label: "RESTART DEMO RIDE" },
];
registerPageFamily({
  ids: ["m-set3-8-demo", "m-set3-8-demo-2", "m-set3-8-demo-3", "m-set3-8-demo-4"], rows: DEMO_ROWS,
  targets: ["m-set3-8-demo", "m-set3-8-demo-speed", "m-set3-8-demo-3", "m-set3-8-demo-restarted"],
  parentStateId: "m-set3-8-4", kind: "panel", section: "set", title: "DEMO MENU",
});
registry["m-set3-8-demo-4"].outcome = "restart-demo-ride";
registerOverlay("m-set3-8-demo-speed", {
  kind: "settings-modal", section: "set", title: "PLAYBACK SPEED", field: "demoPlaybackSpeed",
  options: ["1X", "2X", "4X"], selectedIndex: 0,
}, "m-set3-8-demo-2");
registerOverlay("m-set3-8-demo-restarted", {
  kind: "toast", section: "set", title: "DEMO RIDE RESTARTED", message: "DEMO RIDE RESTARTED",
}, "m-set3-8-demo-4");

registerPageFamily({
  ids: ["m-set3-8-service"], rows: [{ label: "INPUT SERVICE PASSWORD" }],
  targets: ["m-set3-8-service-password"], parentStateId: "m-set3-8-5",
  kind: "panel", section: "set", title: "SERVICE MENU",
});
registerOverlay("m-set3-8-service-password", {
  kind: "keyboard", section: "set", title: "INPUT SERVICE PASSWORD", value: "",
}, "m-set3-8-service");

const MANAGE_ROWS = [
  { label: "SAVE SETTINGS TO FILE" },
  { label: "LOAD SETTINGS FROM FILE" },
  { spacer: true },
  { label: "RESTORE DEFAULT SETTINGS" },
];
registerPageFamily({
  ids: ["m-set3-8-manage", "m-set3-8-manage-2", "m-set3-8-manage-3"], rows: MANAGE_ROWS,
  targets: ["m-set3-8-manage-saved", "m-set3-8-manage-loading", "m-set3-8-manage-restore"],
  parentStateId: "m-set3-8-6", kind: "panel", section: "set", title: "MANAGE SETTINGS:",
});
registry["m-set3-8-manage"].outcome = "save-settings-file";
registry["m-set3-8-manage-2"].outcome = "load-settings-file";
registerOverlay("m-set3-8-manage-saved", {
  kind: "toast", section: "set", title: "SETTINGS FILE DOWNLOADED", message: "SETTINGS FILE DOWNLOADED",
}, "m-set3-8-manage");
registerOverlay("m-set3-8-manage-loading", {
  kind: "notice", section: "set", title: "LOAD SETTINGS", lines: ["SELECT A VOYAGER", "SETTINGS JSON FILE"],
}, "m-set3-8-manage-2");
registerOverlay("m-set3-8-manage-restore", {
  kind: "confirm", section: "set", title: "RESTORE DEFAULT SETTINGS", restoreAll: true,
  outcome: "restore-all-settings", lines: ["RESTORE ALL SETTINGS", "TO FACTORY DEFAULTS?"],
}, "m-set3-8-manage-3");

const USER_SCREEN_DATA_BLOCKS = [
  "<OFF>", "ALTITUDE", "MIN ALTITUDE", "MAX ALTITUDE", "WHEEL SPEED", "GPS SPEED", "WHEEL ODOMETER", "GPS ODOMETER",
  "ENGINE ACC. RUN TIME", "GPS ACC. RUN TIME", "AIR TEMPERATURE", "ENGINE TEMPERATURE", "MAX ENGINE TEMPERATURE",
  "AVG ENGINE TEMPERATURE", "CLOCK", "STOP WATCH", "HEADING", "COMPASS DIRECTION", "INPUT VOLTAGE",
  "INTERNAL BATTERY VOLTAGE", "TACHOMETER",
  `WHEEL DISTANCE ${VOYAGER_FONT_SYMBOLS.circledDigitNarrow1}`,
  `GPS DISTANCE ${VOYAGER_FONT_SYMBOLS.circledDigitNarrow1}`,
  `ENGINE TRIP TIME ${VOYAGER_FONT_SYMBOLS.circledDigitNarrow1}`,
  `GPS TRIP TIME ${VOYAGER_FONT_SYMBOLS.circledDigitNarrow1}`,
  `MAX WHEEL SPEED ${VOYAGER_FONT_SYMBOLS.circledDigitNarrow1}`,
  `MAX GPS SPEED ${VOYAGER_FONT_SYMBOLS.circledDigitNarrow1}`,
  `AVG WHEEL SPEED ${VOYAGER_FONT_SYMBOLS.circledDigitNarrow1}`,
  `AVG GPS SPEED ${VOYAGER_FONT_SYMBOLS.circledDigitNarrow1}`,
  `WHEEL DISTANCE ${VOYAGER_FONT_SYMBOLS.circledDigitNarrow2}`,
  `GPS DISTANCE ${VOYAGER_FONT_SYMBOLS.circledDigitNarrow2}`,
  `ENGINE TRIP TIME ${VOYAGER_FONT_SYMBOLS.circledDigitNarrow2}`,
  `GPS TRIP TIME ${VOYAGER_FONT_SYMBOLS.circledDigitNarrow2}`,
  `MAX WHEEL SPEED ${VOYAGER_FONT_SYMBOLS.circledDigitNarrow2}`,
  `MAX GPS SPEED ${VOYAGER_FONT_SYMBOLS.circledDigitNarrow2}`,
  `AVG WHEEL SPEED ${VOYAGER_FONT_SYMBOLS.circledDigitNarrow2}`,
  `AVG GPS SPEED ${VOYAGER_FONT_SYMBOLS.circledDigitNarrow2}`,
  "CURRENT (BATTERY CHARGER)",
];

const graphDisplayModal = (trackSlot = 1) => ({
  kind: "settings-modal", section: "graph", title: "GRAPHS DISPLAY", options: ["CURRENT TRACK", "OTHER TRACK", "OTHER ROUTE"],
  selectedIndex: 0, graphDisplay: true, trackSlot, summary: `DISPLAYING: CURRENT TRACK${trackSlot === 2 ? " (TRACK_2)" : ""}`,
});
[
  ["m-graph-temp-primary-display", "eng", 1], ["m-graph-temp-display", "eng2", 1], ["m-graph-temp-track2-display", "eng3", 2],
  ["m-graph-alt-primary-display", "alt", 1], ["m-graph-alt-display", "alt2", 1], ["m-graph-alt-track2-display", "alt3", 2],
].forEach(([id, parent, slot]) => registerOverlay(id, graphDisplayModal(slot), parent));

for (const userScreen of [1, 2]) {
  const layoutId = `m-user-screen-${userScreen}-layout`;
  const screenParent = userScreen === 1 ? "cstm" : "cstm2";
  registerOverlay(layoutId, {
    kind: "user-layout", section: "set", title: `USER SCREEN ${userScreen} LAYOUT`, userScreen, selectedIndex: 0,
  }, screenParent);
  registerOverlay(`m-user-screen-${userScreen}-name`, {
    kind: "keyboard", section: "set", title: `USER SCREEN ${userScreen} NAME`, userScreen, userScreenNameEditor: true,
  }, layoutId);
  registerOverlay(`m-user-screen-${userScreen}-data-block`, {
    kind: "settings-modal", section: "set", title: "CHOOSE READOUT", options: USER_SCREEN_DATA_BLOCKS,
    selectedIndex: userScreen === 1 ? 4 : 8, scroll: true, dataBlockPicker: true, userScreen,
  }, layoutId);
}

for (const [id, parent] of [["m-nav-destination-primary", "dir"], ["m-nav-destination-secondary", "dir2"]]) {
  registerOverlay(id, {
    kind: "settings-modal", section: "main", title: "SELECT DESTINATION WAYPOINT", field: "destinationWaypoint", options: DESTINATION_WAYPOINT_OPTIONS, selectedIndex: 0,
    destinationWaypointPicker: true, titleNarrow: true, outcome: "select-destination",
  }, parent);
}

export const VOYAGER_MENU_STATE_INDEX = Object.freeze(registry);
export const VOYAGER_MENU_TRANSITIONS = Object.freeze(transitionIndex);
export const VOYAGER_MENU_STATE_IDS = new Set(Object.keys(registry));

export const VOYAGER_MENU_STABLE_STATE_ALIASES = {
  "menu.quick": "m-main1-1",
  "menu.main": "m-main1-1",
  "menu.ride": "m-ride2-1",
  "menu.ride.tracks": "m-ride-tracks-1",
  "menu.ride.routes": "m-ride-routes-1",
  "menu.ride.waypoints": "m-ride-waypoints-1",
  "menu.ride.add-waypoint": "m-ride-waypoints-add-1",
  "menu.ride.add-waypoint.current": "m-ride-waypoints-add-1",
  "menu.ride.add-waypoint.coordinates": "m-ride-waypoints-add-2",
  "menu.ride.add-waypoint.crosshair": "m-ride-waypoints-add-3",
  "menu.settings": "m-set3-1",
  "menu.settings.units": "m-set3-2-1",
  "menu.settings.vehicle": "m-set3-3-1",
  "menu.settings.power": "m-set3-4-1",
  "menu.settings.gps": "m-set3-5-1",
  "menu.settings.map": "m-set3-6-1",
  "menu.settings.warning-led": "m-set3-7-1",
  "menu.settings.utility": "m-set3-8-1",
  "modal.reset-ride-distance": "m-main1-4-1",
  "modal.waypoint-select": "m-main1-8-1",
  "modal.graphs.temperature": "m-graph-temp-display",
  "modal.graphs.altitude": "m-graph-alt-display",
  "modal.user-screen-1-layout": "m-user-screen-1-layout",
  "modal.user-screen-2-layout": "m-user-screen-2-layout",
  "modal.user-screen-1-data-block": "m-user-screen-1-data-block",
  "modal.user-screen-2-data-block": "m-user-screen-2-data-block",
  "modal.destination-waypoint": "m-nav-destination-primary",
};

export const VOYAGER_MENU_CANONICAL_STATE_IDS = Object.entries(VOYAGER_MENU_STABLE_STATE_ALIASES)
  .reduce((canonicalIds, [stableId, stateId]) => {
    canonicalIds[stateId] ??= stableId;
    return canonicalIds;
  }, {});

export function voyagerMenuState(stateId) {
  return VOYAGER_MENU_STATE_INDEX[stateId] ?? null;
}
