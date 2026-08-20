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
import { renderVoyagerMenuMarkup, voyagerMenuAriaLabel } from "./voyager-menu-renderer.js";
import { VOYAGER_COMPASS_VIEW_BOX, voyagerUiIcon } from "./voyager-ui-icons.js";

const DIRECTION_INPUTS = new Set(["up", "down", "left", "right"]);
const WAYPOINT_STORAGE_KEY = "bobs-app:voyager-waypoints:v1";
const VOYAGER_SCREEN_REFRESH_MS = 2000;
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
  const points = [...documentNode.querySelectorAll("trkpt")].map((point) => ({
    latitude: Number(point.getAttribute("lat")),
    longitude: Number(point.getAttribute("lon")),
    elevation: Number(point.querySelector("ele")?.textContent ?? 0),
    time: Date.parse(point.querySelector("time")?.textContent ?? ""),
  }));
  if (points.length < 2 || points.some((point) => !Number.isFinite(point.latitude + point.longitude))) {
    throw new Error("Voyager GPX does not contain a usable track.");
  }
  return points;
}

function engineTemperatureAt(progress, elevationFeet) {
  return Math.round(166 + Math.sin(progress * Math.PI * 2.25) * 11 + elevationFeet / 560);
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
  return {
    ...definition,
    points,
    distances,
    totalMeters: distances.at(-1) || 1,
    averageSpeedMph: segmentSpeeds.reduce((sum, speed) => sum + speed, 0) / segmentSpeeds.length,
    maxSpeedMph: Math.max(...segmentSpeeds),
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

class VoyagerRideEngine {
  #tracks = new Map();
  #currentTrack = null;
  #listeners = new Set();
  #refreshTimer = 0;
  #lastTimestamp = 0;
  #durationMs = 95000;
  #progress = 0;
  #playbackSpeed = 1;
  #playing = true;
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
    this.#emit();
    this.#lastTimestamp = performance.now();
    this.#refreshTimer = window.setInterval(this.#tick, VOYAGER_SCREEN_REFRESH_MS);
    return this;
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    if (this.#telemetry) listener(this.#telemetry);
    return () => this.#listeners.delete(listener);
  }

  get points() {
    return this.#currentTrack?.points ?? [];
  }

  get trackIds() {
    return [...this.#tracks.keys()];
  }

  get telemetry() {
    return this.#telemetry;
  }

  get playing() {
    return this.#playing;
  }

  selectRide(trackId, { reset = true } = {}) {
    const nextTrack = this.#tracks.get(trackId);
    if (!nextTrack) throw new Error(`Unknown Voyager GPX ride: ${trackId}`);
    this.#currentTrack = nextTrack;
    if (reset) this.#progress = 0;
    this.#emit();
  }

  play() {
    this.#playing = true;
  }

  pause() {
    this.#playing = false;
  }

  reset() {
    this.#progress = 0;
    this.#emit();
  }

  seek(progress) {
    this.#progress = clamp(Number(progress) || 0, 0, 1);
    this.#emit();
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
    const timestamp = performance.now();
    if (this.#lastTimestamp && this.#playing && this.#currentTrack) {
      this.#progress += (timestamp - this.#lastTimestamp) / this.#durationMs * this.#playbackSpeed;
      if (this.#progress >= 1) {
        this.#progress = this.#loop ? this.#progress % 1 : 1;
        if (!this.#loop) this.#playing = false;
      }
      this.#emit();
    }
    this.#lastTimestamp = timestamp;
  };

  #emit() {
    if (!this.#currentTrack) return;
    this.#telemetry = this.#sample(this.#progress);
    for (const listener of this.#listeners) listener(this.#telemetry);
  }

  #sample(progress) {
    const track = this.#currentTrack;
    const segmentPosition = progress * (track.points.length - 1);
    const index = Math.min(track.points.length - 2, Math.floor(segmentPosition));
    const amount = segmentPosition - index;
    const start = track.points[index];
    const end = track.points[index + 1];
    const interpolate = (key) => start[key] + (end[key] - start[key]) * amount;
    const segmentStart = Math.max(0, index - 1);
    const segmentEnd = Math.min(track.points.length - 1, index + 2);
    const speedDistance = haversineMeters(track.points[segmentStart], track.points[segmentEnd]);
    const speedSeconds = Number.isFinite(track.points[segmentEnd].time - track.points[segmentStart].time)
      ? Math.max(1, (track.points[segmentEnd].time - track.points[segmentStart].time) / 1000)
      : 10;
    const speedMph = speedDistance / speedSeconds * 2.23694;
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
      ambientTemperatureF: Math.round(75 + Math.sin(progress * Math.PI * 2) * 3),
      engineTemperatureF: engineTemperatureAt(progress, elevationFeet),
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
    const content = tab.icon
      ? temperatureIcon(18, y + 5, 0.78, active)
      : `<text class="voyager-live__text voyager-live__text--medium${active ? " voyager-live__text--inverse" : ""}" x="33" y="${y + 29}" text-anchor="middle">${tab.label}</text>`;
    return `
      <g data-tab="${tab.id}">
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
      ? screenIndicatorMarkup(variant.screenIndicator, 490, 106, true)
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
        <path class="voyager-live__route" data-live-route />
        <path class="voyager-live__recorded" data-live-recorded />
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

function userMarkup(screen, variant) {
  const hiddenOffset = variant.tabsVisible ? 0 : -48;
  if (variant.view === "secondary") {
    return `
      <rect class="voyager-live__surface" width="504" height="303" />
      ${screenChromeMarkup(screen, variant)}
      ${userTitleMarkup("USER SCREEN 2", variant.tabsVisible)}
      <g transform="translate(${hiddenOffset} 0)">
        <text class="voyager-live__text voyager-live__text--medium" x="283" y="88" text-anchor="middle">ACCUMULATED RUN TIME</text>
        <text class="voyager-live__text voyager-live__text--large voyager-live__text--clock" x="283" y="143" text-anchor="middle" data-live-elapsed>00:00:00</text>
        ${metricBlock(173, 190, "MAX SPD KM/H", "data-live-max-kph", "25")}
        ${metricBlock(397, 190, "AVG SPD KM/H", "data-live-avg-kph", "12")}
      </g>`;
  }
  const leftCenter = variant.tabsVisible ? 173 : 126;
  const rightCenter = variant.tabsVisible ? 397 : 378;
  return `
    <rect class="voyager-live__surface" width="504" height="303" />
    ${screenChromeMarkup(screen, variant)}
    ${userTitleMarkup("USER SCREEN 1", variant.tabsVisible)}
    <g>
      ${metricBlock(leftCenter, 62, "WHEEL SPD", "data-live-speed", "25")}
      ${metricBlock(rightCenter, 62, "GPS SPD", "data-live-gps-speed", "22")}
      ${metricBlock(leftCenter, 148, "TRIP DST KM", "data-live-trip-distance", "120")}
      ${metricBlock(rightCenter, 148, "DST 2 KM", "data-live-odometer", "120")}
      ${metricBlock(leftCenter, 234, "ODOMETER MI", "data-live-odometer-miles", "523.7")}
      ${metricBlock(rightCenter, 234, "ALT FT", "data-live-altitude", "1089")}
    </g>`;
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

function renderScreenMarkup(screen, variant) {
  const renderers = {
    startup: startupMarkup,
    main: mainMarkup,
    map: mapMarkup,
    graph: graphMarkup,
    user: userMarkup,
    navigation: navigationMarkup,
    satellite: satelliteMarkup,
  };
  return renderers[screen.renderer](screen, variant);
}

function projectTrack(points, bounds) {
  const longitudes = points.map((point) => point.longitude);
  const latitudes = points.map((point) => point.latitude);
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
  #layoutKey = "";
  #telemetry = null;
  #projectedTrack = [];
  #projectedTrackId = "";
  #menuProjectedTrack = [];
  #menuProjectedTrackId = "";
  #mapPan = { x: 0, y: 0 };
  #mapScale = 1;
  #graphScale = 1;
  #pulseTimer = 0;
  #stopwatchElapsedMs = 0;
  #stopwatchStartedAt = 0;
  #stopwatchRunning = false;
  #available = false;
  #waypoints = [];

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
      ]),
    ]);
    this.#loadWaypoints();
    this.#available = true;
    this.#ride.subscribe((telemetry) => {
      if (this.#telemetry?.trackId !== telemetry.trackId) {
        this.#projectedTrack = [];
        this.#projectedTrackId = "";
      }
      this.#telemetry = telemetry;
      this.#updateDynamicFields();
    });
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

  render(state, event = {}) {
    this.#state = state;
    this.#screenState = voyagerScreenState(state.id);
    this.#menuState = voyagerMenuState(state.id);
    if (!this.supports(state.id) || (!this.#screenState && !this.#menuState)) {
      throw new Error(`Voyager state ${state.id} does not have a live renderer.`);
    }

    this.#mount.hidden = false;
    this.#stage.dataset.renderer = "live";
    this.#stage.dataset.liveState = state.id;
    this.#applyInteractiveInput(event);

    if (this.#menuState) {
      const layoutKey = `menu:${state.id}:${this.#waypoints.length}`;
      if (layoutKey !== this.#layoutKey) {
        this.#mount.innerHTML = `
          <svg class="voyager-live voyager-menu" viewBox="0 0 504 303" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${voyagerMenuAriaLabel(this.#menuState)}">
            ${renderVoyagerMenuMarkup(this.#menuState)}
          </svg>`;
        this.#layoutKey = layoutKey;
        this.#menuProjectedTrack = [];
      }
      this.#mount.querySelector("svg")?.setAttribute("data-voyager-screen-id", state.id);
      this.#updateDynamicFields();
      return;
    }

    const { screen, variant } = this.#screenState;
    const layoutKey = `${screen.id}:${variant.view}:${variant.tabsVisible}:${variant.interaction ?? "browse"}`;
    if (layoutKey !== this.#layoutKey) {
      this.#mount.innerHTML = `
        <svg class="voyager-live" viewBox="0 0 504 303" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Live Voyager ${screen.tabLabel.toLowerCase()} ${variant.view} screen">
          ${renderScreenMarkup(screen, variant)}
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

  #applyInteractiveInput(event) {
    if (event.type !== "dispatch") return;
    this.#applyMenuOutcome(event);
    const fromState = voyagerScreenState(event.from);
    if (!fromState) return;
    if (fromState.screen.id === "map" && DIRECTION_INPUTS.has(event.action)) {
      const policyState = VOYAGER_INPUT_POLICY_ALIASES[event.from] ?? event.from;
      if (policyState === "map2") {
        const step = 12;
        if (event.action === "up") this.#mapPan.y += step;
        if (event.action === "down") this.#mapPan.y -= step;
        if (event.action === "left") this.#mapPan.x += step;
        if (event.action === "right") this.#mapPan.x -= step;
      }
      if (policyState === "map3") {
        const direction = event.action === "up" || event.action === "right" ? 0.16 : -0.16;
        this.#mapScale = clamp(this.#mapScale + direction, 0.72, 2.2);
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

  #updateDynamicFields() {
    if (!this.#telemetry || !this.#state || this.#mount.hidden) return;
    const setText = (selector, value) => {
      for (const element of this.#mount.querySelectorAll(selector)) element.textContent = value;
    };
    const telemetry = this.#telemetry;
    setText("[data-live-speed]", String(telemetry.speedMph));
    setText("[data-live-gps-speed]", String(Math.max(0, telemetry.speedMph - 2)));
    setText("[data-live-altitude]", String(telemetry.elevationFeet));
    setText("[data-live-distance]", (telemetry.distanceKm * 0.621371).toFixed(1));
    setText("[data-live-trip-distance]", String(Math.round(telemetry.distanceKm * 10)));
    setText("[data-live-odometer]", String(Math.round(1200 + telemetry.distanceKm)));
    setText("[data-live-temperature]", `${telemetry.ambientTemperatureF}°F`);
    setText("[data-live-engine-temperature]", String(telemetry.engineTemperatureF));
    setText("[data-live-time]", telemetry.timeLabel);
    setText("[data-live-heading-label]", this.#headingLabel(telemetry.heading));
    setText("[data-live-max-kph]", String(Math.round(telemetry.maxSpeedMph * 1.60934)));
    setText("[data-live-avg-kph]", String(Math.round(telemetry.averageSpeedMph * 1.60934)));
    setText("[data-live-odometer-miles]", (523.7 + telemetry.distanceKm * 0.621371).toFixed(1));
    setText("[data-live-max-speed]", String(telemetry.maxSpeedMph));
    setText("[data-live-avg-speed]", String(telemetry.averageSpeedMph));
    setText("[data-live-elapsed]", telemetry.elapsedLabel);
    setText("[data-live-stopwatch]", formatDuration(this.#stopwatchMilliseconds() / 1000));
    setText("[data-live-destination]", String(telemetry.destinationMeters));
    setText("[data-live-latitude]", coordinateLabel(telemetry.latitude, "N", "S"));
    setText("[data-live-longitude]", coordinateLabel(telemetry.longitude, "E", "W"));
    setText("[data-live-ride-label]", telemetry.trackLabel);
    this.#mount.dataset.logging = this.#ride.playing ? "recording" : "paused";
    this.#mount.dataset.stopwatch = this.#stopwatchRunning ? "running" : "paused";

    if (this.#menuState) {
      this.#updateMenuMap();
      return;
    }

    if (!this.#screenState) return;

    for (const pointer of this.#mount.querySelectorAll("[data-live-compass-pointer], [data-live-nav-pointer]")) {
      const cx = pointer.dataset.cx;
      const cy = pointer.dataset.cy;
      pointer.setAttribute("transform", `rotate(${telemetry.heading.toFixed(2)} ${cx} ${cy})`);
    }

    if (this.#screenState.screen.renderer === "map") this.#updateMap();
    if (this.#screenState.screen.renderer === "graph") this.#updateGraph();
  }

  #startStopwatch() {
    if (this.#stopwatchRunning) return;
    this.#stopwatchStartedAt = performance.now();
    this.#stopwatchRunning = true;
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
      this.#waypoints = [];
      this.#saveWaypoints();
      this.#invalidateMapProjection();
      this.#ride.reset();
    }
    if (event.from === "m-main1-3-1" || event.from === "m-main1-2-1") this.#ride.reset();
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
    if (!this.#projectedTrack.length || this.#projectedTrackId !== this.#telemetry.trackId) {
      this.#projectedTrack = projectTrack(this.#ride.points, {
        left: variant.tabsVisible ? 104 : 62,
        right: variant.interaction ? 415 : 462,
        top: 62,
        bottom: 234,
      });
      this.#projectedTrackId = this.#telemetry.trackId;
      this.#mount.querySelector("[data-live-route]")?.setAttribute("d", pathFromPoints(this.#projectedTrack));
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
        waypointLayer.innerHTML = [...authoredWaypoints, ...savedWaypoints].map(({ point, label, saved }) => `
            <g transform="translate(${point.x.toFixed(2)} ${point.y.toFixed(2)})">
              <circle class="voyager-live__waypoint" r="${saved ? 14 : 12}" />
              <text class="voyager-live__text" x="0" y="6" text-anchor="middle">${label}</text>
            </g>`).join("");
      }
    }
    const position = this.#pointAtProgress(this.#projectedTrack, this.#telemetry.progress);
    const index = Math.min(this.#projectedTrack.length - 2, Math.floor(this.#telemetry.progress * (this.#projectedTrack.length - 1)));
    const recordedPoints = [...this.#projectedTrack.slice(0, index + 1), position];
    this.#mount.querySelector("[data-live-recorded]")?.setAttribute("d", pathFromPoints(recordedPoints));
    this.#mount.querySelector("[data-live-position]")?.setAttribute(
      "transform",
      `translate(${position.x.toFixed(2)} ${position.y.toFixed(2)}) rotate(${this.#telemetry.heading.toFixed(2)})`,
    );
    this.#mount.querySelector("[data-live-map-transform]")?.setAttribute(
      "transform",
      `translate(${this.#mapPan.x} ${this.#mapPan.y}) translate(252 150) scale(${this.#mapScale}) translate(-252 -150)`,
    );
  }

  #updateGraph() {
    const { screen, variant } = this.#screenState;
    const left = variant.tabsVisible ? 87 : 23;
    const right = 483;
    const top = 44;
    const bottom = 284;
    const isTemperature = screen.graphMetric === "temperature";
    const allValues = this.#ride.points.map((point, index) => {
      const progress = index / (this.#ride.points.length - 1);
      const elevationFeet = point.elevation * 3.28084;
      return isTemperature ? engineTemperatureAt(progress, elevationFeet) : elevationFeet;
    });
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
    const minimum = Math.min(...values.map(({ value }) => value));
    const maximum = Math.max(...values.map(({ value }) => value));
    const range = maximum - minimum || 1;
    const projected = values.map(({ progress, value }) => ({
      x: left + (progress - windowStart) / windowSize * (right - left),
      y: bottom - (value - minimum) / range * (bottom - top - 16),
    }));
    const linePath = pathFromPoints(projected);
    const fillPath = `${linePath} L${right} ${bottom} L${left} ${bottom} Z`;
    this.#mount.querySelector("[data-live-graph-line]")?.setAttribute("d", linePath);
    this.#mount.querySelector("[data-live-graph-fill]")?.setAttribute("d", fillPath);
    this.#mount.querySelector("[data-live-graph-fill-clip]")?.setAttribute("d", fillPath);

    const currentValue = isTemperature ? this.#telemetry.engineTemperatureF : this.#telemetry.elevationFeet;
    const allMaximum = Math.max(...allValues);
    const average = Math.round(allValues.reduce((sum, value) => sum + value, 0) / allValues.length);
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
      const cursor = {
        x: left + (this.#telemetry.progress - windowStart) / windowSize * (right - left),
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
