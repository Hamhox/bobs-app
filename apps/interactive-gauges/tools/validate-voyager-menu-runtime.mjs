#!/usr/bin/env node

import {
  VOYAGER_MENU_STATE_INDEX,
} from "../voyager-menu-registry.js";
import { VOYAGER_KEYBOARD_ROWS, VoyagerMenuModel } from "../voyager-menu-model.js";
import { renderVoyagerMenuMarkup } from "../voyager-menu-renderer.js";

const EXPECTED_COUNTS = Object.freeze({
  total: 131,
  pages: 64,
  workflows: 8,
  overlays: 59,
  menuOverlays: 53,
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

  const dataBlockSelector = VOYAGER_MENU_STATE_INDEX["m-set3-5-1-3-1"];
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
  const modalMarkup = renderDefinition(VOYAGER_MENU_STATE_INDEX["m-set3-2-1-1"], new VoyagerMenuModel());
  if (!modalMarkup.includes("voyager-menu__modal-shadow") || !modalMarkup.includes("voyager-menu__title-band")) {
    throw new Error("settings modal is missing its device frame primitives");
  }
  if (!modalMarkup.includes("voyager-menu__underlay-wash")) {
    throw new Error("settings modal is missing its flat backlight wash");
  }
  if (!modalMarkup.includes('class="voyager-menu__selection" x="83"')) {
    throw new Error("settings selection does not span the inner modal");
  }

  const quickMenuMarkup = renderDefinition(VOYAGER_MENU_STATE_INDEX["m-main1-1"], new VoyagerMenuModel());
  if (!quickMenuMarkup.includes("QUICK MENU") || !quickMenuMarkup.includes(">QUICK</text>")) {
    throw new Error("quick menu naming is not reflected in the title and persistent sidebar");
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
  if (!destinationMarkup.includes("SELECT DESTINATION WAYPOINT") || !destinationMarkup.includes("WAYPOINT 4")) {
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
    VOYAGER_MENU_STATE_INDEX["m-set3-2-1-1"],
    "center",
  );
  if (radioCenterAction.action !== "enter") {
    throw new Error("center does not commit the selected radio option");
  }
  const editorCenterAction = new VoyagerMenuModel().prepareInput(
    VOYAGER_MENU_STATE_INDEX["m-set3-2-3-1"],
    "center",
  );
  if (editorCenterAction.action !== "center") {
    throw new Error("center no longer retains its digit-editor behavior");
  }

  const keyboardDefinition = VOYAGER_MENU_STATE_INDEX["m-set3-5-1-1-1"];
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

  console.log(JSON.stringify(report, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
