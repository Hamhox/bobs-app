const requirement = (field, value = "ENABLED") => Object.freeze({ field, value });

const WHEEL_SENSOR_REQUIRED = Object.freeze([requirement("wheelSensor")]);
const ENGINE_SENSOR_REQUIRED = Object.freeze([requirement("engineSensor")]);
const BOTH_SENSORS_REQUIRED = Object.freeze([
  requirement("wheelSensor"),
  requirement("engineSensor"),
]);

export const VOYAGER_SETTING_RULES = Object.freeze({
  speedUnits: Object.freeze({
    derive: (values) => values.distanceUnits === "KILOMETERS" ? "KM/H" : "MPH",
  }),
  wheelSize: Object.freeze({ requires: WHEEL_SENSOR_REQUIRED }),
  speedSource: Object.freeze({
    requires: WHEEL_SENSOR_REQUIRED,
    effective: (values) => values.wheelSensor === "ENABLED" ? values.speedSource : "GPS",
  }),
  ppr: Object.freeze({ requires: ENGINE_SENSOR_REQUIRED }),
  sensorSensitivity: Object.freeze({ requires: ENGINE_SENSOR_REQUIRED }),
  tachbarScreen: Object.freeze({ requires: ENGINE_SENSOR_REQUIRED }),
  tachScale: Object.freeze({ requires: ENGINE_SENSOR_REQUIRED }),
  mainScreenMode: Object.freeze({ requires: ENGINE_SENSOR_REQUIRED }),
  runTimeSource: Object.freeze({
    requires: BOTH_SENSORS_REQUIRED,
    effective: (values) => {
      const wheelEnabled = values.wheelSensor === "ENABLED";
      const engineEnabled = values.engineSensor === "ENABLED";
      if (wheelEnabled && engineEnabled) return values.runTimeSource;
      if (engineEnabled) return "ENG SENSOR";
      if (wheelEnabled) return "WHL SENSOR";
      return "GPS";
    },
  }),
  mapScreen1TrackClipping: Object.freeze({
    available: (values) => values.mapScreen1TrackLabels !== "OFF",
  }),
  mapScreen1RouteClipping: Object.freeze({
    available: (values) => values.mapScreen1RouteLabels !== "OFF",
  }),
  mapScreen1WaypointClipping: Object.freeze({
    available: (values) => values.mapScreen1WaypointLabels !== "OFF",
  }),
  mapScreen2Options: Object.freeze({
    available: (values) => values.mapScreen2 !== "DISABLED",
  }),
  mapScreen2TrackClipping: Object.freeze({
    available: (values) => values.mapScreen2TrackLabels !== "OFF",
  }),
  mapScreen2RouteClipping: Object.freeze({
    available: (values) => values.mapScreen2RouteLabels !== "OFF",
  }),
  mapScreen2WaypointClipping: Object.freeze({
    available: (values) => values.mapScreen2WaypointLabels !== "OFF",
  }),
});

export function isVoyagerSettingAvailable(field, values = {}) {
  const rule = VOYAGER_SETTING_RULES[field];
  const requirements = rule?.requires ?? [];
  return requirements.every(({ field: dependency, value }) => values[dependency] === value)
    && (rule?.available?.(values) ?? true);
}

export function normalizeVoyagerSettings(values = {}) {
  const normalized = { ...values };
  const normalizeTimer = (value, digits, unit) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return value;
    return `${String(Math.max(0, parsed)).padStart(digits, "0")} ${unit}`;
  };
  normalized.speedUnits = VOYAGER_SETTING_RULES.speedUnits.derive(normalized);
  const legacyDisplayMode = String(normalized.displayMode ?? "NORMAL").toUpperCase();
  if (legacyDisplayMode === "AMBER" || legacyDisplayMode === "GREEN") {
    normalized.backlightColor = legacyDisplayMode;
    normalized.displayMode = "NORMAL";
  } else if (legacyDisplayMode === "LIGHT" || legacyDisplayMode === "NEUTRAL") {
    normalized.displayMode = "NORMAL";
  } else if (legacyDisplayMode === "DARK") {
    normalized.displayMode = "INVERTED";
  } else if (!["NORMAL", "INVERTED"].includes(legacyDisplayMode)) {
    normalized.displayMode = "NORMAL";
  } else {
    normalized.displayMode = legacyDisplayMode;
  }
  if (!["AUTHENTIC", "BLUE", "AMBER", "WHITE", "PURPLE", "VIOLET", "RED", "YELLOW", "GREEN"].includes(normalized.backlightColor)) {
    normalized.backlightColor = "WHITE";
  }
  if (!["WHL SENSOR", "GPS"].includes(normalized.speedSource)) normalized.speedSource = "WHL SENSOR";
  if (!["ENG OR WHL", "GPS"].includes(normalized.runTimeSource)) normalized.runTimeSource = "ENG OR WHL";
  if (!["OFF", "LOW", "MEDIUM", "HIGH"].includes(normalized.backlightLevel)) normalized.backlightLevel = "HIGH";
  if (!["VEHICLE", "WALL PLUG"].includes(normalized.chargeMode)) normalized.chargeMode = "VEHICLE";
  if (!["TIME", "DISTANCE"].includes(normalized.logMethod)) normalized.logMethod = "TIME";
  const logFrequencies = normalized.logMethod === "DISTANCE"
    ? ["1 FT", "10 FT", "50 FT"]
    : ["1 SEC", "2 SEC", "5 SEC"];
  if (!logFrequencies.includes(normalized.logFrequency)) {
    normalized.logFrequency = normalized.logMethod === "DISTANCE" ? "10 FT" : "1 SEC";
  }
  if (!["ALWAYS", "ENG SENSOR", "WHL SENSOR", "ENG OR WHL"].includes(normalized.logOption)) normalized.logOption = "ENG OR WHL";
  if (!["OFF", "1 MI GAP", "5 MI GAP", "10 MI GAP"].includes(normalized.autoSplit)) normalized.autoSplit = "5 MI GAP";
  if (!["DEG.DEC", "DEG, MIN.DEC", "DEG, MIN, SEC"].includes(normalized.coordFormat)) normalized.coordFormat = "DEG, MIN.DEC";
  if (!["ON", "OFF"].includes(normalized.signalBars)) normalized.signalBars = "OFF";
  if (!["TRACK UP", "NORTH UP"].includes(normalized.mapOrientation)) normalized.mapOrientation = "NORTH UP";
  if (!["RUNNING", "PAUSED"].includes(normalized.demoRideState)) normalized.demoRideState = "RUNNING";
  if (!["1X", "2X", "4X"].includes(normalized.demoPlaybackSpeed)) normalized.demoPlaybackSpeed = "1X";
  if (!["ON", "OFF"].includes(normalized.demoLoop)) normalized.demoLoop = "ON";
  if (!["SMALL", "MEDIUM", "LARGE"].includes(normalized.pointerSize)) normalized.pointerSize = "MEDIUM";
  if (!["AUTO-CENTER", "FIXED"].includes(normalized.mapScreen1)) normalized.mapScreen1 = "AUTO-CENTER";
  if (!["DISABLED", "FIXED", "AUTO-CENTER"].includes(normalized.mapScreen2)) normalized.mapScreen2 = "AUTO-CENTER";
  const labelSizes = ["OFF", "SMALL", "LARGE"];
  const clippingValues = ["750 FT", "1500 FT", "3000 FT", "1 MI", "2 MI", "NEVER"];
  for (const screen of [1, 2]) {
    for (const type of ["Track", "Route", "Waypoint"]) {
      const labelField = `mapScreen${screen}${type}Labels`;
      const clippingField = `mapScreen${screen}${type}Clipping`;
      const labelDefault = screen === 1 ? "LARGE" : "OFF";
      if (!labelSizes.includes(normalized[labelField])) normalized[labelField] = labelDefault;
      if (!clippingValues.includes(normalized[clippingField])) normalized[clippingField] = "1500 FT";
    }
    const iconField = `mapScreen${screen}WaypointIcons`;
    if (!["ID#", "DOT"].includes(normalized[iconField])) normalized[iconField] = "ID#";
  }
  normalized.backlightBattery = normalizeTimer(normalized.backlightBattery, 3, "SEC");
  normalized.backlightExternal = normalizeTimer(normalized.backlightExternal, 3, "SEC");
  normalized.sleepBattery = normalizeTimer(normalized.sleepBattery, 2, "MIN");
  normalized.sleepExternal = normalizeTimer(normalized.sleepExternal, 2, "MIN");
  normalized.turnOff = normalizeTimer(normalized.turnOff, 2, "MIN");
  normalized.panZoomTimeout = normalizeTimer(normalized.panZoomTimeout, 3, "SEC");
  for (const field of ["yellowLedOn", "redLedOn", "yellowLedFlash", "redLedFlash"]) {
    const threshold = Number.parseInt(normalized[field], 10);
    normalized[field] = `${String(Number.isFinite(threshold) ? Math.min(999, Math.max(0, threshold)) : 0).padStart(3, "0")} °F`;
  }
  return normalized;
}

export function createVoyagerEffectiveSettings(values = {}) {
  const effective = normalizeVoyagerSettings(values);
  for (const [field, rule] of Object.entries(VOYAGER_SETTING_RULES)) {
    if (rule.derive) effective[field] = rule.derive(effective);
    if (rule.effective) effective[field] = rule.effective(effective);
  }
  return Object.freeze(effective);
}
