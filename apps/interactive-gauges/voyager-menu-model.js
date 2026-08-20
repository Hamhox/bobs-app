const MENU_STORAGE_KEY = "bobs-app:voyager-menu:v1";

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
  sleepModeTimer: "05 MIN",
  chargeMode: "ONLY WHEN MOTOR IS ON",
  chargeLevel: "TRICKLE CHARGE",
  mapOrientation: "TRACK UP",
  mapAutoZoom: "ON",
  logAfterStop: "030 SEC",
  recordMethod: "DISTANCE",
  wrapWhenFull: "WRAP WHEN FULL",
  sampleFrequency: "NORMAL",
  userScreenTitle: "USER SCREEN 1",
  userScreenBlocks: "4",
  userScreenBlock1: "WHEEL SPEED",
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
  "m-set3-5-1-1-1": "userScreenTitle",
  "m-set3-5-1-2-1": "userScreenBlocks",
  "m-set3-5-1-3-1": "userScreenBlock1",
  "m-set3-6-1-1": "yellowLedOn",
  "m-set3-6-2-1": "redLedOn",
  "m-set3-6-3-1": "yellowLedFlash",
  "m-set3-6-4-1": "redLedFlash",
  "m-ride2-6-2-1-1": "rideName",
  "m-ride2-6-4-1-1-1": "rideName",
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
  "SCREEN NAME": "userScreenTitle",
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
  "USER SCREEN 1 SETTINGS": ["userScreenTitle", "userScreenBlocks", "userScreenBlock1"],
  "WARNING LED LIGHTS": ["yellowLedOn", "redLedOn", "yellowLedFlash", "redLedFlash"],
});

const KEYBOARD_KEYS = Object.freeze([
  ..."1234567890-+",
  ..."QWERTYUIOP!°",
  ..."ASDFGHJKL:'\"",
  ..."ZXCVBNM_",
  "SPACE",
  "DELETE",
]);

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
          if (typeof stored[key] === typeof DEFAULT_VALUES[key]) this.#values[key] = stored[key];
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
    if (definition.kind === "slot-input" || definition.kind === "keyboard") resolved.value = draft.value;
    if (definition.kind === "slot-input") resolved.activeDigit = draft.activeDigit;
    if (definition.kind === "brightness") resolved.value = draft.value;
    if (definition.kind === "confirm") resolved.selectedConfirmation = draft.selectedConfirmation;
    if (definition.kind === "keyboard") {
      resolved.keyboardIndex = draft.keyboardIndex;
      resolved.keyboardKey = KEYBOARD_KEYS[draft.keyboardIndex];
    }
    return resolved;
  }

  resolveInputAction(definition, action) {
    if (!definition || action !== "center") return action;
    const centerActivatesSelection = definition.presentation === "page"
      || ["brightness", "confirm", "notice", "settings-modal"].includes(definition.kind);
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

    if (definition.kind === "slot-input") this.#editSlot(draft, preparedAction);
    if (definition.kind === "brightness") this.#editBrightness(draft, preparedAction);
    if (definition.kind === "keyboard") this.#editKeyboard(draft, preparedAction);

    if (preparedAction === "enter") {
      this.#commit(definition, draft);
      if (definition.id === "m-graph-temp-display" || definition.id === "m-graph-alt-display") {
        return { action: preparedAction, targetStateId: draft.selectedIndex === 0 ? "eng2" : "alt2" };
      }
    }
    return { action: preparedAction };
  }

  #draftFor(definition) {
    if (this.#drafts.has(definition.id)) return this.#drafts.get(definition.id);
    const binding = FIELD_BINDINGS[definition.id];
    const storedValue = binding ? this.#values[binding] : undefined;
    const selectedIndex = definition.kind === "settings-modal" && storedValue !== undefined
      ? Math.max(0, definition.options.indexOf(String(storedValue)))
      : definition.selectedIndex ?? 0;
    const value = storedValue ?? definition.value ?? "";
    const digitIndexes = editableDigitIndexes(value);
    const draft = {
      activeDigit: clamp(definition.activeDigit ?? 0, 0, Math.max(0, digitIndexes.length - 1)),
      keyboardIndex: 0,
      selectedConfirmation: 0,
      selectedIndex,
      value,
    };
    this.#drafts.set(definition.id, draft);
    return draft;
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
    if (action === "left" || action === "right") {
      draft.keyboardIndex = (draft.keyboardIndex + (action === "left" ? -1 : 1) + KEYBOARD_KEYS.length) % KEYBOARD_KEYS.length;
      this.#touch();
      return;
    }
    if (action === "up" || action === "down") {
      draft.keyboardIndex = (draft.keyboardIndex + (action === "up" ? -12 : 12) + KEYBOARD_KEYS.length) % KEYBOARD_KEYS.length;
      this.#touch();
      return;
    }
    if (action !== "center") return;
    const key = KEYBOARD_KEYS[draft.keyboardIndex];
    if (key === "DELETE") draft.value = String(draft.value).slice(0, -1);
    else if (key === "SPACE") draft.value += " ";
    else draft.value += key;
    this.#touch();
  }

  #commit(definition, draft) {
    const binding = FIELD_BINDINGS[definition.id];
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
