import {
  VOYAGER_INPUT_POLICY_ALIASES,
  VOYAGER_LIVE_STATE_IDS,
  VOYAGER_STABLE_STATE_ALIASES,
  VOYAGER_TAB_ORDER,
  voyagerScreenState,
} from "./voyager-live-screens.js";
import {
  VOYAGER_MENU_STABLE_STATE_ALIASES,
  VOYAGER_MENU_STATE_IDS,
  voyagerMenuState,
} from "./voyager-menu-registry.js";
import { renderVoyagerMenuMarkup, voyagerMenuAriaLabel } from "./voyager-menu-renderer.js";

const DIRECTION_INPUTS = new Set(["up", "down", "left", "right"]);
const WAYPOINT_STORAGE_KEY = "bobs-app:voyager-waypoints:v1";
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
  #animationFrame = 0;
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
    this.#animationFrame = requestAnimationFrame(this.#tick);
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

  #tick = (timestamp) => {
    if (this.#lastTimestamp && this.#playing && this.#currentTrack) {
      this.#progress += (timestamp - this.#lastTimestamp) / this.#durationMs * this.#playbackSpeed;
      if (this.#progress >= 1) {
        this.#progress = this.#loop ? this.#progress % 1 : 1;
        if (!this.#loop) this.#playing = false;
      }
      this.#emit();
    }
    this.#lastTimestamp = timestamp;
    this.#animationFrame = requestAnimationFrame(this.#tick);
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
  const className = inverse ? "voyager-live__line voyager-live__line--inverse" : "voyager-live__line";
  return `
    <g transform="translate(${x} ${y}) scale(${scale})" aria-hidden="true">
      <path class="${className}" d="M8 1v17a7 7 0 1 0 8 0V1a4 4 0 0 0-8 0Z" />
      <path class="${className}" d="M12 7v15" />
      <path class="${className}" d="M0 31c3-3 6-3 9 0s6 3 9 0 6-3 9 0" />
      <path class="${className}" d="M0 37c3-3 6-3 9 0s6 3 9 0 6-3 9 0" />
    </g>`;
}

function tabsMarkup(activeTab) {
  return VOYAGER_TAB_ORDER.map((tab, index) => {
    const y = index * 43;
    const active = tab.id === activeTab;
    const content = tab.icon
      ? temperatureIcon(18, y + 5, 0.78, active)
      : `<text class="voyager-live__text voyager-live__text--medium${active ? " voyager-live__text--inverse" : ""}" x="33" y="${y + 29}" text-anchor="middle">${tab.label}</text>`;
    return `
      <g data-tab="${tab.id}">
        <rect class="voyager-live__tab${active ? " voyager-live__tab--active" : ""}" x="0" y="${y}" width="67" height="43" />
        ${content}
      </g>`;
  }).join("");
}

function sideArrowsMarkup(tabsVisible) {
  const leftArrow = tabsVisible ? "M67 130l12 20-12 20Z" : "M0 130l12 20-12 20Z";
  return `
    <path class="voyager-live__ink" d="${leftArrow}" />
    <path class="voyager-live__ink" d="M504 130l-12 20 12 20Z" />`;
}

function screenChromeMarkup(screen, variant) {
  return `${variant.tabsVisible ? tabsMarkup(screen.id) : ""}${variant.sideArrows ? sideArrowsMarkup(variant.tabsVisible) : ""}`;
}

function compassMarkup({ cx, cy, radius, pointerAttribute = "data-live-compass-pointer" }) {
  const ticks = Array.from({ length: 16 }, (_, index) => {
    const angle = index * 22.5;
    const length = index % 4 === 0 ? 9 : 5;
    return `<line class="voyager-live__compass-tick" x1="${cx}" y1="${cy - radius}" x2="${cx}" y2="${cy - radius + length}" transform="rotate(${angle} ${cx} ${cy})" />`;
  }).join("");
  const cardinalRadius = radius - 22;
  return `
    <circle class="voyager-live__paper voyager-live__compass-line" cx="${cx}" cy="${cy}" r="${radius}" />
    ${ticks}
    <text class="voyager-live__text voyager-live__text--medium voyager-live__text--muted" x="${cx}" y="${cy - cardinalRadius + 7}" text-anchor="middle">N</text>
    <text class="voyager-live__text voyager-live__text--medium voyager-live__text--muted" x="${cx + cardinalRadius}" y="${cy + 7}" text-anchor="middle">E</text>
    <text class="voyager-live__text voyager-live__text--medium voyager-live__text--muted" x="${cx}" y="${cy + cardinalRadius + 7}" text-anchor="middle">S</text>
    <text class="voyager-live__text voyager-live__text--medium voyager-live__text--muted" x="${cx - cardinalRadius}" y="${cy + 7}" text-anchor="middle">W</text>
    <g ${pointerAttribute} data-cx="${cx}" data-cy="${cy}">
      <path class="voyager-live__compass-shadow" d="M${cx} ${cy - radius + 13}l10 ${radius - 2}-10-9-10 9Z" transform="rotate(-42 ${cx} ${cy})" />
      <path class="voyager-live__ink" d="M${cx} ${cy - radius + 13}l10 ${radius - 2}-10-9-10 9Z" />
    </g>`;
}

function mainMarkup(screen, variant) {
  const hiddenOffset = variant.tabsVisible ? 0 : -47;
  if (variant.view === "secondary") {
    return `
      <rect class="voyager-live__surface" width="504" height="303" />
      ${screenChromeMarkup(screen, variant)}
      <g transform="translate(${hiddenOffset} 0)">
        <text class="voyager-live__text voyager-live__text--medium" x="79" y="29">2</text>
        <text class="voyager-live__text voyager-live__text--medium" x="283" y="35" text-anchor="middle">ODOMETER KM</text>
        <text class="voyager-live__text voyager-live__text--readout" x="283" y="98" text-anchor="middle" data-live-odometer>1200</text>
        <text class="voyager-live__text voyager-live__text--medium" x="173" y="137" text-anchor="middle">MAX SPD KM/H</text>
        <text class="voyager-live__text voyager-live__text--readout" x="173" y="191" text-anchor="middle" data-live-max-kph>25</text>
        <text class="voyager-live__text voyager-live__text--medium" x="397" y="137" text-anchor="middle">AVG SPD KM/H</text>
        <text class="voyager-live__text voyager-live__text--readout" x="397" y="191" text-anchor="middle" data-live-avg-kph>12</text>
        <text class="voyager-live__text voyager-live__text--medium" x="283" y="235" text-anchor="middle">ACCUMULATED RUN TIME</text>
        <text class="voyager-live__text voyager-live__text--large voyager-live__text--clock" x="283" y="291" text-anchor="middle" data-live-elapsed>00:00:00</text>
      </g>`;
  }
  return `
    <rect class="voyager-live__surface" width="504" height="303" />
    ${screenChromeMarkup(screen, variant)}
    <g transform="translate(${hiddenOffset} 0)">
      <text class="voyager-live__text voyager-live__text--medium" x="79" y="29">1</text>
      <text class="voyager-live__text voyager-live__text--medium" x="323" y="28" data-live-temperature>75°F</text>
      <text class="voyager-live__text voyager-live__text--medium" x="393" y="28" data-live-time>12:30</text>
      <path class="voyager-live__ink" d="M488 14h5v18h-5zm9 0h5v18h-5z" />
      <text class="voyager-live__text voyager-live__text--medium" x="454" y="64" data-live-heading-label>NE</text>
      <text class="voyager-live__text" x="156" y="71">SPD MPH</text>
      <text class="voyager-live__text voyager-live__text--large" x="151" y="160" data-live-speed>28</text>
      ${compassMarkup({ cx: 382, cy: 130, radius: 69 })}
      <text class="voyager-live__text" x="100" y="236">ALT FT</text>
      <text class="voyager-live__text voyager-live__text--metric" x="91" y="286" data-live-altitude>1089</text>
      <text class="voyager-live__text" x="261" y="236">DST KM</text>
      <text class="voyager-live__text voyager-live__text--metric" x="254" y="286" data-live-distance>12.0</text>
      ${temperatureIcon(406, 218, 0.72)}
      <text class="voyager-live__text" x="447" y="239">°C</text>
      <text class="voyager-live__text voyager-live__text--metric" x="407" y="286" data-live-celsius>24</text>
    </g>`;
}

function controlHintMarkup(interaction) {
  if (!interaction) return "";
  const mode = interaction === "pan" ? "P" : "Z";
  return `
    <g transform="translate(440 16)" aria-hidden="true">
      <rect class="voyager-live__hint-frame" x="17" y="0" width="18" height="18" />
      <rect class="voyager-live__hint-frame" x="0" y="19" width="18" height="18" />
      <rect class="voyager-live__hint-frame" x="17" y="19" width="18" height="18" />
      <rect class="voyager-live__hint-frame" x="34" y="19" width="18" height="18" />
      <rect class="voyager-live__hint-frame" x="17" y="38" width="18" height="18" />
      <path class="voyager-live__hint-key" data-live-hint="up" d="M26 4l6 8H20Z" />
      <path class="voyager-live__hint-key" data-live-hint="left" d="M4 28l8-6v12Z" />
      <text class="voyager-live__text voyager-live__text--small voyager-live__text--inverse" x="26" y="33" text-anchor="middle">${mode}</text>
      <path class="voyager-live__hint-key" data-live-hint="right" d="M48 28l-8-6v12Z" />
      <path class="voyager-live__hint-key" data-live-hint="down" d="M26 52l6-8H20Z" />
    </g>
    <g transform="translate(442 230)">
      <rect class="voyager-live__ink" width="62" height="42" rx="20" />
      <text class="voyager-live__text voyager-live__text--medium voyager-live__text--inverse" x="31" y="28" text-anchor="middle">P/Z</text>
    </g>`;
}

function mapMarkup(screen, variant) {
  const mapLeft = variant.tabsVisible ? 83 : 28;
  const mapRight = variant.interaction ? 446 : 486;
  return `
    <rect class="voyager-live__surface" width="504" height="303" />
    ${screenChromeMarkup(screen, variant)}
    <text class="voyager-live__text voyager-live__text--medium" x="${variant.tabsVisible ? 82 : 12}" y="27" data-live-ride-label>FOREST LOOP</text>
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
    <text class="voyager-live__text voyager-live__text--medium" x="${variant.tabsVisible ? 244 : 184}" y="286">N</text>
    <path class="voyager-live__ink" d="M${variant.tabsVisible ? 268 : 208} 278l9 7-9 7Z" />
    <text class="voyager-live__text voyager-live__text--medium" x="${variant.tabsVisible ? 307 : 247}" y="286" data-live-temperature>75°F</text>
    <text class="voyager-live__text voyager-live__text--medium" x="${variant.tabsVisible ? 385 : 325}" y="286" data-live-time>12:30</text>
    <path class="voyager-live__ink" d="M478 270h5v18h-5zm9 0h5v18h-5z" />`;
}

function graphGridMarkup(left, right, top, bottom) {
  const verticals = Array.from({ length: 7 }, (_, index) => {
    const x = left + (right - left) * index / 6;
    return `<line x1="${x}" y1="${top}" x2="${x}" y2="${bottom}" />`;
  }).join("");
  const horizontals = Array.from({ length: 4 }, (_, index) => {
    const y = top + (bottom - top) * index / 3;
    return `<line x1="${left}" y1="${y}" x2="${right}" y2="${y}" />`;
  }).join("");
  return `<g class="voyager-live__graph-grid">${verticals}${horizontals}</g>`;
}

function graphMarkup(screen, variant) {
  const left = variant.tabsVisible ? 87 : 23;
  const right = 483;
  const top = 44;
  const bottom = 284;
  const isTemperature = screen.graphMetric === "temperature";
  const unit = isTemperature ? "°F" : "ft";
  const label = isTemperature ? "ENGINE TEMP:" : "ALTITUDE:";
  const primary = variant.view === "primary";
  return `
    <rect class="voyager-live__surface" width="504" height="303" />
    ${screenChromeMarkup(screen, variant)}
    ${primary ? `
      <text class="voyager-live__text voyager-live__text--medium" x="${left}" y="34" data-live-graph-current>${isTemperature ? "ENG 168" : "ALT 700"}</text>
      <text class="voyager-live__text voyager-live__text--medium" x="${left + (right - left) * 0.47}" y="34" text-anchor="middle" data-live-graph-max>MAX 243</text>
      <text class="voyager-live__text voyager-live__text--medium" x="${right}" y="34" text-anchor="end" data-live-graph-average>AVG 172</text>
    ` : `
      <text class="voyager-live__text voyager-live__text--medium" x="23" y="34">${label}</text>
      <text class="voyager-live__text voyager-live__text--medium" x="300" y="34" text-anchor="middle" data-live-graph-readout>168${unit}</text>
      <text class="voyager-live__text voyager-live__text--medium" x="483" y="34" text-anchor="end" data-live-time>12:30</text>
    `}
    <text class="voyager-live__text voyager-live__text--small" x="${left + 3}" y="60">←30m→</text>
    ${graphGridMarkup(left, right, top, bottom)}
    <clipPath id="voyager-live-graph-clip"><rect x="${left}" y="${top}" width="${right - left}" height="${bottom - top}" /></clipPath>
    <g clip-path="url(#voyager-live-graph-clip)">
      <path class="voyager-live__graph-fill" data-live-graph-fill />
      <path class="voyager-live__graph-line" data-live-graph-line />
      ${primary ? "" : `
        <line class="voyager-live__graph-cursor-line" data-live-graph-cursor-line />
        <circle class="voyager-live__graph-cursor" r="12" data-live-graph-cursor />
      `}
    </g>
    <text class="voyager-live__text voyager-live__text--small" x="${left + 3}" y="247">100${unit}</text>`;
}

function metricBlock(x, y, label, attribute, fallback) {
  return `
    <text class="voyager-live__text voyager-live__text--medium" x="${x}" y="${y}" text-anchor="middle">${label}</text>
    <text class="voyager-live__text voyager-live__text--readout" x="${x}" y="${y + 58}" text-anchor="middle" ${attribute}>${fallback}</text>`;
}

function userMarkup(screen, variant) {
  const hiddenOffset = variant.tabsVisible ? 0 : -48;
  if (variant.view === "secondary") {
    return `
      <rect class="voyager-live__surface" width="504" height="303" />
      ${screenChromeMarkup(screen, variant)}
      <g transform="translate(${hiddenOffset} 0)">
        <text class="voyager-live__text voyager-live__text--medium" x="79" y="29">2</text>
        <text class="voyager-live__text voyager-live__text--medium" x="283" y="31" text-anchor="middle">GEOFF'S SCREEN</text>
        <text class="voyager-live__text voyager-live__text--medium" x="283" y="88" text-anchor="middle">ACCUMULATED RUN TIME</text>
        <text class="voyager-live__text voyager-live__text--large voyager-live__text--clock" x="283" y="143" text-anchor="middle" data-live-elapsed>00:00:00</text>
        ${metricBlock(173, 190, "MAX SPD KM/H", "data-live-max-kph", "25")}
        ${metricBlock(397, 190, "AVG SPD KM/H", "data-live-avg-kph", "12")}
      </g>`;
  }
  return `
    <rect class="voyager-live__surface" width="504" height="303" />
    ${screenChromeMarkup(screen, variant)}
    <g transform="translate(${hiddenOffset} 0)">
      <text class="voyager-live__text voyager-live__text--medium" x="79" y="29">1</text>
      <text class="voyager-live__text voyager-live__text--medium" x="283" y="31" text-anchor="middle">KELLY'S SCREEN</text>
      ${metricBlock(173, 83, "WHEEL SPD", "data-live-speed", "25")}
      ${metricBlock(397, 83, "GPS SPD", "data-live-gps-speed", "22")}
      ${metricBlock(173, 190, "TRIP DST KM", "data-live-trip-distance", "120")}
      ${metricBlock(397, 190, "DST 2 KM", "data-live-odometer", "120")}
    </g>`;
}

function navigationMarkup(screen, variant) {
  const hiddenOffset = variant.tabsVisible ? 0 : -66;
  const running = variant.view === "secondary";
  return `
    <rect class="voyager-live__surface" width="504" height="303" />
    ${screenChromeMarkup(screen, variant)}
    <g transform="translate(${hiddenOffset} 0)">
      <text class="voyager-live__text voyager-live__text--medium" x="461" y="45" data-live-heading-label>NE</text>
      ${metricBlock(171, 37, "SPD", "data-live-speed", "21")}
      <text class="voyager-live__text voyager-live__text--medium" x="171" y="137" text-anchor="middle">DEST DIST</text>
      <text class="voyager-live__text voyager-live__text--readout" x="171" y="189" text-anchor="middle" data-live-destination>700</text>
      ${compassMarkup({ cx: 365, cy: 102, radius: 83, pointerAttribute: "data-live-nav-pointer" })}
      <text class="voyager-live__text voyager-live__text--medium" x="284" y="231" text-anchor="middle">STOP WATCH</text>
      ${running ? '<path class="voyager-live__ink" d="M326 214l11 10-11 10Z" />' : '<path class="voyager-live__ink" d="M325 214h5v18h-5zm9 0h5v18h-5z" />'}
      <text class="voyager-live__text voyager-live__text--large voyager-live__text--clock" x="284" y="287" text-anchor="middle" data-live-stopwatch>00:00:00</text>
      ${running ? `
        <g transform="translate(443 231)">
          <rect class="voyager-live__ink" width="61" height="42" rx="20" />
          <path class="voyager-live__paper" d="M16 12h5v18h-5zm9 0h5v18h-5zm11 0 13 9-13 9Z" />
        </g>` : ""}
    </g>`;
}

function satelliteMarkup(screen, variant) {
  const offset = variant.tabsVisible ? 0 : -31;
  const satellites = [
    { x: 141, y: 58, id: 1 }, { x: 229, y: 76, id: 23 }, { x: 110, y: 105, id: 8 },
    { x: 193, y: 127, id: 7 }, { x: 102, y: 162, id: 2 }, { x: 145, y: 143, id: 28 }, { x: 232, y: 178, id: 4 },
  ];
  const satelliteDots = satellites.map(({ x, y, id }) => `
    <g transform="translate(${x} ${y})">
      <circle class="voyager-live__satellite-dot" r="12" />
      <text class="voyager-live__text voyager-live__text--small voyager-live__text--inverse" x="0" y="5" text-anchor="middle">${id}</text>
    </g>`).join("");
  const bars = [79, 91, 59, 45, 102, 25].map((width, index) => {
    const y = 34 + index * 27;
    return `<rect class="voyager-live__ink" x="315" y="${y}" width="${width}" height="12" />`;
  }).join("");
  return `
    <rect class="voyager-live__surface" width="504" height="303" />
    ${screenChromeMarkup(screen, variant)}
    <g transform="translate(${offset} 0)">
      <text class="voyager-live__text voyager-live__text--medium" x="81" y="33">N</text>
      <path class="voyager-live__ink" d="M98 33l8-17 8 17Z" />
      <circle class="voyager-live__compass-line" cx="179" cy="113" r="88" />
      <circle class="voyager-live__compass-line" cx="179" cy="113" r="47" />
      <circle class="voyager-live__ink" cx="179" cy="113" r="4" />
      ${satelliteDots}
      <g class="voyager-live__signal-grid">
        <line x1="315" y1="29" x2="315" y2="192" /><line x1="354" y1="29" x2="354" y2="192" />
        <line x1="393" y1="29" x2="393" y2="192" /><line x1="432" y1="29" x2="432" y2="192" />
        <line x1="471" y1="29" x2="471" y2="192" />
      </g>
      ${bars}
      <text class="voyager-live__text voyager-live__text--small" x="296" y="45" text-anchor="end">1</text>
      <text class="voyager-live__text voyager-live__text--small" x="296" y="72" text-anchor="end">8</text>
      <text class="voyager-live__text voyager-live__text--small" x="296" y="99" text-anchor="end">28</text>
      <text class="voyager-live__text voyager-live__text--small" x="296" y="126" text-anchor="end">2</text>
      <text class="voyager-live__text voyager-live__text--small" x="296" y="153" text-anchor="end">23</text>
      <text class="voyager-live__text voyager-live__text--small" x="296" y="180" text-anchor="end">7</text>
      <text class="voyager-live__text voyager-live__text--medium" x="166" y="238" text-anchor="middle">LATITUDE</text>
      <text class="voyager-live__text voyager-live__text--medium" x="166" y="274" text-anchor="middle" data-live-latitude>N45.000000</text>
      <text class="voyager-live__text voyager-live__text--medium" x="391" y="238" text-anchor="middle">LONGITUDE</text>
      <text class="voyager-live__text voyager-live__text--medium" x="391" y="274" text-anchor="middle" data-live-longitude>W122.000000</text>
    </g>`;
}

function renderScreenMarkup(screen, variant) {
  const renderers = {
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
  #legacyImage;
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
  #pulseTimer = 0;
  #available = false;
  #waypoints = [];

  constructor({ mount, legacyImage, stage, appBase }) {
    this.#mount = mount;
    this.#legacyImage = legacyImage;
    this.#stage = stage;
    this.#appBase = appBase;
  }

  async initialize() {
    const fontReady = document.fonts?.load
      ? document.fonts.load('16px "Bobs Font 8 Pixel"', "VOYAGER RIDE").catch(() => [])
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
      this.#mount.hidden = true;
      this.#legacyImage.hidden = false;
      this.#stage.dataset.renderer = "legacy";
      return;
    }

    this.#mount.hidden = false;
    this.#legacyImage.hidden = true;
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
    if (fromState.variant.interaction === "graph" && (event.action === "left" || event.action === "right")) {
      this.#ride.seekBy(event.action === "left" ? -0.055 : 0.055);
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
    setText("[data-live-distance]", telemetry.distanceKm.toFixed(1));
    setText("[data-live-trip-distance]", String(Math.round(telemetry.distanceKm * 10)));
    setText("[data-live-odometer]", String(Math.round(1200 + telemetry.distanceKm)));
    setText("[data-live-temperature]", `${telemetry.ambientTemperatureF}°F`);
    setText("[data-live-celsius]", String(Math.round((telemetry.ambientTemperatureF - 32) * 5 / 9)));
    setText("[data-live-time]", telemetry.timeLabel);
    setText("[data-live-heading-label]", this.#headingLabel(telemetry.heading));
    setText("[data-live-max-kph]", String(Math.round(telemetry.maxSpeedMph * 1.60934)));
    setText("[data-live-avg-kph]", String(Math.round(telemetry.averageSpeedMph * 1.60934)));
    setText("[data-live-elapsed]", telemetry.elapsedLabel);
    setText("[data-live-stopwatch]", telemetry.elapsedLabel);
    setText("[data-live-destination]", String(telemetry.destinationMeters));
    setText("[data-live-latitude]", coordinateLabel(telemetry.latitude, "N", "S"));
    setText("[data-live-longitude]", coordinateLabel(telemetry.longitude, "E", "W"));
    setText("[data-live-ride-label]", telemetry.trackLabel);

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
    const values = this.#ride.points.map((point, index) => {
      const progress = index / (this.#ride.points.length - 1);
      const elevationFeet = point.elevation * 3.28084;
      return isTemperature ? engineTemperatureAt(progress, elevationFeet) : elevationFeet;
    });
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    const range = maximum - minimum || 1;
    const projected = values.map((value, index) => ({
      x: left + index / (values.length - 1) * (right - left),
      y: bottom - (value - minimum) / range * (bottom - top - 20) - 10,
    }));
    const linePath = pathFromPoints(projected);
    const fillPath = `${linePath} L${right} ${bottom} L${left} ${bottom} Z`;
    this.#mount.querySelector("[data-live-graph-line]")?.setAttribute("d", linePath);
    this.#mount.querySelector("[data-live-graph-fill]")?.setAttribute("d", fillPath);

    const currentValue = isTemperature ? this.#telemetry.engineTemperatureF : this.#telemetry.elevationFeet;
    const average = Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
    const unit = isTemperature ? "°F" : "ft";
    const prefix = isTemperature ? "ENG" : "ALT";
    this.#mount.querySelector("[data-live-graph-current]")?.replaceChildren(document.createTextNode(`${prefix} ${currentValue}${isTemperature ? "°" : ""}`));
    this.#mount.querySelector("[data-live-graph-max]")?.replaceChildren(document.createTextNode(`MAX ${Math.round(maximum)}`));
    this.#mount.querySelector("[data-live-graph-average]")?.replaceChildren(document.createTextNode(`${isTemperature ? "AVG" : "MIN"} ${isTemperature ? average : Math.round(minimum)}`));
    setElementText(this.#mount.querySelector("[data-live-graph-readout]"), `${currentValue}${unit}`);

    if (variant.interaction === "graph") {
      const cursor = this.#pointAtProgress(projected, this.#telemetry.progress);
      const cursorLine = this.#mount.querySelector("[data-live-graph-cursor-line]");
      cursorLine?.setAttribute("x1", cursor.x);
      cursorLine?.setAttribute("x2", cursor.x);
      cursorLine?.setAttribute("y1", cursor.y);
      cursorLine?.setAttribute("y2", bottom);
      this.#mount.querySelector("[data-live-graph-cursor]")?.setAttribute("cx", cursor.x);
      this.#mount.querySelector("[data-live-graph-cursor]")?.setAttribute("cy", cursor.y);
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
