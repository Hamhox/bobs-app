#!/usr/bin/env node

import {
  createVoyagerDisplayProfile,
  createVoyagerInventorySnapshot,
} from "../voyager-device-runtime.js";
import { VoyagerMenuModel } from "../voyager-menu-model.js";
import { VoyagerStateEngine } from "../voyager-state-engine.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const imperial = createVoyagerDisplayProfile({
  distanceUnits: "MILES",
  altitudeUnits: "FEET",
  temperatureUnits: "FAHRENHEIT",
  clockFormat: "12 HOUR",
  timeOfDay: "12:42:04 PM",
  displayMode: "NORMAL",
});
const repeatedImperial = createVoyagerDisplayProfile({
  distanceUnits: "MILES",
  altitudeUnits: "FEET",
  temperatureUnits: "FAHRENHEIT",
  clockFormat: "12 HOUR",
  timeOfDay: "12:42:04 PM",
  displayMode: "NORMAL",
});
assert(imperial === repeatedImperial, "display profiles are not cached by their stable settings signature");
assert(imperial.speedFromMph(27) === 27, "default MPH path performs an unnecessary conversion");
assert(imperial.altitudeFromFeet(1132) === 1132, "default feet path performs an unnecessary conversion");
assert(imperial.temperatureFromF(68) === 68, "default Fahrenheit path performs an unnecessary conversion");
assert(imperial.clockAtElapsedSeconds(60) === "12:43", "12-hour device clock formatting is incorrect");

const metric = createVoyagerDisplayProfile({
  distanceUnits: "KILOMETERS",
  altitudeUnits: "METERS",
  temperatureUnits: "CELSIUS",
  clockFormat: "24 HOUR",
  timeOfDay: "7:42:04 PM",
  displayMode: "INVERTED",
});
assert(metric.speedUnit === "KM/H" && metric.speedFromMph(10) === 16, "metric speed profile is incorrect");
assert(metric.distanceUnit === "KM" && metric.distanceFromKm(12.5) === 12.5, "native kilometer path is not a no-op");
assert(metric.altitudeUnit === "M" && metric.altitudeFromFeet(1000) === 305, "metric altitude profile is incorrect");
assert(metric.temperatureUnit === "°C" && metric.temperatureFromF(68) === 20, "Celsius profile is incorrect");
assert(metric.clockAtElapsedSeconds(60) === "19:43", "24-hour device clock formatting is incorrect");
assert(metric.inverted, "inverted display mode is missing from the profile");

const inventory = createVoyagerInventorySnapshot({
  trackCount: 3,
  trackUsage: 0.31,
  routeCount: 4,
  routeUsage: 0.17,
  waypointCount: 5,
  microSdUsedMb: 416,
  microSdCapacityMb: 486,
}, { savedRideCount: 4, savedWaypointCount: 4 });
assert(inventory.waypointCount === 9 && inventory.savedRideCount === 4, "inventory snapshot does not include loaded and saved content");
assert(Object.isFrozen(inventory), "inventory snapshot must be immutable between content changes");

const storedValues = JSON.stringify({ distanceUnits: "KILOMETERS", speedUnits: "MPH" });
globalThis.window = {
  localStorage: {
    getItem: () => storedValues,
    setItem: () => {},
  },
  setTimeout: (_callback, delay) => {
    globalThis.__voyagerDelay = delay;
    return 1;
  },
  clearTimeout: () => {},
};
const model = new VoyagerMenuModel().load();
assert(model.values.distanceUnits === "KILOMETERS" && model.values.speedUnits === "KM/H", "distance and speed units can drift apart");

const manifest = {
  initialState: "index",
  states: {
    index: {
      id: "index",
      transitions: {},
      autoTransition: { active: true, delayMs: 20000, target: "hidden" },
    },
    hidden: { id: "hidden", transitions: {}, autoTransition: null },
  },
};
new VoyagerStateEngine(manifest, { resolveAutoTransitionDelay: () => 15000 });
assert(globalThis.__voyagerDelay === 15000, "state engine ignored the configured tabs timeout");

console.log(JSON.stringify({
  profiles: [imperial.signature, metric.signature],
  inventory: inventory.signature,
  tabsTimeoutMs: globalThis.__voyagerDelay,
}, null, 2));
