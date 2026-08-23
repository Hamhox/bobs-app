const MPH_TO_KPH = 1.609344;
const MILES_TO_KILOMETERS = 1.609344;
const FEET_TO_METERS = 0.3048;

const profileCache = new Map();
const powerProfileCache = new Map();
const mapProfileCache = new Map();
const gpsProfileCache = new Map();
const BACKLIGHT_BRIGHTNESS_VALUES = Object.freeze({ OFF: 18, LOW: 30, MEDIUM: 40, HIGH: 50 });
const MAP_POINTER_SCALES = Object.freeze({ SMALL: 0.78, MEDIUM: 1, LARGE: 1.28 });
const MAP_LABEL_SCALES = Object.freeze({ OFF: 0, SMALL: 0.82, LARGE: 1 });
const MILES_TO_METERS = 1609.344;

function profileSignature(values = {}) {
  return [
    values.distanceUnits === "KILOMETERS" ? "metric-distance" : "miles",
    values.altitudeUnits === "METERS" ? "meters" : "feet",
    values.temperatureUnits === "CELSIUS" ? "celsius" : "fahrenheit",
    values.clockFormat === "24 HOUR" ? "24-hour" : "12-hour",
    values.timeOfDay ?? "12:42:04 PM",
    values.displayMode === "INVERTED" ? "inverted" : "normal",
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
  const profile = Object.freeze({
    signature,
    inverted: values.displayMode === "INVERTED",
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
    backlightBrightnessValue: BACKLIGHT_BRIGHTNESS_VALUES[values.backlightLevel] ?? BACKLIGHT_BRIGHTNESS_VALUES.HIGH,
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
  const frequency = values.logFrequency ?? (method === "DISTANCE" ? "10 FT" : "2 SEC");
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

  const frequencyAmount = Math.max(1, Number.parseInt(frequency, 10) || (method === "DISTANCE" ? 10 : 2));
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
