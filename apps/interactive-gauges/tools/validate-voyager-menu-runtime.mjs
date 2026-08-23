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
  voyagerMainScreenTarget,
  voyagerUserMetricDefinition,
} from "../voyager-live-runtime.js";

const EXPECTED_COUNTS = Object.freeze({
  total: 246,
  pages: 127,
  workflows: 6,
  overlays: 113,
  menuOverlays: 107,
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

  const tachbarCycle = [
    voyagerMainScreenTarget("index", "right", true),
    voyagerMainScreenTarget("index2", "right", true),
    voyagerMainScreenTarget("index3", "right", true),
  ];
  if (tachbarCycle.join(",") !== "index2,index3,index"
    || voyagerMainScreenTarget("index2", "right", false) !== "index"
    || voyagerMainScreenTarget("index", "left", false) !== "index2") {
    throw new Error("main-screen navigation does not include or correctly skip the tachbar screen");
  }

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
  if (dataBlockSelector.options.some((option) => /\([12]\)/.test(option))) {
    throw new Error("data-block options contain text screen numbers instead of font indicators");
  }
  const userMetric = voyagerUserMetricDefinition(
    `AVG WHEEL SPEED ${VOYAGER_FONT_SYMBOLS.circledDigitNarrow1}`,
    { speedUnit: "KM/H" },
  );
  if (userMetric.label !== `AVG WHEEL SPD ${VOYAGER_FONT_SYMBOLS.circledDigitNarrow1} KM/H`
    || userMetric.label.includes("SPD 1")) {
    throw new Error("user-screen readouts do not retain the font screen indicator");
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
  const touchKeyboardDefinition = VOYAGER_MENU_STATE_INDEX["m-user-screen-1-name"];
  const touchKeyboardModel = new VoyagerMenuModel();
  const touchKeyboardMarkup = renderDefinition(touchKeyboardDefinition, touchKeyboardModel);
  if (!touchKeyboardMarkup.includes('data-menu-key-index="0"')
    || !touchKeyboardMarkup.includes('data-menu-key-index="51"')
    || !touchKeyboardMarkup.includes('data-menu-confirmation="1"')) {
    throw new Error("keyboard keys or buttons are missing touchscreen indexes");
  }
  const keyboardPointerAction = touchKeyboardModel.preparePointerInput(touchKeyboardDefinition, {
    type: "keyboard-key",
    index: 13,
    activate: true,
  });
  if (keyboardPointerAction.action !== "center"
    || touchKeyboardModel.resolve(touchKeyboardDefinition).keyboardKey !== "Q") {
    throw new Error("touchscreen keyboard key does not select the requested device key");
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
  const submenuDefinitions = Object.values(VOYAGER_MENU_STATE_INDEX)
    .filter((definition) => definition.rows?.some((row) => row.submenu));
  for (const definition of submenuDefinitions) {
    const submenuMarkup = renderDefinition(definition, new VoyagerMenuModel());
    if (submenuMarkup.includes("&gt;</text>")) {
      throw new Error(`${definition.id} still renders a text submenu arrow`);
    }
    for (const row of definition.rows.filter((candidate) => candidate.submenu)) {
      if (!submenuMarkup.includes(`${VOYAGER_FONT_SYMBOLS.play} ${row.label.trimStart()}`)) {
        throw new Error(`${definition.id} is missing a play-icon submenu label`);
      }
    }
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
  if (VOYAGER_MENU_STATE_INDEX["m-main1-5-success"].autoTransition?.target !== "map"
    || VOYAGER_MENU_STATE_INDEX["m-ride-import-success"].autoTransition?.target !== "map") {
    throw new Error("successful imports do not hand off to the loaded map");
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
  if (!quickMenuMarkup.includes('data-menu-tab="ride" data-voyager-touch-target="menu-tab"')
    || !quickMenuMarkup.includes('data-menu-row="0"')
    || !quickMenuMarkup.includes("voyager-live__touch-hit")) {
    throw new Error("menu rows or persistent tabs are missing touchscreen targets");
  }
  const pointerPageModel = new VoyagerMenuModel();
  const pointerPageResult = pointerPageModel.preparePointerInput(
    VOYAGER_MENU_STATE_INDEX["m-main1-1"],
    { type: "row", index: 2, activate: true },
  );
  if (pointerPageResult.targetStateId !== "m-main1-3" || pointerPageResult.followupAction !== "enter") {
    throw new Error("touchscreen menu row does not select and activate through the existing page state");
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
  if (!userLayoutMarkup.includes("data-menu-layout-name")
    || !userLayoutMarkup.includes('data-menu-layout-slot="0"')
    || !userLayoutMarkup.includes('data-menu-confirmation="0"')
    || !userLayoutMarkup.includes('data-menu-confirmation="1"')) {
    throw new Error("user layout fields or confirmation buttons are missing touchscreen targets");
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
  const pointerLayoutModel = new VoyagerMenuModel();
  const pointerLayoutAction = pointerLayoutModel.preparePointerInput(layoutDefinition, {
    type: "layout-slot",
    index: 4,
    activate: true,
  });
  if (pointerLayoutAction.action !== "enter"
    || pointerLayoutModel.resolve(layoutDefinition).selectedIndex !== 5) {
    throw new Error("touchscreen user readout does not prime the requested layout slot");
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
  if (wheelDisabledModel.values.speedSource !== "WHL SENSOR"
    || wheelDisabledModel.values.runTimeSource !== "ENG OR WHL"
    || wheelDisabledModel.effectiveValues.speedSource !== "GPS"
    || wheelDisabledModel.effectiveValues.runTimeSource !== "ENG SENSOR"
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
  let sensorValues = wheelDisabledModel.effectiveValues;
  if (sensorValues.runTimeSource !== "GPS") throw new Error("both disabled sensors do not force GPS run time");
  wheelDisabledModel.prepareInput(VOYAGER_MENU_STATE_INDEX["m-set3-3-1"], "enter");
  sensorValues = wheelDisabledModel.effectiveValues;
  if (sensorValues.runTimeSource !== "WHL SENSOR") throw new Error("wheel-only mode does not force wheel run time");
  wheelDisabledModel.prepareInput(VOYAGER_MENU_STATE_INDEX["m-set3-3-3"], "enter");
  sensorValues = wheelDisabledModel.effectiveValues;
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

  const powerModel = new VoyagerMenuModel();
  const powerPageMarkup = renderDefinition(VOYAGER_MENU_STATE_INDEX["m-set3-4-1"], powerModel);
  if (!powerPageMarkup.includes("20 SEC")
    || !powerPageMarkup.includes("ALWAYS ON")
    || !powerPageMarkup.includes("3 MIN")
    || !powerPageMarkup.includes("60 MIN")) {
    throw new Error("power-settings rows do not format stored timeout values for the device");
  }
  const backlightDefinition = VOYAGER_MENU_STATE_INDEX["m-set3-4-level"];
  const backlightMarkup = renderDefinition(backlightDefinition, powerModel);
  if (backlightDefinition.title !== "BACKLIGHT"
    || (backlightMarkup.match(/radio-16pt/g) ?? []).length !== 4
    || !backlightMarkup.includes("OFF")
    || !backlightMarkup.includes("HIGH")) {
    throw new Error("backlight level is not a four-option device radio group");
  }
  const powerSlotExpectations = [
    ["m-set3-4-battery", 3, "BACKLIGHT (BATTERY)", "WHEN USING INTERNAL BATTERY", "DEFAULT: 20 SEC"],
    ["m-set3-4-external", 3, "BACKLIGHT (EXTERNAL)", "WHEN USING EXTERNAL POWER", "DEFAULT: ALWAYS ON"],
    ["m-set3-4-sleep-battery", 2, "SLEEP MODE TIMEOUT", "WHEN USING BATTERY POWER", "DEFAULT: 3 MIN"],
    ["m-set3-4-sleep-external", 2, "SLEEP MODE TIMEOUT", "WHEN USING EXTERNAL POWER", "DEFAULT: 20 MIN"],
    ["m-set3-4-turnoff", 2, "POWER OFF TIMEOUT", "MINUTES UNTIL POWER OFF", "DEFAULT: 60 MIN"],
  ];
  for (const [stateId, slotCount, title, copy, defaultCopy] of powerSlotExpectations) {
    const definition = VOYAGER_MENU_STATE_INDEX[stateId];
    const markup = renderDefinition(definition, new VoyagerMenuModel());
    if (definition.title !== title
      || (markup.match(/data-menu-slot=/g) ?? []).length !== slotCount
      || !markup.includes(copy)
      || !markup.includes(defaultCopy)) {
      throw new Error(`${stateId} power timeout copy or slot geometry is incomplete`);
    }
  }
  powerModel.prepareInput(VOYAGER_MENU_STATE_INDEX["m-set3-4-7"], "enter");
  if (powerModel.values.chargeMode !== "WALL PLUG") throw new Error("charge mode does not toggle to Wall Plug in place");
  powerModel.prepareInput(backlightDefinition, "up");
  powerModel.prepareInput(backlightDefinition, "enter");
  if (powerModel.values.backlightLevel !== "MEDIUM") throw new Error("backlight radio selection does not persist");
  powerModel.prepareInput(VOYAGER_MENU_STATE_INDEX["m-set3-4-8"], "enter");
  if (powerModel.values.backlightLevel !== "MEDIUM"
    || VOYAGER_MENU_TRANSITIONS["m-set3-4-8"].enter !== "m-set3-4-restore") {
    throw new Error("Restore Defaults applies before its confirmation dialog");
  }
  const restoreDefinition = VOYAGER_MENU_STATE_INDEX["m-set3-4-restore"];
  const restoreMarkup = renderDefinition(restoreDefinition, powerModel);
  if (!restoreMarkup.includes("RESTORE POWER SETTINGS")
    || !restoreMarkup.includes("TO FACTORY DEFAULTS?")
    || !restoreMarkup.includes("btn-cancel-selected")) {
    throw new Error("power Restore Defaults confirmation is incomplete");
  }
  powerModel.prepareInput(restoreDefinition, "right");
  powerModel.prepareInput(restoreDefinition, "enter");
  if (powerModel.values.backlightLevel !== "HIGH"
    || powerModel.values.chargeMode !== "VEHICLE"
    || powerModel.values.sleepBattery !== "03 MIN") {
    throw new Error("confirmed power Restore Defaults does not restore the device profile");
  }

  const gpsModel = new VoyagerMenuModel();
  const gpsPageDefinition = VOYAGER_MENU_STATE_INDEX["m-set3-5-1"];
  const gpsPageMarkup = renderDefinition(gpsPageDefinition, gpsModel);
  if (!gpsPageMarkup.includes("LOG METHOD")
    || !gpsPageMarkup.includes("1 SEC")
    || !gpsPageMarkup.includes("5 MI GAP")
    || !gpsPageMarkup.includes("DEG, MIN.DEC")
    || !gpsPageMarkup.includes("OFF")) {
    throw new Error("GPS Settings does not render the device defaults");
  }
  if (VOYAGER_MENU_STATE_INDEX["m-set3-5-method"]
    || VOYAGER_MENU_STATE_INDEX["m-set3-5-bars"]
    || VOYAGER_MENU_TRANSITIONS["m-set3-5-1"].enter !== "m-set3-5-1"
    || VOYAGER_MENU_TRANSITIONS["m-set3-5-6"].enter !== "m-set3-5-6") {
    throw new Error("GPS toggles still open obsolete sub-modals");
  }
  gpsModel.prepareInput(gpsPageDefinition, "enter");
  if (gpsModel.values.logMethod !== "DISTANCE" || gpsModel.values.logFrequency !== "10 FT") {
    throw new Error("Distance logging does not install its 10 FT default frequency");
  }
  const frequencyDefinition = VOYAGER_MENU_STATE_INDEX["m-set3-5-frequency"];
  const distanceFrequency = gpsModel.resolve(frequencyDefinition);
  if (distanceFrequency.options.join("|") !== "1 FT|10 FT|50 FT" || distanceFrequency.selectedIndex !== 1) {
    throw new Error("Distance logging does not expose the three FT frequency choices");
  }
  gpsModel.prepareInput(frequencyDefinition, "down");
  gpsModel.prepareInput(frequencyDefinition, "enter");
  if (gpsModel.values.logFrequency !== "50 FT") throw new Error("Distance frequency selection does not persist");
  gpsModel.prepareInput(gpsPageDefinition, "enter");
  const timeFrequency = gpsModel.resolve(frequencyDefinition);
  if (gpsModel.values.logMethod !== "TIME"
    || gpsModel.values.logFrequency !== "1 SEC"
    || timeFrequency.options.join("|") !== "1 SEC|2 SEC|5 SEC"
    || timeFrequency.selectedIndex !== 0) {
    throw new Error("Time logging does not restore its SEC frequency choices and default");
  }
  const logOptionDefinition = VOYAGER_MENU_STATE_INDEX["m-set3-5-option"];
  if (logOptionDefinition.options.join("|") !== "ALWAYS|ENG SENSOR|WHL SENSOR|ENG OR WHL"
    || gpsModel.resolve(logOptionDefinition).selectedIndex !== 3) {
    throw new Error("Log Option radio order or default is incorrect");
  }
  const autoSplitDefinition = VOYAGER_MENU_STATE_INDEX["m-set3-5-split"];
  const autoSplitMarkup = renderDefinition(autoSplitDefinition, gpsModel);
  if (autoSplitDefinition.title !== "LOG AUTO-SPLIT"
    || autoSplitDefinition.options.join("|") !== "OFF|1 MI GAP|5 MI GAP|10 MI GAP"
    || (autoSplitMarkup.match(/radio-16pt/g) ?? []).length !== 4
    || gpsModel.resolve(autoSplitDefinition).selectedIndex !== 2) {
    throw new Error("Log Auto-Split is not the four-option device radio group");
  }
  const coordinateDefinition = VOYAGER_MENU_STATE_INDEX["m-set3-5-coords"];
  if (coordinateDefinition.title !== "COORDINATE DISPLAY"
    || coordinateDefinition.options.join("|") !== "DEG.DEC|DEG, MIN.DEC|DEG, MIN, SEC"
    || gpsModel.resolve(coordinateDefinition).selectedIndex !== 1) {
    throw new Error("Coordinate Display options or default are incorrect");
  }
  gpsModel.prepareInput(VOYAGER_MENU_STATE_INDEX["m-set3-5-6"], "enter");
  if (gpsModel.values.signalBars !== "ON") throw new Error("Signal Bars does not toggle in place");
  gpsModel.prepareInput(VOYAGER_MENU_STATE_INDEX["m-set3-5-7"], "enter");
  if (gpsModel.values.signalBars !== "ON"
    || VOYAGER_MENU_TRANSITIONS["m-set3-5-7"].enter !== "m-set3-5-restore") {
    throw new Error("GPS Restore Defaults applies before its confirmation dialog");
  }
  const gpsRestoreDefinition = VOYAGER_MENU_STATE_INDEX["m-set3-5-restore"];
  const gpsRestoreMarkup = renderDefinition(gpsRestoreDefinition, gpsModel);
  if (!gpsRestoreMarkup.includes("RESTORE GPS SETTINGS")
    || !gpsRestoreMarkup.includes("TO FACTORY DEFAULTS?")) {
    throw new Error("GPS Restore Defaults confirmation is incomplete");
  }
  gpsModel.prepareInput(gpsRestoreDefinition, "right");
  gpsModel.prepareInput(gpsRestoreDefinition, "enter");
  if (gpsModel.values.logMethod !== "TIME"
    || gpsModel.values.logFrequency !== "1 SEC"
    || gpsModel.values.coordFormat !== "DEG, MIN.DEC"
    || gpsModel.values.signalBars !== "OFF") {
    throw new Error("confirmed GPS Restore Defaults does not restore the device profile");
  }

  const mapModel = new VoyagerMenuModel();
  const mapOrientationDefinition = VOYAGER_MENU_STATE_INDEX["m-set3-6-1"];
  if (VOYAGER_MENU_STATE_INDEX["m-set3-6-orientation"]
    || VOYAGER_MENU_STATE_INDEX["m-set3-6-screen1"]
    || VOYAGER_MENU_TRANSITIONS["m-set3-6-1"].enter !== "m-set3-6-1"
    || VOYAGER_MENU_TRANSITIONS["m-set3-6-3"].enter !== "m-set3-6-3") {
    throw new Error("Map Settings direct toggles still open obsolete sub-modals");
  }
  mapModel.prepareInput(mapOrientationDefinition, "enter");
  if (mapModel.values.mapOrientation !== "TRACK UP") throw new Error("Map Orientation does not toggle in place");
  mapModel.prepareInput(VOYAGER_MENU_STATE_INDEX["m-set3-6-3"], "enter");
  if (mapModel.values.mapScreen1 !== "FIXED") throw new Error("Map Screen 1 does not toggle to Fixed in place");

  const pointerDefinition = VOYAGER_MENU_STATE_INDEX["m-set3-6-pointer"];
  if (pointerDefinition.title !== "MAP POINTER SIZE"
    || pointerDefinition.options.join("|") !== "SMALL|MEDIUM|LARGE"
    || mapModel.resolve(pointerDefinition).selectedIndex !== 1) {
    throw new Error("Map Pointer Size options or default are incorrect");
  }
  const mapScreen2Definition = VOYAGER_MENU_STATE_INDEX["m-set3-6-screen2"];
  if (mapScreen2Definition.title !== "MAP SCREEN 2 MODE"
    || mapScreen2Definition.options.join("|") !== "DISABLED|FIXED|AUTO-CENTER"
    || mapModel.resolve(mapScreen2Definition).selectedIndex !== 2) {
    throw new Error("Map Screen 2 Mode options or default are incorrect");
  }

  const screen1OptionsDefinition = VOYAGER_MENU_STATE_INDEX["m-set3-6-options1"];
  const screen1OptionsMarkup = renderDefinition(screen1OptionsDefinition, mapModel);
  if (screen1OptionsDefinition.title !== "MAP SCREEN 1 OPTIONS"
    || !screen1OptionsMarkup.includes("TRACK LABELS")
    || !screen1OptionsMarkup.includes("ROUTE LABELS")
    || !screen1OptionsMarkup.includes("WAYPOINT ICONS")
    || !screen1OptionsMarkup.includes("WAYPOINT LABELS")) {
    throw new Error("Map Screen 1 Options panel is incomplete");
  }
  const trackLabels1 = VOYAGER_MENU_STATE_INDEX["m-set3-6-options1-track-labels"];
  const trackClipping1 = VOYAGER_MENU_STATE_INDEX["m-set3-6-options1-track-clipping"];
  if (trackLabels1.options.join("|") !== "OFF|SMALL|LARGE"
    || mapModel.resolve(trackLabels1).selectedIndex !== 2
    || trackClipping1.title !== "HIDE LABELS ABOVE:"
    || trackClipping1.options.join("|") !== "750 FT|1500 FT|3000 FT|1 MI|2 MI|NEVER"
    || mapModel.resolve(trackClipping1).selectedIndex !== 1) {
    throw new Error("Map Screen 1 label or clipping options are incorrect");
  }
  mapModel.prepareInput(trackLabels1, "up");
  mapModel.prepareInput(trackLabels1, "up");
  mapModel.prepareInput(trackLabels1, "enter");
  const disabledTrackClipping1 = mapModel.resolve(VOYAGER_MENU_STATE_INDEX["m-set3-6-options1-2"]);
  if (mapModel.values.mapScreen1TrackLabels !== "OFF"
    || !disabledTrackClipping1.rows[disabledTrackClipping1.selectedIndex].disabled) {
    throw new Error("turning Track Labels off does not disable its clipping row");
  }
  mapModel.prepareInput(VOYAGER_MENU_STATE_INDEX["m-set3-6-options1-5"], "enter");
  if (mapModel.values.mapScreen1WaypointIcons !== "DOT") throw new Error("Waypoint Icons does not toggle in place");

  const screen2OptionsDefinition = VOYAGER_MENU_STATE_INDEX["m-set3-6-options2"];
  const resolvedScreen2Options = mapModel.resolve(screen2OptionsDefinition);
  if (resolvedScreen2Options.rows[0].value !== "OFF"
    || !resolvedScreen2Options.rows[1].disabled
    || resolvedScreen2Options.rows[3].value !== "OFF"
    || !resolvedScreen2Options.rows[4].disabled
    || resolvedScreen2Options.rows[7].value !== "OFF"
    || !resolvedScreen2Options.rows[8].disabled) {
    throw new Error("Map Screen 2 label defaults do not disable their clipping rows");
  }
  mapModel.prepareInput(mapScreen2Definition, "up");
  mapModel.prepareInput(mapScreen2Definition, "up");
  mapModel.prepareInput(mapScreen2Definition, "enter");
  const disabledScreen2Options = mapModel.resolve(VOYAGER_MENU_STATE_INDEX["m-set3-6-6"]);
  if (mapModel.values.mapScreen2 !== "DISABLED"
    || !disabledScreen2Options.rows[disabledScreen2Options.selectedIndex].disabled
    || mapModel.prepareInput(VOYAGER_MENU_STATE_INDEX["m-set3-6-5"], "down").targetStateId !== "m-set3-6-7") {
    throw new Error("disabled Map Screen 2 does not disable and skip its Options row");
  }

  const timeoutDefinition = VOYAGER_MENU_STATE_INDEX["m-set3-6-timeout"];
  const timeoutMarkup = renderDefinition(timeoutDefinition, mapModel);
  if (timeoutDefinition.title !== "MAP PAN/ZOOM TIMEOUT"
    || !timeoutMarkup.includes("SECONDS UNTIL MAP RESUMES")
    || !timeoutMarkup.includes("(000 SEC -&gt; NEVER TIMEOUT)")
    || !timeoutMarkup.includes("DEFAULT: 30 SEC")) {
    throw new Error("Map Pan/Zoom Timeout editor copy is incomplete");
  }

  mapModel.prepareInput(VOYAGER_MENU_STATE_INDEX["m-set3-6-8"], "enter");
  if (mapModel.values.mapOrientation !== "TRACK UP"
    || VOYAGER_MENU_TRANSITIONS["m-set3-6-8"].enter !== "m-set3-6-restore") {
    throw new Error("Map Restore Defaults applies before its confirmation dialog");
  }
  const mapRestoreDefinition = VOYAGER_MENU_STATE_INDEX["m-set3-6-restore"];
  const mapRestoreMarkup = renderDefinition(mapRestoreDefinition, mapModel);
  if (!mapRestoreMarkup.includes("RESTORE MAP SETTINGS")
    || !mapRestoreMarkup.includes("TO FACTORY DEFAULTS?")) {
    throw new Error("Map Restore Defaults confirmation is incomplete");
  }
  mapModel.prepareInput(mapRestoreDefinition, "right");
  mapModel.prepareInput(mapRestoreDefinition, "enter");
  if (mapModel.values.mapOrientation !== "NORTH UP"
    || mapModel.values.pointerSize !== "MEDIUM"
    || mapModel.values.mapScreen1 !== "AUTO-CENTER"
    || mapModel.values.mapScreen1TrackLabels !== "LARGE"
    || mapModel.values.mapScreen1WaypointIcons !== "ID#"
    || mapModel.values.mapScreen2 !== "AUTO-CENTER"
    || mapModel.values.mapScreen2TrackLabels !== "OFF"
    || mapModel.values.panZoomTimeout !== "030 SEC") {
    throw new Error("confirmed Map Restore Defaults does not restore the device profile");
  }

  const warningModel = new VoyagerMenuModel();
  const warningPageDefinition = VOYAGER_MENU_STATE_INDEX["m-set3-7-1"];
  const warningPageMarkup = renderDefinition(warningPageDefinition, warningModel);
  if ((warningPageMarkup.match(/DISABLED/g) ?? []).length !== 4) {
    throw new Error("Warning LED panel does not render all four disabled defaults");
  }
  const warningDefinitions = [
    ["m-set3-7-yellow-on", "YELLOW LED ON", "LIGHT LEFT YELLOW LED"],
    ["m-set3-7-red-on", "RED LED ON", "LIGHT RIGHT RED LED"],
    ["m-set3-7-yellow-flash", "YELLOW LED FLASH", "FLASH LEFT YELLOW LED"],
    ["m-set3-7-red-flash", "YELLOW LED FLASH", "FLASH RIGHT RED LED"],
  ];
  for (const [stateId, title, instruction] of warningDefinitions) {
    const definition = VOYAGER_MENU_STATE_INDEX[stateId];
    const resolved = warningModel.resolve(definition);
    const markup = renderDefinition(definition, warningModel);
    if (definition.title !== title
      || resolved.value !== "000 °F"
      || (markup.match(/data-menu-slot=/g) ?? []).length !== 3
      || !markup.includes("°F")
      || !markup.includes(instruction)
      || !markup.includes("WHEN EXCEEDED.")
      || !markup.includes("(000 -&gt; DISABLED)")
      || !markup.includes("DEFAULT: DISABLED")) {
      throw new Error(`${stateId} threshold editor is incomplete`);
    }
  }
  const yellowOnDefinition = VOYAGER_MENU_STATE_INDEX["m-set3-7-yellow-on"];
  warningModel.prepareInput(yellowOnDefinition, "up");
  warningModel.prepareInput(yellowOnDefinition, "enter");
  if (warningModel.values.yellowLedOn !== "010 °F"
    || !renderDefinition(warningPageDefinition, warningModel).includes("10°F")) {
    throw new Error("Warning LED threshold does not persist its three-digit temperature value");
  }
  warningModel.prepareInput(VOYAGER_MENU_STATE_INDEX["m-set3-7-5"], "enter");
  if (warningModel.values.yellowLedOn !== "010 °F"
    || VOYAGER_MENU_TRANSITIONS["m-set3-7-5"].enter !== "m-set3-7-restore") {
    throw new Error("Warning LED Restore Defaults applies before its confirmation dialog");
  }
  const warningRestoreDefinition = VOYAGER_MENU_STATE_INDEX["m-set3-7-restore"];
  const warningRestoreMarkup = renderDefinition(warningRestoreDefinition, warningModel);
  if (!warningRestoreMarkup.includes("RESTORE LED SETTINGS")
    || !warningRestoreMarkup.includes("TO FACTORY DEFAULTS?")) {
    throw new Error("Warning LED Restore Defaults confirmation is incomplete");
  }
  warningModel.prepareInput(warningRestoreDefinition, "right");
  warningModel.prepareInput(warningRestoreDefinition, "enter");
  if (["yellowLedOn", "redLedOn", "yellowLedFlash", "redLedFlash"]
    .some((field) => warningModel.values[field] !== "000 °F")) {
    throw new Error("confirmed Warning LED Restore Defaults does not restore all thresholds");
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

  const destinationOverlayMarkup = renderDefinition(
    VOYAGER_MENU_STATE_INDEX["m-nav-destination-primary"],
    new VoyagerMenuModel(),
  );
  if (!destinationOverlayMarkup.includes("data-menu-backdrop")) {
    throw new Error("menu overlays do not expose a screen-background Back target");
  }
  const dismissibleToastMarkup = renderVoyagerToastMarkup("WAYPOINT SELECTED");
  if (!dismissibleToastMarkup.includes("data-live-toast-dismiss")) {
    throw new Error("live toasts do not expose a full-screen dismissal target");
  }

  console.log(JSON.stringify(report, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
