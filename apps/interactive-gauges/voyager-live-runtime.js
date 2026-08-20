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
  voyagerMenuState,
} from "./voyager-menu-registry.js";
import { VoyagerMenuModel } from "./voyager-menu-model.js";
import { renderVoyagerMenuMarkup, voyagerMenuAriaLabel } from "./voyager-menu-renderer.js";
import { VOYAGER_COMPASS_VIEW_BOX, voyagerUiIcon } from "./voyager-ui-icons.js";

const DIRECTION_INPUTS = new Set(["up", "down", "left", "right"]);
const WAYPOINT_STORAGE_KEY = "bobs-app:voyager-waypoints:v1";
const SAVED_RIDE_STORAGE_KEY = "bobs-app:voyager-saved-rides:v1";
const VOYAGER_CONDUCTOR_SLOT_MS = 500;
const VOYAGER_POWER_SAVE_SLOT_MS = 1000;
const VOYAGER_SLEEP_CLOCK_MS = 1000;
const VOYAGER_DEFAULT_SLEEP_AFTER_MS = 10 * 60 * 1000;
const SD_CARD_DEFAULT_RIDES = Object.freeze([
  { id: "SD-CMRA-T2", name: "CMRA TRAIL 2", progress: 0, trackId: "cmra-trail-2" },
  { id: "SD-BLACKDOG", name: "2016 BLACKDOG", progress: 0, trackId: "blackdog-2016" },
  { id: "SD-FOREST", name: "DEMO FOREST", progress: 0, trackId: "forest-loop" },
  { id: "SD-MOUNTAIN", name: "DEMO MOUNTAIN", progress: 0, trackId: "mountain-run" },
]);
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const radians = (degrees) => (degrees * Math.PI) / 180;

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
  return points;
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

function buildTrack(definition, points) {
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

function formatClock(timestamp) {
  if (!Number.isFinite(timestamp)) return "12:30";
  const date = new Date(timestamp);
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
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

class VoyagerRideEngine {
  #tracks = new Map();
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

  async load(trackDefinitions) {
    const loaded = await Promise.all(
      trackDefinitions.map(async (definition) => {
        const response = await fetch(definition.url);
        if (!response.ok) throw new Error(`Voyager GPX request failed with ${response.status}.`);
        return buildTrack(definition, parseGpx(await response.text()));
      }),
    );
    for (const track of loaded) this.#tracks.set(track.id, track);
    this.#currentTrack = loaded[0];
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

  pointsFor(trackId) {
    return this.#tracks.get(trackId)?.points ?? [];
  }

  get trackIds() {
    return [...this.#tracks.keys()];
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

  alignStopwatchCadence() {
    if (this.#sleeping) return;
    this.#conductorPhase = 1;
    this.#rescheduleConductor();
  }

  selectRide(trackId, { reset = true } = {}) {
    const nextTrack = this.#tracks.get(trackId);
    if (!nextTrack) throw new Error(`Unknown Voyager GPX ride: ${trackId}`);
    this.#currentTrack = nextTrack;
    if (reset) this.#progress = 0;
    this.#emit({ kind: "full", mode: this.#mode });
  }

  play() {
    this.#playing = true;
  }

  pause() {
    this.#playing = false;
  }

  reset() {
    this.#progress = 0;
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
      this.#progress += (timestamp - this.#lastTimestamp) / this.#durationMs * this.#playbackSpeed;
      if (this.#progress >= 1) {
        this.#progress = this.#loop ? this.#progress % 1 : 1;
        if (!this.#loop) this.#playing = false;
      }
    }
    this.#lastTimestamp = timestamp;
    const phase = this.#conductorPhase;
    this.#conductorPhase = (this.#conductorPhase + 1) % 4;
    this.#emit({ kind: "phase", mode: this.#mode, phase });
    this.#scheduleConductor();
  };

  #emit(cadence = { kind: "full", mode: this.#mode }) {
    if (!this.#currentTrack) return;
    this.#telemetry = this.#sample(this.#progress);
    for (const listener of this.#listeners) listener(this.#telemetry, cadence);
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
    const completedMeters = track.distances[index] + haversineMeters(start, end) * amount;
    const elevationFeet = Math.round(interpolate("elevation") * 3.28084);
    const interpolatedTime = Number.isFinite(start.time + end.time)
      ? start.time + (end.time - start.time) * amount
      : Number.NaN;
    return {
      trackId: track.id,
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
      rpm: Number.isFinite(interpolateSensor("rpm")) ? Math.round(interpolateSensor("rpm")) : 0,
      timeLabel: formatClock(interpolatedTime),
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
      <g data-tab="${tab.id}">
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

function screenChromeMarkup(screen, variant) {
  return `${variant.tabsVisible ? tabsMarkup(screen.id) : ""}${variant.sideArrows ? sideArrowsMarkup(screen, variant) : ""}`;
}

function statusBarMarkup(variant) {
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
      ${voyagerUiIcon("throbber-24pt", {
        x: contentLeft + 38,
        y: 7,
        width: 23,
        height: 25,
        className: "voyager-live__status-throbber",
      })}
      ${voyagerUiIcon("battery-24pt-full", { x: contentLeft + 70, y: 10, width: 34, height: 19 })}
      ${voyagerUiIcon("signal-24pt-4bars", { x: contentLeft + 112, y: 10, width: 31, height: 19 })}
      <text class="voyager-live__text voyager-live__text--status" x="${contentLeft + 242}" y="34" text-anchor="middle" data-live-time>12:30</text>
      <text class="voyager-live__text voyager-live__text--status" x="493" y="34" text-anchor="end" data-live-temperature>75°F</text>
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

function mainMarkup(screen, variant) {
  const hiddenOffset = variant.tabsVisible ? 0 : -47;
  if (variant.view === "secondary") {
    const contentCenter = variant.tabsVisible ? 285 : 252;
    const maxCenter = variant.tabsVisible ? 173 : 126;
    const avgCenter = variant.tabsVisible ? 397 : 378;
    return `
      <rect class="voyager-live__surface" width="504" height="303" />
      ${screenChromeMarkup(screen, variant)}
      <g>
        <text class="voyager-live__text voyager-live__text--medium" x="${contentCenter}" y="30" text-anchor="middle">ODOMETER MI</text>
        <text class="voyager-live__text voyager-live__text--readout" x="${contentCenter}" y="88" text-anchor="middle" data-live-odometer-miles>523.7</text>
        <text class="voyager-live__text voyager-live__text--medium" x="${maxCenter}" y="127" text-anchor="middle">MAX SPD MPH</text>
        <text class="voyager-live__text voyager-live__text--readout" x="${maxCenter}" y="185" text-anchor="middle" data-live-max-speed>25</text>
        <path class="voyager-live__line voyager-live__line--secondary-main" d="M${contentCenter} 102V195" />
        <text class="voyager-live__text voyager-live__text--medium" x="${avgCenter}" y="127" text-anchor="middle">AVG SPD MPH</text>
        <text class="voyager-live__text voyager-live__text--readout" x="${avgCenter}" y="185" text-anchor="middle" data-live-avg-speed>12</text>
        <text class="voyager-live__text voyager-live__text--medium" x="${contentCenter}" y="225" text-anchor="middle">ACCUMULATED RUN TIME</text>
        <text class="voyager-live__text voyager-live__text--large voyager-live__text--clock" x="${contentCenter}" y="283" text-anchor="middle" data-live-elapsed>00:00:00</text>
      </g>`;
  }
  return `
    <rect class="voyager-live__surface" width="504" height="303" />
    ${screenChromeMarkup(screen, variant)}
    ${statusBarMarkup(variant)}
    <g transform="translate(${hiddenOffset} 0)">
      <text class="voyager-live__text voyager-live__text--medium" x="198" y="67" text-anchor="middle">MPH</text>
      <text class="voyager-live__text voyager-live__text--speed" x="199" y="188" text-anchor="middle" data-live-speed>28</text>
      ${compassMarkup({ cx: 399, cy: 133, radius: 73 })}
      <text class="voyager-live__text" x="100" y="236">ALT FT</text>
      <text class="voyager-live__text voyager-live__text--metric" x="91" y="286" data-live-altitude>1089</text>
      <text class="voyager-live__text" x="261" y="236">DST MI</text>
      <text class="voyager-live__text voyager-live__text--metric" x="254" y="286" data-live-distance>12.0</text>
      ${temperatureIcon(408, 213, 0.84)}
      <text class="voyager-live__text" x="449" y="236">°F</text>
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

function mapMarkup(screen, variant) {
  const mapLeft = variant.tabsVisible ? 83 : 28;
  const mapRight = variant.interaction ? 446 : 486;
  const status = variant.interaction ? "" : statusBarMarkup(variant);
  return `
    <rect class="voyager-live__surface" width="504" height="303" />
    ${screenChromeMarkup(screen, variant)}
    ${status}
    <clipPath id="voyager-live-map-clip"><rect x="${mapLeft}" y="40" width="${mapRight - mapLeft}" height="207" /></clipPath>
    <g clip-path="url(#voyager-live-map-clip)">
      <g data-live-map-transform>
        <path class="voyager-live__route voyager-live__route--overlay" data-live-overlay-route />
        <path class="voyager-live__recorded" data-live-recorded />
        <path class="voyager-live__route" data-live-route />
        <g data-live-waypoints></g>
        <path class="voyager-live__position" data-live-position d="M0-12 9 10 0 5-9 10Z" />
      </g>
    </g>
    ${controlHintMarkup(variant.interaction)}
    <path class="voyager-live__scale-line" d="M${variant.tabsVisible ? 80 : 20} 279v13h142v-13" />
    <text class="voyager-live__text voyager-live__text--medium" x="${variant.tabsVisible ? 126 : 66}" y="286">2 mi</text>
    <text class="voyager-live__text voyager-live__text--medium" x="${variant.interaction ? 405 : 455}" y="289">N</text>
    ${voyagerUiIcon("compass-indicator-24pt", { x: variant.interaction ? 427 : 477, y: 274, width: 14, height: 19 })}`;
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

function graphMarkup(screen, variant) {
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
      <text class="voyager-live__text voyager-live__text--medium" x="${left}" y="34" data-live-graph-current>${isTemperature ? "ENG:168°F" : "ALT:700 FT"}</text>
      <text class="voyager-live__text voyager-live__text--medium" x="${left + (right - left) * 0.5}" y="34" text-anchor="middle" data-live-graph-max>MAX:243°F</text>
      <text class="voyager-live__text voyager-live__text--medium" x="${right}" y="34" text-anchor="end" data-live-graph-average>AVG:172°F</text>
    ` : `
      <text class="voyager-live__text voyager-live__text--medium" x="23" y="34" data-live-graph-readout>${isTemperature ? "ENGINE TEMP: 168°F" : "ALTITUDE: 700 FT"}</text>
    `}
    <clipPath id="voyager-live-graph-clip"><rect x="${left}" y="${top}" width="${right - left}" height="${bottom - top}" /></clipPath>
    ${primary ? "" : `<clipPath id="voyager-live-graph-fill-clip"><path data-live-graph-fill-clip /></clipPath>`}
    <g clip-path="url(#voyager-live-graph-clip)">
      <path class="voyager-live__graph-fill" data-live-graph-fill />
      <path class="voyager-live__graph-line" data-live-graph-line />
      ${graphGridMarkup(left, right, top, bottom)}
      <text class="voyager-live__text voyager-live__text--medium voyager-live__graph-track-label" x="${(left + right) / 2}" y="279" text-anchor="middle" data-live-ride-label>FOREST LOOP</text>
      ${primary ? "" : `
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
      `}
    </g>`;
}

function metricBlock(x, y, label, attribute, fallback) {
  return `
    <text class="voyager-live__text voyager-live__text--medium" x="${x}" y="${y}" text-anchor="middle">${label}</text>
    <text class="voyager-live__text voyager-live__text--readout" x="${x}" y="${y + 58}" text-anchor="middle" ${attribute}>${fallback}</text>`;
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

function userMetricDefinition(selection) {
  const normalized = selection.replace(/[\uE10B\uE10C]/g, "").trim();
  const variantSuffix = selection.includes("\uE10C") ? " 1" : selection.includes("\uE10B") ? " 2" : "";
  const definitions = {
    ALTITUDE: ["ALT FT", "data-live-altitude", "1089"],
    "MIN ALTITUDE": ["MIN ALT FT", "", "914"],
    "MAX ALTITUDE": ["MAX ALT FT", "", "1234"],
    "WHEEL SPEED": ["WHEEL SPD MPH", "data-live-speed", "25"],
    "GPS SPEED": ["GPS SPD MPH", "data-live-gps-speed", "22"],
    "WHEEL ODOMETER": ["ODOMETER MI", "data-live-odometer-miles", "523.7"],
    "GPS ODOMETER": ["GPS ODO MI", "data-live-odometer", "1200"],
    "ENGINE ACC. RUN TIME": ["ACCUMULATED RUN TIME", "data-live-elapsed", "00:00:00"],
    "GPS ACC. RUN TIME": ["GPS RUN TIME", "data-live-elapsed", "00:00:00"],
    "AIR TEMPERATURE": ["AIR TEMP °F", "data-live-temperature", "75°F"],
    "ENGINE TEMPERATURE": ["ENGINE TEMP °F", "data-live-engine-temperature", "168"],
    "MAX ENGINE TEMPERATURE": ["MAX ENGINE TEMP °F", "", "179"],
    "AVG ENGINE TEMPERATURE": ["AVG ENGINE TEMP °F", "", "169"],
    CLOCK: ["CLOCK", "data-live-time", "12:35"],
    "STOP WATCH": ["STOP WATCH", "data-live-stopwatch", "00:00:00"],
    HEADING: ["HEADING", "data-live-heading-label", "NNE"],
    "COMPASS DIRECTION": ["COMPASS DIRECTION", "data-live-heading-label", "NNE"],
    "INPUT VOLTAGE": ["INPUT VOLTAGE", "", "13.8"],
    "INTERNAL BATTERY VOLTAGE": ["BATTERY VOLTAGE", "", "4.1"],
    TACHOMETER: ["TACHOMETER RPM", "", "3250"],
    "WHEEL DISTANCE": [`WHEEL DST${variantSuffix} MI`, "data-live-trip-distance", "0.0"],
    "GPS DISTANCE": [`GPS DST${variantSuffix} MI`, "data-live-distance", "0.0"],
    "ENGINE TRIP TIME": [`ENGINE TRIP TIME${variantSuffix}`, "data-live-elapsed", "00:00:00"],
    "GPS TRIP TIME": [`GPS TRIP TIME${variantSuffix}`, "data-live-elapsed", "00:00:00"],
    "MAX WHEEL SPEED": [`MAX WHEEL SPD${variantSuffix} MPH`, "data-live-max-speed", "25"],
    "MAX GPS SPEED": [`MAX GPS SPD${variantSuffix} MPH`, "data-live-max-speed", "25"],
    "AVG WHEEL SPEED": [`AVG WHEEL SPD${variantSuffix} MPH`, "data-live-avg-speed", "12"],
    "AVG GPS SPEED": [`AVG GPS SPD${variantSuffix} MPH`, "data-live-avg-speed", "12"],
    "CURRENT (BATTERY CHARGER)": ["CHARGER CURRENT", "", "0.8"],
  };
  const [label, attribute, fallback] = definitions[normalized] ?? [normalized, "", "--"];
  return { label, attribute, fallback };
}

function userMetricBlock(x, y, selection) {
  const metric = userMetricDefinition(selection);
  return `
    <text class="voyager-live__text voyager-live__text--medium voyager-live__user-metric-label" x="${x}" y="${y}" text-anchor="middle">${metric.label}</text>
    <text class="voyager-live__text voyager-live__text--readout" x="${x}" y="${y + 58}" text-anchor="middle" ${metric.attribute}>${metric.fallback}</text>`;
}

function userMarkup(screen, variant, menuValues = {}) {
  const screenNumber = variant.view === "secondary" ? 2 : 1;
  const selections = Array.from({ length: 6 }, (_, index) => (
    menuValues[`userScreen${screenNumber}Block${index + 1}`]
      ?? DEFAULT_USER_SCREEN_BLOCKS[screenNumber][index]
  )).filter((selection) => selection !== "<OFF>");
  const contentLeft = variant.tabsVisible ? 70 : 0;
  const contentWidth = 504 - contentLeft;
  const leftCenter = contentLeft + contentWidth * 0.25;
  const rightCenter = contentLeft + contentWidth * 0.75;
  const center = contentLeft + contentWidth * 0.5;
  const rowCount = Math.max(1, Math.ceil(selections.length / 2));
  const rowLabels = rowCount === 1 ? [123] : rowCount === 2 ? [82, 190] : [62, 148, 234];
  const blocks = selections.map((selection, index) => {
    const row = Math.floor(index / 2);
    const alone = index === selections.length - 1 && selections.length % 2 === 1;
    const x = alone ? center : index % 2 === 0 ? leftCenter : rightCenter;
    return userMetricBlock(x, rowLabels[row], selection);
  }).join("");
  return `
    <rect class="voyager-live__surface" width="504" height="303" />
    ${screenChromeMarkup(screen, variant)}
    ${userTitleMarkup(`USER SCREEN ${screenNumber}`, variant.tabsVisible)}
    ${blocks || `<text class="voyager-live__text voyager-live__text--medium" x="${center}" y="170" text-anchor="middle">NO DATA BLOCKS</text>`}`;
}

function navigationMarkup(screen, variant) {
  const hiddenOffset = variant.tabsVisible ? 0 : -34;
  return `
    <rect class="voyager-live__surface" width="504" height="303" />
    ${screenChromeMarkup(screen, variant)}
    <g transform="translate(${hiddenOffset} 0)">
      <text class="voyager-live__text voyager-live__text--medium" x="467.5" y="47" text-anchor="start" data-live-heading-label>N</text>
      ${metricBlock(186, 30, "SPD MPH", "data-live-speed", "21")}
      ${metricBlock(186, 127, "DEST DST MI", "data-live-destination", "700")}
      ${compassMarkup({ cx: 388.75, cy: 102, radius: 87.4, pointerAttribute: "data-live-nav-pointer" })}
      <text class="voyager-live__text voyager-live__text--medium" x="248" y="225" text-anchor="middle">STOP WATCH</text>
      <text class="voyager-live__text voyager-live__text--large voyager-live__text--clock" x="248" y="283" text-anchor="middle" data-live-stopwatch>00:00:00</text>
    </g>
    ${voyagerUiIcon("pauseplay-pill", { x: 442, y: 230, width: 62, height: 42, attributes: 'data-live-stopwatch-control=""' })}`;
}

function satelliteMarkup(screen, variant) {
  if (variant.view === "secondary") {
    return `
      <rect class="voyager-live__surface" width="504" height="303" />
      ${screenChromeMarkup(screen, variant)}
      <g class="voyager-live__satellite-details">
        <text class="voyager-live__text voyager-live__text--satellite-detail" x="252" y="48" text-anchor="middle">LAT: <tspan class="voyager-live__text--satellite-coordinate">N 45.774051°</tspan></text>
        <text class="voyager-live__text voyager-live__text--satellite-detail" x="252" y="88" text-anchor="middle">LON: <tspan class="voyager-live__text--satellite-coordinate">W 122.527241°</tspan></text>
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
  return renderers[screen.renderer](screen, variant, menuValues);
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

function coordinateLabel(value, positive, negative) {
  return `${value >= 0 ? positive : negative}${Math.abs(value).toFixed(6)}`;
}

export class VoyagerLiveRuntime {
  #mount;
  #stage;
  #appBase;
  #ride = new VoyagerRideEngine();
  #state = null;
  #screenState = null;
  #menuState = null;
  #menuUnderlayScreenState = null;
  #menuReturnStateId = null;
  #menuModel = new VoyagerMenuModel();
  #layoutKey = "";
  #telemetry = null;
  #projectedTrack = [];
  #projectedTrackId = "";
  #menuProjectedTrack = [];
  #menuProjectedTrackId = "";
  #mapViews = {
    overview: { pan: { x: 0, y: 0 }, scale: 1, mode: "pan", followPosition: false },
    detail: { pan: { x: 0, y: 0 }, scale: 2.1, mode: "pan", followPosition: true },
  };
  #graphScale = 1;
  #pulseTimer = 0;
  #stopwatchElapsedMs = 0;
  #stopwatchStartedAt = 0;
  #stopwatchRunning = false;
  #available = false;
  #waypoints = [];
  #savedRides = [];
  #selectedSavedRideIndex = 0;
  #overlayRideId = null;
  #selectedDestination = null;

  constructor({ mount, stage, appBase }) {
    this.#mount = mount;
    this.#stage = stage;
    this.#appBase = appBase;
  }

  async initialize() {
    const fontReady = document.fonts?.load
      ? document.fonts.load('16px "Bobs Font 6 Pixel"', "VOYAGER RIDE").catch(() => [])
      : Promise.resolve();
    await Promise.all([
      fontReady,
      this.#ride.load([
        { id: "forest-loop", label: "FOREST LOOP", url: `${this.#appBase}/assets/rides/forest-loop.gpx` },
        { id: "mountain-run", label: "MOUNTAIN RUN", url: `${this.#appBase}/assets/rides/mountain-run.gpx` },
        { id: "cmra-trail-2", label: "CMRA TRAIL 2", url: `${this.#appBase}/assets/rides/cmra-trail-2.gpx` },
        { id: "blackdog-2016", label: "2016 BLACKDOG", url: `${this.#appBase}/assets/rides/blackdog-2016.gpx` },
      ]),
    ]);
    this.#loadWaypoints();
    this.#loadSavedRides();
    this.#menuModel.load();
    this.#available = true;
    this.#ride.subscribe((telemetry, cadence) => {
      if (this.#telemetry?.trackId !== telemetry.trackId) {
        this.#projectedTrack = [];
        this.#projectedTrackId = "";
      }
      this.#telemetry = telemetry;
      this.#stage.dataset.liveRide = telemetry.trackId;
      this.#stage.dataset.powerMode = cadence.mode;
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
    });
  }

  recordActivity() {
    this.#ride.recordActivity();
  }

  supports(stateId) {
    return this.#available && (VOYAGER_LIVE_STATE_IDS.has(stateId) || VOYAGER_MENU_STATE_IDS.has(stateId));
  }

  getInputPolicyStateId(stateId) {
    return this.supports(stateId) ? VOYAGER_INPUT_POLICY_ALIASES[stateId] ?? stateId : stateId;
  }

  resolveStateId(screenId) {
    return VOYAGER_STABLE_STATE_ALIASES[screenId] ?? VOYAGER_MENU_STABLE_STATE_ALIASES[screenId] ?? screenId;
  }

  getStableStateId(stateId) {
    return VOYAGER_CANONICAL_STATE_IDS[stateId] ?? VOYAGER_MENU_CANONICAL_STATE_IDS[stateId] ?? stateId;
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
    const definition = voyagerMenuState(stateId);
    const prepared = this.#menuModel.prepareInput(definition, action);
    const rootMenu = stateId === "m-main1-1" || stateId === "m-ride2-1" || stateId === "m-set3-1";
    if (rootMenu && this.#menuReturnStateId && (action === "back" || action === "menu")) {
      const targetStateId = this.#menuReturnStateId;
      this.#menuReturnStateId = null;
      return { ...prepared, targetStateId };
    }
    return prepared;
  }

  resolveInputAction(stateId, action) {
    return this.#menuModel.resolveInputAction(voyagerMenuState(stateId), action);
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
      const savedRideKey = this.#savedRides.slice(0, 4).map((ride) => `${ride.id}:${ride.name}`).join("|");
      const layoutKey = `menu:${state.id}:${this.#waypoints.length}:${this.#menuModel.revision}:${savedRideKey}:${this.#selectedSavedRideIndex}`;
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
      return;
    }

    const { screen, variant } = this.#screenState;
    const mapView = screen.renderer === "map" ? this.#mapViews[variant.mapView] : null;
    const renderedVariant = mapView && variant.editing
      ? { ...variant, interaction: mapView.mode }
      : variant;
    const userLayoutRevision = screen.renderer === "user" ? this.#menuModel.revision : "static";
    const layoutKey = `${screen.id}:${variant.view}:${variant.mapView ?? "default"}:${variant.tabsVisible}:${renderedVariant.interaction ?? "browse"}:${userLayoutRevision}`;
    if (layoutKey !== this.#layoutKey) {
      this.#mount.innerHTML = `
        <svg class="voyager-live" viewBox="0 0 504 303" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Live Voyager ${screen.tabLabel.toLowerCase()} ${variant.view} screen">
          ${renderScreenMarkup(screen, renderedVariant, this.#menuModel.values)}
        </svg>`;
      this.#layoutKey = layoutKey;
      this.#projectedTrack = [];
    }
    this.#mount.querySelector("svg")?.setAttribute("data-voyager-screen-id", state.id);
    this.#updateDynamicFields();
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
    let resolved = this.#menuModel.resolve(definition);
    if (resolved.graphDisplay) {
      const trackSlot = resolved.trackSlot === 2 ? " (TRACK_2)" : "";
      resolved = {
        ...resolved,
        summary: `DISPLAYING: ${this.#telemetry?.trackLabel ?? "CURRENT TRACK"}${trackSlot}`,
      };
    }
    if (/^m-ride2-6-4-[1-4]$/.test(resolved.id)) {
      const cardRows = this.#savedRides.slice(0, 4).map((ride) => ({ label: ride.name }));
      while (cardRows.length < 4) cardRows.push({ label: "EMPTY SLOT" });
      resolved = { ...resolved, rows: cardRows };
    }
    if (/^m-ride2-6-4-1-[1-4](?:-1)?$/.test(resolved.id)) {
      resolved = {
        ...resolved,
        title: this.#savedRides[this.#selectedSavedRideIndex]?.name ?? "EMPTY SLOT",
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
        underlayMarkup = renderScreenMarkup(screenParent.screen, screenParent.variant, this.#menuModel.values);
      }
    }
    return renderVoyagerMenuMarkup(resolved, { underlayMarkup });
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
        mapView.scale = clamp(mapView.scale + direction, 0.72, 4.5);
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
    if (!this.#telemetry || !this.#state || this.#mount.hidden) return;
    const setText = (selector, value) => {
      for (const element of this.#mount.querySelectorAll(selector)) element.textContent = value;
    };
    const telemetry = this.#telemetry;
    const refreshAll = cadence === "all";
    const refreshMotion = refreshAll || cadence === 0;
    const refreshCompass = refreshAll || cadence === 1 || cadence === 3;
    const refreshStatus = refreshAll || cadence === 2;
    const refreshStopwatch = refreshAll || cadence === 0 || cadence === 2;
    const menuValues = this.#menuModel.values;
    const brightnessValue = this.#menuState?.kind === "brightness"
      ? this.#menuModel.resolve(this.#menuState).value
      : menuValues.brightness;
    const metricSpeed = menuValues.speedUnits === "KM/H";
    const metricDistance = menuValues.distanceUnits === "KILOMETERS / METERS";
    const fahrenheit = menuValues.temperatureUnits === "FAHRENHEIT";
    const sourceSpeedMph = menuValues.speedSource === "GPS"
      ? Math.max(0, telemetry.speedMph - 2)
      : telemetry.speedMph;
    const displaySpeed = metricSpeed ? Math.round(sourceSpeedMph * 1.60934) : sourceSpeedMph;
    const gpsSpeed = metricSpeed
      ? Math.round(Math.max(0, telemetry.speedMph - 2) * 1.60934)
      : Math.max(0, telemetry.speedMph - 2);
    const ambientTemperature = fahrenheit
      ? `${telemetry.ambientTemperatureF}°F`
      : `${Math.round((telemetry.ambientTemperatureF - 32) * 5 / 9)}°C`;
    const destinationMeters = this.#selectedDestination
      ? haversineMeters(telemetry, this.#selectedDestination)
      : telemetry.destinationMeters;
    if (refreshMotion) {
      setText("[data-live-speed]", String(displaySpeed));
      setText("[data-live-gps-speed]", String(gpsSpeed));
      setText("[data-live-altitude]", String(telemetry.elevationFeet));
      setText("[data-live-distance]", metricDistance ? telemetry.distanceKm.toFixed(1) : (telemetry.distanceKm * 0.621371).toFixed(1));
      setText("[data-live-trip-distance]", String(Math.round((metricDistance ? telemetry.distanceKm : telemetry.distanceKm * 0.621371) * 10)));
      setText("[data-live-destination]", String(Math.round(metricDistance ? destinationMeters : destinationMeters * 3.28084)));
      setText("[data-live-elapsed]", telemetry.elapsedLabel);
      setText("[data-live-ride-label]", telemetry.trackLabel);
    }
    if (refreshStatus) {
      setText("[data-live-odometer]", String(Math.round(1200 + telemetry.distanceKm)));
      setText("[data-live-temperature]", ambientTemperature);
      setText("[data-live-engine-temperature]", String(fahrenheit ? telemetry.engineTemperatureF : Math.round((telemetry.engineTemperatureF - 32) * 5 / 9)));
      setText("[data-live-time]", telemetry.timeLabel);
      setText("[data-live-max-kph]", String(Math.round(telemetry.maxSpeedMph * 1.60934)));
      setText("[data-live-avg-kph]", String(Math.round(telemetry.averageSpeedMph * 1.60934)));
      setText("[data-live-odometer-miles]", (523.7 + telemetry.distanceKm * 0.621371).toFixed(1));
      setText("[data-live-max-speed]", String(telemetry.maxSpeedMph));
      setText("[data-live-avg-speed]", String(telemetry.averageSpeedMph));
      setText("[data-live-latitude]", coordinateLabel(telemetry.latitude, "N", "S"));
      setText("[data-live-longitude]", coordinateLabel(telemetry.longitude, "E", "W"));
      const powerSave = menuValues.gpsMode === "DISABLED (POWER SAVE)";
      const sleepMinutes = Number.parseInt(menuValues.sleepModeTimer, 10);
      this.#ride.setPowerSave(powerSave);
      this.#ride.setSleepAfterMs(sleepMinutes * 60 * 1000);
      const loggingEnabled = menuValues.gpsMode === "ENABLED (LOGGING ON)";
      this.#mount.dataset.logging = this.#ride.playing && loggingEnabled ? "recording" : "paused";
      this.#mount.dataset.gps = powerSave ? "disabled" : "enabled";
      this.#mount.dataset.stopwatch = this.#stopwatchRunning ? "running" : "paused";
      this.#mount.dataset.mapOrientation = menuValues.mapOrientation === "NORTH UP" ? "north-up" : "track-up";
      this.#mount.style.setProperty("--voyager-screen-brightness", String(clamp(Number(brightnessValue) / 50, 0.35, 2)));
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
    if (refreshMotion && this.#screenState.screen.renderer === "graph") this.#updateGraph();
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
    if (event.action !== "enter") return;
    const telemetry = this.#telemetry;
    const savedRideSelection = event.from.match(/^m-ride2-6-4-([1-4])$/);
    if (savedRideSelection) this.#selectedSavedRideIndex = Number(savedRideSelection[1]) - 1;
    if (event.from === "m-main1-4" && telemetry) {
      this.#addWaypoint("QUICK ADD", telemetry.latitude, telemetry.longitude);
    }
    if (event.from === "m-main1-5-1-1") {
      this.#selectedDestination = this.#waypoints.at(-1) ?? this.#ride.points.at(-1) ?? null;
    }
    if (event.from === "m-nav-destination-primary" || event.from === "m-nav-destination-secondary") {
      const waypointNumber = Number.parseInt(this.#menuModel.values.destinationWaypoint.match(/\d+/)?.[0] ?? "1", 10);
      const progress = [0.08, 0.34, 0.62, 0.88][clamp(waypointNumber - 1, 0, 3)];
      const pointIndex = Math.round(progress * Math.max(0, this.#ride.points.length - 1));
      this.#selectedDestination = this.#ride.points[pointIndex] ?? null;
    }
    if (event.from === "m-ride2-2-1" && telemetry) {
      this.#addWaypoint("CURRENT POSITION", telemetry.latitude, telemetry.longitude);
    }
    if (event.from === "m-ride2-3-1-1-1") {
      this.#addWaypoint("LAT/LON", 45.768892, -122.519284);
    }
    if (event.from === "m-ride2-4-1-1" && telemetry) {
      this.#addWaypoint("CROSSHAIRS", telemetry.latitude + 0.0012, telemetry.longitude + 0.0017);
    }
    if (event.from === "m-ride2-5-1-1" && this.#waypoints.length) {
      this.#waypoints.pop();
      this.#saveWaypoints();
      this.#invalidateMapProjection();
    }
    if (event.from === "m-ride2-6-1-1") {
      this.#ride.reset();
      this.#overlayRideId = null;
      this.#selectedDestination = null;
    }
    if (event.from === "m-ride2-6-2-1-1" && telemetry) this.#saveCurrentRide(telemetry);
    if (event.from === "m-ride2-6-3-1") {
      this.#overlayRideId = null;
      this.#invalidateMapProjection();
    }
    if (event.from === "m-ride2-6-4-1-1-1") this.#loadSavedRide();
    if (event.from === "m-ride2-6-4-1-2-1") {
      this.#overlayRideId = this.#savedRides[this.#selectedSavedRideIndex]?.trackId ?? null;
      this.#invalidateMapProjection();
    }
    if (event.from === "m-ride2-6-4-1-4-1") this.#deleteSavedRide();
    if (event.from === "m-main1-2-1") {
      this.#stopwatchElapsedMs = 0;
      this.#stopwatchStartedAt = this.#stopwatchRunning ? performance.now() : 0;
    }
    if (event.from === "m-main1-3-1") this.#ride.reset();
  }

  #saveCurrentRide(telemetry) {
    const name = this.#menuModel.values.rideName || `RIDE-${this.#savedRides.length + 32}`;
    this.#savedRides = [{
      id: `RIDE-${Date.now().toString(36).toUpperCase()}`,
      name,
      progress: telemetry.progress,
      trackId: telemetry.trackId,
    }, ...this.#savedRides.filter((ride) => ride.name !== name)].slice(0, 8);
    this.#saveSavedRides();
  }

  #loadSavedRide() {
    const ride = this.#savedRides[this.#selectedSavedRideIndex];
    if (!ride || !this.#ride.trackIds.includes(ride.trackId)) return;
    this.#ride.selectRide(ride.trackId);
    this.#ride.seek(ride.progress);
    this.#ride.play();
    this.#overlayRideId = null;
    this.#mapViews.overview = { pan: { x: 0, y: 0 }, scale: 1, mode: "pan", followPosition: false };
    this.#mapViews.detail = { pan: { x: 0, y: 0 }, scale: 2.1, mode: "pan", followPosition: true };
    this.#invalidateMapProjection();
  }

  #deleteSavedRide() {
    if (!this.#savedRides[this.#selectedSavedRideIndex]) return;
    const [removed] = this.#savedRides.splice(this.#selectedSavedRideIndex, 1);
    this.#selectedSavedRideIndex = clamp(this.#selectedSavedRideIndex, 0, Math.max(0, this.#savedRides.length - 1));
    if (this.#overlayRideId === removed.trackId) this.#overlayRideId = null;
    this.#saveSavedRides();
    this.#invalidateMapProjection();
  }

  #addWaypoint(source, latitude, longitude) {
    this.#waypoints.push({
      id: `WP-${Date.now().toString(36).toUpperCase()}`,
      label: String(this.#waypoints.length + 5),
      source,
      latitude,
      longitude,
    });
    this.#saveWaypoints();
    this.#invalidateMapProjection();
  }

  #invalidateMapProjection() {
    this.#projectedTrack = [];
    this.#projectedTrackId = "";
    this.#menuProjectedTrack = [];
    this.#menuProjectedTrackId = "";
  }

  #loadWaypoints() {
    try {
      const stored = JSON.parse(window.localStorage.getItem(WAYPOINT_STORAGE_KEY) ?? "[]");
      this.#waypoints = Array.isArray(stored)
        ? stored.filter((waypoint) => Number.isFinite(waypoint?.latitude) && Number.isFinite(waypoint?.longitude)).slice(-24)
        : [];
    } catch {
      this.#waypoints = [];
    }
  }

  #saveWaypoints() {
    try {
      window.localStorage.setItem(WAYPOINT_STORAGE_KEY, JSON.stringify(this.#waypoints));
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
      this.#savedRides = [
        ...SD_CARD_DEFAULT_RIDES.map((ride) => ({ ...ride })),
        ...reviewedStoredRides.filter((ride) => !defaultTrackIds.has(ride.trackId)),
      ].slice(0, 8);
    } catch {
      this.#savedRides = SD_CARD_DEFAULT_RIDES.map((ride) => ({ ...ride }));
    }
  }

  #saveSavedRides() {
    try {
      window.localStorage.setItem(SAVED_RIDE_STORAGE_KEY, JSON.stringify(this.#savedRides));
    } catch {
      // Saved-ride controls remain usable when storage is unavailable.
    }
  }

  #updateMenuMap() {
    if (!this.#menuState || this.#menuState.kind !== "waypoint-map" || !this.#ride.points.length) return;
    if (!this.#menuProjectedTrack.length || this.#menuProjectedTrackId !== this.#telemetry.trackId) {
      this.#menuProjectedTrack = projectTrack(this.#ride.points, { left: 82, right: 422, top: 72, bottom: 222 });
      this.#menuProjectedTrackId = this.#telemetry.trackId;
    }
    const projected = this.#menuProjectedTrack;
    this.#mount.querySelector("[data-menu-route]")?.setAttribute("d", pathFromPoints(projected));
    const current = this.#pointAtProgress(projected, this.#telemetry.progress);
    const currentIndex = Math.min(projected.length - 2, Math.floor(this.#telemetry.progress * (projected.length - 1)));
    this.#mount.querySelector("[data-menu-recorded]")?.setAttribute("d", pathFromPoints([...projected.slice(0, currentIndex + 1), current]));
    this.#mount.querySelector("[data-menu-position]")?.setAttribute(
      "transform",
      `translate(${current.x.toFixed(2)} ${current.y.toFixed(2)}) rotate(${this.#telemetry.heading.toFixed(2)})`,
    );

    const authoredPositions = [0.08, 0.34, 0.62, 0.88].map((progress, index) => ({
      point: this.#pointAtProgress(projected, progress),
      label: String(index + 1),
      saved: false,
    }));
    const savedPositions = this.#waypoints.map((waypoint) => ({
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
          <text class="voyager-live__text" x="0" y="6" text-anchor="middle">${this.#menuState.mode.includes("delete") ? "−" : this.#waypoints.length + 5}</text>
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
    if (!this.#projectedTrack.length || this.#projectedTrackId !== this.#telemetry.trackId) {
      const overlayPoints = this.#ride.pointsFor(this.#overlayRideId);
      const extentPoints = overlayPoints.length > 1
        ? [...this.#ride.points, ...overlayPoints]
        : this.#ride.points;
      const projectionBounds = {
        left: variant.tabsVisible ? 104 : 62,
        right: variant.interaction ? 415 : 462,
        top: 62,
        bottom: 234,
      };
      this.#projectedTrack = projectTrack(this.#ride.points, projectionBounds, extentPoints);
      this.#projectedTrackId = this.#telemetry.trackId;
      this.#mount.querySelector("[data-live-route]")?.setAttribute("d", pathFromPoints(this.#projectedTrack));
      this.#mount.querySelector("[data-live-overlay-route]")?.setAttribute(
        "d", overlayPoints.length > 1
          ? pathFromPoints(projectTrack(overlayPoints, projectionBounds, extentPoints))
          : "",
      );
      const waypointLayer = this.#mount.querySelector("[data-live-waypoints]");
      if (waypointLayer) {
        const authoredWaypoints = [0.08, 0.34, 0.62, 0.88].map((position, index) => {
          const point = this.#projectedTrack[Math.round(position * (this.#projectedTrack.length - 1))];
          return { point, label: String(index + 1), saved: false };
        });
        const savedWaypoints = this.#waypoints.map((waypoint) => ({
          point: this.#projectedTrack[this.#nearestRidePointIndex(waypoint)],
          label: waypoint.label,
          saved: true,
        }));
        waypointLayer.innerHTML = [...authoredWaypoints, ...savedWaypoints].map(({ point, label }) => `
            <g transform="translate(${point.x.toFixed(2)} ${point.y.toFixed(2)})">
              ${voyagerUiIcon("circle-digit-black", { x: -22, y: -15, width: 44, height: 29, className: "voyager-live__waypoint" })}
              <text class="voyager-live__text voyager-live__text--inverse" x="0" y="6" text-anchor="middle">${label}</text>
            </g>`).join("");
      }
    }
    const position = this.#pointAtProgress(this.#projectedTrack, this.#telemetry.progress);
    if (mapView.followPosition) {
      mapView.pan.x = mapView.scale * (252 - position.x);
      mapView.pan.y = mapView.scale * (150 - position.y);
    }
    const index = Math.min(this.#projectedTrack.length - 2, Math.floor(this.#telemetry.progress * (this.#projectedTrack.length - 1)));
    const recordedPoints = [...this.#projectedTrack.slice(0, index + 1), position];
    this.#mount.querySelector("[data-live-recorded]")?.setAttribute("d", pathFromPoints(recordedPoints));
    this.#mount.querySelector("[data-live-position]")?.setAttribute(
      "transform",
      `translate(${position.x.toFixed(2)} ${position.y.toFixed(2)}) rotate(${this.#telemetry.heading.toFixed(2)})`,
    );
    const mapRotation = this.#menuModel.values.mapOrientation === "TRACK UP" ? -this.#telemetry.heading : 0;
    this.#mount.querySelector("[data-live-map-transform]")?.setAttribute(
      "transform",
      `translate(${mapView.pan.x.toFixed(2)} ${mapView.pan.y.toFixed(2)}) translate(252 150) rotate(${mapRotation.toFixed(2)}) scale(${mapView.scale.toFixed(2)}) translate(-252 -150)`,
    );
  }

  #updateGraph(screenState = this.#screenState) {
    const { screen, variant } = screenState;
    const left = variant.tabsVisible ? 87 : 23;
    const right = 483;
    const top = 44;
    const bottom = 284;
    const isTemperature = screen.graphMetric === "temperature";
    const allValues = this.#ride.graphValues(screen.graphMetric);
    if (allValues.length < 2) return;

    const scale = variant.interaction === "graph" ? this.#graphScale : 1;
    const windowSize = 1 / scale;
    const windowStart = clamp(this.#telemetry.progress - windowSize / 2, 0, 1 - windowSize);
    const windowEnd = windowStart + windowSize;
    const visibleValues = allValues.map((value, index) => ({
      progress: index / (allValues.length - 1),
      value,
    })).filter(({ progress }) => progress >= windowStart && progress <= windowEnd);
    const values = visibleValues.length > 1 ? visibleValues : allValues.map((value, index) => ({
      progress: index / (allValues.length - 1),
      value,
    }));
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

    const currentValue = isTemperature ? this.#telemetry.engineTemperatureF : this.#telemetry.elevationFeet;
    const { maximum: allMaximum, average } = graphStats;
    const unit = isTemperature ? "°F" : " FT";
    const prefix = isTemperature ? "ENG" : "ALT";
    setElementText(this.#mount.querySelector("[data-live-graph-current]"), `${prefix}:${currentValue}${unit}`);
    setElementText(this.#mount.querySelector("[data-live-graph-max]"), `MAX:${Math.round(allMaximum)}${unit}`);
    setElementText(this.#mount.querySelector("[data-live-graph-average]"), `AVG:${average}${unit}`);
    setElementText(
      this.#mount.querySelector("[data-live-graph-readout]"),
      `${isTemperature ? "ENGINE TEMP" : "ALTITUDE"}: ${currentValue}${unit}`,
    );

    const labelStep = isTemperature ? 5 : 50;
    const scaleValues = [0.75, 0.5, 0.25, 0].map((amount) => {
      const value = minimum + range * amount;
      return Math.round(value / labelStep) * labelStep;
    });
    for (const labelElement of this.#mount.querySelectorAll("[data-live-graph-scale-label]")) {
      const index = Number(labelElement.dataset.liveGraphScaleLabel);
      labelElement.textContent = `${scaleValues[index]}${isTemperature ? "" : " FT"}`;
    }

    if (variant.interaction === "graph") {
      const crosshairInset = 18;
      const cursor = {
        x: clamp(
          left + (this.#telemetry.progress - windowStart) / windowSize * (right - left),
          left + crosshairInset,
          right - crosshairInset,
        ),
        y: clamp(
          bottom - (currentValue - minimum) / range * (bottom - top - 16),
          top + crosshairInset,
          bottom - crosshairInset,
        ),
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
  if (element) element.textContent = value;
}
