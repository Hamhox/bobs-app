import { VOYAGER_FONT_SYMBOLS } from "./voyager-font-symbols.js";

const MENU_STORAGE_KEY = "bobs-app:voyager-menu:v1";

const dataBlockVariant = (label, digit) => `${label} ${digit === 1
  ? VOYAGER_FONT_SYMBOLS.circledDigitNarrow1
  : VOYAGER_FONT_SYMBOLS.circledDigitNarrow2}`;

const DEFAULT_VALUES = Object.freeze({
  gpsMode: "ENABLED (LOGGING ON)",
  speedSource: "GPS",
  speedUnits: "MPH",
  distanceUnits: "MILES / FEET",
  wheelSize: "1676 mm",
  clockFormat: "12 HOUR",
  timeOfDay: "12:35",
  temperatureUnits: "FAHRENHEIT",
  brightness: 50,
  backlightBattery: "007 SEC",
  backlightExternal: "000 SEC",
  safeModeTimer: "020 SEC",
  sleepModeTimer: "10 MIN",
  chargeMode: "ONLY WHEN MOTOR IS ON",
  chargeLevel: "TRICKLE CHARGE",
  mapOrientation: "NORTH UP",
  mapAutoZoom: "ON",
  logAfterStop: "030 SEC",
  recordMethod: "DISTANCE",
  wrapWhenFull: "WRAP WHEN FULL",
  sampleFrequency: "NORMAL",
  userScreenTitle: "USER SCREEN 1",
  userScreen1Title: "USER SCREEN 1",
  userScreen2Title: "USER SCREEN 2",
  userScreenBlocks: "4",
  userScreenBlock1: "WHEEL SPEED",
  userScreen1Block1: "WHEEL SPEED",
  userScreen1Block2: "GPS SPEED",
  userScreen1Block3: dataBlockVariant("WHEEL DISTANCE", 1),
  userScreen1Block4: dataBlockVariant("WHEEL DISTANCE", 2),
  userScreen1Block5: "WHEEL ODOMETER",
  userScreen1Block6: "ALTITUDE",
  userScreen2Block1: "ENGINE ACC. RUN TIME",
  userScreen2Block2: dataBlockVariant("MAX WHEEL SPEED", 1),
  userScreen2Block3: dataBlockVariant("AVG WHEEL SPEED", 1),
  userScreen2Block4: "<OFF>",
  userScreen2Block5: "<OFF>",
  userScreen2Block6: "<OFF>",
  destinationWaypoint: "WAYPOINT 1",
  yellowLedOn: "210 °F",
  redLedOn: "220 °F",
  yellowLedFlash: "240 °F",
  redLedFlash: "240 °F",
  rideName: "RIDE-32",
});

const FIELD_BINDINGS = Object.freeze({
  "m-main1-6-1": "gpsMode",
  "m-main1-7-1": "speedSource",
  "m-set3-2-1-1": "speedUnits",
  "m-set3-2-2-1": "distanceUnits",
  "m-set3-2-3-1": "wheelSize",
  "m-set3-2-4-1": "clockFormat",
  "m-set3-2-5-1": "timeOfDay",
  "m-set3-2-6-1": "temperatureUnits",
  "m-set3-3-1-1": "brightness",
  "m-set3-3-2-1": "backlightBattery",
  "m-set3-3-3-1": "backlightExternal",
  "m-set3-3-4-1": "safeModeTimer",
  "m-set3-3-5-1": "sleepModeTimer",
  "m-set3-3-6-1": "chargeMode",
  "m-set3-3-7-1": "chargeLevel",
  "m-set3-4-1-1": "mapOrientation",
  "m-set3-4-2-1": "mapAutoZoom",
  "m-set3-4-3-1": "logAfterStop",
  "m-set3-4-4-1": "recordMethod",
  "m-set3-4-5-1": "wrapWhenFull",
  "m-set3-4-6-1": "sampleFrequency",
  "m-set3-5-1-1-1": "userScreen1Title",
  "m-set3-5-1-2-1": "userScreenBlocks",
  "m-set3-5-1-3-1": "userScreenBlock1",
  "m-nav-destination-primary": "destinationWaypoint",
  "m-nav-destination-secondary": "destinationWaypoint",
  "m-set3-6-1-1": "yellowLedOn",
  "m-set3-6-2-1": "redLedOn",
  "m-set3-6-3-1": "yellowLedFlash",
  "m-set3-6-4-1": "redLedFlash",
  "m-ride2-6-2-1-1": "rideName",
});

const ROW_BINDINGS = Object.freeze({
  "RIDE NAME": "rideName",
  GPS: "gpsMode",
  "SPEED/DST": "speedSource",
  "SPEED UNITS": "speedUnits",
  "DISTANCE UNITS": "distanceUnits",
  "WHEEL SIZE": "wheelSize",
  "CLOCK FORMAT": "clockFormat",
  "TIME OF DAY": "timeOfDay",
  "TEMP. UNITS": "temperatureUnits",
  BRIGHTNESS: "brightness",
  "BACKLIGHT (BAT)": "backlightBattery",
  "BACKLIGHT (EXT)": "backlightExternal",
  "SAFE MODE TIMER": "safeModeTimer",
  "SLEEP MODE TIMER": "sleepModeTimer",
  "CHARGE MODE": "chargeMode",
  "CHARGE LEVEL": "chargeLevel",
  "MAP ORIENTATION": "mapOrientation",
  "MAP AUTO-ZOOM": "mapAutoZoom",
  "LOG AFTER STOP": "logAfterStop",
  "RECORD METHOD": "recordMethod",
  "WRAP WHEN FULL": "wrapWhenFull",
  "SAMPLE FREQUENCY": "sampleFrequency",
  "SCREEN NAME": "userScreen1Title",
  "NUMBER OF BLOCKS": "userScreenBlocks",
  "BLOCK 1": "userScreenBlock1",
  "YELLOW LED ON": "yellowLedOn",
  "RED LED ON": "redLedOn",
  "YELLOW LED FLASH": "yellowLedFlash",
  "RED LED FLASH": "redLedFlash",
});

const RESET_GROUPS = Object.freeze({
  "UNIT SETTINGS": ["speedUnits", "distanceUnits", "wheelSize", "clockFormat", "timeOfDay", "temperatureUnits"],
  "SYSTEM SETTINGS": ["brightness", "backlightBattery", "backlightExternal", "safeModeTimer", "sleepModeTimer", "chargeMode", "chargeLevel"],
  "GPS SETTINGS": ["mapOrientation", "mapAutoZoom", "logAfterStop", "recordMethod", "wrapWhenFull", "sampleFrequency"],
  "USER SCREEN 1 SETTINGS": [
    "userScreenTitle",
    "userScreen1Title",
    "userScreenBlocks",
    "userScreenBlock1",
    "userScreen1Block1",
    "userScreen1Block2",
    "userScreen1Block3",
    "userScreen1Block4",
    "userScreen1Block5",
    "userScreen1Block6",
  ],
  "WARNING LED LIGHTS": ["yellowLedOn", "redLedOn", "yellowLedFlash", "redLedFlash"],
});

export const VOYAGER_KEYBOARD_ROWS = Object.freeze([
  Object.freeze(["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "+", "BACKSPACE"]),
  Object.freeze(["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "_", "°", "\\"]),
  Object.freeze(["A", "S", "D", "F", "G", "H", "J", "K", "L", ":", "'", ",", "."]),
  Object.freeze(["Z", "X", "C", "V", "B", "N", "M", "SPACE", "(", ")", "BACK", "FORWARD", "DELETE"]),
]);

const KEYBOARD_KEYS = Object.freeze(VOYAGER_KEYBOARD_ROWS.flat());
const KEYBOARD_COLUMN_COUNT = VOYAGER_KEYBOARD_ROWS[0].length;

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

function editableDigitIndexes(value) {
  return [...String(value)].flatMap((character, index) => /\d/.test(character) ? [index] : []);
}

function rowValue(key, value) {
  if (key === "brightness") return `${value}%`;
  if (key === "distanceUnits") return value === "MILES / FEET" ? "MI / FT" : "KM / M";
  if (key === "chargeMode") return value === "ONLY WHEN MOTOR IS ON" ? "MOTOR ON" : value;
  if (key === "chargeLevel") return value === "TRICKLE CHARGE" ? "TRICKLE" : "FAST";
  return String(value);
}

export class VoyagerMenuModel {
  #values = { ...DEFAULT_VALUES };
  #drafts = new Map();
  #revision = 0;

  get revision() {
    return this.#revision;
  }

  get values() {
    return { ...this.#values };
  }

  load() {
    try {
      const stored = JSON.parse(window.localStorage.getItem(MENU_STORAGE_KEY) ?? "{}");
      if (stored && typeof stored === "object" && !Array.isArray(stored)) {
        for (const key of Object.keys(DEFAULT_VALUES)) {
          const previousSleepDefault = key === "sleepModeTimer" && ["05 MIN", "30 MIN"].includes(stored[key]);
          if (!previousSleepDefault && typeof stored[key] === typeof DEFAULT_VALUES[key]) this.#values[key] = stored[key];
        }
        if (typeof stored.userScreen1Title !== "string" && typeof stored.userScreenTitle === "string") {
          this.#values.userScreen1Title = stored.userScreenTitle;
        }
      }
    } catch {
      this.#values = { ...DEFAULT_VALUES };
    }
    return this;
  }

  resolve(definition) {
    const draft = definition.presentation === "overlay" ? this.#draftFor(definition) : null;
    const resolved = {
      ...definition,
      rows: definition.rows?.map((row) => {
        const key = ROW_BINDINGS[row.label];
        return key ? { ...row, value: rowValue(key, this.#values[key]) } : { ...row };
      }),
    };
    if (!draft) return resolved;
    if (definition.kind === "settings-modal") resolved.selectedIndex = draft.selectedIndex;
    if (definition.kind === "user-layout") {
      resolved.name = draft.name;
      resolved.options = [...draft.options];
      resolved.selectedIndex = draft.selectedIndex;
    }
    if (definition.kind === "slot-input" || definition.kind === "keyboard") resolved.value = draft.value;
    if (definition.kind === "slot-input") resolved.activeDigit = draft.activeDigit;
    if (definition.kind === "brightness") resolved.value = draft.value;
    if (definition.kind === "confirm") resolved.selectedConfirmation = draft.selectedConfirmation;
    if (definition.kind === "keyboard") {
      resolved.keyboardIndex = draft.keyboardIndex;
      resolved.keyboardKey = KEYBOARD_KEYS[draft.keyboardIndex];
      resolved.keyboardCursor = draft.keyboardCursor;
      resolved.selectedConfirmation = draft.selectedConfirmation;
    }
    return resolved;
  }

  resolveInputAction(definition, action) {
    if (!definition || action !== "center") return action;
    const centerActivatesSelection = definition.presentation === "page"
      || ["brightness", "confirm", "notice", "settings-modal", "user-layout"].includes(definition.kind);
    return centerActivatesSelection ? "enter" : action;
  }

  prepareInput(definition, action) {
    if (!definition) return { action };
    if (action === "back" || action === "menu") {
      this.#discard(definition.id);
      return { action };
    }
    const preparedAction = this.resolveInputAction(definition, action);
    if (definition.presentation !== "overlay") {
      if (preparedAction === "enter") this.#applyPageAction(definition);
      return { action: preparedAction };
    }

    const draft = this.#draftFor(definition);
    if (preparedAction === "left" && ["brightness", "settings-modal", "slot-input"].includes(definition.kind)) {
      this.#discard(definition.id);
      return { action: preparedAction };
    }
    if (definition.kind === "confirm") {
      if (["left", "right", "up", "down"].includes(preparedAction)) {
        draft.selectedConfirmation = draft.selectedConfirmation === 0 ? 1 : 0;
        this.#touch();
      }
      if (preparedAction === "enter" && draft.selectedConfirmation === 0) {
        this.#discard(definition.id);
        return { action: "back" };
      }
    }

    if (definition.kind === "settings-modal" && (preparedAction === "up" || preparedAction === "down")) {
      const count = definition.options.length;
      draft.selectedIndex = (draft.selectedIndex + (preparedAction === "up" ? -1 : 1) + count) % count;
      this.#touch();
    }

    if (definition.kind === "user-layout" && ["up", "down", "left", "right"].includes(preparedAction)) {
      const selected = draft.selectedIndex;
      if (preparedAction === "up") {
        if (selected === 0) draft.selectedIndex = 7;
        else if (selected <= 2) draft.selectedIndex = 0;
        else if (selected <= 6) draft.selectedIndex -= 2;
        else draft.selectedIndex -= 2;
      }
      if (preparedAction === "down") {
        if (selected === 0) draft.selectedIndex = 1;
        else if (selected <= 4) draft.selectedIndex += 2;
        else if (selected <= 6) draft.selectedIndex += 2;
        else draft.selectedIndex = 0;
      }
      if (preparedAction === "left") {
        if ([2, 4, 6, 8].includes(selected)) draft.selectedIndex -= 1;
      }
      if (preparedAction === "right") {
        if ([1, 3, 5, 7].includes(selected)) draft.selectedIndex += 1;
      }
      this.#touch();
    }

    if (definition.kind === "user-layout" && preparedAction === "enter") {
      if (draft.selectedIndex === 0) {
        return { action: preparedAction, targetStateId: `m-user-screen-${definition.userScreen}-name` };
      }
      if (draft.selectedIndex >= 1 && draft.selectedIndex <= 6) {
        return { action: preparedAction, targetStateId: `m-user-screen-${definition.userScreen}-data-block` };
      }
      if (draft.selectedIndex === 7) {
        this.#discard(definition.id);
        return { action: "back", targetStateId: definition.parentStateId };
      }
      this.#commit(definition, draft);
      return { action: preparedAction, targetStateId: definition.parentStateId };
    }

    if (definition.kind === "keyboard"
      && draft.selectedConfirmation >= 0
      && (preparedAction === "center" || preparedAction === "enter")) {
      if (draft.selectedConfirmation === 0) {
        this.#discard(definition.id);
        return { action: "back" };
      }
      this.#commit(definition, draft);
      return { action: "enter" };
    }

    if (definition.kind === "slot-input") this.#editSlot(draft, preparedAction);
    if (definition.kind === "brightness") this.#editBrightness(draft, preparedAction);
    if (definition.kind === "keyboard") this.#editKeyboard(draft, preparedAction);

    if (preparedAction === "enter" && definition.kind !== "user-layout") {
      this.#commit(definition, draft);
    }
    return { action: preparedAction };
  }

  #draftFor(definition) {
    if (this.#drafts.has(definition.id)) return this.#drafts.get(definition.id);
    const binding = this.#bindingFor(definition);
    const storedValue = binding ? this.#values[binding] : undefined;
    const selectedIndex = definition.kind === "settings-modal" && storedValue !== undefined
      ? Math.max(0, definition.options.indexOf(String(storedValue)))
      : definition.selectedIndex ?? 0;
    const value = storedValue ?? definition.value ?? "";
    const digitIndexes = editableDigitIndexes(value);
    const draft = {
      activeDigit: clamp(definition.activeDigit ?? 0, 0, Math.max(0, digitIndexes.length - 1)),
      keyboardCursor: [...String(value)].length,
      keyboardIndex: 0,
      selectedConfirmation: definition.kind === "keyboard" ? -1 : 0,
      selectedIndex,
      value,
    };
    if (definition.kind === "user-layout") {
      draft.name = this.#values[`userScreen${definition.userScreen}Title`];
      draft.options = Array.from(
        { length: 6 },
        (_, index) => this.#values[`userScreen${definition.userScreen}Block${index + 1}`],
      );
    }
    if (definition.dataBlockPicker) {
      const layoutDraft = this.#drafts.get(`m-user-screen-${definition.userScreen}-layout`);
      const selectedSlot = Math.max(0, (layoutDraft?.selectedIndex ?? 1) - 1);
      const selectedValue = layoutDraft?.options?.[selectedSlot];
      if (selectedValue !== undefined) {
        draft.selectedIndex = Math.max(0, definition.options.indexOf(String(selectedValue)));
      }
    }
    if (definition.userScreenNameEditor) {
      const layoutDraft = this.#drafts.get(`m-user-screen-${definition.userScreen}-layout`);
      draft.value = layoutDraft?.name ?? this.#values[`userScreen${definition.userScreen}Title`];
      draft.keyboardCursor = [...String(draft.value)].length;
    }
    this.#drafts.set(definition.id, draft);
    return draft;
  }

  #bindingFor(definition) {
    if (definition.dataBlockPicker || definition.userScreenNameEditor) return null;
    return FIELD_BINDINGS[definition.id];
  }

  #editSlot(draft, action) {
    const indexes = editableDigitIndexes(draft.value);
    if (!indexes.length) return;
    if (action === "center" || action === "right") {
      draft.activeDigit = clamp(draft.activeDigit + (action === "center" ? -1 : 1), 0, indexes.length - 1);
      this.#touch();
      return;
    }
    if (action !== "up" && action !== "down") return;
    const characters = [...String(draft.value)];
    const index = indexes[draft.activeDigit];
    const digit = Number(characters[index]);
    characters[index] = String((digit + (action === "up" ? 1 : 9)) % 10);
    draft.value = characters.join("");
    this.#touch();
  }

  #editBrightness(draft, action) {
    if (action !== "up" && action !== "down") return;
    const increase = action === "up";
    draft.value = clamp(Number(draft.value) + (increase ? 5 : -5), 0, 100);
    this.#touch();
  }

  #editKeyboard(draft, action) {
    if (draft.selectedConfirmation >= 0) {
      if (action === "left" || action === "right") {
        draft.selectedConfirmation = action === "left" ? 0 : 1;
        this.#touch();
      } else if (action === "up") {
        draft.selectedConfirmation = -1;
        this.#touch();
      }
      return;
    }
    if (action === "left" || action === "right") {
      draft.keyboardIndex = (draft.keyboardIndex + (action === "left" ? -1 : 1) + KEYBOARD_KEYS.length) % KEYBOARD_KEYS.length;
      this.#touch();
      return;
    }
    if (action === "up" || action === "down") {
      if (action === "down" && draft.keyboardIndex >= KEYBOARD_KEYS.length - KEYBOARD_COLUMN_COUNT) {
        draft.selectedConfirmation = 1;
        this.#touch();
        return;
      }
      draft.keyboardIndex = (draft.keyboardIndex + (action === "up" ? -KEYBOARD_COLUMN_COUNT : KEYBOARD_COLUMN_COUNT) + KEYBOARD_KEYS.length) % KEYBOARD_KEYS.length;
      this.#touch();
      return;
    }
    if (action !== "center") return;
    const key = KEYBOARD_KEYS[draft.keyboardIndex];
    const characters = [...String(draft.value)];
    draft.keyboardCursor = clamp(draft.keyboardCursor, 0, characters.length);
    if (key === "BACKSPACE" && draft.keyboardCursor > 0) {
      characters.splice(draft.keyboardCursor - 1, 1);
      draft.keyboardCursor -= 1;
    } else if (key === "DELETE" && draft.keyboardCursor < characters.length) {
      characters.splice(draft.keyboardCursor, 1);
    } else if (key === "BACK") {
      draft.keyboardCursor = clamp(draft.keyboardCursor - 1, 0, characters.length);
    } else if (key === "FORWARD") {
      draft.keyboardCursor = clamp(draft.keyboardCursor + 1, 0, characters.length);
    } else {
      const character = key === "SPACE" ? " " : key;
      characters.splice(draft.keyboardCursor, 0, character);
      draft.keyboardCursor += 1;
    }
    draft.value = characters.join("");
    this.#touch();
  }

  #commit(definition, draft) {
    if (definition.kind === "user-layout") {
      this.#values[`userScreen${definition.userScreen}Title`] = draft.name;
      draft.options.forEach((option, index) => {
        this.#values[`userScreen${definition.userScreen}Block${index + 1}`] = option;
      });
      this.#save();
      this.#drafts.delete(definition.id);
      this.#touch();
      return;
    }
    if (definition.dataBlockPicker) {
      const layoutDraft = this.#drafts.get(`m-user-screen-${definition.userScreen}-layout`);
      const selectedSlot = Math.max(0, (layoutDraft?.selectedIndex ?? 1) - 1);
      if (layoutDraft?.options) layoutDraft.options[selectedSlot] = definition.options[draft.selectedIndex];
      this.#drafts.delete(definition.id);
      this.#touch();
      return;
    }
    if (definition.userScreenNameEditor) {
      const layoutDraft = this.#drafts.get(`m-user-screen-${definition.userScreen}-layout`);
      if (layoutDraft) layoutDraft.name = String(draft.value).trim() || `USER SCREEN ${definition.userScreen}`;
      this.#drafts.delete(definition.id);
      this.#touch();
      return;
    }
    const binding = this.#bindingFor(definition);
    if (binding) {
      if (definition.kind === "settings-modal") this.#values[binding] = definition.options[draft.selectedIndex];
      else this.#values[binding] = draft.value;
      this.#save();
    }
    this.#drafts.delete(definition.id);
    this.#touch();
  }

  #applyPageAction(definition) {
    const selectedRow = definition.rows?.[definition.selectedIndex];
    if (selectedRow?.label !== "RESTORE DEFAULTS") return;
    for (const key of RESET_GROUPS[definition.title] ?? []) this.#values[key] = DEFAULT_VALUES[key];
    this.#save();
    this.#touch();
  }

  #discard(stateId) {
    if (!this.#drafts.delete(stateId)) return;
    this.#touch();
  }

  #touch() {
    this.#revision += 1;
  }

  #save() {
    try {
      window.localStorage.setItem(MENU_STORAGE_KEY, JSON.stringify(this.#values));
    } catch {
      // Menu operation remains available when storage is blocked.
    }
  }
}
