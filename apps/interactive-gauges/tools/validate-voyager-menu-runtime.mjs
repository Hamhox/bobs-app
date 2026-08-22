#!/usr/bin/env node

import {
  VOYAGER_MENU_STATE_INDEX,
  VOYAGER_MENU_TRANSITIONS,
} from "../voyager-menu-registry.js";
import { VOYAGER_FONT_SYMBOLS } from "../voyager-font-symbols.js";
import { VOYAGER_KEYBOARD_ROWS, VoyagerMenuModel } from "../voyager-menu-model.js";
import { renderVoyagerMenuMarkup, renderVoyagerToastMarkup } from "../voyager-menu-renderer.js";
import {
  formatVoyagerDestinationDistance,
  voyagerDestinationTextLength,
} from "../voyager-live-runtime.js";

const EXPECTED_COUNTS = Object.freeze({
  total: 201,
  pages: 102,
  workflows: 6,
  overlays: 93,
  menuOverlays: 87,
});
const EDITOR_ACTIONS = ["up", "down", "left", "right", "center", "back", "enter"];

function renderDefinition(definition, model, visited = new Set()) {
  if (visited.has(definition.id)) throw new Error(`Underlay cycle detected at ${definition.id}`);
  visited.add(definition.id);
  const resolved = model.resolve(definition);
  if (resolved.presentation !== "overlay") return renderVoyagerMenuMarkup(resolved);

  const parent = VOYAGER_MENU_STATE_INDEX[resolved.parentStateId];
  const underlayMarkup = parent
    ? renderDefinition(parent, model, visited)
    : '<rect class="voyager-live__surface" width="504" height="303" />';
  return renderVoyagerMenuMarkup(resolved, { underlayMarkup });
}

function main() {
  const definitions = Object.values(VOYAGER_MENU_STATE_INDEX);
  const report = {
    total: definitions.length,
    pages: definitions.filter(({ presentation }) => presentation === "page").length,
    workflows: definitions.filter(({ presentation }) => presentation === "workflow").length,
    overlays: definitions.filter(({ presentation }) => presentation === "overlay").length,
    menuOverlays: definitions.filter(({ presentation, section }) => presentation === "overlay" && section !== "graph").length,
  };

  for (const [key, expected] of Object.entries(EXPECTED_COUNTS)) {
    if (report[key] !== expected) throw new Error(`${key}: received ${report[key]}, expected ${expected}`);
  }

  for (const definition of definitions) {
    if (!definition.presentation) throw new Error(`${definition.id} has no presentation type`);
    if (definition.presentation === "overlay" && !definition.parentStateId) {
      throw new Error(`${definition.id} has no overlay parent`);
    }
    for (const [action, target] of Object.entries(VOYAGER_MENU_TRANSITIONS[definition.id] ?? {})) {
      if (target !== null && !VOYAGER_MENU_STATE_INDEX[target] && !["index", "eng", "eng2", "eng3", "alt", "alt2", "alt3", "cstm", "cstm2", "dir", "dir2"].includes(target)) {
        throw new Error(`${definition.id}.${action} references missing state ${target}`);
      }
    }

    const model = new VoyagerMenuModel();
    const markup = renderDefinition(definition, model);
    if (!markup.includes("voyager-live__surface")) throw new Error(`${definition.id} has no rendered surface`);
    if (definition.presentation === "overlay") {
      if (!markup.includes(`data-menu-overlay="${definition.id}"`)) throw new Error(`${definition.id} has no overlay marker`);
      if (!markup.includes(`data-menu-parent="${definition.parentStateId}"`)) throw new Error(`${definition.id} has no parent marker`);
    }

    for (const action of EDITOR_ACTIONS) {
      const result = model.prepareInput(definition, action);
      if (!result?.action) throw new Error(`${definition.id}.${action} did not resolve an input action`);
      renderDefinition(definition, model);
    }
  }

  const dataBlockSelector = VOYAGER_MENU_STATE_INDEX["m-user-screen-1-data-block"];
  if (dataBlockSelector.options.length !== 38) {
    throw new Error(`data-block options: received ${dataBlockSelector.options.length}, expected 38`);
  }
  if (!dataBlockSelector.options.some((option) => option.includes("\uE10B"))) {
    throw new Error("data-block options are missing the v1.003 circled 2 glyph");
  }

  if (VOYAGER_KEYBOARD_ROWS.length !== 4 || VOYAGER_KEYBOARD_ROWS.some((row) => row.length !== 13)) {
    throw new Error("keyboard is not a full four-by-thirteen device grid");
  }
  const expectedKeyboardRows = [
    "1234567890-+BACKSPACE",
    "QWERTYUIOP_°\\",
    "ASDFGHJKL:',.",
    "ZXCVBNMSPACE()BACKFORWARDDELETE",
  ];
  if (VOYAGER_KEYBOARD_ROWS.some((row, index) => row.join("") !== expectedKeyboardRows[index])) {
    throw new Error("keyboard character map no longer matches the device");
  }
  const scrollModel = new VoyagerMenuModel();
  for (let index = 0; index < 12; index += 1) scrollModel.prepareInput(dataBlockSelector, "down");
  const scrolledMarkup = renderDefinition(dataBlockSelector, scrollModel);
  if (!scrolledMarkup.includes('data-menu-option="16" data-menu-option-selected="true"')) {
    throw new Error("scrolling data-block selector did not keep the active option visible");
  }

  const selectedMenuMarkup = renderDefinition(VOYAGER_MENU_STATE_INDEX["m-set3-2"], new VoyagerMenuModel());
  if (!selectedMenuMarkup.includes('class="voyager-menu__selection" x="68"')) {
    throw new Error("top-level menu selection does not span the content pane");
  }
  const panelMarkup = renderDefinition(VOYAGER_MENU_STATE_INDEX["m-set3-2-1"], new VoyagerMenuModel());
  if (!panelMarkup.includes("voyager-menu__panel-shadow") || !panelMarkup.includes("voyager-menu__title-band")) {
    throw new Error("nested menu panel is missing its device frame primitives");
  }
  if (!panelMarkup.includes('class="voyager-menu__selection" x="45"')) {
    throw new Error("nested menu selection does not span the inner panel");
  }
  const memoryDefinition = VOYAGER_MENU_STATE_INDEX["m-ride-memory-1"];
  const memoryMarkup = renderDefinition(memoryDefinition, new VoyagerMenuModel());
  const memoryTransitions = VOYAGER_MENU_TRANSITIONS[memoryDefinition.id];
  if (memoryMarkup.includes("TRACK MEMORY")
    || memoryMarkup.includes("ROUTE MEMORY")
    || !memoryMarkup.includes("3 / 300")
    || !memoryMarkup.includes("4 / 300")
    || !memoryMarkup.includes("9 / 300")
    || !memoryMarkup.includes("31%")
    || !memoryMarkup.includes("17%")
    || (memoryMarkup.match(/voyager-menu__selection/g) ?? []).length !== 1
    || !memoryMarkup.includes('class="voyager-menu__panel" x="55" y="18" width="400" height="267"')
    || memoryTransitions.up !== memoryDefinition.id
    || memoryTransitions.down !== memoryDefinition.id
    || memoryTransitions.enter !== "m-ride-memory-reset") {
    throw new Error("memory panel no longer keeps its meters static and Reset Ride Memory actionable");
  }
  const modalMarkup = renderDefinition(VOYAGER_MENU_STATE_INDEX["m-set3-2-units"], new VoyagerMenuModel());
  if (!modalMarkup.includes("voyager-menu__modal-shadow") || !modalMarkup.includes("voyager-menu__title-band")) {
    throw new Error("settings modal is missing its device frame primitives");
  }
  if (!modalMarkup.includes("voyager-menu__underlay-wash")) {
    throw new Error("settings modal is missing its flat backlight wash");
  }
  if (!modalMarkup.includes('class="voyager-menu__selection" x="83"')) {
    throw new Error("settings selection does not span the inner modal");
  }

  const transferMarkup = renderDefinition(VOYAGER_MENU_STATE_INDEX["m-ride-transfer-2"], new VoyagerMenuModel());
  if (!transferMarkup.includes(`${VOYAGER_FONT_SYMBOLS.play} IMPORT SETTINGS`)
    || !transferMarkup.includes(`${VOYAGER_FONT_SYMBOLS.play} EXPORT SETTINGS`)
    || transferMarkup.includes("&gt;</text>")) {
    throw new Error("ride transfer submenu rows do not use the device play symbol");
  }
  const trackRows = VOYAGER_MENU_STATE_INDEX["m-ride-tracks-1"].rows;
  const routeRows = VOYAGER_MENU_STATE_INDEX["m-ride-routes-1"].rows;
  const waypointRows = VOYAGER_MENU_STATE_INDEX["m-ride-waypoints-1"].rows;
  if (trackRows[2].label !== "START NEW TRACK SEGMENT" || !trackRows[3].spacer
    || routeRows[1].label !== "RENAME A ROUTE" || !routeRows[2].spacer
    || waypointRows[1].label !== "RENAME A WAYPOINT" || !waypointRows[2].spacer) {
    throw new Error("track, route, or waypoint menu grouping is incomplete");
  }
  const waypointMarkup = renderDefinition(VOYAGER_MENU_STATE_INDEX["m-ride-waypoints-5"], new VoyagerMenuModel());
  if (!waypointMarkup.includes(`${VOYAGER_FONT_SYMBOLS.play} ADD WAYPOINT`)
    || !waypointMarkup.includes(`${VOYAGER_FONT_SYMBOLS.play} ERASE WAYPOINT(S)`)
    || waypointMarkup.includes("&gt;</text>")) {
    throw new Error("waypoint submenu rows do not use the device play symbol");
  }
  const readingDefinition = VOYAGER_MENU_STATE_INDEX["m-ride-import-reading"];
  const readingMarkup = renderDefinition(readingDefinition, new VoyagerMenuModel());
  if (!readingMarkup.includes("READING CARD...")
    || !readingMarkup.includes("voyager-menu__toast")
    || readingMarkup.includes("voyager-menu__underlay-wash")
    || readingDefinition.autoTransition?.target !== "m-ride-import-file"
    || VOYAGER_MENU_TRANSITIONS["m-ride-transfer-1"].enter !== "m-ride-import-reading") {
    throw new Error("ride import no longer pauses at the reading-card toast before the file browser");
  }
  const importOptionsMarkup = renderDefinition(VOYAGER_MENU_STATE_INDEX["m-ride-import-settings"], new VoyagerMenuModel());
  for (const expected of ["IMPORT OPTIONS", "FILE TYPE", "ALL", "TRACKS", "AS TRACKS", "ROUTES", "AS ROUTES", "WAYPOINTS", "ON", "RESOLUTION", "FULL"]) {
    if (!importOptionsMarkup.includes(expected)) throw new Error(`import options modal is missing ${expected}`);
  }
  if (importOptionsMarkup.includes("radio-16pt")) {
    throw new Error("import options modal incorrectly renders as a radio list");
  }
  const exportProgressMarkup = renderDefinition(VOYAGER_MENU_STATE_INDEX["m-ride-export-progress"], new VoyagerMenuModel());
  if (!exportProgressMarkup.includes("EXPORT GPX")
    || !exportProgressMarkup.includes("WRITING FILE...")
    || !exportProgressMarkup.includes("voyager-menu__progress-track")
    || !exportProgressMarkup.includes("voyager-menu__progress-fill")) {
    throw new Error("ride export progress modal is incomplete");
  }
  const exportOptionsMarkup = renderDefinition(VOYAGER_MENU_STATE_INDEX["m-ride-export-settings"], new VoyagerMenuModel());
  for (const expected of ["EXPORT OPTIONS", "FILE TYPE", "GPX", "TRACKS", "AS TRACKS", "ROUTES", "AS ROUTES", "WAYPOINTS", "ON", "RESOLUTION", "FULL"]) {
    if (!exportOptionsMarkup.includes(expected)) throw new Error(`export options modal is missing ${expected}`);
  }
  if (exportOptionsMarkup.includes("radio-16pt")) {
    throw new Error("export options modal incorrectly renders as a radio list");
  }

  for (const stateId of ["m-main1-3-1", "m-ride-reset-memory", "m-ride-memory-reset"]) {
    const resetMemory = VOYAGER_MENU_STATE_INDEX[stateId];
    if (resetMemory.lines[0] !== "ERASE ALL"
      || resetMemory.lines[1] !== "TRACKS/ROUTES/WAYPOINTS"
      || !resetMemory.lines[2].includes(VOYAGER_FONT_SYMBOLS.circledDigitNarrow1)
      || !resetMemory.lines[2].includes(VOYAGER_FONT_SYMBOLS.circledDigitNarrow2)
      || resetMemory.lines.join(" ").includes("(1)")) {
      throw new Error(`${stateId} does not use the device reset-memory copy and screen indicators`);
    }
  }
  const resetTrip1 = VOYAGER_MENU_STATE_INDEX["m-ride-reset-trip-1"];
  const resetTrip2 = VOYAGER_MENU_STATE_INDEX["m-ride-reset-trip-2"];
  const resetStopwatch = VOYAGER_MENU_STATE_INDEX["m-ride-reset-stopwatch"];
  if (!resetTrip1.lines[1].includes(VOYAGER_FONT_SYMBOLS.circledDigitNarrow1)
    || resetTrip1.lines[2] !== "FROM MAIN & USER SCREEN)") {
    throw new Error("trip-distance 1 reset copy is incomplete");
  }
  if (!resetTrip2.title.includes(VOYAGER_FONT_SYMBOLS.circledDigitNarrow2)
    || !resetTrip2.lines[1].includes(VOYAGER_FONT_SYMBOLS.circledDigitNarrow2)
    || resetTrip2.lines[2] !== "ONLY FROM USER SCREEN)") {
    throw new Error("trip-distance 2 reset copy is incomplete");
  }
  if (resetStopwatch.lines.join("|") !== "RESET|STOP|WATCH?") {
    throw new Error("stopwatch reset copy is not split across three lines");
  }

  const quickMenuMarkup = renderDefinition(VOYAGER_MENU_STATE_INDEX["m-main1-1"], new VoyagerMenuModel());
  if (!quickMenuMarkup.includes("QUICK MENU") || !quickMenuMarkup.includes(">QUICK</text>")) {
    throw new Error("quick menu naming is not reflected in the title and persistent sidebar");
  }
  const waypointToastMarkup = renderVoyagerToastMarkup("Waypoint 7 added.");
  if (!waypointToastMarkup.includes("Waypoint 7 added.")
    || !waypointToastMarkup.includes("voyager-menu__modal-shadow")
    || !waypointToastMarkup.includes("voyager-menu__modal")
    || waypointToastMarkup.includes("voyager-menu__title-band")
    || waypointToastMarkup.includes("voyager-menu__underlay-wash")) {
    throw new Error("quick-add waypoint toast is not the compact device notice");
  }
  const destinationToastMarkup = renderVoyagerToastMarkup(["WAYPOINT SELECTED", "CMRA Trail Head"]);
  if (!destinationToastMarkup.includes("WAYPOINT SELECTED")
    || !destinationToastMarkup.includes("CMRA Trail Head")
    || (destinationToastMarkup.match(/voyager-menu__toast-copy/g) ?? []).length !== 2) {
    throw new Error("destination waypoint toast is not a two-line device notice");
  }
  if (formatVoyagerDestinationDistance(3_270_000, false) !== "2032") {
    throw new Error("imperial destination distance is not converted from meters to miles");
  }
  if (voyagerDestinationTextLength("1234567") !== null
    || voyagerDestinationTextLength("12345678") !== 196) {
    throw new Error("destination distance no longer caps values beyond seven characters");
  }
  const graphDisplayMarkup = renderDefinition(VOYAGER_MENU_STATE_INDEX["m-graph-temp-display"], new VoyagerMenuModel());
  if (!graphDisplayMarkup.includes("CURRENT TRACK") || !graphDisplayMarkup.includes("voyager-menu__summary")) {
    throw new Error("graph display modal is missing its source choices or displaying summary");
  }
  const userLayoutMarkup = renderDefinition(VOYAGER_MENU_STATE_INDEX["m-user-screen-1-layout"], new VoyagerMenuModel());
  if (!userLayoutMarkup.includes("USER SCREEN 1 LAYOUT")
    || userLayoutMarkup.includes("USER NAME")
    || !userLayoutMarkup.includes('text-anchor="middle">USER SCREEN 1</text>')
    || !userLayoutMarkup.includes("WHEEL SPD")
    || !userLayoutMarkup.includes("btn-cancel-disabled")
    || !userLayoutMarkup.includes("btn-ok-disabled")) {
    throw new Error("user screen layout modal is incomplete");
  }
  const dataBlockMarkup = renderDefinition(VOYAGER_MENU_STATE_INDEX["m-user-screen-1-data-block"], new VoyagerMenuModel());
  if (!dataBlockMarkup.includes("CHOOSE READOUT") || !dataBlockMarkup.includes("WHEEL SPEED")) {
    throw new Error("user screen data-block picker is incomplete");
  }

  const layoutDefinition = VOYAGER_MENU_STATE_INDEX["m-user-screen-1-layout"];
  const pickerDefinition = VOYAGER_MENU_STATE_INDEX["m-user-screen-1-data-block"];
  const stagedLayoutModel = new VoyagerMenuModel();
  stagedLayoutModel.prepareInput(layoutDefinition, "down");
  stagedLayoutModel.prepareInput(pickerDefinition, "down");
  stagedLayoutModel.prepareInput(pickerDefinition, "enter");
  if (stagedLayoutModel.values.userScreen1Block1 !== "WHEEL SPEED") {
    throw new Error("user layout picker committed before OK");
  }
  stagedLayoutModel.prepareInput(layoutDefinition, "up");
  stagedLayoutModel.prepareInput(layoutDefinition, "up");
  const cancelAction = stagedLayoutModel.prepareInput(layoutDefinition, "enter");
  if (cancelAction.targetStateId !== "cstm" || stagedLayoutModel.values.userScreen1Block1 !== "WHEEL SPEED") {
    throw new Error("user layout Cancel did not discard staged changes");
  }

  const committedLayoutModel = new VoyagerMenuModel();
  committedLayoutModel.prepareInput(layoutDefinition, "down");
  committedLayoutModel.prepareInput(pickerDefinition, "down");
  committedLayoutModel.prepareInput(pickerDefinition, "enter");
  committedLayoutModel.prepareInput(layoutDefinition, "up");
  committedLayoutModel.prepareInput(layoutDefinition, "up");
  committedLayoutModel.prepareInput(layoutDefinition, "right");
  const okAction = committedLayoutModel.prepareInput(layoutDefinition, "enter");
  if (okAction.targetStateId !== "cstm" || committedLayoutModel.values.userScreen1Block1 === "WHEEL SPEED") {
    throw new Error("user layout OK did not commit staged changes");
  }
  const destinationMarkup = renderDefinition(VOYAGER_MENU_STATE_INDEX["m-nav-destination-primary"], new VoyagerMenuModel());
  if (!destinationMarkup.includes("SELECT DESTINATION WAYPOINT")
    || !destinationMarkup.includes("CMRA TRAIL HEAD")
    || !destinationMarkup.includes("CIRCLE E CAMP")
    || !destinationMarkup.includes("circle-digit-black")
    || !destinationMarkup.includes("voyager-menu__title--narrow")
    || !destinationMarkup.includes('class="voyager-menu__modal" x="67" y="49" width="370"')
    || !destinationMarkup.includes('class="voyager-menu__selection" x="73"')
    || destinationMarkup.includes("radio-16pt")) {
    throw new Error("navigation destination modal is incomplete");
  }

  const pageCenterAction = new VoyagerMenuModel().prepareInput(
    VOYAGER_MENU_STATE_INDEX["m-set3-2"],
    "center",
  );
  if (pageCenterAction.action !== "enter") {
    throw new Error("center does not activate the selected menu row");
  }
  const radioCenterAction = new VoyagerMenuModel().prepareInput(
    VOYAGER_MENU_STATE_INDEX["m-set3-2-units"],
    "center",
  );
  if (radioCenterAction.action !== "enter") {
    throw new Error("center does not commit the selected radio option");
  }
  const editorCenterAction = new VoyagerMenuModel().prepareInput(
    VOYAGER_MENU_STATE_INDEX["m-set3-2-time"],
    "center",
  );
  if (editorCenterAction.action !== "center") {
    throw new Error("center no longer retains its digit-editor behavior");
  }

  const directToggleCases = [
    ["m-set3-2-1", "distanceUnits", "KILOMETERS"],
    ["m-set3-2-2", "altitudeUnits", "METERS"],
    ["m-set3-2-3", "temperatureUnits", "CELSIUS"],
    ["m-set3-2-4", "clockFormat", "24 HOUR"],
    ["m-set3-2-7", "displayMode", "INVERTED"],
  ];
  for (const [stateId, field, expected] of directToggleCases) {
    const toggleModel = new VoyagerMenuModel();
    toggleModel.prepareInput(VOYAGER_MENU_STATE_INDEX[stateId], "enter");
    if (toggleModel.values[field] !== expected || VOYAGER_MENU_TRANSITIONS[stateId].enter !== stateId) {
      throw new Error(`${stateId} does not toggle ${field} directly in Unit Settings`);
    }
  }

  const vehicleDirectToggleCases = [
    ["m-set3-3-1", "wheelSensor", "DISABLED"],
    ["m-set3-3-3", "engineSensor", "DISABLED"],
    ["m-set3-3-5", "sensorSensitivity", "HIGH"],
    ["m-set3-3-7", "speedSource", "GPS"],
    ["m-set3-3-8", "runTimeSource", "GPS"],
  ];
  for (const [stateId, field, expected] of vehicleDirectToggleCases) {
    const toggleModel = new VoyagerMenuModel();
    toggleModel.prepareInput(VOYAGER_MENU_STATE_INDEX[stateId], "enter");
    if (toggleModel.values[field] !== expected || VOYAGER_MENU_TRANSITIONS[stateId].enter !== stateId) {
      throw new Error(`${stateId} does not toggle ${field} directly in Vehicle Sensors`);
    }
  }

  const wheelDisabledModel = new VoyagerMenuModel();
  wheelDisabledModel.prepareInput(VOYAGER_MENU_STATE_INDEX["m-set3-3-1"], "enter");
  const wheelDisabledPanel = wheelDisabledModel.resolve(VOYAGER_MENU_STATE_INDEX["m-set3-3-1"]);
  const wheelDisabledRows = Object.fromEntries(wheelDisabledPanel.rows.filter((row) => !row.spacer).map((row) => [row.label.trim(), row]));
  if (wheelDisabledModel.values.speedSource !== "GPS"
    || wheelDisabledModel.values.runTimeSource !== "ENG SENSOR"
    || !wheelDisabledRows["WHEEL SIZE"].disabled
    || !wheelDisabledRows["SPEED / DIST"].disabled
    || !wheelDisabledRows["ACCUM RUN TIME"].disabled
    || wheelDisabledRows.PPR.disabled) {
    throw new Error("wheel-sensor dependencies do not match the device");
  }
  const skipWheelSize = wheelDisabledModel.prepareInput(VOYAGER_MENU_STATE_INDEX["m-set3-3-1"], "down");
  const blockWheelSize = wheelDisabledModel.prepareInput(VOYAGER_MENU_STATE_INDEX["m-set3-3-2"], "enter");
  if (skipWheelSize.targetStateId !== "m-set3-3-3" || blockWheelSize.targetStateId !== "m-set3-3-2") {
    throw new Error("disabled vehicle rows remain interactive or are not skipped");
  }

  wheelDisabledModel.prepareInput(VOYAGER_MENU_STATE_INDEX["m-set3-3-3"], "enter");
  let sensorValues = wheelDisabledModel.values;
  if (sensorValues.runTimeSource !== "GPS") throw new Error("both disabled sensors do not force GPS run time");
  wheelDisabledModel.prepareInput(VOYAGER_MENU_STATE_INDEX["m-set3-3-1"], "enter");
  sensorValues = wheelDisabledModel.values;
  if (sensorValues.runTimeSource !== "WHL SENSOR") throw new Error("wheel-only mode does not force wheel run time");
  wheelDisabledModel.prepareInput(VOYAGER_MENU_STATE_INDEX["m-set3-3-3"], "enter");
  sensorValues = wheelDisabledModel.values;
  if (sensorValues.runTimeSource !== "ENG OR WHL") throw new Error("re-enabled sensors do not restore combined run time");

  const wheelSizeMarkup = renderDefinition(VOYAGER_MENU_STATE_INDEX["m-set3-3-size"], new VoyagerMenuModel());
  if (!wheelSizeMarkup.includes("MOTORCYCLE: 2110 mm")
    || !wheelSizeMarkup.includes("ATV: 1675 mm")
    || !wheelSizeMarkup.includes("DEFAULT: 2110 mm")) {
    throw new Error("wheel-size reference notes are incomplete");
  }
  const pprDefinition = VOYAGER_MENU_STATE_INDEX["m-set3-3-ppr"];
  const pprMarkup = renderDefinition(pprDefinition, new VoyagerMenuModel());
  if ((pprMarkup.match(/radio-16pt/g) ?? []).length !== 3 || pprMarkup.includes("data-menu-slot")) {
    throw new Error("PPR is not rendered as a three-option radio group");
  }
  const pprModel = new VoyagerMenuModel();
  pprModel.prepareInput(pprDefinition, "down");
  pprModel.prepareInput(pprDefinition, "enter");
  if (pprModel.values.ppr !== "2") throw new Error("PPR radio selection does not persist");

  const vehicleMarkup = renderDefinition(VOYAGER_MENU_STATE_INDEX["m-set3-3-6"], new VoyagerMenuModel());
  if (!vehicleMarkup.includes("▶ TACHBAR") || vehicleMarkup.includes("&gt;</text>")) {
    throw new Error("Tachbar row does not use the font play icon");
  }
  const tachbarDefinition = VOYAGER_MENU_STATE_INDEX["m-set3-3-tachbar"];
  const tachbarModel = new VoyagerMenuModel();
  let tachbarMarkup = renderDefinition(tachbarDefinition, tachbarModel);
  if (!tachbarMarkup.includes("TACHBAR SCREEN") || !tachbarMarkup.includes("TACH SCALE") || !tachbarMarkup.includes("MAIN SCREEN")) {
    throw new Error("Tachbar options rows are incomplete");
  }
  tachbarModel.prepareInput(tachbarDefinition, "enter");
  tachbarMarkup = renderDefinition(tachbarDefinition, tachbarModel);
  if (!tachbarMarkup.includes("DISABLED")) throw new Error("Tachbar screen row does not toggle in place");
  tachbarModel.prepareInput(tachbarDefinition, "down");
  const tachScaleTarget = tachbarModel.prepareInput(tachbarDefinition, "enter");
  if (tachScaleTarget.targetStateId !== "m-set3-3-tach-scale"
    || (renderDefinition(VOYAGER_MENU_STATE_INDEX["m-set3-3-tach-scale"], tachbarModel).match(/data-menu-slot=/g) ?? []).length !== 5) {
    throw new Error("Tach scale does not open its five-digit MAX RPM editor");
  }

  const tabsDefinition = VOYAGER_MENU_STATE_INDEX["m-set3-2-tabs"];
  const tabsMarkup = renderDefinition(tabsDefinition, new VoyagerMenuModel());
  if (!tabsMarkup.includes("SECONDSUNTIL TABS HIDE")
    || !tabsMarkup.includes("(000 SEC -&gt; ALWAYS ON)")
    || !tabsMarkup.includes("DEFAULT: 15 SEC")
    || (tabsMarkup.match(/data-menu-slot=/g) ?? []).length !== 3
    || (tabsMarkup.match(/voyager-menu__slot-underline/g) ?? []).length !== 3) {
    throw new Error("tabs-timeout slot editor copy or digit geometry is incomplete");
  }
  const tabsModel = new VoyagerMenuModel();
  tabsModel.prepareInput(tabsDefinition, "right");
  tabsModel.prepareInput(tabsDefinition, "right");
  if (tabsModel.resolve(tabsDefinition).activeDigit !== 0) throw new Error("slot selection does not wrap right");
  tabsModel.prepareInput(tabsDefinition, "left");
  tabsModel.prepareInput(tabsDefinition, "up");
  if (tabsModel.resolve(tabsDefinition).value !== "016 SEC") throw new Error("tabs-timeout digit did not increment");
  tabsModel.prepareInput(tabsDefinition, "down");
  tabsModel.prepareInput(tabsDefinition, "enter");
  if (tabsModel.values.tabsTimeout !== "015 SEC") throw new Error("tabs-timeout editor did not save with Enter");

  const timeDefinition = VOYAGER_MENU_STATE_INDEX["m-set3-2-time"];
  const timeMarkup = renderDefinition(timeDefinition, new VoyagerMenuModel());
  if ((timeMarkup.match(/data-menu-slot=/g) ?? []).length !== 7
    || !timeMarkup.includes("voyager-menu__slot-meridiem")
    || !timeMarkup.includes("data-menu-slot-selected=\"true\"")) {
    throw new Error("time-of-day slot editor is missing its digits or meridiem slot");
  }
  const timeModel = new VoyagerMenuModel();
  timeModel.prepareInput(timeDefinition, "right");
  timeModel.prepareInput(timeDefinition, "up");
  timeModel.prepareInput(timeDefinition, "up");
  if (timeModel.resolve(timeDefinition).value !== "12:02:04 PM") {
    throw new Error("time-of-day minute tens do not stay within 00-59");
  }
  for (let index = 0; index < 4; index += 1) timeModel.prepareInput(timeDefinition, "right");
  timeModel.prepareInput(timeDefinition, "up");
  if (!timeModel.resolve(timeDefinition).value.endsWith("AM")) throw new Error("time-of-day meridiem is not editable");

  const keyboardDefinition = VOYAGER_MENU_STATE_INDEX["m-user-screen-1-name"];
  const keyboardModel = new VoyagerMenuModel();
  const keyboardMarkup = renderDefinition(keyboardDefinition, keyboardModel);
  if (!keyboardMarkup.includes('data-menu-key="\\"')
    || !keyboardMarkup.includes('data-menu-key=","')
    || !keyboardMarkup.includes('data-menu-key="BACKSPACE"')
    || !keyboardMarkup.includes("voyager-menu__keyboard-key-selection")
    || keyboardMarkup.includes("voyager-menu__note")) {
    throw new Error("keyboard rendering is missing device keys or retains the floating active-key display");
  }
  if (!keyboardMarkup.includes('y="18" width="426" height="267"')
    || !keyboardMarkup.includes('transform="translate(0 -21)"')) {
    throw new Error("keyboard modal is no longer centered with padded confirmation buttons");
  }
  for (let index = 0; index < 12; index += 1) keyboardModel.prepareInput(keyboardDefinition, "right");
  const beforeBackspace = keyboardModel.resolve(keyboardDefinition).value;
  keyboardModel.prepareInput(keyboardDefinition, "center");
  const afterBackspace = keyboardModel.resolve(keyboardDefinition);
  if (afterBackspace.value !== beforeBackspace.slice(0, -1)
    || afterBackspace.keyboardCursor !== [...afterBackspace.value].length) {
    throw new Error("keyboard BACKSPACE did not update the value and cursor together");
  }
  const keyboardFocusModel = new VoyagerMenuModel();
  for (let index = 0; index < 4; index += 1) keyboardFocusModel.prepareInput(keyboardDefinition, "down");
  const focusedConfirmation = keyboardFocusModel.resolve(keyboardDefinition);
  const focusedConfirmationMarkup = renderDefinition(keyboardDefinition, keyboardFocusModel);
  if (focusedConfirmation.keyboardKey !== "Z"
    || focusedConfirmation.selectedConfirmation !== 1
    || !focusedConfirmationMarkup.includes("btn-ok-selected")
    || focusedConfirmationMarkup.includes("voyager-menu__keyboard-key-selection")) {
    throw new Error("keyboard Down did not move from the final key row to OK");
  }
  keyboardFocusModel.prepareInput(keyboardDefinition, "up");
  const returnedKeyboardFocus = keyboardFocusModel.resolve(keyboardDefinition);
  if (returnedKeyboardFocus.keyboardKey !== "Z" || returnedKeyboardFocus.selectedConfirmation !== -1) {
    throw new Error("keyboard Up did not return from OK to the final key row");
  }
  keyboardFocusModel.prepareInput(keyboardDefinition, "down");
  keyboardFocusModel.prepareInput(keyboardDefinition, "left");
  const cancelButtonFocus = keyboardFocusModel.resolve(keyboardDefinition);
  if (cancelButtonFocus.selectedConfirmation !== 0) {
    throw new Error("keyboard Left did not move from OK to Cancel");
  }
  keyboardFocusModel.prepareInput(keyboardDefinition, "right");
  const returnedOkFocus = keyboardFocusModel.resolve(keyboardDefinition);
  if (returnedOkFocus.selectedConfirmation !== 1) {
    throw new Error("keyboard Right did not move from Cancel to OK");
  }
  keyboardFocusModel.prepareInput(keyboardDefinition, "left");
  keyboardFocusModel.prepareInput(keyboardDefinition, "down");
  const wrappedKeyboardFocus = keyboardFocusModel.resolve(keyboardDefinition);
  if (wrappedKeyboardFocus.keyboardKey !== "1" || wrappedKeyboardFocus.selectedConfirmation !== -1) {
    throw new Error("keyboard Down did not move from the confirmation buttons to the top row");
  }

  console.log(JSON.stringify(report, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
