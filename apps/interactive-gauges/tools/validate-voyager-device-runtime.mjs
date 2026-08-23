#!/usr/bin/env node

import {
  createVoyagerDisplayProfile,
  createVoyagerGpsProfile,
  createVoyagerInventorySnapshot,
  createVoyagerMapProfile,
  createVoyagerPowerProfile,
} from "../voyager-device-runtime.js";
import { serializeVoyagerGpx, voyager250FourStrokeRpm } from "../voyager-live-runtime.js";
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

const externalPower = createVoyagerPowerProfile({
  backlightLevel: "HIGH",
  backlightBattery: "020 SEC",
  backlightExternal: "000 SEC",
  sleepBattery: "03 MIN",
  sleepExternal: "20 MIN",
  turnOff: "60 MIN",
  chargeMode: "VEHICLE",
});
const repeatedExternalPower = createVoyagerPowerProfile({
  backlightLevel: "HIGH",
  backlightBattery: "020 SEC",
  backlightExternal: "000 SEC",
  sleepBattery: "03 MIN",
  sleepExternal: "20 MIN",
  turnOff: "60 MIN",
  chargeMode: "VEHICLE",
});
assert(externalPower === repeatedExternalPower, "power profiles are not cached by their stable settings signature");
assert(externalPower.backlightBrightnessValue === 50, "default High backlight changed the approved screen brightness");
assert(externalPower.backlightTimeoutMs === Number.POSITIVE_INFINITY, "external Always On backlight has a finite timeout");
assert(externalPower.sleepAfterMs === 20 * 60 * 1000, "external sleep timeout does not use Power Settings");
assert(externalPower.powerOffAfterMs === 60 * 60 * 1000, "power-off timeout does not use Power Settings");
const batteryPower = createVoyagerPowerProfile({
  backlightLevel: "OFF",
  backlightBattery: "020 SEC",
  backlightExternal: "000 SEC",
  sleepBattery: "03 MIN",
  sleepExternal: "20 MIN",
  turnOff: "00 MIN",
  chargeMode: "WALL PLUG",
}, { externalPower: false });
assert(batteryPower.backlightBrightnessValue === 18, "Off backlight does not retain a readable passive LCD");
assert(batteryPower.backlightTimeoutMs === 20 * 1000, "battery backlight timeout is incorrect");
assert(batteryPower.sleepAfterMs === 3 * 60 * 1000, "battery sleep timeout is incorrect");
assert(batteryPower.powerOffAfterMs === Number.POSITIVE_INFINITY, "00-minute power-off does not disable the timeout");
assert(batteryPower.chargeMode === "WALL PLUG", "charge mode is missing from the power profile");

const timeGps = createVoyagerGpsProfile({
  logTrack: "ON",
  gpsMode: "ENABLED (LOGGING ON)",
  logMethod: "TIME",
  logFrequency: "2 SEC",
  logOption: "ENG OR WHL",
  autoSplit: "5 MI GAP",
  coordFormat: "DEG, MIN.DEC",
  signalBars: "OFF",
  engineSensor: "ENABLED",
  wheelSensor: "ENABLED",
});
const repeatedTimeGps = createVoyagerGpsProfile({
  logTrack: "ON",
  gpsMode: "ENABLED (LOGGING ON)",
  logMethod: "TIME",
  logFrequency: "2 SEC",
  logOption: "ENG OR WHL",
  autoSplit: "5 MI GAP",
  coordFormat: "DEG, MIN.DEC",
  signalBars: "OFF",
  engineSensor: "ENABLED",
  wheelSensor: "ENABLED",
});
assert(timeGps === repeatedTimeGps, "GPS profiles are not cached by their stable settings signature");
assert(timeGps.sampleIntervalMs === 2000, "time logging does not use the selected frequency");
assert(timeGps.sampleDistanceMeters === Number.POSITIVE_INFINITY, "time logging performs a distance threshold check");
assert(timeGps.shouldRecord({ engineRunning: true }), "ENG OR WHL logging does not accept the running engine sensor");
assert(timeGps.shouldRecord({ wheelMoving: true }), "ENG OR WHL logging does not accept the moving wheel sensor");
assert(!timeGps.shouldRecord(), "sensor-gated logging records without sensor input");
assert(timeGps.formatLatitude(45.774051) === "N 45° 46.443′", "decimal-minute latitude formatting is incorrect");
assert(timeGps.formatLongitude(-122.527241) === "W 122° 31.634′", "decimal-minute longitude formatting is incorrect");

const distanceGps = createVoyagerGpsProfile({
  logTrack: "ON",
  logMethod: "DISTANCE",
  logFrequency: "10 FT",
  logOption: "ALWAYS",
  autoSplit: "OFF",
  coordFormat: "DEG, MIN, SEC",
  signalBars: "ON",
});
assert(Math.abs(distanceGps.sampleDistanceMeters - 3.048) < 0.0001, "distance logging does not use the selected foot threshold");
assert(distanceGps.sampleIntervalMs === Number.POSITIVE_INFINITY, "distance logging performs a time threshold check");
assert(distanceGps.autoSplitMeters === Number.POSITIVE_INFINITY, "auto-split OFF still has a finite split distance");
assert(distanceGps.signalBars, "signal-bar preference is missing from the GPS profile");
assert(distanceGps.shouldRecord(), "ALWAYS logging is incorrectly sensor-gated");
assert(distanceGps.formatLatitude(45.774051).startsWith("N 45° 46′"), "degree-minute-second formatting is incorrect");

const disabledGps = createVoyagerGpsProfile({
  logTrack: "ON",
  gpsMode: "DISABLED (POWER SAVE)",
  logOption: "ALWAYS",
});
assert(!disabledGps.gpsEnabled && !disabledGps.shouldRecord(), "GPS power save still permits recording");
assert(createVoyagerGpsProfile({ logMethod: "TIME" }).sampleIntervalMs === 1000, "clean GPS settings do not default to one-second logging");

const idleRpm = voyager250FourStrokeRpm({ speedMph: 0, progress: 0.25 });
const peakRpm = voyager250FourStrokeRpm({ recordedRpm: 3000, speedMph: 50, progress: 0.72 });
const topEndRpm = voyager250FourStrokeRpm({ recordedRpm: 3210, speedMph: 62, progress: 0.77 });
assert(idleRpm >= 1800 && idleRpm <= 2200, "250cc four-stroke idle left the approved range");
assert(peakRpm >= 11500 && peakRpm < 13500, "250cc four-stroke pull misses its power band");
assert(topEndRpm >= 13500 && topEndRpm <= 14200, "250cc four-stroke top end misses its approved range");

const exportedGpx = serializeVoyagerGpx({
  name: "FOREST & LOOP",
  segments: [[{
    latitude: 45.1,
    longitude: -122.2,
    elevation: 320,
    speedKph: 42,
    rpm: 6300,
    engineTemperatureC: 88,
    airTemperatureC: 20,
    recordedAt: "2026-08-22T12:00:00.000Z",
  }]],
});
assert(exportedGpx.includes("FOREST &amp; LOOP") && exportedGpx.includes("tt:RideData"), "recorded GPX export omits its track or sensor data");

const mapProfile = createVoyagerMapProfile({
  tracksDisplay: "CUSTOM",
  visibleTracks: ["BAKER WEST"],
  routesDisplay: "NONE",
  waypointsDisplay: "ALL",
  mapOrientation: "NORTH UP",
  pointerSize: "LARGE",
  mapScreen1: "AUTO-CENTER",
  mapScreen1TrackLabels: "LARGE",
  mapScreen1TrackClipping: "1500 FT",
  mapScreen1RouteLabels: "OFF",
  mapScreen1WaypointIcons: "DOT",
  mapScreen1WaypointLabels: "SMALL",
  mapScreen1WaypointClipping: "NEVER",
  mapScreen2: "DISABLED",
  panZoomTimeout: "030 SEC",
});
const repeatedMapProfile = createVoyagerMapProfile({
  tracksDisplay: "CUSTOM",
  visibleTracks: ["BAKER WEST"],
  routesDisplay: "NONE",
  waypointsDisplay: "ALL",
  mapOrientation: "NORTH UP",
  pointerSize: "LARGE",
  mapScreen1: "AUTO-CENTER",
  mapScreen1TrackLabels: "LARGE",
  mapScreen1TrackClipping: "1500 FT",
  mapScreen1RouteLabels: "OFF",
  mapScreen1WaypointIcons: "DOT",
  mapScreen1WaypointLabels: "SMALL",
  mapScreen1WaypointClipping: "NEVER",
  mapScreen2: "DISABLED",
  panZoomTimeout: "030 SEC",
});
assert(mapProfile === repeatedMapProfile, "map profiles are not cached by their stable settings signature");
assert(createVoyagerMapProfile({}).orientation === "NORTH UP", "clean map settings do not default to north-up orientation");
assert(mapProfile.orientation === "NORTH UP" && mapProfile.pointerScale > 1, "map orientation or pointer size is not represented");
assert(mapProfile.resourceVisible("track", ["BAKER WEST"]), "custom track visibility dropped a selected resource");
assert(!mapProfile.resourceVisible("track", ["JORDAN CREEK"]), "custom track visibility retained an unselected resource");
assert(!mapProfile.resourceVisible("route", ["BAKER WEST"]), "route display NONE did not hide route resources");
assert(mapProfile.screen2.enabled === false, "disabled map screen 2 remains enabled");
assert(mapProfile.screen1.waypointIcons === "DOT", "waypoint icon mode is missing from the map profile");
assert(!mapProfile.labelsVisible(1, "track", 4), "track labels ignored their zoom clipping threshold");
assert(mapProfile.labelsVisible(1, "track", 8), "track labels do not appear inside their zoom clipping threshold");
assert(mapProfile.labelsVisible(1, "waypoint", 1), "NEVER clipping did not preserve waypoint labels");
assert(mapProfile.panZoomTimeoutMs === 30000, "map pan/zoom timeout is incorrect");

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
const catalogBeforeRecording = catalog.inventorySnapshot();
catalog.setRecordingSummary({ pointCount: 12, segmentCount: 2, bytes: 2600 });
const catalogWithRecording = catalog.inventorySnapshot();
assert(catalogWithRecording.trackCount === catalogBeforeRecording.trackCount + 1, "live recording is missing from track memory");
assert(catalogWithRecording.trackUsage > catalogBeforeRecording.trackUsage, "live recording bytes do not affect track memory");
assert(catalogWithRecording.recordedPointCount === 12 && catalogWithRecording.recordedSegmentCount === 2, "recording inventory details are incorrect");
catalog.noteExport(exportedGpx.length);
assert(catalog.inventorySnapshot().exportedBytes === exportedGpx.length, "GPX export bytes are missing from SD-card inventory");

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
  logMethod: "TIME",
  logFrequency: "2 SEC",
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
assert(model.values.logFrequency === "1 SEC", "menu load does not migrate the prior two-second logging default");
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
  gpsProfiles: [timeGps.signature, distanceGps.signature],
  mapProfile: mapProfile.signature,
  inventory: inventory.signature,
  catalogInventory: catalog.inventorySnapshot().signature,
  effectiveSources: [model.effectiveValues.speedSource, model.effectiveValues.runTimeSource],
  tabsTimeoutMs: globalThis.__voyagerDelay,
}, null, 2));
