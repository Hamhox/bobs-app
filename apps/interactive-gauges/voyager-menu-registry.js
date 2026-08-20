import { VOYAGER_FONT_SYMBOLS } from "./voyager-font-symbols.js";

const registry = {};

function register(id, definition) {
  registry[id] = { id, ...definition };
}

function registerMenuFamily(ids, definition, selectedRows = []) {
  ids.forEach((id, index) => register(id, { ...definition, selectedIndex: selectedRows[index] ?? null }));
}

const MAIN_ROWS = [
  { label: "RESET STOP WATCH" },
  { label: "RESET RIDE DST" },
  { spacer: true },
  { label: "QUICK ADD WAYPOINT" },
  { label: "SELECT DESTINATION" },
  { spacer: true },
  { label: "GPS", value: "ENABLED (LOGGING ON)" },
  { label: "SPEED/DST", value: "GPS" },
  { spacer: true },
  { label: "MEMORY", value: "38%", meter: 0.38 },
];

registerMenuFamily(
  ["m-main1-1", "m-main1-2", "m-main1-3", "m-main1-4", "m-main1-5", "m-main1-6", "m-main1-7"],
  { kind: "menu", section: "main", title: "MAIN MENU", rows: MAIN_ROWS },
  [null, 0, 1, 3, 4, 6, 7],
);
register("m-main1-2-1", {
  kind: "confirm", section: "main", title: "RESET STOP WATCH", lines: ["RESET STOP WATCH?"],
});
register("m-main1-3-1", {
  kind: "confirm", section: "main", title: "RESET RIDE DST",
  lines: ["RESET RIDE DST?", "RIDE DST IS ONLY VISIBLE", "FROM USER SCREEN."],
});
register("m-main1-5-1", { kind: "waypoint-map", section: "main", title: "DEST. WAYPOINT: SELECT", mode: "select" });
register("m-main1-5-1-1", { kind: "waypoint-map", section: "main", title: "DEST. WAYPOINT: CONFIRM", mode: "confirm" });
register("m-main1-6-1", {
  kind: "settings-modal", section: "main", title: "GPS",
  options: ["ENABLED (LOGGING ON)", "ENABLED (LOGGING OFF)", "DISABLED (POWER SAVE)"], selectedIndex: 0,
});
register("m-main1-7-1", {
  kind: "settings-modal", section: "main", title: "SPEED/DST SOURCE",
  options: ["WHEEL SENSOR", "GPS"], selectedIndex: 1,
});

const RIDE_ROWS = [
  { label: "RIDE NAME", value: "RIDE-32" },
  { label: "ADD WAYPOINT (CURRENT POS)" },
  { label: "ADD WAYPOINT (LAT/LON)" },
  { label: "ADD WAYPOINT (CROSSHAIR)" },
  { spacer: true },
  { label: "DELETE WAYPOINT" },
  { spacer: true },
  { label: "EDIT RIDES" },
];
registerMenuFamily(
  ["m-ride2-1", "m-ride2-2", "m-ride2-3", "m-ride2-4", "m-ride2-5", "m-ride2-6"],
  { kind: "menu", section: "ride", title: "RIDE MENU", rows: RIDE_ROWS },
  [null, 1, 2, 3, 5, 7],
);
register("m-ride2-2-1", { kind: "waypoint-map", section: "ride", title: "ADD WAYPOINT: CONFIRM", mode: "confirm", pending: "current" });
register("m-ride2-3-1", { kind: "slot-input", section: "ride", title: "ENTER LATITUDE", value: "N45.768892", activeDigit: 3 });
register("m-ride2-3-1-1", { kind: "slot-input", section: "ride", title: "ENTER LONGITUDE", value: "W122.519284", activeDigit: 4 });
register("m-ride2-3-1-1-1", { kind: "waypoint-map", section: "ride", title: "ADD WAYPOINT: CONFIRM", mode: "confirm", pending: "coordinates" });
register("m-ride2-4-1", { kind: "waypoint-map", section: "ride", title: "ADD WAYPOINT: CROSSHAIRS", mode: "crosshair", pending: "crosshair" });
register("m-ride2-4-1-1", { kind: "waypoint-map", section: "ride", title: "ADD WAYPOINT: CONFIRM", mode: "confirm", pending: "crosshair" });
register("m-ride2-5-1", { kind: "waypoint-map", section: "ride", title: "DELETE WAYPOINT: SELECT", mode: "select-delete" });
register("m-ride2-5-1-1", { kind: "waypoint-map", section: "ride", title: "DELETE WAYPOINT: CONFIRM", mode: "confirm-delete" });

const EDIT_RIDE_ROWS = [
  { label: "NEW RIDE (CLEAR CURRENT)" },
  { label: "SAVE RIDE" },
  { spacer: true },
  { label: "CLEAR OVERLAY" },
  { label: "SAVED RIDES" },
];
registerMenuFamily(
  ["m-ride2-6-1", "m-ride2-6-2", "m-ride2-6-3", "m-ride2-6-4"],
  { kind: "panel", section: "ride", title: "EDIT RIDES", rows: EDIT_RIDE_ROWS },
  [0, 1, 3, 4],
);
register("m-ride2-6-1-1", {
  kind: "confirm", section: "ride", title: "NEW RIDE",
  lines: ["START NEW RIDE AND", "DISCARD CURRENT RIDE?", "UNSAVED DATA WILL BE LOST."],
});
register("m-ride2-6-2-1", {
  kind: "confirm", section: "ride", title: "SAVE RIDE",
  lines: ["SAVE CURRENT RIDE AND", "START NEW RIDE?"],
});
register("m-ride2-6-2-1-1", { kind: "keyboard", section: "ride", title: "NAME RIDE", value: "YACOLT RIDE1" });
register("m-ride2-6-2-1-1-1", {
  kind: "notice", section: "ride", title: "RIDE SAVED", lines: ["RIDE-32", "IS SAVED TO", "MEMORY CARD."],
});
register("m-ride2-6-3-1", {
  kind: "confirm", section: "ride", title: "CLEAR OVERLAYED RIDE",
  lines: ["REMOVE OVERLAYED RIDE FROM", "MAP SCREEN. UNSAVED DATA", "WILL NOT BE LOST."],
});

const SAVED_RIDES = ["RIDE-32", "RIDE-33", "MT. ST. HELENS TRIP", "RIDE-35"];
registerMenuFamily(
  ["m-ride2-6-4-1", "m-ride2-6-4-2", "m-ride2-6-4-3", "m-ride2-6-4-4"],
  { kind: "panel", section: "ride", title: "SAVED RIDES", rows: SAVED_RIDES.map((label) => ({ label })) },
  [0, 1, 2, 3],
);
const SAVED_RIDE_ACTIONS = ["RENAME", "CONTINUE", "OVERLAY", "DELETE"];
registerMenuFamily(
  ["m-ride2-6-4-1-1", "m-ride2-6-4-1-2", "m-ride2-6-4-1-3", "m-ride2-6-4-1-4"],
  { kind: "settings-modal", section: "ride", title: "RIDE-32", options: SAVED_RIDE_ACTIONS },
  [0, 1, 2, 3],
);
register("m-ride2-6-4-1-1-1", { kind: "keyboard", section: "ride", title: "RENAME SAVED RIDE", value: "YACOLT RIDE1" });
register("m-ride2-6-4-1-2-1", {
  kind: "confirm", section: "ride", title: "CONTINUE SAVED RIDE",
  lines: ["LOAD RIDE AND", "CONTINUE LOGGING.", "UNSAVED DATA WILL BE LOST."],
});
register("m-ride2-6-4-1-3-1", {
  kind: "confirm", section: "ride", title: "OVERLAY SAVED RIDE",
  lines: ["LOAD RIDE ON", "TOP OF THE CURRENT RIDE", "FOR REFERENCE."],
});
register("m-ride2-6-4-1-4-1", {
  kind: "confirm", section: "ride", title: "DELETE SAVED RIDE", lines: ["RIDE-32", "DELETE SAVED RIDE?"],
});

const SETTINGS_MENU_ROWS = [
  { label: "UNIT SETTINGS" },
  { label: "SYSTEM SETTINGS" },
  { label: "GPS SETTINGS" },
  { label: "USER SCREENS" },
  { label: "WARNING LED LIGHTS" },
];
registerMenuFamily(
  ["m-set3-1", "m-set3-2", "m-set3-3", "m-set3-4", "m-set3-5", "m-set3-6"],
  {
    kind: "menu",
    section: "set",
    title: "SETTINGS MENU",
    rows: SETTINGS_MENU_ROWS,
    titleX: 270,
    rowTop: 73,
    rowSpacing: 42,
    showTitleRule: false,
  },
  [null, 0, 1, 2, 3, 4],
);

const UNIT_ROWS = [
  { label: "SPEED UNITS", value: "MPH" },
  { label: "DISTANCE UNITS", value: "KM" },
  { label: "WHEEL SIZE", value: "2110mm" },
  { label: "CLOCK FORMAT", value: "12 HOUR" },
  { label: "TIME OF DAY", value: "12:35" },
  { label: "TEMP. UNITS", value: "CELCIUS" },
  { spacer: true },
  { label: "RESTORE DEFAULTS" },
];
registerMenuFamily(
  ["m-set3-2-1", "m-set3-2-2", "m-set3-2-3", "m-set3-2-4", "m-set3-2-5", "m-set3-2-6", "m-set3-2-7"],
  { kind: "panel", section: "set", title: "UNIT SETTINGS", rows: UNIT_ROWS },
  [0, 1, 2, 3, 4, 5, 7],
);
register("m-set3-2-1-1", { kind: "settings-modal", section: "set", title: "SPEED UNITS", options: ["KM/H", "MPH"], selectedIndex: 1 });
register("m-set3-2-2-1", { kind: "settings-modal", section: "set", title: "DISTANCE UNITS", options: ["KILOMETERS / METERS", "MILES / FEET"], selectedIndex: 0 });
register("m-set3-2-3-1", { kind: "slot-input", section: "set", title: "WHEEL SIZE", value: "1676 mm", activeDigit: 1, note: ["MOTORCYCLE: 2110mm", "ATV: 1675mm"] });
register("m-set3-2-4-1", { kind: "settings-modal", section: "set", title: "CLOCK FORMAT", options: ["12 HOUR", "24 HOUR"], selectedIndex: 0 });
register("m-set3-2-5-1", { kind: "slot-input", section: "set", title: "TIME OF DAY", value: "12:35", activeDigit: 1 });
register("m-set3-2-6-1", { kind: "settings-modal", section: "set", title: "TEMPERATURE UNITS", options: ["CELCIUS", "FAHRENHEIT"], selectedIndex: 0 });

const SYSTEM_ROWS = [
  { label: "BRIGHTNESS", value: "50%" },
  { label: "BACKLIGHT (BAT)", value: "10 SEC" },
  { label: "BACKLIGHT (EXT)", value: "ALWAYS ON" },
  { label: "SAFE MODE TIMER", value: "20 SEC" },
  { label: "SLEEP MODE TIMER", value: "30 MIN" },
  { label: "CHARGE MODE", value: "MOTOR ON" },
  { label: "CHARGE LEVEL", value: "TRICKLE" },
  { spacer: true },
  { label: "RESTORE DEFAULTS" },
];
registerMenuFamily(
  ["m-set3-3-1", "m-set3-3-2", "m-set3-3-3", "m-set3-3-4", "m-set3-3-5", "m-set3-3-6", "m-set3-3-7", "m-set3-3-8"],
  { kind: "panel", section: "set", title: "SYSTEM SETTINGS", rows: SYSTEM_ROWS },
  [0, 1, 2, 3, 4, 5, 6, 8],
);
register("m-set3-3-1-1", { kind: "brightness", section: "set", title: "BRIGHTNESS", value: 50 });
register("m-set3-3-2-1", { kind: "slot-input", section: "set", title: "BACKLIGHT (BATTERY)", value: "007 SEC", activeDigit: 2, note: ["SECONDS BACKLIGHT LIGHTS", "WHEN USING INTERNAL BATTERY", "DEFAULT: 7 SEC"] });
register("m-set3-3-3-1", { kind: "slot-input", section: "set", title: "BACKLIGHT (EXTERNAL)", value: "000 SEC", activeDigit: 2, note: ["SECONDS BACKLIGHT LIGHTS", "WHEN USING EXTERNAL POWER", "DEFAULT: ALWAYS ON (0 SEC)"] });
register("m-set3-3-4-1", { kind: "slot-input", section: "set", title: "SAFE MODE TIMER", value: "020 SEC", activeDigit: 1, note: ["SECONDS UNTIL TABS HIDE", "DEFAULT: 20 SEC", "NEVER HIDE: 0 SEC"] });
register("m-set3-3-5-1", { kind: "slot-input", section: "set", title: "SLEEP MODE TIMER", value: "05 MIN", activeDigit: 1, note: ["MINUTES UNTIL SLEEP MODE", "AFTER LAST SENSOR INPUT", "DEFAULT: 5 MIN"] });
register("m-set3-3-6-1", { kind: "settings-modal", section: "set", title: "CHARGE MODE", options: ["ONLY WHEN MOTOR IS ON", "ALWAYS CHARGE", "OFF"], selectedIndex: 0, note: "DEFAULT: MOTOR ON" });
register("m-set3-3-7-1", { kind: "settings-modal", section: "set", title: "CHARGE LEVEL", options: ["TRICKLE CHARGE", "FAST CHARGE"], selectedIndex: 0, note: "USE TRICKLE IF POWER SUPPLY IS LIMITED." });

const GPS_ROWS = [
  { label: "MAP ORIENTATION", value: "NORTH UP" },
  { label: "MAP AUTO-ZOOM", value: "ON" },
  { label: "LOG AFTER STOP", value: "30 SEC" },
  { label: "RECORD METHOD", value: "DISTANCE" },
  { label: "WRAP WHEN FULL", value: "YES" },
  { label: "SAMPLE FREQUENCY", value: "NORMAL" },
  { spacer: true },
  { label: "RESTORE DEFAULTS" },
];
registerMenuFamily(
  ["m-set3-4-1", "m-set3-4-2", "m-set3-4-3", "m-set3-4-4", "m-set3-4-5", "m-set3-4-6", "m-set3-4-7"],
  { kind: "panel", section: "set", title: "GPS SETTINGS", rows: GPS_ROWS },
  [0, 1, 2, 3, 4, 5, 7],
);
register("m-set3-4-1-1", { kind: "settings-modal", section: "set", title: "MAP ORIENTATION", options: ["TRACK UP", "NORTH UP"], selectedIndex: 1, note: "TRACK UP ROTATES MAP. NORTH UP ROTATES POSITION." });
register("m-set3-4-2-1", { kind: "settings-modal", section: "set", title: "MAP AUTO-ZOOM", options: ["ON", "OFF"], selectedIndex: 0, note: "AUTO PAN AND ZOOM MAP TO KEEP RIDE ON THE SCREEN." });
register("m-set3-4-3-1", { kind: "slot-input", section: "set", title: "LOG AFTER STOP", value: "030 SEC", activeDigit: 1, note: ["CONSERVE POWER", "DEFAULT: 30 SEC"] });
register("m-set3-4-4-1", { kind: "settings-modal", section: "set", title: "RECORD METHOD", options: ["TIME", "DISTANCE"], selectedIndex: 1, note: "METHOD FOR GATHERING LOG POINTS." });
register("m-set3-4-5-1", { kind: "settings-modal", section: "set", title: "WRAP WHEN FULL", options: ["WRAP WHEN FULL", "STOP LOGGING WHEN FULL"], selectedIndex: 0, note: "WRAP OVERWRITES BEGINNING." });
register("m-set3-4-6-1", { kind: "settings-modal", section: "set", title: "SAMPLE FREQUENCY", options: ["FAST", "NORMAL", "SLOW"], selectedIndex: 1, note: "CONSERVE MEMORY SPACE" });

const USER_SCREEN_ROWS = [
  { label: "USER SCREEN 1 SETTINGS" },
  { label: "USER SCREEN 2 SETTINGS" },
  { spacer: true },
  { label: "RESTORE DEFAULTS" },
];
registerMenuFamily(
  ["m-set3-5-1", "m-set3-5-2", "m-set3-5-3"],
  { kind: "panel", section: "set", title: "USER SCREENS", rows: USER_SCREEN_ROWS },
  [0, 1, 3],
);
const USER_SCREEN_SETTINGS = [
  { label: "SCREEN NAME", value: "KELLY'S SCREEN" },
  { spacer: true },
  { label: "NUMBER OF BLOCKS", value: "4" },
  { label: "BLOCK 1", value: "WHEEL SPD" },
  { label: "BLOCK 2", value: "GPS SPD" },
  { label: "BLOCK 3", value: "DST" },
  { label: "BLOCK 4", value: "TRIP DST" },
  { spacer: true },
  { label: "RESTORE DEFAULTS" },
];

const dataBlockVariant = (label, digit) => `${label} ${digit === 1
  ? VOYAGER_FONT_SYMBOLS.circledDigitNarrow1
  : VOYAGER_FONT_SYMBOLS.circledDigitNarrow2}`;

const USER_SCREEN_DATA_BLOCKS = [
  "<OFF>",
  "ALTITUDE",
  "MIN ALTITUDE",
  "MAX ALTITUDE",
  "WHEEL SPEED",
  "GPS SPEED",
  "WHEEL ODOMETER",
  "GPS ODOMETER",
  "ENGINE ACC. RUN TIME",
  "GPS ACC. RUN TIME",
  "AIR TEMPERATURE",
  "ENGINE TEMPERATURE",
  "MAX ENGINE TEMPERATURE",
  "AVG ENGINE TEMPERATURE",
  "CLOCK",
  "STOP WATCH",
  "HEADING",
  "COMPASS DIRECTION",
  "INPUT VOLTAGE",
  "INTERNAL BATTERY VOLTAGE",
  "TACHOMETER",
  dataBlockVariant("WHEEL DISTANCE", 1),
  dataBlockVariant("GPS DISTANCE", 1),
  dataBlockVariant("ENGINE TRIP TIME", 1),
  dataBlockVariant("GPS TRIP TIME", 1),
  dataBlockVariant("MAX WHEEL SPEED", 1),
  dataBlockVariant("MAX GPS SPEED", 1),
  dataBlockVariant("AVG WHEEL SPEED", 1),
  dataBlockVariant("AVG GPS SPEED", 1),
  dataBlockVariant("WHEEL DISTANCE", 2),
  dataBlockVariant("GPS DISTANCE", 2),
  dataBlockVariant("ENGINE TRIP TIME", 2),
  dataBlockVariant("GPS TRIP TIME", 2),
  dataBlockVariant("MAX WHEEL SPEED", 2),
  dataBlockVariant("MAX GPS SPEED", 2),
  dataBlockVariant("AVG WHEEL SPEED", 2),
  dataBlockVariant("AVG GPS SPEED", 2),
  "CURRENT (BATTERY CHARGER)",
];
registerMenuFamily(
  ["m-set3-5-1-1", "m-set3-5-1-2", "m-set3-5-1-3", "m-set3-5-1-4", "m-set3-5-1-5", "m-set3-5-1-6", "m-set3-5-1-7"],
  { kind: "panel", section: "set", title: "USER SCREEN 1 SETTINGS", rows: USER_SCREEN_SETTINGS, compact: true },
  [0, 2, 3, 4, 5, 6, 8],
);
register("m-set3-5-1-1-1", { kind: "keyboard", section: "set", title: "USER SCREEN 1 TITLE", value: "KELLY'S SCREEN" });
register("m-set3-5-1-2-1", { kind: "settings-modal", section: "set", title: "NUMBER OF BLOCKS", options: ["1", "2", "3", "4"], selectedIndex: 0, note: "NUMBER OF DATA BLOCKS TO DISPLAY ON USER SCREEN" });
register("m-set3-5-1-3-1", { kind: "settings-modal", section: "set", title: "BLOCK 1", options: USER_SCREEN_DATA_BLOCKS, selectedIndex: 4, scroll: true, note: "DATA TO DISPLAY ON BLOCK 1." });

const WARNING_ROWS = [
  { label: "YELLOW LED ON", value: "210°F" },
  { label: "RED LED ON", value: "220°F" },
  { spacer: true },
  { label: "YELLOW LED FLASH", value: "240°F" },
  { label: "RED LED FLASH", value: "240°F" },
  { spacer: true },
  { label: "RESTORE DEFAULTS" },
];
registerMenuFamily(
  ["m-set3-6-1", "m-set3-6-2", "m-set3-6-3", "m-set3-6-4", "m-set3-6-5"],
  { kind: "panel", section: "set", title: "WARNING LED LIGHTS", rows: WARNING_ROWS },
  [0, 1, 3, 4, 6],
);
register("m-set3-6-1-1", { kind: "slot-input", section: "set", title: "YELLOW LED ON", value: "210 °F", activeDigit: 1, note: ["LIGHTS LEFT YELLOW LED WHEN", "EXCEEDED. DEFAULT: 210°F"] });
register("m-set3-6-2-1", { kind: "slot-input", section: "set", title: "RED LED ON", value: "220 °F", activeDigit: 1, note: ["LIGHTS RIGHT RED LED WHEN", "EXCEEDED. DEFAULT: 220°F"] });
register("m-set3-6-3-1", { kind: "slot-input", section: "set", title: "YELLOW LED FLASH", value: "240 °F", activeDigit: 1, note: ["FLASH LEFT YELLOW LED WHEN", "EXCEEDED. DEFAULT: 240°F"] });
register("m-set3-6-4-1", { kind: "slot-input", section: "set", title: "RED LED FLASH", value: "240 °F", activeDigit: 1, note: ["FLASH RIGHT RED LED WHEN", "EXCEEDED. DEFAULT: 240°F"] });

register("m-graph-temp-display", {
  kind: "settings-modal",
  section: "graph",
  title: "GRAPHS DISPLAY",
  options: ["ENGINE TEMPERATURE", "ALTITUDE"],
  selectedIndex: 0,
  note: "ENTER SWITCHES GRAPH. BACK RETURNS TO GRAPH.",
});
register("m-graph-alt-display", {
  kind: "settings-modal",
  section: "graph",
  title: "GRAPHS DISPLAY",
  options: ["ENGINE TEMPERATURE", "ALTITUDE"],
  selectedIndex: 1,
  note: "ENTER SWITCHES GRAPH. BACK RETURNS TO GRAPH.",
});

const OVERLAY_KINDS = new Set([
  "brightness",
  "confirm",
  "keyboard",
  "notice",
  "settings-modal",
  "slot-input",
]);

function inferredParentStateId(stateId) {
  if (stateId === "m-graph-temp-display") return "eng2";
  if (stateId === "m-graph-alt-display") return "alt2";
  const parts = stateId.split("-");
  while (parts.length > 2) {
    parts.pop();
    const candidate = parts.join("-");
    if (registry[candidate]) return candidate;
  }
  return null;
}

for (const definition of Object.values(registry)) {
  definition.presentation = OVERLAY_KINDS.has(definition.kind)
    ? "overlay"
    : definition.kind === "waypoint-map"
      ? "workflow"
      : "page";
  definition.parentStateId = inferredParentStateId(definition.id);
}

export const VOYAGER_MENU_STATE_INDEX = Object.freeze(registry);
export const VOYAGER_MENU_STATE_IDS = new Set(Object.keys(registry));

export const VOYAGER_MENU_STABLE_STATE_ALIASES = {
  "menu.main": "m-main1-1",
  "menu.ride": "m-ride2-1",
  "menu.ride.add-waypoint": "m-ride2-2",
  "menu.ride.add-waypoint.current": "m-ride2-2",
  "menu.ride.add-waypoint.coordinates": "m-ride2-3",
  "menu.ride.add-waypoint.crosshair": "m-ride2-4",
  "menu.settings": "m-set3-1",
  "menu.settings.units": "m-set3-2-1",
  "menu.settings.system": "m-set3-3-1",
  "menu.settings.gps": "m-set3-4-1",
  "menu.settings.user-screens": "m-set3-5-1",
  "menu.settings.warning-led": "m-set3-6-1",
  "modal.reset-ride-distance": "m-main1-3-1",
  "modal.waypoint-select": "m-main1-5-1",
  "modal.system-brightness": "m-set3-3-1-1",
  "modal.system.brightness": "m-set3-3-1-1",
  "modal.graphs.temperature": "m-graph-temp-display",
  "modal.graphs.altitude": "m-graph-alt-display",
};

export const VOYAGER_MENU_CANONICAL_STATE_IDS = Object.entries(
  VOYAGER_MENU_STABLE_STATE_ALIASES,
).reduce((canonicalIds, [stableId, stateId]) => {
  canonicalIds[stateId] ??= stableId;
  return canonicalIds;
}, {});

export function voyagerMenuState(stateId) {
  return VOYAGER_MENU_STATE_INDEX[stateId] ?? null;
}
