const MPH_TO_KPH = 1.609344;
const MILES_TO_KILOMETERS = 1.609344;
const FEET_TO_METERS = 0.3048;

const profileCache = new Map();
const powerProfileCache = new Map();
const screenPaletteCache = new Map();
const warningProfileCache = new Map();
const mapProfileCache = new Map();
const gpsProfileCache = new Map();
const BACKLIGHT_OPACITY_VALUES = Object.freeze({ OFF: 0, LOW: 1, MEDIUM: 1, HIGH: 1 });
const BACKLIGHT_CONTRAST_VALUES = Object.freeze({ OFF: 0, LOW: 0, MEDIUM: 0.5, HIGH: 1 });
const MAP_POINTER_SCALES = Object.freeze({ SMALL: 0.78, MEDIUM: 1, LARGE: 1.28 });
const MAP_LABEL_SCALES = Object.freeze({ OFF: 0, SMALL: 0.82, LARGE: 1 });
const MILES_TO_METERS = 1609.344;
const SCREEN_DISPLAY_MODES = Object.freeze({
  NORMAL: Object.freeze({ dark: false, overlay: "standard" }),
  INVERTED: Object.freeze({ dark: true, overlay: "inverted" }),
});
const SCREEN_SURFACE = Object.freeze([245, 244, 239]);
const SCREEN_INK = Object.freeze([36, 32, 33]);
const SCREEN_LIT_SURFACE = Object.freeze([255, 255, 255]);
const SCREEN_LIT_INK = Object.freeze([0, 0, 0]);
export const VOYAGER_BACKLIGHT_COLORS = Object.freeze([
  "AUTHENTIC",
  "BLUE",
  "AMBER",
  "WHITE",
  "PURPLE",
  "VIOLET",
  "RED",
  "YELLOW",
  "GREEN",
]);

function clampUnit(value) {
  return Math.min(1, Math.max(0, Number(value) || 0));
}

function mixRgb(from, to, amount) {
  const ratio = clampUnit(amount);
  return from.map((channel, index) => Math.round(channel + (to[index] - channel) * ratio));
}

function rgbCss(channels) {
  return `rgb(${channels.join(" ")})`;
}

export function normalizeVoyagerDisplayMode(value) {
  const normalized = String(value ?? "NORMAL").toUpperCase();
  if (normalized === "LIGHT" || normalized === "NEUTRAL") return "NORMAL";
  if (normalized === "DARK") return "INVERTED";
  return SCREEN_DISPLAY_MODES[normalized] ? normalized : "NORMAL";
}

export function normalizeVoyagerBacklightColor(value) {
  const normalized = String(value ?? "WHITE").toUpperCase();
  return VOYAGER_BACKLIGHT_COLORS.includes(normalized) ? normalized : "WHITE";
}

export function createVoyagerScreenPalette({
  displayMode,
  colorTheme,
  theme,
  inverted = false,
  backlightActive = false,
  backlightLevel = "HIGH",
} = {}) {
  const requestedMode = displayMode ?? colorTheme ?? theme ?? (inverted ? "INVERTED" : "NORMAL");
  const mode = normalizeVoyagerDisplayMode(requestedMode);
  const modeProfile = SCREEN_DISPLAY_MODES[mode];
  const normalizedBacklightLevel = ["OFF", "LOW", "MEDIUM", "HIGH"].includes(backlightLevel)
    ? backlightLevel
    : "HIGH";
  const illuminated = Boolean(backlightActive) && normalizedBacklightLevel !== "OFF";
  const illumination = illuminated
    ? BACKLIGHT_CONTRAST_VALUES[normalizedBacklightLevel]
    : 0;
  const signature = `${mode}:${illuminated ? normalizedBacklightLevel : "UNLIT"}`;
  const cached = screenPaletteCache.get(signature);
  if (cached) return cached;

  // Display polarity and illumination are independent on the physical LCD.
  // An unlit or Low screen retains the approved reflective colors. Medium and
  // High increase the LCD contrast beneath the separately composited backlight.
  const surface = mixRgb(SCREEN_SURFACE, SCREEN_LIT_SURFACE, illumination);
  const ink = mixRgb(SCREEN_INK, SCREEN_LIT_INK, illumination);
  const background = modeProfile.dark ? ink : surface;
  const foreground = modeProfile.dark ? surface : ink;
  const mid = mixRgb(background, foreground, 0.42);
  const muted = mixRgb(background, foreground, 0.29);
  const shadow = mixRgb(background, foreground, 0.44);
  const routeMuted = mixRgb(background, foreground, 0.56);
  const routeInk = modeProfile.dark
    ? mixRgb(foreground, background, 0.06)
    : mixRgb([25, 25, 25], SCREEN_LIT_INK, illumination);
  const profile = Object.freeze({
    signature,
    displayMode: mode,
    theme: mode,
    dark: modeProfile.dark,
    overlay: modeProfile.overlay,
    inverted: mode === "INVERTED",
    backlightActive: illuminated,
    backlightLevel: normalizedBacklightLevel,
    illumination,
    screen: rgbCss(background),
    ink: rgbCss(foreground),
    mid: rgbCss(mid),
    muted: rgbCss(muted),
    shadow: rgbCss(shadow),
    routeInk: rgbCss(routeInk),
    routeMuted: rgbCss(routeMuted),
  });
  if (screenPaletteCache.size >= 24) screenPaletteCache.delete(screenPaletteCache.keys().next().value);
  screenPaletteCache.set(signature, profile);
  return profile;
}

function warningThreshold(value) {
  const threshold = Number.parseInt(value, 10);
  return Number.isFinite(threshold) && threshold > 0 ? threshold : Number.POSITIVE_INFINITY;
}

export function createVoyagerWarningProfile(values = {}) {
  const signature = [
    values.yellowLedOn ?? "000 °F",
    values.yellowLedFlash ?? "000 °F",
    values.redLedOn ?? "000 °F",
    values.redLedFlash ?? "000 °F",
  ].join(":");
  const cached = warningProfileCache.get(signature);
  if (cached) return cached;
  const thresholds = Object.freeze({
    yellow: Object.freeze({
      on: warningThreshold(values.yellowLedOn),
      flash: warningThreshold(values.yellowLedFlash),
    }),
    red: Object.freeze({
      on: warningThreshold(values.redLedOn),
      flash: warningThreshold(values.redLedFlash),
    }),
  });
  const profile = Object.freeze({
    signature,
    thresholds,
    stateFor(color, temperatureF) {
      const limits = thresholds[color];
      const temperature = Number(temperatureF);
      if (!limits || !Number.isFinite(temperature)) return "off";
      if (temperature >= limits.flash) return "flash";
      if (temperature >= limits.on) return "on";
      return "off";
    },
  });
  if (warningProfileCache.size >= 16) warningProfileCache.delete(warningProfileCache.keys().next().value);
  warningProfileCache.set(signature, profile);
  return profile;
}

function profileSignature(values = {}) {
  return [
    values.distanceUnits === "KILOMETERS" ? "metric-distance" : "miles",
    values.altitudeUnits === "METERS" ? "meters" : "feet",
    values.temperatureUnits === "CELSIUS" ? "celsius" : "fahrenheit",
    values.clockFormat === "24 HOUR" ? "24-hour" : "12-hour",
    values.timeOfDay ?? "12:42:04 PM",
    normalizeVoyagerDisplayMode(values.displayMode).toLowerCase(),
  ].join(":");
}

function parseClockSeconds(value) {
  const match = String(value).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) return 12 * 3600 + 42 * 60 + 4;
  let hours = Number(match[1]);
  const meridiem = match[4]?.toUpperCase();
  if (meridiem) {
    hours %= 12;
    if (meridiem === "PM") hours += 12;
  }
  return (hours % 24) * 3600 + Number(match[2]) * 60 + Number(match[3] ?? 0);
}

function clockLabel(totalSeconds, use24Hour) {
  const wrappedSeconds = ((Math.floor(totalSeconds) % 86400) + 86400) % 86400;
  const hours = Math.floor(wrappedSeconds / 3600);
  const minutes = String(Math.floor(wrappedSeconds % 3600 / 60)).padStart(2, "0");
  return use24Hour
    ? `${String(hours).padStart(2, "0")}:${minutes}`
    : `${hours % 12 || 12}:${minutes}`;
}

export function createVoyagerDisplayProfile(values = {}) {
  const signature = profileSignature(values);
  const cached = profileCache.get(signature);
  if (cached) return cached;

  const metricDistance = values.distanceUnits === "KILOMETERS";
  const metricAltitude = values.altitudeUnits === "METERS";
  const celsius = values.temperatureUnits === "CELSIUS";
  const use24Hour = values.clockFormat === "24 HOUR";
  const clockStartSeconds = parseClockSeconds(values.timeOfDay);
  const displayMode = normalizeVoyagerDisplayMode(values.displayMode);
  const profile = Object.freeze({
    signature,
    displayMode,
    colorTheme: displayMode,
    inverted: displayMode === "INVERTED",
    speedUnit: metricDistance ? "KM/H" : "MPH",
    distanceUnit: metricDistance ? "KM" : "MI",
    altitudeUnit: metricAltitude ? "M" : "FT",
    temperatureUnit: celsius ? "°C" : "°F",
    speedFromMph: metricDistance
      ? (value) => Math.round(value * MPH_TO_KPH)
      : (value) => Math.round(value),
    distanceFromKm: metricDistance
      ? (value) => value
      : (value) => value / MILES_TO_KILOMETERS,
    distanceFromMiles: metricDistance
      ? (value) => value * MILES_TO_KILOMETERS
      : (value) => value,
    destinationFromMeters: metricDistance
      ? (value) => Math.round(value / 1000)
      : (value) => Math.round(value / 1609.344),
    altitudeFromFeet: metricAltitude
      ? (value) => Math.round(value * FEET_TO_METERS)
      : (value) => Math.round(value),
    temperatureFromF: celsius
      ? (value) => Math.round((value - 32) * 5 / 9)
      : (value) => Math.round(value),
    clockAtElapsedSeconds: (elapsedSeconds) => clockLabel(clockStartSeconds + elapsedSeconds, use24Hour),
  });
  if (profileCache.size >= 16) profileCache.delete(profileCache.keys().next().value);
  profileCache.set(signature, profile);
  return profile;
}

function durationMilliseconds(value, multiplier) {
  const amount = Number.parseInt(value, 10);
  return Number.isFinite(amount) && amount > 0 ? amount * multiplier : Number.POSITIVE_INFINITY;
}

export function createVoyagerPowerProfile(values = {}, { externalPower = true } = {}) {
  const signature = [
    externalPower ? "external" : "battery",
    values.backlightLevel ?? "HIGH",
    values.backlightBattery ?? "020 SEC",
    values.backlightExternal ?? "000 SEC",
    values.sleepBattery ?? "03 MIN",
    values.sleepExternal ?? "20 MIN",
    values.turnOff ?? "60 MIN",
    values.chargeMode ?? "VEHICLE",
  ].join(":");
  const cached = powerProfileCache.get(signature);
  if (cached) return cached;

  const profile = Object.freeze({
    signature,
    externalPower,
    backlightLevel: ["OFF", "LOW", "MEDIUM", "HIGH"].includes(values.backlightLevel) ? values.backlightLevel : "HIGH",
    backlightOpacity: BACKLIGHT_OPACITY_VALUES[values.backlightLevel] ?? BACKLIGHT_OPACITY_VALUES.HIGH,
    backlightTimeoutMs: durationMilliseconds(
      externalPower ? values.backlightExternal : values.backlightBattery,
      1000,
    ),
    sleepAfterMs: durationMilliseconds(
      externalPower ? values.sleepExternal : values.sleepBattery,
      60 * 1000,
    ),
    powerOffAfterMs: durationMilliseconds(values.turnOff, 60 * 1000),
    chargeMode: values.chargeMode === "WALL PLUG" ? "WALL PLUG" : "VEHICLE",
  });
  if (powerProfileCache.size >= 16) powerProfileCache.delete(powerProfileCache.keys().next().value);
  powerProfileCache.set(signature, profile);
  return profile;
}

function coordinateParts(value) {
  const absolute = Math.abs(Number(value) || 0);
  const degrees = Math.floor(absolute);
  const decimalMinutes = (absolute - degrees) * 60;
  const minutes = Math.floor(decimalMinutes);
  const seconds = (decimalMinutes - minutes) * 60;
  return { absolute, degrees, decimalMinutes, minutes, seconds };
}

function formatCoordinate(value, positive, negative, format) {
  const hemisphere = Number(value) >= 0 ? positive : negative;
  const { absolute, degrees, decimalMinutes, minutes, seconds } = coordinateParts(value);
  if (format === "DEG.DEC") return `${hemisphere} ${absolute.toFixed(6)}\u00B0`;
  if (format === "DEG, MIN, SEC") {
    return `${hemisphere} ${degrees}\u00B0 ${String(minutes).padStart(2, "0")}\u2032 ${seconds.toFixed(1).padStart(4, "0")}\u2033`;
  }
  return `${hemisphere} ${degrees}\u00B0 ${decimalMinutes.toFixed(3).padStart(6, "0")}\u2032`;
}

export function createVoyagerGpsProfile(values = {}) {
  const method = values.logMethod === "DISTANCE" ? "DISTANCE" : "TIME";
  const frequency = values.logFrequency ?? (method === "DISTANCE" ? "10 FT" : "1 SEC");
  const logOption = ["ALWAYS", "ENG SENSOR", "WHL SENSOR", "ENG OR WHL"].includes(values.logOption)
    ? values.logOption
    : "ENG OR WHL";
  const autoSplit = ["OFF", "1 MI GAP", "5 MI GAP", "10 MI GAP"].includes(values.autoSplit)
    ? values.autoSplit
    : "5 MI GAP";
  const coordinateFormat = ["DEG.DEC", "DEG, MIN.DEC", "DEG, MIN, SEC"].includes(values.coordFormat)
    ? values.coordFormat
    : "DEG, MIN.DEC";
  const signature = [
    values.logTrack === "ON" ? "record-on" : "record-off",
    values.gpsMode === "DISABLED (POWER SAVE)" ? "gps-off" : "gps-on",
    method,
    frequency,
    logOption,
    autoSplit,
    coordinateFormat,
    values.signalBars === "ON" ? "bars-on" : "bars-off",
    values.engineSensor === "ENABLED" ? "engine-on" : "engine-off",
    values.wheelSensor === "ENABLED" ? "wheel-on" : "wheel-off",
  ].join(":");
  const cached = gpsProfileCache.get(signature);
  if (cached) return cached;

  const frequencyAmount = Math.max(1, Number.parseInt(frequency, 10) || (method === "DISTANCE" ? 10 : 1));
  const autoSplitMiles = Number.parseInt(autoSplit, 10);
  const gpsEnabled = values.gpsMode !== "DISABLED (POWER SAVE)";
  const recordingRequested = values.logTrack === "ON" && gpsEnabled;
  const engineSensorEnabled = values.engineSensor === "ENABLED";
  const wheelSensorEnabled = values.wheelSensor === "ENABLED";
  const profile = Object.freeze({
    signature,
    gpsEnabled,
    recordingRequested,
    method,
    frequency,
    sampleIntervalMs: method === "TIME" ? frequencyAmount * 1000 : Number.POSITIVE_INFINITY,
    sampleDistanceMeters: method === "DISTANCE" ? frequencyAmount * FEET_TO_METERS : Number.POSITIVE_INFINITY,
    autoSplitMeters: autoSplit === "OFF" || !Number.isFinite(autoSplitMiles)
      ? Number.POSITIVE_INFINITY
      : autoSplitMiles * MILES_TO_METERS,
    logOption,
    coordinateFormat,
    signalBars: values.signalBars === "ON",
    shouldRecord: ({ engineRunning = false, wheelMoving = false } = {}) => {
      if (!recordingRequested) return false;
      const engineActive = engineSensorEnabled && engineRunning;
      const wheelActive = wheelSensorEnabled && wheelMoving;
      if (logOption === "ALWAYS") return true;
      if (logOption === "ENG SENSOR") return engineActive;
      if (logOption === "WHL SENSOR") return wheelActive;
      return engineActive || wheelActive;
    },
    formatLatitude: (value) => formatCoordinate(value, "N", "S", coordinateFormat),
    formatLongitude: (value) => formatCoordinate(value, "E", "W", coordinateFormat),
  });
  if (gpsProfileCache.size >= 24) gpsProfileCache.delete(gpsProfileCache.keys().next().value);
  gpsProfileCache.set(signature, profile);
  return profile;
}

function mapClippingFeet(value) {
  if (value === "NEVER") return Number.POSITIVE_INFINITY;
  const amount = Number.parseInt(value, 10);
  if (!Number.isFinite(amount)) return 1500;
  return String(value).includes("MI") ? amount * 5280 : amount;
}

function mapScreenProfile(values, screenNumber) {
  const prefix = `mapScreen${screenNumber}`;
  const mode = values[prefix] ?? "AUTO-CENTER";
  const labelProfile = (kind) => {
    const settingName = `${prefix}${kind}Labels`;
    const clippingName = `${prefix}${kind}Clipping`;
    const size = values[settingName] ?? (screenNumber === 1 ? "LARGE" : "OFF");
    return Object.freeze({
      size,
      scale: MAP_LABEL_SCALES[size] ?? 0,
      clippingFeet: mapClippingFeet(values[clippingName]),
    });
  };
  return Object.freeze({
    number: screenNumber,
    enabled: screenNumber === 1 || mode !== "DISABLED",
    mode,
    autoCenter: mode === "AUTO-CENTER",
    waypointIcons: values[`${prefix}WaypointIcons`] === "DOT" ? "DOT" : "ID#",
    labels: Object.freeze({
      track: labelProfile("Track"),
      route: labelProfile("Route"),
      waypoint: labelProfile("Waypoint"),
    }),
  });
}

export function createVoyagerMapProfile(values = {}) {
  const selectedTracks = Array.isArray(values.visibleTracks) ? values.visibleTracks : [];
  const signature = [
    values.tracksDisplay ?? "ALL",
    selectedTracks.join("|"),
    values.routesDisplay ?? "ALL",
    values.waypointsDisplay ?? "ALL",
    values.mapOrientation ?? "NORTH UP",
    values.pointerSize ?? "MEDIUM",
    values.mapScreen1 ?? "AUTO-CENTER",
    values.mapScreen1TrackLabels ?? "LARGE",
    values.mapScreen1TrackClipping ?? "1500 FT",
    values.mapScreen1RouteLabels ?? "LARGE",
    values.mapScreen1RouteClipping ?? "1500 FT",
    values.mapScreen1WaypointIcons ?? "ID#",
    values.mapScreen1WaypointLabels ?? "LARGE",
    values.mapScreen1WaypointClipping ?? "1500 FT",
    values.mapScreen2 ?? "AUTO-CENTER",
    values.mapScreen2TrackLabels ?? "OFF",
    values.mapScreen2TrackClipping ?? "1500 FT",
    values.mapScreen2RouteLabels ?? "OFF",
    values.mapScreen2RouteClipping ?? "1500 FT",
    values.mapScreen2WaypointIcons ?? "ID#",
    values.mapScreen2WaypointLabels ?? "OFF",
    values.mapScreen2WaypointClipping ?? "1500 FT",
    values.panZoomTimeout ?? "030 SEC",
  ].join(":");
  const cached = mapProfileCache.get(signature);
  if (cached) return cached;

  const selectedTrackLabels = new Set(selectedTracks.map((label) => String(label).toUpperCase()));
  const displayMode = (kind) => values[`${kind}sDisplay`] ?? "ALL";
  const resourceVisible = (kind, labels = []) => {
    const mode = displayMode(kind);
    if (mode === "NONE") return false;
    if (mode !== "CUSTOM") return true;
    if (kind !== "track" || selectedTrackLabels.size === 0) return true;
    return labels.some((label) => selectedTrackLabels.has(String(label).toUpperCase()));
  };
  const screen1 = mapScreenProfile(values, 1);
  const screen2 = mapScreenProfile(values, 2);
  const panZoomSeconds = Number.parseInt(values.panZoomTimeout, 10);
  const profile = Object.freeze({
    signature,
    orientation: values.mapOrientation === "TRACK UP" ? "TRACK UP" : "NORTH UP",
    pointerScale: MAP_POINTER_SCALES[values.pointerSize] ?? MAP_POINTER_SCALES.MEDIUM,
    panZoomTimeoutMs: Number.isFinite(panZoomSeconds) && panZoomSeconds > 0
      ? panZoomSeconds * 1000
      : Number.POSITIVE_INFINITY,
    screen1,
    screen2,
    screen: (number) => number === 2 ? screen2 : screen1,
    resourceVisible,
    labelsVisible: (screenNumber, kind, mapScale) => {
      const label = (screenNumber === 2 ? screen2 : screen1).labels[kind];
      if (!label?.scale) return false;
      const scaleBarFeet = 2 * 5280 / Math.max(0.01, mapScale);
      return scaleBarFeet <= label.clippingFeet;
    },
  });
  if (mapProfileCache.size >= 32) mapProfileCache.delete(mapProfileCache.keys().next().value);
  mapProfileCache.set(signature, profile);
  return profile;
}

export function createVoyagerInventorySnapshot(memorySummary, {
  savedRideCount = 0,
  savedWaypointCount = 0,
} = {}) {
  const snapshot = {
    trackCount: memorySummary.trackCount,
    trackUsage: memorySummary.trackUsage,
    routeCount: memorySummary.routeCount,
    routeUsage: memorySummary.routeUsage,
    waypointCount: memorySummary.waypointCount + savedWaypointCount,
    microSdUsedMb: memorySummary.microSdUsedMb,
    microSdCapacityMb: memorySummary.microSdCapacityMb,
    savedRideCount,
    recordedPointCount: memorySummary.recordedPointCount ?? 0,
    recordedSegmentCount: memorySummary.recordedSegmentCount ?? 0,
    recordedBytes: memorySummary.recordedBytes ?? 0,
    exportedBytes: memorySummary.exportedBytes ?? 0,
  };
  return Object.freeze({
    ...snapshot,
    signature: [
      snapshot.trackCount,
      snapshot.trackUsage,
      snapshot.routeCount,
      snapshot.routeUsage,
      snapshot.waypointCount,
      snapshot.microSdUsedMb,
      snapshot.microSdCapacityMb,
      snapshot.savedRideCount,
      snapshot.recordedPointCount,
      snapshot.recordedSegmentCount,
      snapshot.recordedBytes,
      snapshot.exportedBytes,
    ].join(":"),
  });
}
