import { createVoyagerInventorySnapshot } from "./voyager-device-runtime.js";

const VOYAGER_TRACK_STORAGE_CAPACITY_BYTES = 1_940_000;
const VOYAGER_ROUTE_STORAGE_CAPACITY_BYTES = 10_746_000;
const VOYAGER_MICROSD_BASE_USED_BYTES = 414 * 1024 * 1024;
const VOYAGER_MICROSD_CAPACITY_MB = 486;

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const immutableRecords = (records) => Object.freeze(records.map((record) => Object.freeze({ ...record })));

export class VoyagerRideCatalog {
  #tracks = new Map();
  #areas = new Map();
  #resources = new Map();
  #savedWaypoints = Object.freeze([]);
  #savedRides = Object.freeze([]);
  #recordingSummary = Object.freeze({ pointCount: 0, segmentCount: 0, bytes: 0 });
  #exportedBytes = 0;
  #memorySummary = null;
  #inventorySnapshot = null;
  #revision = 0;

  get revision() {
    return this.#revision;
  }

  registerLoadedGroups(groups) {
    this.#tracks.clear();
    this.#areas.clear();
    this.#resources.clear();
    for (const group of groups) {
      this.#resources.set(group.resource.id, Object.freeze({ ...group.resource }));
      for (const track of group.tracks) this.#tracks.set(track.id, track);
      if (group.areaId) {
        this.#areas.set(group.areaId, {
          lastTrackId: null,
          trackIds: group.tracks.map((track) => track.id),
        });
      }
    }
    this.#memorySummary = this.#buildMemorySummary();
    this.#touch();
  }

  track(trackId) {
    return this.#tracks.get(trackId) ?? null;
  }

  resource(resourceId) {
    return this.#resources.get(resourceId) ?? null;
  }

  area(areaId) {
    return this.#areas.get(areaId) ?? null;
  }

  pointsFor(trackId) {
    const area = this.#areas.get(trackId);
    const resolvedTrackId = area?.lastTrackId ?? area?.trackIds[0] ?? trackId;
    return this.#tracks.get(resolvedTrackId)?.points ?? [];
  }

  get trackIds() {
    return Object.freeze([...this.#tracks.keys(), ...this.#areas.keys()]);
  }

  selectAreaTrackId(areaId, random = Math.random) {
    const area = this.#areas.get(areaId);
    if (!area) return null;
    const candidates = area.trackIds.filter((candidate) => candidate !== area.lastTrackId);
    const selectionPool = candidates.length ? candidates : area.trackIds;
    const resolvedTrackId = selectionPool[Math.floor(random() * selectionPool.length)];
    area.lastTrackId = resolvedTrackId;
    return resolvedTrackId;
  }

  resourcesFor(role) {
    return Object.freeze(
      [...this.#resources.values()].filter(({ memoryRoles = [] }) => memoryRoles.includes(role)),
    );
  }

  labelsFor(role) {
    return Object.freeze(this.resourcesFor(role).map(({ label, id }) => label ?? id));
  }

  visibleResources(role, { display = "ALL", selectedLabels = [] } = {}) {
    if (display === "NONE") return Object.freeze([]);
    const resources = this.resourcesFor(role);
    if (display !== "CUSTOM") return resources;
    const selected = new Set(selectedLabels);
    return Object.freeze(resources.filter(({ label, id }) => selected.has(label ?? id)));
  }

  get memorySummary() {
    return this.#memorySummary ?? this.#buildMemorySummary();
  }

  get savedWaypoints() {
    return this.#savedWaypoints;
  }

  setSavedWaypoints(waypoints) {
    this.#savedWaypoints = immutableRecords(waypoints);
    this.#touch();
  }

  addSavedWaypoint(waypoint) {
    const savedWaypoint = Object.freeze({ ...waypoint });
    this.#savedWaypoints = Object.freeze([...this.#savedWaypoints, savedWaypoint]);
    this.#touch();
    return savedWaypoint;
  }

  removeLastSavedWaypoint() {
    const removed = this.#savedWaypoints.at(-1) ?? null;
    if (!removed) return null;
    this.#savedWaypoints = Object.freeze(this.#savedWaypoints.slice(0, -1));
    this.#touch();
    return removed;
  }

  clearSavedWaypoints() {
    if (!this.#savedWaypoints.length) return;
    this.#savedWaypoints = Object.freeze([]);
    this.#touch();
  }

  get savedRides() {
    return this.#savedRides;
  }

  setSavedRides(rides) {
    this.#savedRides = immutableRecords(rides);
    this.#touch();
  }

  saveRide(ride, limit = 8) {
    this.#savedRides = immutableRecords([
      ride,
      ...this.#savedRides.filter((savedRide) => savedRide.name !== ride.name),
    ].slice(0, limit));
    this.#touch();
    return this.#savedRides[0];
  }

  removeSavedRide(index) {
    const removed = this.#savedRides[index] ?? null;
    if (!removed) return null;
    this.#savedRides = immutableRecords(this.#savedRides.filter((_, rideIndex) => rideIndex !== index));
    this.#touch();
    return removed;
  }

  setRecordingSummary({ pointCount = 0, segmentCount = 0, bytes = 0 } = {}) {
    const next = {
      pointCount: Math.max(0, Math.floor(Number(pointCount) || 0)),
      segmentCount: Math.max(0, Math.floor(Number(segmentCount) || 0)),
      bytes: Math.max(0, Math.floor(Number(bytes) || 0)),
    };
    if (next.pointCount === this.#recordingSummary.pointCount
      && next.segmentCount === this.#recordingSummary.segmentCount
      && next.bytes === this.#recordingSummary.bytes) return;
    this.#recordingSummary = Object.freeze(next);
    this.#inventorySnapshot = null;
  }

  noteExport(bytes, { replacesBytes = 0 } = {}) {
    this.#exportedBytes = Math.max(
      0,
      this.#exportedBytes
        - Math.max(0, Math.floor(Number(replacesBytes) || 0))
        + Math.max(0, Math.floor(Number(bytes) || 0)),
    );
    this.#inventorySnapshot = null;
  }

  destinationWaypoints(authoredWaypoints, limit = 4) {
    const savedWaypoints = this.#savedWaypoints.map((waypoint) => ({
      name: `${waypoint.source} ${waypoint.label}`,
      latitude: waypoint.latitude,
      longitude: waypoint.longitude,
    }));
    return Object.freeze([...authoredWaypoints, ...savedWaypoints].slice(0, limit).map((waypoint, index) => Object.freeze({
      ...waypoint,
      label: String(index + 1),
    })));
  }

  inventorySnapshot() {
    if (this.#inventorySnapshot) return this.#inventorySnapshot;
    const memorySummary = this.memorySummary;
    const recordedTrackCount = this.#recordingSummary.pointCount > 0 ? 1 : 0;
    const dynamicSummary = {
      ...memorySummary,
      trackCount: Math.min(300, memorySummary.trackCount + recordedTrackCount),
      trackUsage: clamp(
        (memorySummary.trackBytes + this.#recordingSummary.bytes) / VOYAGER_TRACK_STORAGE_CAPACITY_BYTES,
        0,
        1,
      ),
      microSdUsedMb: Math.round(
        (VOYAGER_MICROSD_BASE_USED_BYTES + memorySummary.totalResourceBytes + this.#exportedBytes) / 1024 / 1024,
      ),
      recordedPointCount: this.#recordingSummary.pointCount,
      recordedSegmentCount: this.#recordingSummary.segmentCount,
      recordedBytes: this.#recordingSummary.bytes,
      exportedBytes: this.#exportedBytes,
    };
    this.#inventorySnapshot = createVoyagerInventorySnapshot(dynamicSummary, {
      savedRideCount: this.#savedRides.length,
      savedWaypointCount: this.#savedWaypoints.length,
    });
    return this.#inventorySnapshot;
  }

  #buildMemorySummary() {
    const resources = [...this.#resources.values()];
    const trackResources = resources.filter(({ memoryRoles = [] }) => memoryRoles.includes("track"));
    const routeResources = resources.filter(({ memoryRoles = [] }) => memoryRoles.includes("route"));
    const sumBytes = (records) => records.reduce((total, resource) => total + resource.bytes, 0);
    const totalResourceBytes = sumBytes(resources);
    return Object.freeze({
      trackCount: trackResources.length,
      trackUsage: clamp(sumBytes(trackResources) / VOYAGER_TRACK_STORAGE_CAPACITY_BYTES, 0, 1),
      trackBytes: sumBytes(trackResources),
      routeCount: routeResources.length,
      routeUsage: clamp(sumBytes(routeResources) / VOYAGER_ROUTE_STORAGE_CAPACITY_BYTES, 0, 1),
      routeBytes: sumBytes(routeResources),
      waypointCount: resources.reduce((total, resource) => total + resource.waypoints.length, 0),
      microSdUsedMb: Math.round((VOYAGER_MICROSD_BASE_USED_BYTES + totalResourceBytes) / 1024 / 1024),
      microSdCapacityMb: VOYAGER_MICROSD_CAPACITY_MB,
      totalResourceBytes,
    });
  }

  #touch() {
    this.#revision += 1;
    this.#inventorySnapshot = null;
  }
}
