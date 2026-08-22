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
});

export function isVoyagerSettingAvailable(field, values = {}) {
  const requirements = VOYAGER_SETTING_RULES[field]?.requires ?? [];
  return requirements.every(({ field: dependency, value }) => values[dependency] === value);
}

export function normalizeVoyagerSettings(values = {}) {
  const normalized = { ...values };
  const normalizeTimer = (value, digits, unit) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return value;
    return `${String(Math.max(0, parsed)).padStart(digits, "0")} ${unit}`;
  };
  normalized.speedUnits = VOYAGER_SETTING_RULES.speedUnits.derive(normalized);
  if (!["WHL SENSOR", "GPS"].includes(normalized.speedSource)) normalized.speedSource = "WHL SENSOR";
  if (!["ENG OR WHL", "GPS"].includes(normalized.runTimeSource)) normalized.runTimeSource = "ENG OR WHL";
  if (!["OFF", "LOW", "MEDIUM", "HIGH"].includes(normalized.backlightLevel)) normalized.backlightLevel = "HIGH";
  if (!["VEHICLE", "WALL PLUG"].includes(normalized.chargeMode)) normalized.chargeMode = "VEHICLE";
  normalized.backlightBattery = normalizeTimer(normalized.backlightBattery, 3, "SEC");
  normalized.backlightExternal = normalizeTimer(normalized.backlightExternal, 3, "SEC");
  normalized.sleepBattery = normalizeTimer(normalized.sleepBattery, 2, "MIN");
  normalized.sleepExternal = normalizeTimer(normalized.sleepExternal, 2, "MIN");
  normalized.turnOff = normalizeTimer(normalized.turnOff, 2, "MIN");
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
