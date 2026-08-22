const MPH_TO_KPH = 1.609344;
const MILES_TO_KILOMETERS = 1.609344;
const FEET_TO_METERS = 0.3048;

const profileCache = new Map();

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
    ].join(":"),
  });
}
