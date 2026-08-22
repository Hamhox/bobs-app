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
  normalized.speedUnits = VOYAGER_SETTING_RULES.speedUnits.derive(normalized);
  if (!["WHL SENSOR", "GPS"].includes(normalized.speedSource)) normalized.speedSource = "WHL SENSOR";
  if (!["ENG OR WHL", "GPS"].includes(normalized.runTimeSource)) normalized.runTimeSource = "ENG OR WHL";
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
