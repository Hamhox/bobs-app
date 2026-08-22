#!/usr/bin/env node

import {
  createVoyagerDisplayProfile,
  createVoyagerInventorySnapshot,
} from "../voyager-device-runtime.js";
import { VoyagerMenuModel } from "../voyager-menu-model.js";
import { VoyagerRideCatalog } from "../voyager-ride-catalog.js";
import {
  createVoyagerEffectiveSettings,
  isVoyagerSettingAvailable,
} from "../voyager-setting-rules.js";
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

const catalog = new VoyagerRideCatalog();
const trackA = { id: "TRACK-A", points: [{ latitude: 1, longitude: 1 }] };
const trackB = { id: "AREA-A:RIDE-B", points: [{ latitude: 2, longitude: 2 }] };
catalog.registerLoadedGroups([
  {
    areaId: null,
    resource: { id: "TRACK-A", label: "TRACK A", bytes: 1000, memoryRoles: ["track"], waypoints: [{ name: "START" }] },
    tracks: [trackA],
  },
  {
    areaId: "AREA-A",
    resource: { id: "AREA-A", label: "AREA A", bytes: 2000, memoryRoles: ["track", "route"], waypoints: [{ name: "CAMP" }] },
    tracks: [trackB],
  },
]);
assert(catalog.track("TRACK-A") === trackA, "catalog does not own loaded tracks");
assert(catalog.trackIds.includes("AREA-A"), "catalog does not expose riding-area selections");
assert(catalog.selectAreaTrackId("AREA-A", () => 0) === "AREA-A:RIDE-B", "catalog cannot resolve a riding-area track");
assert(catalog.labelsFor("track").join("|") === "TRACK A|AREA A", "catalog does not expose loaded track labels");
assert(catalog.visibleResources("track", { display: "CUSTOM", selectedLabels: ["AREA A"] })[0]?.id === "AREA-A", "catalog cannot resolve custom display visibility");
catalog.setSavedWaypoints([{ id: "WP-1", source: "CURRENT POSITION", label: "5", latitude: 3, longitude: 3 }]);
catalog.setSavedRides([{ id: "RIDE-1", name: "RIDE 1", trackId: "TRACK-A", progress: 0 }]);
const catalogInventory = catalog.inventorySnapshot();
assert(catalogInventory.trackCount === 2 && catalogInventory.routeCount === 1, "catalog inventory does not reflect loaded roles");
assert(catalogInventory.waypointCount === 3 && catalogInventory.savedRideCount === 1, "catalog inventory omits authored content");
assert(catalog.inventorySnapshot() === catalogInventory, "catalog inventory is not cached between content changes");
catalog.addSavedWaypoint({ id: "WP-2", source: "QUICK ADD", label: "6", latitude: 4, longitude: 4 });
assert(catalog.inventorySnapshot() !== catalogInventory, "catalog mutations do not invalidate inventory");
assert(Object.isFrozen(catalog.savedWaypoints), "catalog exposes mutable waypoint ownership");

const preferredSources = {
  distanceUnits: "MILES",
  speedSource: "WHL SENSOR",
  runTimeSource: "ENG OR WHL",
  wheelSensor: "DISABLED",
  engineSensor: "ENABLED",
};
const effectiveWithoutWheel = createVoyagerEffectiveSettings(preferredSources);
assert(effectiveWithoutWheel.speedSource === "GPS", "disabled wheel sensor did not produce an effective GPS speed source");
assert(effectiveWithoutWheel.runTimeSource === "ENG SENSOR", "single engine sensor did not produce an effective engine runtime source");
assert(preferredSources.speedSource === "WHL SENSOR" && preferredSources.runTimeSource === "ENG OR WHL", "effective settings overwrote rider preferences");
const restoredSources = createVoyagerEffectiveSettings({ ...preferredSources, wheelSensor: "ENABLED" });
assert(restoredSources.speedSource === "WHL SENSOR" && restoredSources.runTimeSource === "ENG OR WHL", "sensor re-enable did not restore rider preferences");
assert(!isVoyagerSettingAvailable("wheelSize", preferredSources), "wheel-dependent setting remains available without its sensor");

const storedValues = JSON.stringify({
  distanceUnits: "KILOMETERS",
  speedUnits: "MPH",
  wheelSensor: "DISABLED",
  engineSensor: "ENABLED",
  speedSource: "WHL SENSOR",
  runTimeSource: "ENG OR WHL",
});
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
assert(model.values.speedSource === "WHL SENSOR", "menu load destroyed the saved speed-source preference");
assert(model.effectiveValues.speedSource === "GPS" && model.effectiveValues.runTimeSource === "ENG SENSOR", "menu model did not expose effective sensor fallbacks");

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
  catalogInventory: catalog.inventorySnapshot().signature,
  effectiveSources: [model.effectiveValues.speedSource, model.effectiveValues.runTimeSource],
  tabsTimeoutMs: globalThis.__voyagerDelay,
}, null, 2));
