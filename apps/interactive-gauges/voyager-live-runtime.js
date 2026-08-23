import {
  VOYAGER_CANONICAL_STATE_IDS,
  VOYAGER_INPUT_POLICY_ALIASES,
  VOYAGER_LIVE_STATE_IDS,
  VOYAGER_STABLE_STATE_ALIASES,
  VOYAGER_TAB_ORDER,
  voyagerScreenState,
} from "./voyager-live-screens.js";
import {
  VOYAGER_MENU_CANONICAL_STATE_IDS,
  VOYAGER_MENU_STABLE_STATE_ALIASES,
  VOYAGER_MENU_STATE_IDS,
  voyagerMemoryRows,
  voyagerMenuState,
} from "./voyager-menu-registry.js";
import { VoyagerMenuModel } from "./voyager-menu-model.js";
import {
  createVoyagerDisplayProfile,
  createVoyagerGpsProfile,
  createVoyagerMapProfile,
  createVoyagerPowerProfile,
} from "./voyager-device-runtime.js";
import { VoyagerRideCatalog } from "./voyager-ride-catalog.js";
import {
  renderVoyagerMenuMarkup,
  renderVoyagerToastMarkup,
  voyagerMenuAriaLabel,
} from "./voyager-menu-renderer.js";
import { VOYAGER_COMPASS_VIEW_BOX, voyagerUiIcon } from "./voyager-ui-icons.js";
import { VOYAGER_FONT_SYMBOLS } from "./voyager-font-symbols.js";

const DIRECTION_INPUTS = new Set(["up", "down", "left", "right"]);
const WAYPOINT_STORAGE_KEY = "bobs-app:voyager-waypoints:v1";
const SAVED_RIDE_STORAGE_KEY = "bobs-app:voyager-saved-rides:v1";
const VOYAGER_CONDUCTOR_SLOT_MS = 500;
const VOYAGER_POWER_SAVE_SLOT_MS = 1000;
const VOYAGER_SLEEP_CLOCK_MS = 1000;
const VOYAGER_DEFAULT_SLEEP_AFTER_MS = 10 * 60 * 1000;
const VOYAGER_DEFAULT_RIDE_ID = "baker-west-desert";
const VOYAGER_TACHBAR_SPRITE = "/apps/interactive-gauges/assets/ui/voyager-tachbar.svg";
const VOYAGER_SCREEN_TAB_TARGETS = Object.freeze({
  main: "index",
  map: "map",
  temp: "eng",
  alt: "alt",
  user: "cstm",
  nav: "dir",
  sat: "sat",
});
const VOYAGER_MENU_TAB_TARGETS = Object.freeze({
  main: "m-main1-1",
  ride: "m-ride2-1",
  set: "m-set3-1",
});
const VOYAGER_TABS_VISIBLE_TARGETS = Object.freeze({
  "index1-2": "index",
  "index2-2": "index2",
  "index3-2": "index3",
  "map1-2": "map",
  map2: "map",
  "map2-2": "map",
  map3: "map2-2",
  "map3-2": "map2-2",
  "eng1-2": "eng",
  eng2: "eng",
  eng3: "eng",
  "alt1-2": "alt",
  alt2: "alt",
  alt3: "alt",
  "cstm1-2": "cstm",
  "cstm2-2": "cstm2",
  "dir1-2": "dir",
  dir3: "dir2",
  "sat1-2": "sat",
  sat2: "sat",
});
const SD_CARD_DEFAULT_RIDES = Object.freeze([
  { id: "SD-BAKER", name: "BAKER WEST", progress: 0, trackId: "baker-west-desert" },
  { id: "SD-JORDAN", name: "JORDAN CREEK", progress: 0, trackId: "jordan-creek" },
  { id: "SD-CMRA-T2", name: "CMRA TRAIL 2", progress: 0, trackId: "cmra-trail-2" },
  { id: "SD-BLACKDOG", name: "2016 BLACKDOG", progress: 0, trackId: "blackdog-2016" },
]);
const SD_CARD_RIDE_FILES = Object.freeze({
  "BAKER-WEST.GPX": { trackId: "baker-west-desert", label: "BAKER WEST" },
  "JORDAN-CREEK.GPX": { trackId: "jordan-creek", label: "JORDAN CREEK" },
  "CMRA-TRAIL-2.GPX": { trackId: "cmra-trail-2", label: "CMRA TRAIL 2" },
  "2016-BLACKDOG.GPX": { trackId: "blackdog-2016", label: "2016 BLACKDOG" },
});
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const radians = (degrees) => (degrees * Math.PI) / 180;

export function formatVoyagerDestinationDistance(destinationMeters, metricDistance) {
  return String(Math.round(metricDistance ? destinationMeters / 1000 : destinationMeters / 1609.344));
}

export function voyagerDestinationTextLength(value) {
  return String(value).length > 7 ? 196 : null;
}

export function voyager250FourStrokeRpm({ recordedRpm, speedMph = 0, progress = 0 } = {}) {
  const speed = Math.max(0, Number(speedMph) || 0);
  const rideProgress = Math.max(0, Number(progress) || 0);
  if (speed <= 0.75) {
    return Math.round(2000 + Math.sin(rideProgress * Math.PI * 36) * 200);
  }

  const sensorRpm = Number(recordedRpm);
  const sensorBase = Number.isFinite(sensorRpm) && sensorRpm > 0
    ? sensorRpm < 4000 ? sensorRpm * 4.25 : sensorRpm
    : Number.NaN;
  const speedBase = 2200 + Math.min(speed, 55) * 190;
  const engineBase = Number.isFinite(sensorBase) ? Math.max(sensorBase, speedBase * 0.8) : speedBase;
  const shiftPhase = (rideProgress * 18) % 1;
  const throttleSweep = shiftPhase * 900 - 300 + Math.sin(rideProgress * Math.PI * 50) * 150;
  return Math.round(clamp(engineBase + throttleSweep, 2200, 14200));
}

export function voyagerScreenTabTarget(tabId) {
  return VOYAGER_SCREEN_TAB_TARGETS[tabId] ?? null;
}

export function voyagerTabsVisibleTarget(stateId) {
  return VOYAGER_TABS_VISIBLE_TARGETS[stateId] ?? null;
}

export function voyagerMainScreenTarget(stateId, action, tachbarEnabled = true) {
  if (!["index", "index2", "index3"].includes(stateId)
    || !["left", "right", "enter"].includes(action)) return null;
  const mainScreens = tachbarEnabled ? ["index", "index2", "index3"] : ["index", "index2"];
  const currentIndex = Math.max(0, mainScreens.indexOf(stateId));
  const direction = action === "left" ? -1 : 1;
  return mainScreens[(currentIndex + direction + mainScreens.length) % mainScreens.length];
}

export function voyagerMapScreenTarget(stateId, action, mapScreen2Enabled = true) {
  if (action !== "right" || mapScreen2Enabled || !["map", "map1-2", "map2-2"].includes(stateId)) return null;
  return stateId === "map2-2" ? "map" : stateId;
}

function haversineMeters(a, b) {
  const earthRadius = 6371000;
  const latitudeDelta = radians(b.latitude - a.latitude);
  const longitudeDelta = radians(b.longitude - a.longitude);
  const latitudeA = radians(a.latitude);
  const latitudeB = radians(b.latitude);
  const h =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.sqrt(h));
}

function bearingDegrees(a, b) {
  const longitudeDelta = radians(b.longitude - a.longitude);
  const latitudeA = radians(a.latitude);
  const latitudeB = radians(b.latitude);
  const y = Math.sin(longitudeDelta) * Math.cos(latitudeB);
  const x =
    Math.cos(latitudeA) * Math.sin(latitudeB) -
    Math.sin(latitudeA) * Math.cos(latitudeB) * Math.cos(longitudeDelta);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function parseGpx(xmlText) {
  const documentNode = new DOMParser().parseFromString(xmlText, "application/xml");
  if (documentNode.querySelector("parsererror")) throw new Error("Voyager GPX could not be parsed.");
  const points = [...documentNode.querySelectorAll("trkpt")].map((point) => {
    const rideData = point.getElementsByTagNameNS("*", "RideData")[0];
    const sensorValue = (name) => {
      const value = Number(rideData?.getAttribute(name));
      return Number.isFinite(value) ? value : Number.NaN;
    };
    return {
      latitude: Number(point.getAttribute("lat")),
      longitude: Number(point.getAttribute("lon")),
      elevation: Number(point.querySelector("ele")?.textContent ?? 0),
      time: Date.parse(point.querySelector("time")?.textContent ?? ""),
      engineTemperatureC: sensorValue("eng"),
      airTemperatureC: sensorValue("air"),
      speedKph: sensorValue("spd"),
      rpm: sensorValue("rpm"),
    };
  });
  if (points.length < 2 || points.some((point) => !Number.isFinite(point.latitude + point.longitude))) {
    throw new Error("Voyager GPX does not contain a usable track.");
  }
  const waypoints = [...documentNode.querySelectorAll("wpt")].map((waypoint) => ({
    name: waypoint.querySelector("name")?.textContent?.trim() ?? "",
    latitude: Number(waypoint.getAttribute("lat")),
    longitude: Number(waypoint.getAttribute("lon")),
  })).filter((waypoint) => waypoint.name && Number.isFinite(waypoint.latitude + waypoint.longitude));
  return { points, waypoints };
}

function decodedAreaPoint(row) {
  const sensor = (index) => row[index] === null ? Number.NaN : Number(row[index]);
  return {
    latitude: Number(row[0]),
    longitude: Number(row[1]),
    elevation: Number(row[2] ?? 0),
    time: Number(row[3]),
    engineTemperatureC: sensor(4),
    airTemperatureC: sensor(5),
    speedKph: sensor(6),
    rpm: sensor(7),
  };
}

export function parseVoyagerRideArea(data) {
  if (data?.kind !== "voyager-ride-area" || data.version !== 1) {
    throw new Error("Voyager ride area has an unsupported format.");
  }
  const networkSegments = (data.network ?? []).map((segment) => segment.map((row) => ({
    latitude: Number(row[0]),
    longitude: Number(row[1]),
  })).filter((point) => Number.isFinite(point.latitude + point.longitude))).filter((segment) => segment.length > 1);
  const rides = (data.rides ?? []).map((ride) => ({
    id: String(ride.id ?? ""),
    label: String(ride.label ?? "RIDE"),
    points: (ride.points ?? []).map(decodedAreaPoint).filter((point) => (
      Number.isFinite(point.latitude + point.longitude + point.elevation + point.time)
    )),
  })).filter((ride) => ride.id && ride.points.length > 1);
  const waypoints = (data.waypoints ?? []).map((waypoint) => ({
    name: String(waypoint.name ?? "").trim(),
    latitude: Number(waypoint.latitude),
    longitude: Number(waypoint.longitude),
  })).filter((waypoint) => waypoint.name && Number.isFinite(waypoint.latitude + waypoint.longitude));
  if (!networkSegments.length || !rides.length) throw new Error("Voyager ride area does not contain usable geometry.");
  return { networkSegments, rides, waypoints };
}

function engineTemperatureAt(progress, elevationFeet) {
  return Math.round(166 + Math.sin(progress * Math.PI * 2.25) * 11 + elevationFeet / 560);
}

function summarizeValues(values) {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  let sum = 0;
  for (const value of values) {
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
    sum += value;
  }
  return { minimum, maximum, average: Math.round(sum / Math.max(1, values.length)) };
}

function reduceGraphPoints(values, maximumPoints) {
  if (values.length <= maximumPoints) return values;
  const stride = Math.ceil(values.length / maximumPoints);
  const reduced = values.filter((_, index) => index % stride === 0);
  if (reduced.at(-1) !== values.at(-1)) reduced.push(values.at(-1));
  return reduced;
}

function graphValueAtProgress(values, progress) {
  if (!values.length) return 0;
  if (values.length === 1) return values[0];
  const position = clamp(progress, 0, 1) * (values.length - 1);
  const index = Math.min(values.length - 2, Math.floor(position));
  const amount = position - index;
  return values[index] + (values[index + 1] - values[index]) * amount;
}

function graphSamplesInWindow(values, windowStart, windowEnd) {
  const samples = [{
    progress: windowStart,
    value: graphValueAtProgress(values, windowStart),
  }];
  for (let index = 0; index < values.length; index += 1) {
    const progress = index / (values.length - 1);
    if (progress > windowStart && progress < windowEnd) samples.push({ progress, value: values[index] });
  }
  samples.push({
    progress: windowEnd,
    value: graphValueAtProgress(values, windowEnd),
  });
  return samples;
}

function buildTrack(definition, { points, waypoints }) {
  const distances = [0];
  const segmentSpeeds = [];
  for (let index = 1; index < points.length; index += 1) {
    const meters = haversineMeters(points[index - 1], points[index]);
    distances.push(distances[index - 1] + meters);
    const elapsedSeconds = Number.isFinite(points[index].time - points[index - 1].time)
      ? Math.max(1, (points[index].time - points[index - 1].time) / 1000)
      : 5;
    segmentSpeeds.push(meters / elapsedSeconds * 2.23694);
  }
  const sensorSpeedsMph = points
    .map((point) => point.speedKph * 0.621371)
    .filter(Number.isFinite);
  const elevationValuesFeet = points.map((point) => point.elevation * 3.28084);
  const temperatureValuesF = points.map((point, index) => Number.isFinite(point.engineTemperatureC)
    ? point.engineTemperatureC * 9 / 5 + 32
    : engineTemperatureAt(index / Math.max(1, points.length - 1), elevationValuesFeet[index]));
  return {
    ...definition,
    points,
    waypoints,
    mapSegments: definition.mapSegments?.length ? definition.mapSegments : [points],
    distances,
    totalMeters: distances.at(-1) || 1,
    averageSpeedMph: sensorSpeedsMph.length
      ? sensorSpeedsMph.reduce((sum, speed) => sum + speed, 0) / sensorSpeedsMph.length
      : segmentSpeeds.reduce((sum, speed) => sum + speed, 0) / segmentSpeeds.length,
    maxSpeedMph: sensorSpeedsMph.length ? Math.max(...sensorSpeedsMph) : Math.max(...segmentSpeeds),
    graphValues: {
      altitude: elevationValuesFeet,
      temperature: temperatureValuesF,
    },
    graphStats: {
      altitude: summarizeValues(elevationValuesFeet),
      temperature: summarizeValues(temperatureValuesF),
    },
  };
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatLocalClock(timestamp = Date.now()) {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function escapeXmlText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function serializeVoyagerGpx({ name = "VOYAGER RIDE", segments = [] } = {}) {
  const trackSegments = segments
    .filter((segment) => Array.isArray(segment) && segment.length)
    .map((segment) => `    <trkseg>\n${segment.map((point) => {
      const latitude = Number(point.latitude).toFixed(7);
      const longitude = Number(point.longitude).toFixed(7);
      const elevation = Number.isFinite(point.elevation) ? Number(point.elevation).toFixed(1) : "0.0";
      const recordedAt = point.recordedAt ?? new Date(0).toISOString();
      const sensor = [
        `spd="${Number(point.speedKph || 0).toFixed(2)}"`,
        `rpm="${Math.round(Number(point.rpm) || 0)}"`,
        `eng="${Number(point.engineTemperatureC || 0).toFixed(1)}"`,
        `air="${Number(point.airTemperatureC || 0).toFixed(1)}"`,
      ].join(" ");
      return `      <trkpt lat="${latitude}" lon="${longitude}"><ele>${elevation}</ele><time>${escapeXmlText(recordedAt)}</time><extensions><tt:RideData ${sensor} /></extensions></trkpt>`;
    }).join("\n")}\n    </trkseg>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Bob's Interactive Voyager" xmlns="http://www.topografix.com/GPX/1/1" xmlns:tt="https://trailtech.net/voyager/ride-data">\n  <trk>\n    <name>${escapeXmlText(name)}</name>\n${trackSegments}\n  </trk>\n</gpx>\n`;
}

class VoyagerRideEngine {
  #catalog;
  #currentTrack = null;
  #listeners = new Set();
  #conductorTimer = 0;
  #conductorPhase = 0;
  #lastTimestamp = 0;
  #lastActivityTimestamp = 0;
  #sleepAfterMs = VOYAGER_DEFAULT_SLEEP_AFTER_MS;
  #durationMs = 95000;
  #progress = 0;
  #playbackSpeed = 1;
  #playing = true;
  #playingBeforeSleep = true;
  #sleeping = false;
  #powerSave = false;
  #loop = true;
  #telemetry = null;
  #gpsProfile = createVoyagerGpsProfile();
  #recordedSegments = [];
  #recordedPointCount = 0;
  #recordingRevision = 0;
  #recordingClockMs = 0;
  #lastRecordedClockMs = Number.NEGATIVE_INFINITY;
  #lastRecordedPoint = null;
  #recordingStartedAt = Date.now();

  constructor(catalog) {
    this.#catalog = catalog;
  }

  async load(trackDefinitions) {
    const loadedGroups = await Promise.all(
      trackDefinitions.map(async (definition) => {
        const response = await fetch(definition.areaUrl ?? definition.url);
        if (!response.ok) throw new Error(`Voyager ride request failed with ${response.status}.`);
        const payload = await response.text();
        const resourceBytes = new TextEncoder().encode(payload).byteLength;
        if (!definition.areaUrl) {
          const ride = parseGpx(payload);
          return {
            areaId: null,
            resource: {
              id: definition.id,
              label: definition.label,
              bytes: resourceBytes,
              memoryRoles: definition.memoryRoles ?? [],
              waypoints: ride.waypoints,
            },
            tracks: [buildTrack(definition, ride)],
          };
        }
        const area = parseVoyagerRideArea(JSON.parse(payload));
        return {
          areaId: definition.id,
          resource: {
            id: definition.id,
            label: definition.label,
            bytes: resourceBytes,
            memoryRoles: definition.memoryRoles ?? [],
            waypoints: area.waypoints,
          },
          tracks: area.rides.map((ride) => buildTrack({
            ...definition,
            areaId: definition.id,
            id: `${definition.id}:${ride.id}`,
            label: ride.label,
            mapSegments: area.networkSegments,
          }, { points: ride.points, waypoints: area.waypoints })),
        };
      }),
    );
    this.#catalog.registerLoadedGroups(loadedGroups);
    const loadedTracks = loadedGroups.flatMap((group) => group.tracks);
    const defaultTrackId = this.#catalog.selectAreaTrackId(VOYAGER_DEFAULT_RIDE_ID, () => 0);
    this.#currentTrack = this.#catalog.track(defaultTrackId) ?? loadedTracks[0];
    this.#lastTimestamp = performance.now();
    this.#lastActivityTimestamp = this.#lastTimestamp;
    this.#emit({ kind: "full", mode: "active" });
    document.addEventListener("visibilitychange", this.#handleVisibilityChange);
    this.#scheduleConductor();
    return this;
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    if (this.#telemetry) listener(this.#telemetry, { kind: "full", mode: this.#mode });
    return () => this.#listeners.delete(listener);
  }

  get points() {
    return this.#currentTrack?.points ?? [];
  }

  get waypoints() {
    return this.#currentTrack?.waypoints ?? [];
  }

  get mapSegments() {
    return this.#currentTrack?.mapSegments ?? [];
  }

  get surroundingRoutes() {
    return this.#currentTrack?.areaId ? this.#currentTrack.mapSegments : [];
  }

  pointsFor(trackId) {
    return this.#catalog.pointsFor(trackId);
  }

  get trackIds() {
    return this.#catalog.trackIds;
  }

  get memorySummary() {
    return this.#catalog.memorySummary;
  }

  get telemetry() {
    return this.#telemetry;
  }

  get #mode() {
    if (this.#sleeping) return "sleep";
    return this.#powerSave ? "power-save" : "active";
  }

  get playing() {
    return this.#playing;
  }

  get recording() {
    return this.#gpsProfile.shouldRecord({
      engineRunning: this.#playing && (this.#telemetry?.rpm ?? 0) > 0,
      wheelMoving: this.#playing && (this.#telemetry?.speedMph ?? 0) > 0.5,
    });
  }

  get recordedSegments() {
    return this.#recordedSegments;
  }

  get recordingSnapshot() {
    return Object.freeze({
      active: this.recording,
      pointCount: this.#recordedPointCount,
      segmentCount: this.#recordedSegments.filter((segment) => segment.length).length,
      bytes: this.#estimatedRecordingBytes(),
      revision: this.#recordingRevision,
    });
  }

  graphValues(metric) {
    return this.#currentTrack?.graphValues?.[metric] ?? [];
  }

  graphStats(metric) {
    return this.#currentTrack?.graphStats?.[metric] ?? { minimum: 0, maximum: 0, average: 0 };
  }

  recordActivity() {
    const timestamp = performance.now();
    this.#lastActivityTimestamp = timestamp;
    if (!this.#sleeping) return;
    this.#sleeping = false;
    this.#playing = this.#playingBeforeSleep;
    this.#lastTimestamp = timestamp;
    this.#conductorPhase = 0;
    this.#emit({ kind: "full", mode: this.#mode, reason: "wake" });
    this.#rescheduleConductor();
  }

  setPowerSave(enabled) {
    const powerSave = Boolean(enabled);
    if (powerSave === this.#powerSave) return;
    this.#powerSave = powerSave;
    this.#rescheduleConductor();
  }

  setSleepAfterMs(milliseconds) {
    const sleepAfterMs = Number(milliseconds);
    this.#sleepAfterMs = Number.isFinite(sleepAfterMs) && sleepAfterMs > 0
      ? sleepAfterMs
      : Number.POSITIVE_INFINITY;
  }

  setGpsProfile(profile) {
    if (!profile || profile.signature === this.#gpsProfile.signature) return;
    this.#gpsProfile = profile;
    this.#lastRecordedClockMs = Number.NEGATIVE_INFINITY;
    this.#lastRecordedPoint = this.#recordedSegments.at(-1)?.at(-1) ?? null;
  }

  startNewTrackSegment() {
    if (!this.#recordedPointCount || !this.#recordedSegments.at(-1)?.length) return;
    this.#recordedSegments.push([]);
    this.#lastRecordedPoint = null;
    this.#lastRecordedClockMs = Number.NEGATIVE_INFINITY;
    this.#touchRecording();
  }

  clearRecording() {
    this.#recordedSegments = [];
    this.#recordedPointCount = 0;
    this.#recordingClockMs = 0;
    this.#lastRecordedClockMs = Number.NEGATIVE_INFINITY;
    this.#lastRecordedPoint = null;
    this.#recordingStartedAt = Date.now();
    this.#touchRecording();
  }

  exportRecordedGpx(name) {
    return serializeVoyagerGpx({ name, segments: this.#recordedSegments });
  }

  alignStopwatchCadence() {
    if (this.#sleeping) return;
    this.#conductorPhase = 1;
    this.#rescheduleConductor();
  }

  selectRide(trackId, { reset = true } = {}) {
    const resolvedTrackId = this.#selectAreaTrackId(trackId) ?? trackId;
    const nextTrack = this.#catalog.track(resolvedTrackId);
    if (!nextTrack) throw new Error(`Unknown Voyager GPX ride: ${trackId}`);
    this.#currentTrack = nextTrack;
    if (reset) {
      this.#progress = 0;
      this.clearRecording();
    }
    this.#emit({ kind: "full", mode: this.#mode });
    return nextTrack;
  }

  #selectAreaTrackId(areaId) {
    return this.#catalog.selectAreaTrackId(areaId);
  }

  play() {
    this.#playing = true;
  }

  pause() {
    this.#playing = false;
  }

  reset() {
    this.#progress = 0;
    this.clearRecording();
    this.#emit({ kind: "full", mode: this.#mode });
  }

  seek(progress) {
    this.#progress = clamp(Number(progress) || 0, 0, 1);
    this.#emit({ kind: "full", mode: this.#mode });
  }

  seekBy(amount) {
    this.seek(this.#progress + amount);
  }

  setPlaybackSpeed(speed) {
    this.#playbackSpeed = clamp(Number(speed) || 1, 0.1, 8);
  }

  setLoop(loop) {
    this.#loop = Boolean(loop);
  }

  #tick = () => {
    this.#conductorTimer = 0;
    const timestamp = performance.now();
    if (!this.#sleeping && timestamp - this.#lastActivityTimestamp >= this.#sleepAfterMs) {
      this.#playingBeforeSleep = this.#playing;
      this.#playing = false;
      this.#sleeping = true;
      this.#lastTimestamp = timestamp;
      this.#emit({ kind: "sleep", mode: "sleep", clockLabel: formatLocalClock() });
      this.#scheduleConductor();
      return;
    }
    if (this.#sleeping) {
      this.#lastTimestamp = timestamp;
      this.#emit({ kind: "sleep", mode: "sleep", clockLabel: formatLocalClock() });
      this.#scheduleConductor();
      return;
    }
    if (this.#lastTimestamp && this.#playing && this.#currentTrack) {
      const elapsedMilliseconds = timestamp - this.#lastTimestamp;
      this.#recordingClockMs += elapsedMilliseconds * this.#playbackSpeed;
      this.#progress += elapsedMilliseconds / this.#durationMs * this.#playbackSpeed;
      if (this.#progress >= 1) {
        this.#progress = this.#loop ? this.#progress % 1 : 1;
        if (!this.#loop) {
          this.#playing = false;
        } else if (this.#currentTrack.areaId) {
          const nextTrackId = this.#selectAreaTrackId(this.#currentTrack.areaId);
          this.#currentTrack = this.#catalog.track(nextTrackId) ?? this.#currentTrack;
        }
      }
    }
    this.#lastTimestamp = timestamp;
    const phase = this.#conductorPhase;
    this.#conductorPhase = (this.#conductorPhase + 1) % 4;
    this.#emit({ kind: "phase", mode: this.#mode, phase }, { record: true });
    this.#scheduleConductor();
  };

  #emit(cadence = { kind: "full", mode: this.#mode }, { record = false } = {}) {
    if (!this.#currentTrack) return;
    this.#telemetry = this.#sample(this.#progress);
    if (record) this.#recordTelemetry(this.#telemetry);
    for (const listener of this.#listeners) listener(this.#telemetry, cadence);
  }

  #recordTelemetry(telemetry) {
    if (!this.recording) return;
    const previous = this.#lastRecordedPoint;
    const distanceFromPrevious = previous ? haversineMeters(previous, telemetry) : Number.POSITIVE_INFINITY;
    const sampleDue = !previous
      || (this.#gpsProfile.method === "TIME"
        ? this.#recordingClockMs - this.#lastRecordedClockMs >= this.#gpsProfile.sampleIntervalMs
        : distanceFromPrevious >= this.#gpsProfile.sampleDistanceMeters);
    if (!sampleDue) return;

    const splitForGap = previous && distanceFromPrevious >= this.#gpsProfile.autoSplitMeters;
    if (!this.#recordedSegments.length || splitForGap) this.#recordedSegments.push([]);
    const point = Object.freeze({
      latitude: telemetry.latitude,
      longitude: telemetry.longitude,
      elevation: telemetry.elevationFeet / 3.28084,
      speedKph: telemetry.speedMph * 1.609344,
      rpm: telemetry.rpm,
      engineTemperatureC: (telemetry.engineTemperatureF - 32) * 5 / 9,
      airTemperatureC: (telemetry.ambientTemperatureF - 32) * 5 / 9,
      recordedAt: new Date(this.#recordingStartedAt + this.#recordingClockMs).toISOString(),
      trackId: telemetry.trackId,
    });
    this.#recordedSegments.at(-1).push(point);
    this.#recordedPointCount += 1;
    this.#lastRecordedPoint = point;
    this.#lastRecordedClockMs = this.#recordingClockMs;
    this.#touchRecording();
  }

  #estimatedRecordingBytes() {
    return this.#recordedPointCount
      ? 256 + this.#recordedPointCount * 196 + this.#recordedSegments.length * 40
      : 0;
  }

  #touchRecording() {
    this.#recordingRevision += 1;
    this.#catalog.setRecordingSummary({
      pointCount: this.#recordedPointCount,
      segmentCount: this.#recordedSegments.filter((segment) => segment.length).length,
      bytes: this.#estimatedRecordingBytes(),
    });
  }

  #scheduleConductor() {
    if (this.#conductorTimer || document.hidden) return;
    const delay = this.#sleeping
      ? VOYAGER_SLEEP_CLOCK_MS
      : this.#powerSave ? VOYAGER_POWER_SAVE_SLOT_MS : VOYAGER_CONDUCTOR_SLOT_MS;
    this.#conductorTimer = window.setTimeout(this.#tick, delay);
  }

  #rescheduleConductor() {
    window.clearTimeout(this.#conductorTimer);
    this.#conductorTimer = 0;
    this.#scheduleConductor();
  }

  #handleVisibilityChange = () => {
    if (document.hidden) {
      window.clearTimeout(this.#conductorTimer);
      this.#conductorTimer = 0;
      return;
    }
    this.#lastTimestamp = performance.now();
    this.#scheduleConductor();
  };

  #sample(progress) {
    const track = this.#currentTrack;
    const segmentPosition = progress * (track.points.length - 1);
    const index = Math.min(track.points.length - 2, Math.floor(segmentPosition));
    const amount = segmentPosition - index;
    const start = track.points[index];
    const end = track.points[index + 1];
    const interpolate = (key) => start[key] + (end[key] - start[key]) * amount;
    const interpolateSensor = (key) => Number.isFinite(start[key]) && Number.isFinite(end[key])
      ? interpolate(key)
      : Number.NaN;
    const segmentStart = Math.max(0, index - 1);
    const segmentEnd = Math.min(track.points.length - 1, index + 2);
    const speedDistance = haversineMeters(track.points[segmentStart], track.points[segmentEnd]);
    const speedSeconds = Number.isFinite(track.points[segmentEnd].time - track.points[segmentStart].time)
      ? Math.max(1, (track.points[segmentEnd].time - track.points[segmentStart].time) / 1000)
      : 10;
    const calculatedSpeedMph = speedDistance / speedSeconds * 2.23694;
    const recordedSpeedMph = interpolateSensor("speedKph") * 0.621371;
    const speedMph = Number.isFinite(recordedSpeedMph) ? recordedSpeedMph : calculatedSpeedMph;
    const recordedRpm = interpolateSensor("rpm");
    const completedMeters = track.distances[index] + haversineMeters(start, end) * amount;
    const elevationFeet = Math.round(interpolate("elevation") * 3.28084);
    return {
      trackId: track.id,
      areaId: track.areaId ?? null,
      trackLabel: track.label,
      progress,
      pointIndex: index,
      latitude: interpolate("latitude"),
      longitude: interpolate("longitude"),
      elevationFeet,
      speedMph: Math.round(clamp(speedMph, 0, 99)),
      maxSpeedMph: Math.round(track.maxSpeedMph),
      averageSpeedMph: Math.round(track.averageSpeedMph),
      heading: bearingDegrees(start, end),
      distanceKm: completedMeters / 1000,
      totalDistanceKm: track.totalMeters / 1000,
      destinationMeters: Math.max(0, Math.round(track.totalMeters - completedMeters)),
      ambientTemperatureF: Number.isFinite(interpolateSensor("airTemperatureC"))
        ? Math.round(interpolateSensor("airTemperatureC") * 9 / 5 + 32)
        : Math.round(75 + Math.sin(progress * Math.PI * 2) * 3),
      engineTemperatureF: Number.isFinite(interpolateSensor("engineTemperatureC"))
        ? Math.round(interpolateSensor("engineTemperatureC") * 9 / 5 + 32)
        : engineTemperatureAt(progress, elevationFeet),
      rpm: voyager250FourStrokeRpm({ recordedRpm, speedMph, progress }),
      elapsedSeconds: progress * this.#durationMs / 1000,
      elapsedLabel: formatDuration(progress * this.#durationMs / 1000),
    };
  }
}

function temperatureIcon(x, y, scale = 1, inverse = false) {
  return voyagerUiIcon("fluid-temp-icon", {
    x,
    y,
    width: 28 * scale,
    height: 28 * scale,
    className: inverse ? "voyager-ui-icon--inverse" : "",
  });
}

function screenIndicatorMarkup(value, x = 73, y = 9, narrow = false) {
  return voyagerUiIcon(`screen-indicator-16pt-${value}${narrow ? "-narrow" : ""}`, {
    x,
    y,
    width: narrow ? 16 : 18,
    height: 21,
  });
}

function tabsMarkup(activeTab) {
  return VOYAGER_TAB_ORDER.map((tab, index) => {
    const y = index * 43;
    const bottom = index === VOYAGER_TAB_ORDER.length - 1 ? 303 : y + 43;
    const active = tab.id === activeTab;
    const followsActiveTab = index > 0 && VOYAGER_TAB_ORDER[index - 1].id === activeTab;
    const content = tab.icon
      ? temperatureIcon(18, y + 5, 1.15, active)
      : `<text class="voyager-live__text voyager-live__text--medium${active ? " voyager-live__text--inverse" : ""}" x="33" y="${y + 29}" text-anchor="middle">${tab.label}</text>`;
    return `
      <g data-tab="${tab.id}" data-voyager-touch-target="screen-tab">
        <rect class="voyager-live__touch-hit" x="0" y="${y}" width="68" height="${bottom - y}" />
        ${followsActiveTab ? `<path class="voyager-live__tab-active-tail" d="M-3 ${y - 1}H8L-3 ${y + 8}Z" />` : ""}
        <path class="voyager-live__tab${active ? " voyager-live__tab--active" : ""}" d="M-3 ${y + 8} 8 ${y}H67V${bottom}H-3Z" />
        <path class="voyager-live__tab-top" d="M-3 ${y + 8} 8 ${y}H67" />
        <path class="voyager-live__tab-right" d="M67 ${y}V${bottom}" />
        ${content}
      </g>`;
  }).join("");
}

function sideArrowsMarkup(screen, variant) {
  if (screen.id === "user") return "";
  if (screen.id === "main" || screen.id === "map" || screen.id === "sat" || screen.renderer === "graph") {
    const indicator = screen.id === "map" && variant.screenIndicator
      ? screenIndicatorMarkup(variant.screenIndicator, 484, 106, true)
      : "";
    return `${indicator}${voyagerUiIcon("screen-arrow-right", { x: 492, y: 132, width: 12, height: 35 })}`;
  }
  return `
    ${voyagerUiIcon("screen-arrow-right", { x: variant.tabsVisible ? 67 : 0, y: 132, width: 12, height: 35 })}
    ${voyagerUiIcon("screen-arrow-left", { x: 492, y: 132, width: 12, height: 35 })}`;
}

function secondaryScreenTouchMarkup(screen) {
  if (screen.id === "startup" || screen.id === "nav") return "";
  return `<rect class="voyager-live__touch-hit voyager-live__touch-hit--secondary" data-live-secondary-screen x="470" y="92" width="34" height="118" />`;
}

function screenChromeMarkup(screen, variant) {
  return `${variant.tabsVisible ? tabsMarkup(screen.id) : ""}${variant.sideArrows ? sideArrowsMarkup(screen, variant) : ""}`;
}

function statusBarMarkup(variant, display) {
  const contentLeft = variant.tabsVisible ? 67 : 0;
  return `
    <g class="voyager-live__status-bar">
      ${voyagerUiIcon("icon-16pt-record", {
        x: contentLeft + 11,
        y: 8,
        width: 21,
        height: 21,
        attributes: 'data-live-logging-record=""',
      })}
      ${voyagerUiIcon("icon-16pt-pause", {
        x: contentLeft + 13,
        y: 9,
        width: 18,
        height: 19,
        attributes: 'data-live-logging-pause=""',
      })}
      <g data-live-engine-running>
        ${voyagerUiIcon("throbber-24pt", {
          x: contentLeft + 38,
          y: 7,
          width: 23,
          height: 25,
          className: "voyager-live__status-throbber",
        })}
      </g>
      <g class="voyager-live__engine-off" data-live-engine-off>
        <circle cx="${contentLeft + 49.5}" cy="19.5" r="9" />
        <path d="M${contentLeft + 43} 13L${contentLeft + 56} 26" />
      </g>
      ${voyagerUiIcon("battery-24pt-full", { x: contentLeft + 70, y: 10, width: 34, height: 19 })}
      ${voyagerUiIcon("signal-24pt-4bars", {
        x: contentLeft + 112,
        y: 10,
        width: 31,
        height: 19,
        attributes: 'data-live-signal-bars=""',
      })}
      <text class="voyager-live__text voyager-live__text--status" x="${contentLeft + 242}" y="34" text-anchor="middle" data-live-time>12:30</text>
      <text class="voyager-live__text voyager-live__text--status" x="493" y="34" text-anchor="end" data-live-temperature>75${display.temperatureUnit}</text>
    </g>`;
}

function startupMarkup() {
  return `
    <rect class="voyager-live__surface" width="504" height="303" />
    <g fill="#231f20" transform="translate(37 120) scale(1.75)" aria-label="Trail Tech">
      <path d="M94.2.3l-6.4 23.7L82.1.3h-8.7L55.6 23.5 52 16.4c3.5-1 7.2-3 8.5-7.6 1.4-5-2.1-8.5-10.4-8.5H1.6L0 6.2h13.2l-5.1 19H19l5.1-19h23.5c2.4-.1 4.6.6 3.9 3.1-.4 1.4-2.2 3.4-5.5 3.4h-5.5l1-3.7h-9.2L28 25.2h9.2l1.9-7.2h4.2l1.8 7.6 9.1-.4h7.9l3.6-4.4H76l1.4 4.4h19.4L103.5.3h-9.3ZM68.8 15.6c2.1-3.1 3.3-3.3 5.6-7 0 0 1.2 4 1.4 7h-7Z" />
      <path d="M112 19h13.6l-1.6 6.2h-22.8L107.9.3h9.1L112 19Z" />
      <path d="M236.3.4h9l-6.6 24.8h-9.1l2.9-10.7h-7.9l-2.9 10.7h-9L219.3.4h9.1l-2.4 8.9h7.9l2.4-8.9Z" />
      <path d="m210.3 19.8.6 4.6c-1.9.5-5 1.1-7.9 1.1-9.4 0-16.3-3.7-16.2-10.2h-13.6l-1.1 4.1h13.6l-1.6 5.8h-22.7l5.1-19h-9l-5.1 19h-10.9l5.1-19H133l1.6-5.9h55.8l-1.6 5.8h-13.1l-1.1 4h13.5C191.1 3.8 199.5 0 209.3 0c2.1 0 5.7.5 7.8 1.2l-3.4 4.4c-1.4-.4-4.4-.5-5.3-.5-4.6 0-9.8 2.3-11.2 7.6-1.4 5.2 2.6 7.6 7.6 7.6 2 .1 3.9-.2 5.5-.5Z" />
    </g>`;
}

function compassMarkup({ cx, cy, radius, pointerAttribute = "data-live-compass-pointer" }) {
  return `
    ${voyagerUiIcon("compass-dial", { x: cx - radius, y: cy - radius, width: radius * 2, height: radius * 2 })}
    <g ${pointerAttribute} data-cx="${cx}" data-cy="${cy}">
      ${voyagerUiIcon("compass-arrow", {
        x: cx - radius,
        y: cy - radius,
        width: radius * 2,
        height: radius * 2,
        viewBox: VOYAGER_COMPASS_VIEW_BOX,
      })}
    </g>`;
}

function tachbarSegmentsMarkup(variant, tachScale) {
  const segmentCount = 15;
  const width = variant.tabsVisible ? "thin" : "wide";
  const segmentMarkup = Array.from({ length: segmentCount }, (_, index) => {
    const threshold = Math.round(tachScale * (index + 1) / segmentCount);
    return `
      <use href="${VOYAGER_TACHBAR_SPRITE}#tachbar-${width}-off-${index}"></use>
      <use class="voyager-live__tach-segment" data-live-tach-segment data-rpm-threshold="${threshold}" href="${VOYAGER_TACHBAR_SPRITE}#tachbar-${width}-on-${index}"></use>`;
  }).join("");
  return `<g class="voyager-live__tachbar" data-live-tachbar>
    ${segmentMarkup}
    <use href="${VOYAGER_TACHBAR_SPRITE}#tachbar-${width}-labels"></use>
  </g>`;
}

function tachbarMarkup(screen, variant, menuValues, display) {
  const contentLeft = variant.tabsVisible ? 67 : 0;
  const tachScale = Math.max(1000, Number.parseInt(menuValues.tachScale, 10) || 15000);
  return `
    <rect class="voyager-live__surface" width="504" height="303" />
    ${screenChromeMarkup(screen, variant)}
    ${tachbarSegmentsMarkup(variant, tachScale)}
    <g class="voyager-live__tach-temperature">
      <text class="voyager-live__text voyager-live__tach-temperature-readout" x="${contentLeft + 11}" y="57" data-live-temperature>71${display.temperatureUnit}</text>
      ${temperatureIcon(contentLeft + 104, 18, 1.34)}
    </g>
    <text class="voyager-live__text voyager-live__tach-time" x="${contentLeft + 10}" y="288" data-live-time>09:50</text>
    <text class="voyager-live__text voyager-live__tach-speed" x="444" y="287" text-anchor="end" data-live-speed>0</text>
    <text class="voyager-live__text voyager-live__tach-speed-unit" x="488" y="287" text-anchor="end">${display.speedUnit}</text>`;
}

function mainMarkup(screen, variant, { display, menuValues }) {
  const hiddenOffset = variant.tabsVisible ? 0 : -47;
  if (variant.view === "tachbar") return tachbarMarkup(screen, variant, menuValues, display);
  if (variant.view === "secondary") {
    const contentCenter = variant.tabsVisible ? 285 : 252;
    const maxCenter = variant.tabsVisible ? 173 : 126;
    const avgCenter = variant.tabsVisible ? 397 : 378;
    return `
      <rect class="voyager-live__surface" width="504" height="303" />
      ${screenChromeMarkup(screen, variant)}
      <g>
        <text class="voyager-live__text voyager-live__text--medium" x="${contentCenter}" y="30" text-anchor="middle">ODOMETER ${display.distanceUnit}</text>
        <text class="voyager-live__text voyager-live__text--readout" x="${contentCenter}" y="88" text-anchor="middle" data-live-odometer-miles>523.7</text>
        <text class="voyager-live__text voyager-live__text--medium" x="${maxCenter}" y="127" text-anchor="middle">MAX SPD ${display.speedUnit}</text>
        <text class="voyager-live__text voyager-live__text--readout" x="${maxCenter}" y="185" text-anchor="middle" data-live-max-speed>25</text>
        <path class="voyager-live__line voyager-live__line--secondary-main" d="M${contentCenter} 102V195" />
        <text class="voyager-live__text voyager-live__text--medium" x="${avgCenter}" y="127" text-anchor="middle">AVG SPD ${display.speedUnit}</text>
        <text class="voyager-live__text voyager-live__text--readout" x="${avgCenter}" y="185" text-anchor="middle" data-live-avg-speed>12</text>
        <text class="voyager-live__text voyager-live__text--medium" x="${contentCenter}" y="225" text-anchor="middle">ACCUMULATED RUN TIME</text>
        <text class="voyager-live__text voyager-live__text--large voyager-live__text--clock" x="${contentCenter}" y="283" text-anchor="middle" data-live-elapsed>00:00:00</text>
      </g>`;
  }
  return `
    <rect class="voyager-live__surface" width="504" height="303" />
    ${screenChromeMarkup(screen, variant)}
    ${statusBarMarkup(variant, display)}
    <g transform="translate(${hiddenOffset} 0)">
      <text class="voyager-live__text voyager-live__text--medium" x="198" y="67" text-anchor="middle">${display.speedUnit}</text>
      <text class="voyager-live__text voyager-live__text--speed" x="199" y="188" text-anchor="middle" data-live-speed>28</text>
      ${compassMarkup({ cx: 399, cy: 133, radius: 73 })}
      <text class="voyager-live__text" x="100" y="236">ALT ${display.altitudeUnit}</text>
      <text class="voyager-live__text voyager-live__text--metric" x="91" y="286" data-live-altitude>1089</text>
      <text class="voyager-live__text" x="261" y="236">DST ${display.distanceUnit}</text>
      <text class="voyager-live__text voyager-live__text--metric" x="254" y="286" data-live-distance>12.0</text>
      ${temperatureIcon(408, 213, 0.84)}
      <text class="voyager-live__text" x="449" y="236">${display.temperatureUnit}</text>
      <text class="voyager-live__text voyager-live__text--metric" x="407" y="286" data-live-engine-temperature>168</text>
    </g>`;
}

function controlHintMarkup(interaction) {
  if (!interaction) return "";
  const dpadIcon = interaction === "pan" ? "dpad-pan" : "dpad-zoom";
  return `
    ${voyagerUiIcon(dpadIcon, { x: 440, y: 16, width: 54, height: 54 })}
    <path class="voyager-live__hint-pulse" data-live-hint="up" d="M458 16h18v18h-18Z" />
    <path class="voyager-live__hint-pulse" data-live-hint="left" d="M440 34h18v18h-18Z" />
    <path class="voyager-live__hint-pulse" data-live-hint="right" d="M476 34h18v18h-18Z" />
    <path class="voyager-live__hint-pulse" data-live-hint="down" d="M458 52h18v18h-18Z" />
    ${voyagerUiIcon("panzoom-pill", { x: 442, y: 230, width: 62, height: 42 })}`;
}

function mapMarkup(screen, variant, { display }) {
  const status = variant.interaction ? "" : statusBarMarkup(variant, display);
  return `
    <rect class="voyager-live__surface" width="504" height="303" />
    <clipPath id="voyager-live-map-clip"><rect width="504" height="303" /></clipPath>
    <g clip-path="url(#voyager-live-map-clip)">
      <g data-live-map-transform>
        <path class="voyager-live__recorded" data-live-recorded />
        <path class="voyager-live__routes" data-live-routes />
        <path class="voyager-live__route voyager-live__route--overlay" data-live-overlay-route />
        <path class="voyager-live__route" data-live-route />
        <g data-live-route-labels></g>
        <g data-live-track-labels></g>
        <g data-live-waypoints></g>
        <path class="voyager-live__position" data-live-position d="M0-12 9 10 0 5-9 10Z" />
      </g>
    </g>
    ${screenChromeMarkup(screen, variant)}
    ${status}
    ${controlHintMarkup(variant.interaction)}
    <path class="voyager-live__scale-line" d="M${variant.tabsVisible ? 80 : 20} 279v13h142v-13" />
    <text class="voyager-live__text voyager-live__text--medium" x="${variant.tabsVisible ? 126 : 66}" y="286" data-live-map-scale>${display.distanceUnit === "KM" ? "3 km" : "2 mi"}</text>
    <g data-live-map-north>
      <text class="voyager-live__text voyager-live__text--medium" x="${variant.interaction ? 405 : 455}" y="289">N</text>
      ${voyagerUiIcon("compass-indicator-24pt", { x: variant.interaction ? 427 : 477, y: 274, width: 14, height: 19 })}
    </g>`;
}

function graphGridMarkup(left, right, top, bottom) {
  const horizontals = Array.from({ length: 3 }, (_, index) => {
    const y = top + (bottom - top) * (index + 1) / 4;
    return `
      <line x1="${left}" y1="${y}" x2="${right}" y2="${y}" />
      <text class="voyager-live__text voyager-live__text--medium voyager-live__graph-scale-label" x="${left + 4}" y="${y - 5}" data-live-graph-scale-label="${index}"></text>`;
  }).join("");
  return `
    <g class="voyager-live__graph-grid">${horizontals}</g>
    <rect class="voyager-live__graph-border" x="${left}" y="${top}" width="${right - left}" height="${bottom - top}" />
    <text class="voyager-live__text voyager-live__text--medium voyager-live__graph-scale-label" x="${left + 4}" y="${bottom - 5}" data-live-graph-scale-label="3"></text>`;
}

function graphMarkup(screen, variant, { display }) {
  const left = variant.tabsVisible ? 87 : 23;
  const right = 483;
  const top = 44;
  const bottom = 284;
  const isTemperature = screen.graphMetric === "temperature";
  const primary = variant.view === "primary";
  return `
    <rect class="voyager-live__surface" width="504" height="303" />
    ${screenChromeMarkup(screen, variant)}
    ${primary ? `
      <text class="voyager-live__text voyager-live__text--medium" x="${left}" y="34" data-live-graph-current>${isTemperature ? `ENG:168${display.temperatureUnit}` : `ALT:700 ${display.altitudeUnit}`}</text>
      <text class="voyager-live__text voyager-live__text--medium" x="${left + (right - left) * 0.5}" y="34" text-anchor="middle" data-live-graph-max>MAX:243${isTemperature ? display.temperatureUnit : ` ${display.altitudeUnit}`}</text>
      <text class="voyager-live__text voyager-live__text--medium" x="${right}" y="34" text-anchor="end" data-live-graph-average>AVG:172${isTemperature ? display.temperatureUnit : ` ${display.altitudeUnit}`}</text>
    ` : `
      <text class="voyager-live__text voyager-live__text--medium" x="23" y="34" data-live-graph-readout>${isTemperature ? `ENGINE TEMP: 168${display.temperatureUnit}` : `ALTITUDE: 700 ${display.altitudeUnit}`}</text>
    `}
    <clipPath id="voyager-live-graph-clip"><rect x="${left}" y="${top}" width="${right - left}" height="${bottom - top}" /></clipPath>
    <clipPath id="voyager-live-graph-fill-clip"><path data-live-graph-fill-clip /></clipPath>
    <g clip-path="url(#voyager-live-graph-clip)">
      <path class="voyager-live__graph-fill" data-live-graph-fill />
      <path class="voyager-live__graph-line" data-live-graph-line />
      ${graphGridMarkup(left, right, top, bottom)}
      <text class="voyager-live__text voyager-live__text--medium voyager-live__graph-track-label" x="${(left + right) / 2}" y="279" text-anchor="middle" data-live-ride-label>FOREST LOOP</text>
      <line class="voyager-live__graph-crosshair" data-live-graph-crosshair-horizontal />
      <line class="voyager-live__graph-crosshair" data-live-graph-crosshair-vertical />
      <g data-live-graph-crosshair-center>
        ${voyagerUiIcon("crosshair-center", { x: -18, y: -18, width: 36, height: 36, className: "voyager-live__graph-crosshair-center" })}
      </g>
      <g clip-path="url(#voyager-live-graph-fill-clip)">
        <line class="voyager-live__graph-crosshair voyager-live__graph-crosshair--inverse" data-live-graph-crosshair-horizontal />
        <line class="voyager-live__graph-crosshair voyager-live__graph-crosshair--inverse" data-live-graph-crosshair-vertical />
        <g data-live-graph-crosshair-center>
          ${voyagerUiIcon("crosshair-center", { x: -18, y: -18, width: 36, height: 36, className: "voyager-live__graph-crosshair-center voyager-live__graph-crosshair-center--inverse" })}
        </g>
      </g>
    </g>`;
}

function metricBlock(x, y, label, attribute, fallback, {
  labelAttribute = "",
  labelClass = "",
  readoutClass = "",
} = {}) {
  return `
    <text class="voyager-live__text voyager-live__text--medium${labelClass ? ` ${labelClass}` : ""}" x="${x}" y="${y}" text-anchor="middle" ${labelAttribute}>${label}</text>
    <text class="voyager-live__text voyager-live__text--readout${readoutClass ? ` ${readoutClass}` : ""}" x="${x}" y="${y + 58}" text-anchor="middle" ${attribute}>${fallback}</text>`;
}

function userTitleMarkup(title, tabsVisible) {
  const x = tabsVisible ? 70 : 0;
  const width = tabsVisible ? 434 : 504;
  return `
    <g class="voyager-live__user-title-bar">
      <rect x="${x}" width="${width}" height="40" />
      <text class="voyager-live__text voyager-live__text--medium voyager-live__user-title" x="${x + width / 2}" y="30" text-anchor="middle">${title}</text>
    </g>`;
}

const DEFAULT_USER_SCREEN_BLOCKS = Object.freeze({
  1: ["WHEEL SPEED", "GPS SPEED", "WHEEL DISTANCE", "WHEEL DISTANCE", "WHEEL ODOMETER", "ALTITUDE"],
  2: ["ENGINE ACC. RUN TIME", "MAX WHEEL SPEED", "AVG WHEEL SPEED", "<OFF>", "<OFF>", "<OFF>"],
});

export function voyagerUserMetricDefinition(selection, display) {
  const normalized = selection.replace(/[\uE109-\uE10C]/g, "").trim();
  const screenIndicator = selection.includes(VOYAGER_FONT_SYMBOLS.circledDigitNarrow1)
    || selection.includes(VOYAGER_FONT_SYMBOLS.circledDigitWide1)
    ? VOYAGER_FONT_SYMBOLS.circledDigitNarrow1
    : selection.includes(VOYAGER_FONT_SYMBOLS.circledDigitNarrow2)
      || selection.includes(VOYAGER_FONT_SYMBOLS.circledDigitWide2)
      ? VOYAGER_FONT_SYMBOLS.circledDigitNarrow2
      : "";
  const variantSuffix = screenIndicator ? ` ${screenIndicator}` : "";
  const definitions = {
    ALTITUDE: [`ALT ${display.altitudeUnit}`, "data-live-altitude", "1089"],
    "MIN ALTITUDE": [`MIN ALT ${display.altitudeUnit}`, "", "914"],
    "MAX ALTITUDE": [`MAX ALT ${display.altitudeUnit}`, "", "1234"],
    "WHEEL SPEED": [`WHEEL SPD ${display.speedUnit}`, "data-live-speed", "25"],
    "GPS SPEED": [`GPS SPD ${display.speedUnit}`, "data-live-gps-speed", "22"],
    "WHEEL ODOMETER": [`ODOMETER ${display.distanceUnit}`, "data-live-odometer-miles", "523.7"],
    "GPS ODOMETER": [`GPS ODO ${display.distanceUnit}`, "data-live-odometer", "1200"],
    "ENGINE ACC. RUN TIME": ["ACCUMULATED RUN TIME", "data-live-elapsed", "00:00:00"],
    "GPS ACC. RUN TIME": ["GPS RUN TIME", "data-live-elapsed", "00:00:00"],
    "AIR TEMPERATURE": [`AIR TEMP ${display.temperatureUnit}`, "data-live-temperature", `75${display.temperatureUnit}`],
    "ENGINE TEMPERATURE": [`ENGINE TEMP ${display.temperatureUnit}`, "data-live-engine-temperature", "168"],
    "MAX ENGINE TEMPERATURE": [`MAX ENGINE TEMP ${display.temperatureUnit}`, "", "179"],
    "AVG ENGINE TEMPERATURE": [`AVG ENGINE TEMP ${display.temperatureUnit}`, "", "169"],
    CLOCK: ["CLOCK", "data-live-time", "12:35"],
    "STOP WATCH": ["STOP WATCH", "data-live-stopwatch", "00:00:00"],
    HEADING: ["HEADING", "data-live-heading-label", "NNE"],
    "COMPASS DIRECTION": ["COMPASS DIRECTION", "data-live-heading-label", "NNE"],
    "INPUT VOLTAGE": ["INPUT VOLTAGE", "", "13.8"],
    "INTERNAL BATTERY VOLTAGE": ["BATTERY VOLTAGE", "", "4.1"],
    TACHOMETER: ["TACHOMETER RPM", "data-live-rpm", "3250"],
    "WHEEL DISTANCE": [`WHEEL DST${variantSuffix} ${display.distanceUnit}`, "data-live-trip-distance", "0.0"],
    "GPS DISTANCE": [`GPS DST${variantSuffix} ${display.distanceUnit}`, "data-live-distance", "0.0"],
    "ENGINE TRIP TIME": [`ENGINE TRIP TIME${variantSuffix}`, "data-live-elapsed", "00:00:00"],
    "GPS TRIP TIME": [`GPS TRIP TIME${variantSuffix}`, "data-live-elapsed", "00:00:00"],
    "MAX WHEEL SPEED": [`MAX WHEEL SPD${variantSuffix} ${display.speedUnit}`, "data-live-max-speed", "25"],
    "MAX GPS SPEED": [`MAX GPS SPD${variantSuffix} ${display.speedUnit}`, "data-live-max-speed", "25"],
    "AVG WHEEL SPEED": [`AVG WHEEL SPD${variantSuffix} ${display.speedUnit}`, "data-live-avg-speed", "12"],
    "AVG GPS SPEED": [`AVG GPS SPD${variantSuffix} ${display.speedUnit}`, "data-live-avg-speed", "12"],
    "CURRENT (BATTERY CHARGER)": ["CHARGER CURRENT", "", "0.8"],
  };
  const [label, attribute, fallback] = definitions[normalized] ?? [normalized, "", "--"];
  return { label, attribute, fallback };
}

function userMetricBlock(x, y, selection, display, screenNumber, slotIndex) {
  const metric = voyagerUserMetricDefinition(selection, display);
  const readoutClass = metric.fallback === "00:00:00" ? " voyager-live__user-metric-readout--clock" : "";
  return `
    <g data-live-user-readout data-user-screen="${screenNumber}" data-user-slot="${slotIndex}" data-voyager-touch-target="user-readout">
      <rect class="voyager-live__touch-hit" x="${x - 104}" y="${y - 29}" width="208" height="91" />
      <text class="voyager-live__text voyager-live__text--medium voyager-live__user-metric-label" x="${x}" y="${y}" text-anchor="middle">${metric.label}</text>
      <text class="voyager-live__text voyager-live__text--readout${readoutClass}" x="${x}" y="${y + 58}" text-anchor="middle" ${metric.attribute}>${metric.fallback}</text>
    </g>`;
}

function userMarkup(screen, variant, { menuValues, display }) {
  const screenNumber = variant.view === "secondary" ? 2 : 1;
  const selections = Array.from({ length: 6 }, (_, index) => ({
    selection: menuValues[`userScreen${screenNumber}Block${index + 1}`]
      ?? DEFAULT_USER_SCREEN_BLOCKS[screenNumber][index],
    slotIndex: index,
  })).filter(({ selection }) => selection !== "<OFF>");
  const contentLeft = variant.tabsVisible ? 70 : 0;
  const contentWidth = 504 - contentLeft;
  const leftCenter = contentLeft + contentWidth * 0.25;
  const rightCenter = contentLeft + contentWidth * 0.75;
  const center = contentLeft + contentWidth * 0.5;
  const rowCount = Math.max(1, Math.ceil(selections.length / 2));
  const rowLabels = rowCount === 1 ? [123] : rowCount === 2 ? [82, 190] : [62, 148, 234];
  const blocks = selections.map(({ selection, slotIndex }, index) => {
    const row = Math.floor(index / 2);
    const alone = index === selections.length - 1 && selections.length % 2 === 1;
    const x = alone ? center : index % 2 === 0 ? leftCenter : rightCenter;
    return userMetricBlock(x, rowLabels[row], selection, display, screenNumber, slotIndex);
  }).join("");
  return `
    <rect class="voyager-live__surface" width="504" height="303" />
    ${screenChromeMarkup(screen, variant)}
    ${userTitleMarkup(menuValues[`userScreen${screenNumber}Title`] ?? `USER SCREEN ${screenNumber}`, variant.tabsVisible)}
    ${blocks || `<text class="voyager-live__text voyager-live__text--medium" x="${center}" y="170" text-anchor="middle">NO DATA BLOCKS</text>`}`;
}

function navigationMarkup(screen, variant, { display }) {
  const hiddenOffset = variant.tabsVisible ? 0 : -34;
  return `
    <rect class="voyager-live__surface" width="504" height="303" />
    ${screenChromeMarkup(screen, variant)}
    <g transform="translate(${hiddenOffset} 0)">
      <text class="voyager-live__text voyager-live__text--medium" x="467.5" y="47" text-anchor="start" data-live-heading-label>N</text>
      ${metricBlock(186, 30, `SPD ${display.speedUnit}`, "data-live-speed", "21")}
      <g data-live-nav-destination data-voyager-touch-target="destination-picker">
        <rect class="voyager-live__touch-hit" x="96" y="103" width="180" height="96" />
        ${metricBlock(186, 127, `DEST DST ${display.distanceUnit}`, "data-live-destination", "---", {
    labelAttribute: "data-live-destination-label",
    labelClass: "voyager-live__destination-label",
    readoutClass: "voyager-live__destination-readout",
  })}
      </g>
      ${compassMarkup({ cx: 388.75, cy: 102, radius: 87.4, pointerAttribute: "data-live-nav-pointer" })}
      <g data-live-stopwatch-toggle data-voyager-touch-target="stopwatch-toggle">
        <rect class="voyager-live__touch-hit" x="142" y="202" width="212" height="96" />
        <text class="voyager-live__text voyager-live__text--medium" x="248" y="225" text-anchor="middle">STOP WATCH</text>
        <text class="voyager-live__text voyager-live__text--large voyager-live__text--clock" x="248" y="283" text-anchor="middle" data-live-stopwatch>00:00:00</text>
      </g>
    </g>
    <g data-live-stopwatch-toggle data-voyager-touch-target="stopwatch-toggle">
      <rect class="voyager-live__touch-hit" x="434" y="218" width="70" height="66" />
      ${voyagerUiIcon("pauseplay-pill", { x: 442, y: 230, width: 62, height: 42, attributes: 'data-live-stopwatch-control=""' })}
    </g>`;
}

function satelliteMarkup(screen, variant) {
  if (variant.view === "secondary") {
    return `
      <rect class="voyager-live__surface" width="504" height="303" />
      ${screenChromeMarkup(screen, variant)}
      <g class="voyager-live__satellite-details">
        <text class="voyager-live__text voyager-live__text--satellite-detail" x="252" y="48" text-anchor="middle">LAT: <tspan class="voyager-live__text--satellite-coordinate" data-live-latitude>N 45.774051°</tspan></text>
        <text class="voyager-live__text voyager-live__text--satellite-detail" x="252" y="88" text-anchor="middle">LON: <tspan class="voyager-live__text--satellite-coordinate" data-live-longitude>W 122.527241°</tspan></text>
        <text class="voyager-live__text voyager-live__text--satellite-detail" x="252" y="134" text-anchor="middle">TYPE: 3D</text>
        <text class="voyager-live__text voyager-live__text--satellite-detail" x="252" y="168" text-anchor="middle">QUALITY: DGPS</text>
        <text class="voyager-live__text voyager-live__text--satellite-detail" x="252" y="212" text-anchor="middle">PDOP: 1.45</text>
        <text class="voyager-live__text voyager-live__text--satellite-detail" x="252" y="246" text-anchor="middle">HDOP: 0.85</text>
        <text class="voyager-live__text voyager-live__text--satellite-detail" x="252" y="280" text-anchor="middle">VDOP: 1.16</text>
      </g>`;
  }
  const offset = variant.tabsVisible ? 0 : -34;
  const satellites = [
    { x: 200, y: 43, id: 1, active: true },
    { x: 314, y: 72, id: 23, active: true },
    { x: 159, y: 105, id: 8, active: true },
    { x: 284, y: 136, id: 7, active: true },
    { x: 146, y: 203, id: 2, active: false },
    { x: 203, y: 165, id: 28, active: true },
    { x: 325, y: 217, id: 4, active: false },
  ];
  const satelliteDots = satellites.map(({ x, y, id, active }) => `
    <g transform="translate(${x} ${y})">
      ${active
        ? voyagerUiIcon("circle-digit-black", { x: -22, y: -15, width: 44, height: 29 })
        : voyagerUiIcon("circle-digit-white", { x: -22, y: -15, width: 44, height: 29, className: "voyager-live__satellite-pill--weak" })}
      <text class="voyager-live__text${active ? " voyager-live__text--inverse" : ""}" x="0" y="6" text-anchor="middle">${id}</text>
    </g>`).join("");
  const signalValues = [
    { id: 1, width: 66, active: true }, { id: 8, width: 18, active: true },
    { id: 28, width: 72, active: true }, { id: 2, width: 42, active: false },
    { id: 23, width: 84, active: true }, { id: 4, width: 24, active: false },
    { id: 7, width: 32, active: true },
  ];
  const bars = signalValues.map(({ width, active }, index) => {
    const y = 52 + index * 30;
    return `<rect class="${active ? "voyager-live__ink" : "voyager-live__signal-bar--weak"}" x="396" y="${y}" width="${width}" height="15" />`;
  }).join("");
  const signalLabels = signalValues.map(({ id }, index) =>
    `<text class="voyager-live__text" x="388" y="${66 + index * 30}" text-anchor="end">${id}</text>`,
  ).join("");
  return `
    <rect class="voyager-live__surface" width="504" height="303" />
    ${screenChromeMarkup(screen, variant)}
    <g transform="translate(${offset} 0)">
      <g class="voyager-live__satellite-heading-arrow" transform="rotate(22.5 85 279.5)">
        ${voyagerUiIcon("compass-indicator-24pt", { x: 76, y: 267, width: 18, height: 25 })}
      </g>
      <text class="voyager-live__text voyager-live__text--medium" x="105" y="289">NNE</text>
      <g class="voyager-live__satellite-radar">
        <circle class="voyager-live__compass-line voyager-live__satellite-radar-line" cx="240" cy="151" r="26.64" />
        <circle class="voyager-live__compass-line voyager-live__satellite-radar-line" cx="240" cy="151" r="53.28" />
        <circle class="voyager-live__compass-line voyager-live__satellite-radar-line" cx="240" cy="151" r="79.92" />
        <circle class="voyager-live__compass-line voyager-live__satellite-radar-line" cx="240" cy="151" r="106.56" />
        <path class="voyager-live__compass-line voyager-live__satellite-radar-line" d="M133.44 151H346.56M240 44.44V257.56" />
      </g>
      ${satelliteDots}
      ${bars}
      <g class="voyager-live__signal-grid">
        <line x1="396" y1="47" x2="396" y2="250" />
      </g>
      ${signalLabels}
    </g>`;
}

function renderScreenMarkup(screen, variant, menuValues = {}) {
  const renderers = {
    startup: startupMarkup,
    main: mainMarkup,
    map: mapMarkup,
    graph: graphMarkup,
    user: userMarkup,
    navigation: navigationMarkup,
    satellite: satelliteMarkup,
  };
  const markup = renderers[screen.renderer](screen, variant, {
    menuValues,
    display: createVoyagerDisplayProfile(menuValues),
  });
  return `${markup}${secondaryScreenTouchMarkup(screen)}`;
}

function projectTrack(points, bounds, extentPoints = points) {
  const longitudes = extentPoints.map((point) => point.longitude);
  const latitudes = extentPoints.map((point) => point.latitude);
  const minimumLongitude = Math.min(...longitudes);
  const maximumLongitude = Math.max(...longitudes);
  const minimumLatitude = Math.min(...latitudes);
  const maximumLatitude = Math.max(...latitudes);
  const longitudeRange = maximumLongitude - minimumLongitude || 1;
  const latitudeRange = maximumLatitude - minimumLatitude || 1;
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  return points.map((point) => ({
    x: bounds.left + (point.longitude - minimumLongitude) / longitudeRange * width,
    y: bounds.bottom - (point.latitude - minimumLatitude) / latitudeRange * height,
  }));
}

function pathFromPoints(points) {
  return points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
}

function pathFromSegments(segments) {
  return segments.map(pathFromPoints).filter(Boolean).join(" ");
}

function escapeSvgText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function mapScaleLabel(mapScale, display) {
  const scaleBarMiles = 2 / Math.max(0.01, mapScale);
  if (display.distanceUnit === "KM") {
    const kilometers = scaleBarMiles * 1.609344;
    return kilometers >= 1 ? `${kilometers.toFixed(kilometers >= 10 ? 0 : 1)} km` : `${Math.round(kilometers * 1000)} m`;
  }
  return scaleBarMiles >= 1
    ? `${scaleBarMiles.toFixed(scaleBarMiles >= 10 ? 0 : 1)} mi`
    : `${Math.round(scaleBarMiles * 5280)} ft`;
}

function mapLabelMarkup(point, label, kind, size) {
  return `
    <g data-live-map-fixed data-map-x="${point.x.toFixed(2)}" data-map-y="${point.y.toFixed(2)}">
      <text class="voyager-live__text voyager-live__map-label voyager-live__map-label--${kind} voyager-live__map-label--${size.toLowerCase()}" x="0" y="0" text-anchor="middle">${escapeSvgText(label)}</text>
    </g>`;
}

export class VoyagerLiveRuntime {
  #mount;
  #stage;
  #appBase;
  #catalog;
  #ride;
  #state = null;
  #screenState = null;
  #menuState = null;
  #menuUnderlayScreenState = null;
  #menuReturnStateId = null;
  #menuModel = new VoyagerMenuModel();
  #layoutKey = "";
  #telemetry = null;
  #projectedTrack = [];
  #projectedNetworkSegments = [];
  #projectedExtentPoints = [];
  #projectedRecordedSegments = [];
  #projectedRecordingRevision = -1;
  #projectedTrackId = "";
  #menuProjectedTrack = [];
  #menuProjectedRecordedSegments = [];
  #menuProjectedRecordingRevision = -1;
  #menuProjectedTrackId = "";
  #mapViews = {
    overview: { pan: { x: 0, y: 0 }, scale: 1, mode: "pan", followPosition: false },
    detail: { pan: { x: 0, y: 0 }, scale: 2.1, mode: "pan", followPosition: true },
  };
  #graphScale = 1;
  #graphCursorProjection = null;
  #pulseTimer = 0;
  #stopwatchElapsedMs = 0;
  #stopwatchStartedAt = 0;
  #stopwatchRunning = false;
  #available = false;
  #selectedSavedRideIndex = 0;
  #overlayRideId = null;
  #selectedDestination = null;
  #lastImportedRideLabel = "";
  #lastExportedRide = null;
  #toastMessage = "";
  #toastExpiresAt = 0;
  #appliedSettingsKey = "";
  #settingsSnapshot = null;
  #settingsRevision = -1;
  #mapProfileSnapshot = null;
  #mapProfileRevision = -1;
  #gpsProfileSnapshot = null;
  #gpsProfileRevision = -1;

  constructor({ mount, stage, appBase }) {
    this.#mount = mount;
    this.#stage = stage;
    this.#appBase = appBase;
    this.#catalog = new VoyagerRideCatalog();
    this.#ride = new VoyagerRideEngine(this.#catalog);
  }

  async initialize() {
    const fontReady = document.fonts?.load
      ? Promise.all([
        document.fonts.load('16px "Bobs Font 6 Pixel"', "VOYAGER RIDE"),
        document.fonts.load('18px "Bobs Font 6 Pixel Narrow"', "ACCUMULATED RUN TIME"),
      ]).catch(() => [])
      : Promise.resolve();
    await Promise.all([
      fontReady,
      this.#ride.load([
        { id: "forest-loop", label: "FOREST LOOP", memoryRoles: ["track"], url: `${this.#appBase}/assets/rides/forest-loop.gpx` },
        { id: "mountain-run", label: "MOUNTAIN RUN", memoryRoles: ["track"], url: `${this.#appBase}/assets/rides/mountain-run.gpx` },
        { id: "cmra-trail-2", label: "CMRA TRAIL 2", memoryRoles: ["track", "route"], url: `${this.#appBase}/assets/rides/cmra-trail-2.gpx` },
        { id: "blackdog-2016", label: "2016 BLACKDOG", memoryRoles: ["route"], url: `${this.#appBase}/assets/rides/blackdog-2016.gpx` },
        { id: "baker-west-desert", label: "BAKER WEST", memoryRoles: ["route"], areaUrl: `${this.#appBase}/assets/rides/baker-west-desert.voyager.json` },
        { id: "jordan-creek", label: "JORDAN CREEK", memoryRoles: ["route"], areaUrl: `${this.#appBase}/assets/rides/jordan-creek.voyager.json` },
      ]),
    ]);
    this.#loadWaypoints();
    this.#loadSavedRides();
    this.#menuModel.load();
    this.#available = true;
    this.#ride.subscribe((telemetry, cadence) => {
      const previousTelemetry = this.#telemetry;
      const advancedAreaTrack = previousTelemetry?.areaId
        && previousTelemetry.areaId === telemetry.areaId
        && previousTelemetry.trackId !== telemetry.trackId;
      if (previousTelemetry?.trackId !== telemetry.trackId) {
        this.#projectedTrack = [];
        this.#projectedNetworkSegments = [];
        this.#projectedExtentPoints = [];
        this.#projectedRecordedSegments = [];
        this.#projectedRecordingRevision = -1;
        this.#projectedTrackId = "";
        this.#graphCursorProjection = null;
      }
      this.#telemetry = telemetry;
      this.#stage.dataset.liveRide = telemetry.trackId;
      this.#stage.dataset.powerMode = cadence.mode;
      const recording = this.#ride.recordingSnapshot;
      this.#stage.dataset.recordingPoints = String(recording.pointCount);
      this.#stage.dataset.recordingSegments = String(recording.segmentCount);
      if (cadence.kind === "sleep") {
        this.#renderSleep(cadence.clockLabel);
        return;
      }
      if (cadence.reason === "wake" && this.#layoutKey === "sleep" && this.#state) {
        this.#layoutKey = "";
        this.render(this.#state, { type: "wake" });
        return;
      }
      this.#updateDynamicFields(cadence.kind === "phase" ? cadence.phase : "all");
      if (advancedAreaTrack) {
        this.#queueToast(["NEXT TRACK", telemetry.trackLabel]);
        this.#renderQueuedToast();
      }
    });
  }

  recordActivity() {
    this.#ride.recordActivity();
  }

  performDemoEffect(effect, { loopIndex = 0 } = {}) {
    if (effect !== "warning-led-cycle") return null;
    const enabled = loopIndex % 2 === 0;
    const snapshot = this.#menuModel.exportSnapshot();
    snapshot.settings = {
      ...snapshot.settings,
      yellowLedOn: enabled ? "120 °F" : "000 °F",
      redLedOn: enabled ? "155 °F" : "000 °F",
      yellowLedFlash: enabled ? "145 °F" : "000 °F",
      redLedFlash: enabled ? "170 °F" : "000 °F",
    };
    this.#menuModel.importSnapshot(snapshot);
    this.#invalidateSettingsSnapshot();
    this.#layoutKey = "";
    this.#stage.dataset.demoWarningLights = enabled ? "armed" : "off";
    if (this.#state) this.render(this.#state, { type: "demo-effect", effect });

    const lights = [...this.#stage.querySelectorAll("[data-voyager-warning-led]")];
    for (const light of lights) light.getAnimations().forEach((animation) => animation.cancel());
    if (enabled) {
      for (const [index, light] of lights.entries()) {
        light.animate(
          [
            { opacity: 0, offset: 0 },
            { opacity: 0.96, offset: 0.12 },
            { opacity: 0, offset: 0.3 },
            { opacity: 0, offset: 0.48 },
            { opacity: 0.96, offset: 0.6 },
            { opacity: 0, offset: 0.8 },
            { opacity: 0, offset: 1 },
          ],
          {
            delay: index * 180,
            duration: 1700,
            easing: "steps(1, end)",
          },
        );
      }
    }
    return Object.freeze({ enabled });
  }

  supports(stateId) {
    return this.#available && (VOYAGER_LIVE_STATE_IDS.has(stateId) || VOYAGER_MENU_STATE_IDS.has(stateId));
  }

  getInputPolicyStateId(stateId) {
    return this.supports(stateId) ? VOYAGER_INPUT_POLICY_ALIASES[stateId] ?? stateId : stateId;
  }

  resolveInputTarget(stateId, action, defaultTarget) {
    const mapScreenTarget = voyagerMapScreenTarget(stateId, action, this.#mapProfile().screen2.enabled);
    if (!mapScreenTarget) return defaultTarget;
    return mapScreenTarget === stateId ? null : mapScreenTarget;
  }

  resolveStateId(screenId) {
    return VOYAGER_STABLE_STATE_ALIASES[screenId] ?? VOYAGER_MENU_STABLE_STATE_ALIASES[screenId] ?? screenId;
  }

  getStableStateId(stateId) {
    return VOYAGER_CANONICAL_STATE_IDS[stateId] ?? VOYAGER_MENU_CANONICAL_STATE_IDS[stateId] ?? stateId;
  }

  resolveAutoTransitionDelay(state, transition) {
    if (["map2", "map3", "map3-2"].includes(state.id)) {
      const timeout = this.#mapProfile().panZoomTimeoutMs;
      return Number.isFinite(timeout) ? timeout : null;
    }
    if (transition.delayMs !== 20000) return undefined;
    const seconds = Number.parseInt(this.#settings().tabsTimeout, 10);
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
  }

  applyNavigationParameters(parameters = {}) {
    const rideId = parameters.rideId ?? parameters.trackId;
    if (rideId) this.#ride.selectRide(rideId, { reset: parameters.resetRide !== false });
    if (Number.isFinite(Number(parameters.progress))) this.#ride.seek(Number(parameters.progress));
    if (Number.isFinite(Number(parameters.playbackSpeed))) this.#ride.setPlaybackSpeed(Number(parameters.playbackSpeed));
    if (parameters.loop !== undefined) this.#ride.setLoop(parameters.loop);
    if (parameters.playing === true) this.#ride.play();
    if (parameters.playing === false) this.#ride.pause();
  }

  prepareInput(stateId, action) {
    this.#clearToast();
    const policyStateId = VOYAGER_INPUT_POLICY_ALIASES[stateId] ?? stateId;
    const mainScreenTarget = voyagerMainScreenTarget(
      policyStateId,
      action,
      this.#settings().tachbarScreen === "ENABLED",
    );
    if (mainScreenTarget) return { action, targetStateId: mainScreenTarget };
    const mapScreenTarget = voyagerMapScreenTarget(
      stateId,
      action,
      this.#mapProfile().screen2.enabled,
    );
    if (mapScreenTarget) return { action, targetStateId: mapScreenTarget };
    const definition = this.#contextualizeMenuDefinition(voyagerMenuState(stateId));
    const prepared = this.#menuModel.prepareInput(definition, action);
    const rootMenu = stateId === "m-main1-1" || stateId === "m-ride2-1" || stateId === "m-set3-1";
    if (rootMenu && this.#menuReturnStateId && (action === "back" || action === "menu")) {
      const targetStateId = this.#menuReturnStateId;
      this.#menuReturnStateId = null;
      return { ...prepared, targetStateId };
    }
    return prepared;
  }

  preparePointerInput(stateId, target, pointer = {}) {
    if (!target?.closest) return null;
    if (target.closest("[data-live-toast]")) {
      this.#clearToast();
      return { handled: true };
    }
    this.#clearToast();

    if (target.closest("[data-menu-backdrop]")) return { action: "back" };

    const menuTab = target.closest("[data-menu-tab]");
    if (menuTab) {
      const targetStateId = VOYAGER_MENU_TAB_TARGETS[menuTab.dataset.menuTab];
      return targetStateId ? { targetStateId } : null;
    }

    const screenTab = target.closest("[data-tab]");
    if (screenTab) {
      const targetStateId = voyagerScreenTabTarget(screenTab.dataset.tab);
      return targetStateId ? { targetStateId } : null;
    }

    const tabsVisibleTarget = voyagerTabsVisibleTarget(stateId);
    if (tabsVisibleTarget && !voyagerMenuState(stateId)) return { targetStateId: tabsVisibleTarget };

    const userReadout = target.closest("[data-live-user-readout]");
    if (userReadout) {
      const userScreen = Number(userReadout.dataset.userScreen);
      const slotIndex = Number(userReadout.dataset.userSlot);
      if (![1, 2].includes(userScreen) || !Number.isInteger(slotIndex)) return null;
      const layoutId = `m-user-screen-${userScreen}-layout`;
      const layoutDefinition = this.#contextualizeMenuDefinition(voyagerMenuState(layoutId));
      this.#menuModel.preparePointerInput(layoutDefinition, {
        type: "layout-slot",
        index: slotIndex,
        activate: false,
      });
      return { targetStateId: `m-user-screen-${userScreen}-data-block` };
    }

    if (target.closest("[data-live-nav-destination]")) {
      return {
        targetStateId: ["dir2", "dir3"].includes(stateId)
          ? "m-nav-destination-secondary"
          : "m-nav-destination-primary",
      };
    }
    if (target.closest("[data-live-stopwatch-toggle]")) return { action: "enter" };
    if (target.closest("[data-live-secondary-screen]")) return { action: "right" };

    const definition = this.#contextualizeMenuDefinition(voyagerMenuState(stateId));
    if (!definition) return null;

    const confirmation = target.closest("[data-menu-confirmation]");
    if (confirmation) {
      return this.#menuModel.preparePointerInput(definition, {
        type: "confirmation",
        index: confirmation.dataset.menuConfirmation,
        activate: pointer.activate,
      });
    }
    const layoutName = target.closest("[data-menu-layout-name]");
    if (layoutName) {
      return this.#menuModel.preparePointerInput(definition, {
        type: "layout-name",
        activate: pointer.activate,
      });
    }
    const layoutSlot = target.closest("[data-menu-layout-slot]");
    if (layoutSlot) {
      return this.#menuModel.preparePointerInput(definition, {
        type: "layout-slot",
        index: layoutSlot.dataset.menuLayoutSlot,
        activate: pointer.activate,
      });
    }
    const option = target.closest("[data-menu-option]");
    if (option) {
      return this.#menuModel.preparePointerInput(definition, {
        type: "option",
        index: option.dataset.menuOption,
        activate: pointer.activate,
      });
    }
    const row = target.closest("[data-menu-row]");
    if (row) {
      return this.#menuModel.preparePointerInput(definition, {
        type: "row",
        index: row.dataset.menuRow,
        activate: pointer.activate,
      });
    }
    const keyboardKey = target.closest("[data-menu-key-index]");
    if (keyboardKey) {
      return this.#menuModel.preparePointerInput(definition, {
        type: "keyboard-key",
        index: keyboardKey.dataset.menuKeyIndex,
        activate: pointer.activate,
      });
    }
    const slot = target.closest("[data-menu-slot]");
    if (slot) {
      return this.#menuModel.preparePointerInput(definition, {
        type: "slot",
        index: slot.dataset.menuSlot,
        activate: pointer.activate,
      });
    }
    if (target.closest("[data-menu-brightness]")) {
      const value = (Number(pointer.x) - 112) / 280 * 100;
      return this.#menuModel.preparePointerInput(definition, {
        type: "brightness",
        value,
        activate: pointer.activate,
      });
    }
    const action = target.closest("[data-menu-action]")?.dataset.menuAction;
    return action ? this.#menuModel.preparePointerInput(definition, { type: "action", action }) : null;
  }

  resolveInputAction(stateId, action) {
    return this.#menuModel.resolveInputAction(this.#contextualizeMenuDefinition(voyagerMenuState(stateId)), action);
  }

  render(state, event = {}) {
    const sourceScreenState = voyagerScreenState(event.from);
    this.#state = state;
    this.#screenState = voyagerScreenState(state.id);
    this.#menuState = voyagerMenuState(state.id);
    this.#menuUnderlayScreenState = null;
    if (this.#menuState && event.action === "menu" && sourceScreenState) {
      this.#menuReturnStateId = event.from;
    } else if (this.#screenState && voyagerMenuState(event.from)) {
      this.#menuReturnStateId = null;
    }
    if (!this.supports(state.id) || (!this.#screenState && !this.#menuState)) {
      throw new Error(`Voyager state ${state.id} does not have a live renderer.`);
    }

    this.#mount.hidden = false;
    this.#stage.dataset.renderer = "live";
    this.#stage.dataset.liveState = state.id;
    this.#applyInteractiveInput(event);

    if (this.#menuState) {
      const savedRideKey = this.#catalog.savedRides.slice(0, 4).map((ride) => `${ride.id}:${ride.name}`).join("|");
      const inventory = this.#inventory();
      const layoutKey = `menu:${state.id}:${inventory.signature}:${this.#menuModel.revision}:${savedRideKey}:${this.#selectedSavedRideIndex}`;
      if (layoutKey !== this.#layoutKey) {
        this.#mount.innerHTML = `
          <svg class="voyager-live voyager-menu" viewBox="0 0 504 303" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${voyagerMenuAriaLabel(this.#menuState)}">
            ${this.#renderMenuMarkup(this.#menuState)}
          </svg>`;
        this.#layoutKey = layoutKey;
        this.#menuProjectedTrack = [];
      }
      this.#mount.querySelector("svg")?.setAttribute("data-voyager-screen-id", state.id);
      this.#updateDynamicFields();
      this.#renderQueuedToast();
      return;
    }

    const { screen, variant } = this.#screenState;
    const mapView = screen.renderer === "map" ? this.#mapViews[variant.mapView] : null;
    let renderedVariant = mapView && variant.editing
      ? { ...variant, interaction: mapView.mode }
      : variant;
    const menuValues = this.#settings();
    if (screen.renderer === "map" && !variant.editing && !this.#mapProfile().screen2.enabled) {
      renderedVariant = { ...renderedVariant, sideArrows: false };
    }
    const displayProfile = createVoyagerDisplayProfile(menuValues);
    const settingsLayoutRevision = screen.renderer === "user" || screen.renderer === "map" || variant.view === "tachbar"
      ? this.#menuModel.revision
      : "static";
    const layoutKey = `${screen.id}:${variant.view}:${variant.mapView ?? "default"}:${variant.tabsVisible}:${renderedVariant.interaction ?? "browse"}:${displayProfile.signature}:${settingsLayoutRevision}`;
    if (layoutKey !== this.#layoutKey) {
      this.#mount.innerHTML = `
        <svg class="voyager-live" viewBox="0 0 504 303" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Live Voyager ${screen.tabLabel.toLowerCase()} ${variant.view} screen">
          ${renderScreenMarkup(screen, renderedVariant, menuValues)}
        </svg>`;
      this.#layoutKey = layoutKey;
      this.#projectedTrack = [];
      this.#projectedNetworkSegments = [];
      this.#graphCursorProjection = null;
    }
    this.#mount.querySelector("svg")?.setAttribute("data-voyager-screen-id", state.id);
    this.#syncDestinationLabel();
    this.#updateDynamicFields();
    this.#renderQueuedToast();
  }

  pulseInput(action) {
    const hint = this.#mount.querySelector(`[data-live-hint="${action}"]`);
    if (!hint) return;
    hint.classList.add("is-pressed");
    window.clearTimeout(this.#pulseTimer);
    this.#pulseTimer = window.setTimeout(() => hint.classList.remove("is-pressed"), 180);
  }

  #renderSleep(clockLabel) {
    if (this.#layoutKey !== "sleep") {
      this.#mount.innerHTML = `
        <svg class="voyager-live voyager-live--sleep" viewBox="0 0 504 303" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Voyager sleep mode clock">
          <rect class="voyager-live__surface" width="504" height="303" />
          <text class="voyager-live__text voyager-live__sleep-clock" x="252" y="190" text-anchor="middle" data-live-sleep-clock></text>
        </svg>`;
      this.#layoutKey = "sleep";
    }
    setElementText(this.#mount.querySelector("[data-live-sleep-clock]"), clockLabel);
  }

  #renderMenuMarkup(definition, visited = new Set()) {
    if (visited.has(definition.id)) throw new Error(`Voyager menu underlay cycle at ${definition.id}.`);
    visited.add(definition.id);
    const contextualDefinition = this.#contextualizeMenuDefinition(definition);
    let resolved = this.#menuModel.resolve(contextualDefinition);
    if (resolved.graphDisplay) {
      const trackSlot = resolved.trackSlot === 2 ? " (TRACK_2)" : "";
      resolved = {
        ...resolved,
        summary: `DISPLAYING: ${this.#telemetry?.trackLabel ?? "CURRENT TRACK"}${trackSlot}`,
      };
    }
    if (/^m-ride2-6-4-[1-4]$/.test(resolved.id)) {
      const cardRows = this.#catalog.savedRides.slice(0, 4).map((ride) => ({ label: ride.name }));
      while (cardRows.length < 4) cardRows.push({ label: "EMPTY SLOT" });
      resolved = { ...resolved, rows: cardRows };
    }
    if (/^m-ride2-6-4-1-[1-4](?:-1)?$/.test(resolved.id)) {
      resolved = {
        ...resolved,
        title: this.#catalog.savedRides[this.#selectedSavedRideIndex]?.name ?? "EMPTY SLOT",
      };
    }
    if (resolved.presentation !== "overlay") return renderVoyagerMenuMarkup(resolved);

    let underlayMarkup = "";
    const menuParent = voyagerMenuState(resolved.parentStateId);
    if (menuParent) {
      underlayMarkup = this.#renderMenuMarkup(menuParent, visited);
    } else {
      const screenParent = voyagerScreenState(resolved.parentStateId);
      if (screenParent) {
        this.#menuUnderlayScreenState = screenParent;
        underlayMarkup = renderScreenMarkup(screenParent.screen, screenParent.variant, this.#settings());
      }
    }
    return renderVoyagerMenuMarkup(resolved, { underlayMarkup });
  }

  #destinationWaypoints() {
    return this.#catalog.destinationWaypoints(this.#ride.waypoints);
  }

  #settings() {
    if (this.#settingsRevision === this.#menuModel.revision && this.#settingsSnapshot) return this.#settingsSnapshot;
    this.#settingsSnapshot = this.#menuModel.effectiveValues;
    this.#settingsRevision = this.#menuModel.revision;
    return this.#settingsSnapshot;
  }

  #mapProfile() {
    if (this.#mapProfileRevision === this.#menuModel.revision && this.#mapProfileSnapshot) {
      return this.#mapProfileSnapshot;
    }
    this.#mapProfileSnapshot = createVoyagerMapProfile(this.#settings());
    this.#mapProfileRevision = this.#menuModel.revision;
    return this.#mapProfileSnapshot;
  }

  #gpsProfile() {
    if (this.#gpsProfileRevision === this.#menuModel.revision && this.#gpsProfileSnapshot) {
      return this.#gpsProfileSnapshot;
    }
    this.#gpsProfileSnapshot = createVoyagerGpsProfile(this.#settings());
    this.#gpsProfileRevision = this.#menuModel.revision;
    return this.#gpsProfileSnapshot;
  }

  #inventory() {
    return this.#catalog.inventorySnapshot();
  }

  #contextualizeMenuDefinition(definition) {
    if (["m-main1-5-success", "m-ride-import-success"].includes(definition?.id)) {
      return {
        ...definition,
        message: ["TRACK LOADED", this.#lastImportedRideLabel || "OPEN MAP TO VIEW"],
      };
    }
    if (definition?.kind === "status-modal") {
      const inventory = this.#inventory();
      const telemetry = this.#telemetry;
      const gps = this.#gpsProfile();
      const recording = this.#ride.recordingSnapshot;
      return {
        ...definition,
        entries: [
          { key: "software", value: "VOYAGER WEB 1.7.0" },
          { key: "state", value: this.#state?.id ?? "BOOT" },
          { key: "ride", value: telemetry?.trackLabel ?? "NO TRACK" },
          { key: "rideProgress", value: `${Math.round((telemetry?.progress ?? 0) * 100)}%` },
          { key: "engine", value: this.#ride.playing ? "RUNNING" : "STOPPED" },
          { key: "gpsFix", value: gps.gpsEnabled ? "3D DGPS" : "POWER SAVE" },
          { key: "gpsLogging", value: recording.active ? `${gps.method} ${gps.frequency}` : "PAUSED" },
          { key: "recorded", value: `${recording.pointCount} PTS / ${recording.segmentCount} SEG` },
          { key: "latitude", value: telemetry ? gps.formatLatitude(telemetry.latitude) : "--" },
          { key: "longitude", value: telemetry ? gps.formatLongitude(telemetry.longitude) : "--" },
          { key: "altitudeFt", value: Math.round(telemetry?.elevationFeet ?? 0) },
          { key: "speedMph", value: Math.round(telemetry?.speedMph ?? 0) },
          { key: "heading", value: Math.round(telemetry?.heading ?? 0) },
          { key: "tracks", value: `${inventory.trackCount}/300` },
          { key: "routes", value: `${inventory.routeCount}/300` },
          { key: "waypoints", value: `${inventory.waypointCount}/300` },
          { key: "microSd", value: `${inventory.microSdUsedMb}/${inventory.microSdCapacityMb}MB` },
          { key: "lastExport", value: this.#lastExportedRide ? `${this.#lastExportedRide.bytes} BYTES` : "NONE" },
          ...this.#menuModel.supportEntries(),
        ],
      };
    }
    if (definition?.kind === "memory") {
      return {
        ...definition,
        rows: voyagerMemoryRows(this.#inventory()),
      };
    }
    if (["m-ride-tracks-custom", "m-ride-tracks-rename"].includes(definition?.id)) {
      const options = this.#catalog.labelsFor("track");
      return {
        ...definition,
        options,
        checkedOptions: options.map((_, index) => index),
        optionTargets: definition.id === "m-ride-tracks-rename"
          ? Object.fromEntries(options.map((_, index) => [index, "m-ride-track-name"]))
          : definition.optionTargets,
      };
    }
    if (definition?.id === "m-ride-routes-rename") {
      return {
        ...definition,
        options: this.#catalog.labelsFor("route"),
      };
    }
    if (!definition?.destinationWaypointPicker) return definition;
    const waypointOptions = this.#destinationWaypoints();
    if (!waypointOptions.length) {
      return {
        ...definition,
        options: ["<NONE>"],
        waypointOptions: [],
        destinationUnavailable: true,
      };
    }
    return {
      ...definition,
      options: waypointOptions.map((waypoint) => waypoint.name),
      waypointOptions,
    };
  }

  #applyInteractiveInput(event) {
    if (event.type !== "dispatch") return;
    this.#applyMenuOutcome(event);
    const fromState = voyagerScreenState(event.from);
    if (!fromState) return;
    if (fromState.screen.id === "map") {
      const mapView = this.#mapViews[fromState.variant.mapView];
      if (fromState.variant.editing && event.action === "enter") {
        mapView.mode = mapView.mode === "pan" ? "zoom" : "pan";
      } else if (event.action === "center") {
        mapView.pan = { x: 0, y: 0 };
        mapView.scale = 1;
        mapView.followPosition = false;
      } else if (fromState.variant.editing && DIRECTION_INPUTS.has(event.action) && mapView.mode === "pan") {
        const step = 12;
        if (event.action === "up") mapView.pan.y += step;
        if (event.action === "down") mapView.pan.y -= step;
        if (event.action === "left") mapView.pan.x += step;
        if (event.action === "right") mapView.pan.x -= step;
        mapView.followPosition = false;
      } else if (fromState.variant.editing && DIRECTION_INPUTS.has(event.action) && mapView.mode === "zoom") {
        const direction = event.action === "up" || event.action === "right" ? 0.16 : -0.16;
        mapView.scale = clamp(mapView.scale * (direction > 0 ? 1.2 : 1 / 1.2), 0.72, 24);
      }
    }
    if (fromState.variant.interaction === "graph") {
      if (event.action === "left" || event.action === "right") {
        const step = 0.055 / this.#graphScale;
        this.#ride.seekBy(event.action === "left" ? -step : step);
      }
      if (event.action === "up") this.#graphScale = clamp(this.#graphScale * 1.6, 1, 8);
      if (event.action === "down") this.#graphScale = clamp(this.#graphScale / 1.6, 1, 8);
      if (event.action === "center") this.#graphScale = 1;
    }
    if (fromState.screen.id === "nav" && event.action === "enter") {
      const destination = voyagerScreenState(event.to);
      if (destination?.screen.id === "nav" && destination.variant.view === "secondary") {
        this.#startStopwatch();
      } else {
        this.#pauseStopwatch();
      }
    }
  }

  #updateDynamicFields(cadence = "all") {
    this.#expireToast();
    if (!this.#telemetry || !this.#state || this.#mount.hidden) return;
    const setText = (selector, value) => {
      const elements = this.#mount.querySelectorAll(selector);
      if (!elements.length) return;
      const nextValue = String(typeof value === "function" ? value() : value);
      for (const element of elements) setElementText(element, nextValue);
    };
    const telemetry = this.#telemetry;
    const refreshAll = cadence === "all";
    const refreshMotion = refreshAll || cadence === 0;
    const refreshTach = refreshAll || cadence === 0 || cadence === 2;
    const refreshCompass = refreshAll || cadence === 1 || cadence === 3;
    const refreshStatus = refreshAll || cadence === 2;
    const refreshStopwatch = refreshAll || cadence === 0 || cadence === 2;
    const menuValues = this.#settings();
    const display = createVoyagerDisplayProfile(menuValues);
    const power = createVoyagerPowerProfile(menuValues);
    const gps = this.#gpsProfile();
    this.#ride.setGpsProfile(gps);
    const brightnessValue = this.#menuState?.kind === "brightness"
      ? this.#menuModel.resolve(this.#menuState).value
      : power.backlightBrightnessValue;
    const sourceSpeedMph = () => menuValues.speedSource === "GPS"
      ? Math.max(0, telemetry.speedMph - 2)
      : telemetry.speedMph;
    if (refreshMotion) {
      setText("[data-live-speed]", () => display.speedFromMph(sourceSpeedMph()));
      setText("[data-live-gps-speed]", () => display.speedFromMph(Math.max(0, telemetry.speedMph - 2)));
      setText("[data-live-altitude]", () => display.altitudeFromFeet(telemetry.elevationFeet));
      setText("[data-live-distance]", () => display.distanceFromKm(telemetry.distanceKm).toFixed(1));
      setText("[data-live-trip-distance]", () => display.distanceFromKm(telemetry.distanceKm).toFixed(1));
      const destinationReadout = this.#mount.querySelector("[data-live-destination]");
      if (destinationReadout) this.#updateDestinationDistance(this.#selectedDestination
        ? String(display.destinationFromMeters(haversineMeters(telemetry, this.#selectedDestination)))
        : "---");
      setText("[data-live-elapsed]", telemetry.elapsedLabel);
      setText("[data-live-ride-label]", telemetry.trackLabel);
    }
    if (refreshTach) {
      const liveRpm = menuValues.engineSensor === "ENABLED" && menuValues.demoRideState === "RUNNING"
        ? telemetry.rpm
        : 0;
      setText("[data-live-rpm]", liveRpm);
      for (const element of this.#mount.querySelectorAll("[data-live-tach-segment]")) {
        element.classList.toggle("is-active", liveRpm >= Number(element.dataset.rpmThreshold));
      }
    }
    if (refreshStatus) {
      const completedMiles = telemetry.distanceKm / 1.609344;
      setText("[data-live-odometer]", () => Math.round(display.distanceFromMiles(1200 + completedMiles)));
      setText("[data-live-temperature]", () => `${display.temperatureFromF(telemetry.ambientTemperatureF)}${display.temperatureUnit}`);
      setText("[data-live-engine-temperature]", () => display.temperatureFromF(telemetry.engineTemperatureF));
      setText("[data-live-time]", () => display.clockAtElapsedSeconds(telemetry.elapsedSeconds));
      setText("[data-live-odometer-miles]", () => display.distanceFromMiles(523.7 + completedMiles).toFixed(1));
      setText("[data-live-max-speed]", () => display.speedFromMph(telemetry.maxSpeedMph));
      setText("[data-live-avg-speed]", () => display.speedFromMph(telemetry.averageSpeedMph));
      setText("[data-live-latitude]", () => gps.formatLatitude(telemetry.latitude));
      setText("[data-live-longitude]", () => gps.formatLongitude(telemetry.longitude));
      const powerSave = !gps.gpsEnabled;
      const demoRunning = menuValues.demoRideState === "RUNNING";
      setDatasetValue(this.#mount, "logging", this.#ride.recording ? "recording" : "paused");
      setDatasetValue(this.#mount, "engine", demoRunning ? "running" : "off");
      setDatasetValue(this.#mount, "gps", powerSave ? "disabled" : "enabled");
      setDatasetValue(this.#mount, "signalBars", gps.signalBars && gps.gpsEnabled ? "on" : "off");
      setDatasetValue(this.#mount, "stopwatch", this.#stopwatchRunning ? "running" : "paused");
      const settingsKey = [
        brightnessValue,
        menuValues.gpsMode,
        menuValues.demoRideState,
        menuValues.demoPlaybackSpeed,
        menuValues.demoLoop,
        power.signature,
        gps.signature,
        menuValues.mapOrientation,
        display.signature,
      ].join(":");
      if (settingsKey !== this.#appliedSettingsKey) {
        this.#ride.setPowerSave(powerSave || !demoRunning);
        this.#ride.setSleepAfterMs(power.sleepAfterMs);
        this.#ride.setPlaybackSpeed(Number.parseFloat(menuValues.demoPlaybackSpeed) || 1);
        this.#ride.setLoop(menuValues.demoLoop === "ON");
        if (demoRunning) this.#ride.play();
        else this.#ride.pause();
        setDatasetValue(this.#mount, "mapOrientation", menuValues.mapOrientation === "NORTH UP" ? "north-up" : "track-up");
        this.#mount.style.setProperty("--voyager-screen-brightness", String(clamp(Number(brightnessValue) / 50, 0.35, 2)));
        this.#mount.style.setProperty("--voyager-screen-inversion", display.inverted ? "1" : "0");
        this.#appliedSettingsKey = settingsKey;
      }
    }
    if (refreshStopwatch) {
      setText("[data-live-stopwatch]", formatDuration(this.#stopwatchMilliseconds() / 1000));
    }
    if (refreshCompass) {
      setText("[data-live-heading-label]", this.#headingLabel(telemetry.heading));
    }

    if (this.#menuState) {
      if (refreshMotion) {
        this.#updateMenuMap();
        if (this.#menuUnderlayScreenState?.screen.renderer === "graph") this.#updateGraph(this.#menuUnderlayScreenState);
      }
      return;
    }

    if (!this.#screenState) return;

    if (refreshCompass) {
      for (const pointer of this.#mount.querySelectorAll("[data-live-compass-pointer], [data-live-nav-pointer]")) {
        const cx = pointer.dataset.cx;
        const cy = pointer.dataset.cy;
        pointer.setAttribute("transform", `rotate(${telemetry.heading.toFixed(2)} ${cx} ${cy})`);
      }
    }

    if (refreshMotion && this.#screenState.screen.renderer === "map") this.#updateMap();
    if (this.#screenState.screen.renderer === "graph") {
      if (refreshMotion) {
        this.#updateGraph();
      } else if (cadence === 2) {
        this.#updateGraphCrosshair();
      }
    }
  }

  #startStopwatch() {
    if (this.#stopwatchRunning) return;
    this.#stopwatchStartedAt = performance.now();
    this.#stopwatchRunning = true;
    this.#ride.alignStopwatchCadence();
  }

  #pauseStopwatch() {
    if (!this.#stopwatchRunning) return;
    this.#stopwatchElapsedMs += performance.now() - this.#stopwatchStartedAt;
    this.#stopwatchStartedAt = 0;
    this.#stopwatchRunning = false;
  }

  #stopwatchMilliseconds() {
    return this.#stopwatchElapsedMs + (this.#stopwatchRunning ? performance.now() - this.#stopwatchStartedAt : 0);
  }

  #applyMenuOutcome(event) {
    const definition = voyagerMenuState(event.from);
    if (event.action === "back" && definition?.cancelOutcome === "cancel-export") {
      this.#queueToast("CANCELLED...");
      return;
    }
    if (event.action !== "enter") return;
    const telemetry = this.#telemetry;
    const savedRideSelection = event.from.match(/^m-ride2-6-4-([1-4])$/);
    if (savedRideSelection) this.#selectedSavedRideIndex = Number(savedRideSelection[1]) - 1;
    if (definition?.outcome === "quick-add-waypoint" && telemetry) {
      const waypoint = this.#addWaypoint("QUICK ADD", telemetry.latitude, telemetry.longitude);
      this.#queueToast(`Waypoint ${waypoint.label} added.`);
    }
    if (definition?.outcome === "select-destination"
      || event.from === "m-nav-destination-primary"
      || event.from === "m-nav-destination-secondary") {
      const selectedName = this.#settings().destinationWaypoint;
      this.#selectedDestination = this.#destinationWaypoints().find((waypoint) => waypoint.name === selectedName) ?? null;
      if (this.#selectedDestination) this.#queueToast(["WAYPOINT SELECTED", selectedName]);
      else this.#queueToast("DESTINATION CLEARED");
    }
    if (definition?.outcome === "add-waypoint-current" && telemetry) {
      const waypoint = this.#addWaypoint("CURRENT POSITION", telemetry.latitude, telemetry.longitude);
      this.#queueToast(`Waypoint ${waypoint.label} added.`);
    }
    if (definition?.outcome === "add-waypoint-coordinates") {
      const waypoint = this.#addWaypoint("LAT/LON", 45.768892, -122.519284);
      this.#queueToast(`Waypoint ${waypoint.label} added.`);
    }
    if (definition?.outcome === "add-waypoint-crosshair" && telemetry) {
      const waypoint = this.#addWaypoint("CROSSHAIRS", telemetry.latitude + 0.0012, telemetry.longitude + 0.0017);
      this.#queueToast(`Waypoint ${waypoint.label} added.`);
    }
    if (definition?.outcome === "erase-waypoint" && this.#catalog.savedWaypoints.length) {
      this.#catalog.removeLastSavedWaypoint();
      this.#saveWaypoints();
      this.#invalidateMapProjection();
      this.#queueToast("WAYPOINT ERASED");
    }
    if (definition?.outcome === "erase-waypoints") {
      this.#catalog.clearSavedWaypoints();
      this.#saveWaypoints();
      this.#invalidateMapProjection();
      this.#queueToast("ALL WAYPOINTS ERASED");
    }
    if (definition?.outcome === "reset-destination") {
      this.#selectedDestination = null;
      this.#queueToast("DESTINATION RESET");
    }
    if (definition?.outcome === "reset-ride-memory") {
      this.#ride.reset();
      this.#catalog.clearSavedWaypoints();
      this.#selectedDestination = null;
      this.#stopwatchElapsedMs = 0;
      this.#stopwatchStartedAt = this.#stopwatchRunning ? performance.now() : 0;
      this.#saveWaypoints();
      this.#invalidateMapProjection();
      this.#queueToast("RIDE MEMORY RESET");
    }
    if (definition?.outcome === "reset-trip-1") this.#queueToast("TRIP DST / TIME RESET");
    if (definition?.outcome === "reset-trip-2") this.#queueToast("TRIP DST / TIME 2 RESET");
    if (definition?.outcome === "reset-stopwatch") {
      this.#stopwatchElapsedMs = 0;
      this.#stopwatchStartedAt = this.#stopwatchRunning ? performance.now() : 0;
      this.#queueToast("STOP WATCH RESET");
    }
    if (definition?.outcome === "start-track-segment") {
      this.#ride.startNewTrackSegment();
      this.#queueToast("NEW TRACK SEGMENT STARTED");
    }
    if (definition?.outcome === "erase-tracks") {
      this.#ride.clearRecording();
      this.#invalidateMapProjection();
      this.#queueToast("ALL TRACKS ERASED");
    }
    if (definition?.outcome === "erase-routes") this.#queueToast("ALL ROUTES ERASED");
    if (definition?.outcome === "import-ride") this.#importRideFromCard();
    if (definition?.outcome === "export-ride") {
      this.#exportCurrentRide();
      this.#queueToast("GPX SAVED TO SD CARD");
    }
    if (definition?.outcome === "export-settings") this.#queueToast("SETTINGS SAVED TO SD CARD");
    if (definition?.outcome === "restart-demo-ride") {
      this.#ride.reset();
      if (this.#settings().demoRideState === "RUNNING") this.#ride.play();
    }
    if (definition?.outcome === "save-settings-file") {
      this.#downloadSettingsFile();
    }
    if (definition?.outcome === "load-settings-file") this.#chooseSettingsFile();
    if (definition?.outcome === "restore-all-settings") {
      this.#invalidateSettingsSnapshot();
      this.#queueToast("DEFAULT SETTINGS RESTORED");
    }
  }

  #downloadSettingsFile() {
    const contents = `${JSON.stringify(this.#menuModel.exportSnapshot(), null, 2)}\n`;
    const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "voyager-settings.json";
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    queueMicrotask(() => URL.revokeObjectURL(url));
  }

  #exportCurrentRide() {
    const name = this.#settings().rideName || this.#telemetry?.trackLabel || "VOYAGER RIDE";
    const contents = this.#ride.exportRecordedGpx(name);
    const bytes = new TextEncoder().encode(contents).byteLength;
    this.#catalog.noteExport(bytes, { replacesBytes: this.#lastExportedRide?.bytes ?? 0 });
    this.#lastExportedRide = Object.freeze({ name, bytes, contents });
  }

  #chooseSettingsFile() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.hidden = true;
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;
      try {
        if (file.size > 262144) throw new TypeError("Settings file is too large.");
        const result = this.#menuModel.importSnapshot(await file.text());
        this.#invalidateSettingsSnapshot();
        this.#queueToast(["SETTINGS FILE LOADED", `${result.accepted} VALUES RESTORED`]);
      } catch {
        this.#queueToast(["SETTINGS LOAD FAILED", "INVALID SETTINGS FILE"]);
      }
      this.#layoutKey = "";
      if (this.#state) this.render(this.#state, { type: "settings-file" });
    }, { once: true });
    input.addEventListener("cancel", () => input.remove(), { once: true });
    document.body.append(input);
    input.click();
  }

  #invalidateSettingsSnapshot() {
    this.#settingsSnapshot = null;
    this.#settingsRevision = -1;
    this.#mapProfileSnapshot = null;
    this.#mapProfileRevision = -1;
    this.#gpsProfileSnapshot = null;
    this.#gpsProfileRevision = -1;
    this.#appliedSettingsKey = "";
  }

  #importRideFromCard() {
    const selectedFile = this.#settings().importRideFile;
    const importedRide = SD_CARD_RIDE_FILES[selectedFile];
    if (!importedRide) {
      this.#lastImportedRideLabel = "IMPORT FAILED";
      return;
    }
    this.#ride.selectRide(importedRide.trackId);
    if (this.#settings().demoRideState === "RUNNING") this.#ride.play();
    this.#overlayRideId = null;
    this.#selectedDestination = null;
    this.#graphScale = 1;
    this.#mapViews.overview = { pan: { x: 0, y: 0 }, scale: 1, mode: "pan", followPosition: false };
    this.#mapViews.detail = { pan: { x: 0, y: 0 }, scale: 2.1, mode: "pan", followPosition: true };
    this.#lastImportedRideLabel = importedRide.label;
    this.#invalidateMapProjection();
  }

  #saveCurrentRide(telemetry) {
    const name = this.#settings().rideName || `RIDE-${this.#catalog.savedRides.length + 32}`;
    this.#catalog.saveRide({
      id: `RIDE-${Date.now().toString(36).toUpperCase()}`,
      name,
      progress: telemetry.progress,
      trackId: telemetry.trackId,
    });
    this.#saveSavedRides();
  }

  #loadSavedRide() {
    const ride = this.#catalog.savedRides[this.#selectedSavedRideIndex];
    if (!ride || !this.#ride.trackIds.includes(ride.trackId)) return;
    const selectedTrack = this.#ride.selectRide(ride.trackId);
    this.#ride.seek(ride.progress);
    this.#ride.play();
    this.#overlayRideId = null;
    this.#selectedDestination = null;
    this.#mapViews.overview = { pan: { x: 0, y: 0 }, scale: 1, mode: "pan", followPosition: false };
    this.#mapViews.detail = { pan: { x: 0, y: 0 }, scale: 2.1, mode: "pan", followPosition: true };
    this.#invalidateMapProjection();
    this.#queueToast(["RIDE LOADED", selectedTrack.label]);
  }

  #deleteSavedRide() {
    const removed = this.#catalog.removeSavedRide(this.#selectedSavedRideIndex);
    if (!removed) return;
    this.#selectedSavedRideIndex = clamp(this.#selectedSavedRideIndex, 0, Math.max(0, this.#catalog.savedRides.length - 1));
    if (this.#overlayRideId === removed.trackId) this.#overlayRideId = null;
    this.#saveSavedRides();
    this.#invalidateMapProjection();
  }

  #addWaypoint(source, latitude, longitude) {
    const waypoint = {
      id: `WP-${Date.now().toString(36).toUpperCase()}`,
      label: String(this.#catalog.savedWaypoints.length + 5),
      source,
      latitude,
      longitude,
    };
    this.#catalog.addSavedWaypoint(waypoint);
    this.#saveWaypoints();
    this.#invalidateMapProjection();
    return waypoint;
  }

  #destinationLabel() {
    if (this.#selectedDestination?.name) return this.#selectedDestination.name;
    if (this.#selectedDestination?.label) return `WAYPOINT ${this.#selectedDestination.label}`;
    return `DEST DST ${createVoyagerDisplayProfile(this.#settings()).distanceUnit}`;
  }

  #syncDestinationLabel() {
    setElementText(this.#mount.querySelector("[data-live-destination-label]"), this.#destinationLabel());
  }

  #updateDestinationDistance(value) {
    const readout = this.#mount.querySelector("[data-live-destination]");
    if (!readout) return;
    setElementText(readout, value);
    const textLength = voyagerDestinationTextLength(value);
    if (textLength) {
      readout.setAttribute("textLength", String(textLength));
      readout.setAttribute("lengthAdjust", "spacingAndGlyphs");
      return;
    }
    readout.removeAttribute("textLength");
    readout.removeAttribute("lengthAdjust");
  }

  #queueToast(message, durationMs = 5000) {
    this.#toastMessage = message;
    this.#toastExpiresAt = performance.now() + durationMs;
  }

  #renderQueuedToast() {
    if (!this.#toastMessage || performance.now() >= this.#toastExpiresAt) return;
    const screen = this.#mount.querySelector("svg");
    if (!screen) return;
    screen.querySelector("[data-live-toast]")?.remove();
    screen.insertAdjacentHTML("beforeend", renderVoyagerToastMarkup(this.#toastMessage));
  }

  #expireToast() {
    if (!this.#toastExpiresAt || performance.now() < this.#toastExpiresAt) return;
    this.#clearToast();
  }

  #clearToast() {
    this.#mount.querySelector("[data-live-toast]")?.remove();
    this.#toastMessage = "";
    this.#toastExpiresAt = 0;
  }

  #invalidateMapProjection() {
    this.#projectedTrack = [];
    this.#projectedNetworkSegments = [];
    this.#projectedExtentPoints = [];
    this.#projectedRecordedSegments = [];
    this.#projectedRecordingRevision = -1;
    this.#projectedTrackId = "";
    this.#menuProjectedTrack = [];
    this.#menuProjectedRecordedSegments = [];
    this.#menuProjectedRecordingRevision = -1;
    this.#menuProjectedTrackId = "";
  }

  #loadWaypoints() {
    try {
      const stored = JSON.parse(window.localStorage.getItem(WAYPOINT_STORAGE_KEY) ?? "[]");
      this.#catalog.setSavedWaypoints(Array.isArray(stored)
        ? stored.filter((waypoint) => Number.isFinite(waypoint?.latitude) && Number.isFinite(waypoint?.longitude)).slice(-24)
        : []);
    } catch {
      this.#catalog.setSavedWaypoints([]);
    }
  }

  #saveWaypoints() {
    try {
      window.localStorage.setItem(WAYPOINT_STORAGE_KEY, JSON.stringify(this.#catalog.savedWaypoints));
    } catch {
      // The prototype remains usable if storage is unavailable.
    }
  }

  #loadSavedRides() {
    try {
      const stored = JSON.parse(window.localStorage.getItem(SAVED_RIDE_STORAGE_KEY) ?? "[]");
      const reviewedStoredRides = Array.isArray(stored)
        ? stored.filter((ride) => typeof ride?.name === "string" && typeof ride?.trackId === "string")
        : [];
      const defaultTrackIds = new Set(SD_CARD_DEFAULT_RIDES.map((ride) => ride.trackId));
      this.#catalog.setSavedRides([
        ...SD_CARD_DEFAULT_RIDES.map((ride) => ({ ...ride })),
        ...reviewedStoredRides.filter((ride) => !defaultTrackIds.has(ride.trackId)),
      ].slice(0, 8));
    } catch {
      this.#catalog.setSavedRides(SD_CARD_DEFAULT_RIDES.map((ride) => ({ ...ride })));
    }
  }

  #saveSavedRides() {
    try {
      window.localStorage.setItem(SAVED_RIDE_STORAGE_KEY, JSON.stringify(this.#catalog.savedRides));
    } catch {
      // Saved-ride controls remain usable when storage is unavailable.
    }
  }

  #updateMenuMap() {
    if (!this.#menuState || this.#menuState.kind !== "waypoint-map" || !this.#ride.points.length) return;
    const projectionBounds = { left: 82, right: 422, top: 72, bottom: 222 };
    const projectionChanged = !this.#menuProjectedTrack.length || this.#menuProjectedTrackId !== this.#telemetry.trackId;
    if (projectionChanged) {
      this.#menuProjectedTrack = projectTrack(this.#ride.points, projectionBounds);
      this.#menuProjectedTrackId = this.#telemetry.trackId;
    }
    const recording = this.#ride.recordingSnapshot;
    if (projectionChanged || this.#menuProjectedRecordingRevision !== recording.revision) {
      this.#menuProjectedRecordedSegments = this.#ride.recordedSegments
        .filter((segment) => segment.length)
        .map((segment) => projectTrack(segment, projectionBounds, this.#ride.points));
      this.#menuProjectedRecordingRevision = recording.revision;
    }
    const projected = this.#menuProjectedTrack;
    this.#mount.querySelector("[data-menu-route]")?.setAttribute("d", pathFromPoints(projected));
    const current = this.#pointAtProgress(projected, this.#telemetry.progress);
    this.#mount.querySelector("[data-menu-recorded]")?.setAttribute("d", pathFromSegments(this.#menuProjectedRecordedSegments));
    this.#mount.querySelector("[data-menu-position]")?.setAttribute(
      "transform",
      `translate(${current.x.toFixed(2)} ${current.y.toFixed(2)}) rotate(${this.#telemetry.heading.toFixed(2)})`,
    );

    const authoredPositions = [0.08, 0.34, 0.62, 0.88].map((progress, index) => ({
      point: this.#pointAtProgress(projected, progress),
      label: String(index + 1),
      saved: false,
    }));
    const savedPositions = this.#catalog.savedWaypoints.map((waypoint) => ({
      point: projected[this.#nearestRidePointIndex(waypoint)] ?? current,
      label: waypoint.label,
      saved: true,
    }));
    const waypointLayer = this.#mount.querySelector("[data-menu-waypoints]");
    if (waypointLayer) {
      waypointLayer.innerHTML = [...authoredPositions, ...savedPositions].map(({ point, label, saved }) => `
        <g transform="translate(${point.x.toFixed(2)} ${point.y.toFixed(2)})">
          <circle class="voyager-menu__map-waypoint" r="${saved ? 13 : 11}" />
          <text class="voyager-live__text voyager-live__text--small" x="0" y="5" text-anchor="middle">${label}</text>
        </g>`).join("");
    }

    let pendingPoint = current;
    if (this.#menuState.pending === "coordinates") {
      pendingPoint = projected[this.#nearestRidePointIndex({ latitude: 45.768892, longitude: -122.519284 })] ?? current;
    } else if (this.#menuState.mode.includes("delete") && savedPositions.length) {
      pendingPoint = savedPositions.at(-1).point;
    }
    const pendingLayer = this.#mount.querySelector("[data-menu-pending-waypoint]");
    if (pendingLayer) {
      pendingLayer.innerHTML = `
        <g transform="translate(${pendingPoint.x.toFixed(2)} ${pendingPoint.y.toFixed(2)})">
          <circle class="voyager-menu__map-pending" r="16" />
          <text class="voyager-live__text" x="0" y="6" text-anchor="middle">${this.#menuState.mode.includes("delete") ? "−" : this.#catalog.savedWaypoints.length + 5}</text>
        </g>`;
    }
  }

  #nearestRidePointIndex(coordinate) {
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    this.#ride.points.forEach((point, index) => {
      const distance = haversineMeters(point, coordinate);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });
    return nearestIndex;
  }

  #updateMap() {
    if (!this.#ride.points.length) return;
    const { variant } = this.#screenState;
    const mapView = this.#mapViews[variant.mapView];
    const profile = this.#mapProfile();
    const screenNumber = variant.mapView === "detail" ? 2 : 1;
    const screenProfile = profile.screen(screenNumber);
    const resourceId = this.#telemetry.areaId ?? this.#telemetry.trackId;
    const resourceLabel = this.#catalog.resource(resourceId)?.label ?? this.#telemetry.trackLabel;
    const tracksVisible = profile.resourceVisible("track", [resourceLabel, this.#telemetry.trackLabel]);
    const routesVisible = profile.resourceVisible("route", [resourceLabel]);
    const waypointsVisible = profile.resourceVisible("waypoint");
    const projectionKey = [
      this.#telemetry.trackId,
      this.#overlayRideId ?? "none",
      this.#catalog.revision,
      profile.signature,
      screenNumber,
    ].join(":");
    const projectionBounds = {
      left: 4,
      right: 500,
      top: 4,
      bottom: 299,
    };
    const projectionChanged = !this.#projectedTrack.length || this.#projectedTrackId !== projectionKey;
    if (projectionChanged) {
      const overlayPoints = routesVisible ? this.#ride.pointsFor(this.#overlayRideId) : [];
      const networkSegments = routesVisible && this.#ride.mapSegments.length
        ? this.#ride.mapSegments
        : [this.#ride.points];
      const networkPoints = networkSegments.flat();
      const extentPoints = overlayPoints.length > 1 ? [...networkPoints, ...overlayPoints] : networkPoints;
      this.#projectedExtentPoints = extentPoints;
      this.#projectedTrack = projectTrack(this.#ride.points, projectionBounds, extentPoints);
      this.#projectedNetworkSegments = networkSegments.map((segment) => projectTrack(segment, projectionBounds, extentPoints));
      this.#projectedTrackId = projectionKey;
      this.#mount.querySelector("[data-live-routes]")?.setAttribute(
        "d",
        routesVisible && this.#ride.surroundingRoutes.length ? pathFromSegments(this.#projectedNetworkSegments) : "",
      );
      this.#mount.querySelector("[data-live-route]")?.setAttribute(
        "d",
        tracksVisible ? pathFromPoints(this.#projectedTrack) : "",
      );
      this.#mount.querySelector("[data-live-overlay-route]")?.setAttribute(
        "d", overlayPoints.length > 1
          ? pathFromPoints(projectTrack(overlayPoints, projectionBounds, extentPoints))
          : "",
      );
      const trackLabelLayer = this.#mount.querySelector("[data-live-track-labels]");
      if (trackLabelLayer) {
        const labelPoint = this.#pointAtProgress(this.#projectedTrack, 0.62);
        trackLabelLayer.innerHTML = labelPoint
          ? mapLabelMarkup(labelPoint, this.#telemetry.trackLabel, "track", screenProfile.labels.track.size)
          : "";
      }
      const routeLabelLayer = this.#mount.querySelector("[data-live-route-labels]");
      if (routeLabelLayer) {
        const longestSegment = this.#projectedNetworkSegments.reduce(
          (longest, segment) => segment.length > longest.length ? segment : longest,
          [],
        );
        const labelPoint = this.#pointAtProgress(longestSegment, 0.38);
        routeLabelLayer.innerHTML = labelPoint && this.#ride.surroundingRoutes.length
          ? mapLabelMarkup(labelPoint, resourceLabel, "route", screenProfile.labels.route.size)
          : "";
      }
      const waypointLayer = this.#mount.querySelector("[data-live-waypoints]");
      if (waypointLayer) {
        const destinationWaypoints = this.#destinationWaypoints();
        const projectedWaypoints = projectTrack(destinationWaypoints, projectionBounds, extentPoints);
        waypointLayer.innerHTML = waypointsVisible ? projectedWaypoints.map((point, index) => {
          const waypoint = destinationWaypoints[index];
          const icon = screenProfile.waypointIcons === "DOT"
            ? '<circle class="voyager-live__waypoint-dot" r="5" />'
            : `${voyagerUiIcon("circle-digit-black", { x: -22, y: -15, width: 44, height: 29, className: "voyager-live__waypoint" })}
              <text class="voyager-live__text voyager-live__text--inverse" x="0" y="6" text-anchor="middle">${escapeSvgText(waypoint.label)}</text>`;
          return `
            <g data-live-map-fixed data-live-map-marker data-map-x="${point.x.toFixed(2)}" data-map-y="${point.y.toFixed(2)}">
              ${icon}
              <text class="voyager-live__text voyager-live__map-label voyager-live__map-label--waypoint voyager-live__map-label--${screenProfile.labels.waypoint.size.toLowerCase()}" data-live-waypoint-label x="25" y="6">${escapeSvgText(waypoint.name)}</text>
            </g>`;
        }).join("") : "";
      }
    }
    const recording = this.#ride.recordingSnapshot;
    if (projectionChanged || this.#projectedRecordingRevision !== recording.revision) {
      this.#projectedRecordedSegments = this.#ride.recordedSegments
        .filter((segment) => segment.length)
        .map((segment) => projectTrack(segment, projectionBounds, this.#projectedExtentPoints));
      this.#projectedRecordingRevision = recording.revision;
    }
    const position = this.#pointAtProgress(this.#projectedTrack, this.#telemetry.progress);
    const mapRotation = profile.orientation === "TRACK UP" ? -this.#telemetry.heading : 0;
    if (!variant.editing && screenProfile.autoCenter) {
      const angle = radians(mapRotation);
      const deltaX = (position.x - 252) * mapView.scale;
      const deltaY = (position.y - 150) * mapView.scale;
      mapView.pan.x = -(deltaX * Math.cos(angle) - deltaY * Math.sin(angle));
      mapView.pan.y = -(deltaX * Math.sin(angle) + deltaY * Math.cos(angle));
    }
    this.#mount.querySelector("[data-live-recorded]")?.setAttribute(
      "d",
      tracksVisible ? pathFromSegments(this.#projectedRecordedSegments) : "",
    );
    this.#mount.querySelector("[data-live-position]")?.setAttribute(
      "transform",
      `translate(${position.x.toFixed(2)} ${position.y.toFixed(2)}) scale(${(profile.pointerScale / mapView.scale).toFixed(4)}) rotate(${this.#telemetry.heading.toFixed(2)})`,
    );
    for (const marker of this.#mount.querySelectorAll("[data-live-map-fixed]")) {
      marker.setAttribute(
        "transform",
        `translate(${marker.dataset.mapX} ${marker.dataset.mapY}) rotate(${(-mapRotation).toFixed(2)}) scale(${(1 / mapView.scale).toFixed(4)})`,
      );
    }
    const setLayerVisibility = (selector, visible) => {
      const element = this.#mount.querySelector(selector);
      if (element) element.style.display = visible ? "" : "none";
    };
    setLayerVisibility(
      "[data-live-track-labels]",
      tracksVisible && profile.labelsVisible(screenNumber, "track", mapView.scale),
    );
    setLayerVisibility(
      "[data-live-route-labels]",
      routesVisible && profile.labelsVisible(screenNumber, "route", mapView.scale),
    );
    const waypointLabelsVisible = waypointsVisible && profile.labelsVisible(screenNumber, "waypoint", mapView.scale);
    for (const label of this.#mount.querySelectorAll("[data-live-waypoint-label]")) {
      label.style.display = waypointLabelsVisible ? "" : "none";
    }
    this.#mount.querySelector("[data-live-map-transform]")?.setAttribute(
      "transform",
      `translate(${mapView.pan.x.toFixed(2)} ${mapView.pan.y.toFixed(2)}) translate(252 150) rotate(${mapRotation.toFixed(2)}) scale(${mapView.scale.toFixed(2)}) translate(-252 -150)`,
    );
    const northCenterX = variant.interaction ? 425 : 475;
    this.#mount.querySelector("[data-live-map-north]")?.setAttribute(
      "transform",
      `rotate(${mapRotation.toFixed(2)} ${northCenterX} 283)`,
    );
    setElementText(
      this.#mount.querySelector("[data-live-map-scale]"),
      mapScaleLabel(mapView.scale, createVoyagerDisplayProfile(this.#settings())),
    );
  }

  #updateGraph(screenState = this.#screenState) {
    const { screen, variant } = screenState;
    const left = variant.tabsVisible ? 87 : 23;
    const right = 483;
    const top = 44;
    const bottom = 284;
    const isTemperature = screen.graphMetric === "temperature";
    const display = createVoyagerDisplayProfile(this.#settings());
    const allValues = this.#ride.graphValues(screen.graphMetric);
    if (allValues.length < 2) return;

    const scale = variant.interaction === "graph" ? this.#graphScale : 1;
    const windowSize = 1 / scale;
    const windowStart = clamp(this.#telemetry.progress - windowSize / 2, 0, 1 - windowSize);
    const windowEnd = windowStart + windowSize;
    const values = graphSamplesInWindow(allValues, windowStart, windowEnd);
    const graphStats = this.#ride.graphStats(screen.graphMetric);
    const minimum = scale === 1 ? graphStats.minimum : Math.min(...values.map(({ value }) => value));
    const maximum = scale === 1 ? graphStats.maximum : Math.max(...values.map(({ value }) => value));
    const range = maximum - minimum || 1;
    const plottedValues = reduceGraphPoints(values, Math.ceil(right - left));
    const projected = plottedValues.map(({ progress, value }) => ({
      x: left + (progress - windowStart) / windowSize * (right - left),
      y: bottom - (value - minimum) / range * (bottom - top - 16),
    }));
    const linePath = pathFromPoints(projected);
    const fillPath = `${linePath} L${right} ${bottom} L${left} ${bottom} Z`;
    this.#mount.querySelector("[data-live-graph-line]")?.setAttribute("d", linePath);
    this.#mount.querySelector("[data-live-graph-fill]")?.setAttribute("d", fillPath);
    this.#mount.querySelector("[data-live-graph-fill-clip]")?.setAttribute("d", fillPath);

    const currentGraphValue = graphValueAtProgress(allValues, this.#telemetry.progress);
    const convertValue = isTemperature ? display.temperatureFromF : display.altitudeFromFeet;
    const currentValue = convertValue(currentGraphValue);
    const { maximum: allMaximum, average } = graphStats;
    const unit = isTemperature ? display.temperatureUnit : ` ${display.altitudeUnit}`;
    const prefix = isTemperature ? "ENG" : "ALT";
    setElementText(this.#mount.querySelector("[data-live-graph-current]"), `${prefix}:${currentValue}${unit}`);
    setElementText(this.#mount.querySelector("[data-live-graph-max]"), `MAX:${convertValue(allMaximum)}${unit}`);
    setElementText(this.#mount.querySelector("[data-live-graph-average]"), `AVG:${convertValue(average)}${unit}`);
    setElementText(
      this.#mount.querySelector("[data-live-graph-readout]"),
      `${isTemperature ? "ENGINE TEMP" : "ALTITUDE"}: ${currentValue}${unit}`,
    );

    const labelStep = isTemperature ? 5 : display.altitudeUnit === "M" ? 20 : 50;
    const scaleValues = [0.75, 0.5, 0.25, 0].map((amount) => {
      const value = minimum + range * amount;
      const converted = convertValue(value);
      return Math.round(converted / labelStep) * labelStep;
    });
    for (const labelElement of this.#mount.querySelectorAll("[data-live-graph-scale-label]")) {
      const index = Number(labelElement.dataset.liveGraphScaleLabel);
      setElementText(labelElement, `${scaleValues[index]}${isTemperature ? "" : ` ${display.altitudeUnit}`}`);
    }

    this.#graphCursorProjection = {
      allValues,
      bottom,
      left,
      minimum,
      range,
      right,
      top,
      windowSize,
      windowStart,
    };
    this.#updateGraphCrosshair();
  }

  #updateGraphCrosshair() {
    const projection = this.#graphCursorProjection;
    if (!projection || !this.#telemetry) return;
    const {
      bottom,
      allValues,
      left,
      minimum,
      range,
      right,
      top,
      windowSize,
      windowStart,
    } = projection;
    const currentValue = graphValueAtProgress(allValues, this.#telemetry.progress);
    const normalizedProgress = clamp((this.#telemetry.progress - windowStart) / windowSize, 0, 1);
    const cursor = {
      x: left + normalizedProgress * (right - left),
      y: bottom - (currentValue - minimum) / range * (bottom - top - 16),
    };
    for (const horizontal of this.#mount.querySelectorAll("[data-live-graph-crosshair-horizontal]")) {
      horizontal.setAttribute("x1", left);
      horizontal.setAttribute("x2", right);
      horizontal.setAttribute("y1", cursor.y);
      horizontal.setAttribute("y2", cursor.y);
    }
    for (const vertical of this.#mount.querySelectorAll("[data-live-graph-crosshair-vertical]")) {
      vertical.setAttribute("x1", cursor.x);
      vertical.setAttribute("x2", cursor.x);
      vertical.setAttribute("y1", top);
      vertical.setAttribute("y2", bottom);
    }
    for (const center of this.#mount.querySelectorAll("[data-live-graph-crosshair-center]")) {
      center.setAttribute("transform", `translate(${cursor.x.toFixed(2)} ${cursor.y.toFixed(2)})`);
    }
  }

  #pointAtProgress(points, progress) {
    const position = progress * (points.length - 1);
    const index = Math.min(points.length - 2, Math.floor(position));
    const amount = position - index;
    return {
      x: points[index].x + (points[index + 1].x - points[index].x) * amount,
      y: points[index].y + (points[index + 1].y - points[index].y) * amount,
    };
  }

  #headingLabel(heading) {
    const labels = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    return labels[Math.round(heading / 45) % labels.length];
  }
}

function setElementText(element, value) {
  if (!element) return;
  const nextValue = String(value);
  if (element.textContent !== nextValue) element.textContent = nextValue;
}

function setDatasetValue(element, key, value) {
  if (element.dataset[key] !== value) element.dataset[key] = value;
}
