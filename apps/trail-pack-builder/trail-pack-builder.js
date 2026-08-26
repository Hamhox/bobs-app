import { TrailMap } from "./map-canvas.js";

const AUTO_GROUP_LOAD_MIN_ZOOM = 6;
const MOBILE_INITIAL_MAX_ZOOM = 8.9;
const MANIFEST_PATH = "web-map/v2/manifest.json";
const VOYAGER_MANIFEST_PATH = "voyager-production-manifest.json";
const DEFAULT_BASEMAP_PATH = "web-map/basemap/bobs-pirate-map.pmtiles";
const DEFAULT_RUNTIME_MAP_PATH = "./runtime/map";
const DEFAULT_RUNTIME_RELEASE_PATH = "./runtime/release";
const OVERVIEW_GROUP_FIELDS = [
  "id",
  "count",
  "bounds",
  "center",
  "file",
  "unassignedCount",
  "unassignedBounds",
  "unassignedCenter",
];
const OVERVIEW_AREA_FIELDS = [
  "id",
  "name",
  "count",
  "pointCount",
  "viewBounds",
  "labelPoint",
  "groupIds",
];
const OVERVIEW_COLLECTION_FIELDS = [
  "id",
  "name",
  "count",
  "pointCount",
  "viewBounds",
  "labelPoint",
  "groupIds",
  "memberAreaIds",
];
const CHUNK_CATALOG_FIELDS = [
  "trail_id",
  "display_name",
  "bbox",
  "length_m",
  "point_count",
  "elevation_coverage",
  "area_id",
];
const CHUNK_COLLECTION_CATALOG_FIELDS = [...CHUNK_CATALOG_FIELDS, "collection_id"];
const LEGACY_CHUNK_CATALOG_FIELDS = [
  ...CHUNK_CATALOG_FIELDS.slice(0, -1),
  "gpx_path",
  "area_id",
];
const LEGACY_CHUNK_COLLECTION_CATALOG_FIELDS = [
  ...LEGACY_CHUNK_CATALOG_FIELDS,
  "collection_id",
];
const urlParameters = new URLSearchParams(window.location.search);
const CURATION_ENABLED = urlParameters.get("curate") === "1" && isLoopbackHostname(window.location.hostname);
let quickStartOpenTimer = 0;

const elements = {
  status: document.getElementById("trailStatus"),
  workspace: document.getElementById("trailWorkspace"),
  canvas: document.getElementById("trailMap"),
  areaLabels: document.getElementById("trailAreaLabels"),
  trackTooltip: document.getElementById("trailTrackTooltip"),
  panTool: document.getElementById("panTool"),
  boxTool: document.getElementById("boxTool"),
  autoFitAreas: document.getElementById("autoFitAreas"),
  zoomIn: document.getElementById("zoomIn"),
  zoomOut: document.getElementById("zoomOut"),
  fitTrails: document.getElementById("fitTrails"),
  helpButton: document.getElementById("trailHelpButton"),
  helpDialog: document.getElementById("trailHelpDialog"),
  helpClose: document.getElementById("trailHelpClose"),
  collectionOpen: document.getElementById("openCollectionPacks"),
  selectionPanel: document.getElementById("trailSelection"),
  selectionTitle: document.getElementById("selection-title"),
  selectionKindLabel: document.getElementById("selectionKindLabel"),
  selectionPrimary: document.getElementById("selectionPrimary"),
  selectionDetails: document.getElementById("selectionDetails"),
  packRule: document.getElementById("packRule"),
  collectionPackList: document.getElementById("collectionPackList"),
  download: document.getElementById("downloadPack"),
  contextDownload: document.getElementById("downloadMapContext"),
  contextWarning: document.getElementById("mapContextWarning"),
  clear: document.getElementById("clearSelection"),
  curation: document.getElementById("trailCuration"),
  curationTitle: document.getElementById("trailCurationTitle"),
  curationDirty: document.getElementById("trailCurationDirty"),
  curationSummary: document.getElementById("trailCurationSummary"),
  curationSelection: document.getElementById("trailCurationSelection"),
  curationPackName: document.getElementById("trailCurationPackName"),
  curationNew: document.getElementById("trailCurationNew"),
  curationRename: document.getElementById("trailCurationRename"),
  curationAdd: document.getElementById("trailCurationAdd"),
  curationReplace: document.getElementById("trailCurationReplace"),
  curationUnassign: document.getElementById("trailCurationUnassign"),
  curationClearSelection: document.getElementById("trailCurationClearSelection"),
  curationSearch: document.getElementById("trailCurationSearch"),
  curationInView: document.getElementById("trailCurationInView"),
  curationAutoFit: document.getElementById("trailCurationAutoFit"),
  curationMerge: document.getElementById("trailCurationMerge"),
  curationCheckVisible: document.getElementById("trailCurationCheckVisible"),
  curationShowAll: document.getElementById("trailCurationShowAll"),
  curationChecked: document.getElementById("trailCurationChecked"),
  curationLayers: document.getElementById("trailCurationLayers"),
  curationLoose: document.getElementById("trailCurationLoose"),
  curationUndo: document.getElementById("trailCurationUndo"),
  curationRedo: document.getElementById("trailCurationRedo"),
  curationExport: document.getElementById("trailCurationExport"),
  curationImport: document.getElementById("trailCurationImport"),
  curationReset: document.getElementById("trailCurationReset"),
  curationImportFile: document.getElementById("trailCurationImportFile"),
};

const state = {
  repository: null,
  voyagerRepository: null,
  voyagerManifest: null,
  voyagerPacks: new Map(),
  voyagerAddon: null,
  voyagerReleaseError: null,
  manifest: null,
  catalog: new Map(),
  overviewGroups: new Map(),
  ridingAreas: new Map(),
  ridingCollections: new Map(),
  ridingTargets: new Map(),
  loadedGroups: new Set(),
  groupPromises: new Map(),
  activeGroupId: null,
  activeAreaId: null,
  selectedAreaId: null,
  selected: new Set(),
  selectionBounds: null,
  selectionKind: null,
  selectionName: null,
  selecting: false,
  statusTimer: 0,
  viewportLoadTimer: 0,
  areaRequestToken: 0,
  areaLabelButtons: new Map(),
  curator: null,
  curatorAreas: new Map(),
  publicDocumentTitle: document.title,
};

const map = new TrailMap(elements.canvas, {
  showAllAreaLabels: CURATION_ENABLED,
  onTrailHover: CURATION_ENABLED ? renderTrailTooltip : null,
  onBox: CURATION_ENABLED ? (bounds) => routeCuratorEvent("onBox", bounds) : null,
  onAreaPeek: (area) => routeCuratorGroup(area, peekArea),
  onAreaSelect: (area) => routeCuratorGroup(area, selectArea),
  onGroupPeek: CURATION_ENABLED ? (group) => routeCuratorGroup(group) : null,
  onGroupSelect: CURATION_ENABLED ? (group) => routeCuratorGroup(group) : null,
  onTrailToggle: CURATION_ENABLED ? (trailId) => routeCuratorEvent("onTrailToggle", trailId) : null,
  onBackgroundSelect: CURATION_ENABLED ? () => routeCuratorEvent("onBackgroundSelect") : null,
  onAreaLabels: renderAreaLabels,
  onViewport: (view) => routeCuratorViewport(view),
  onToolShortcut: activateMapShortcutTool,
  onFitAllShortcut: fitAllTrails,
  onFitSelectedShortcut: fitSelectedTrails,
  onEscape: CURATION_ENABLED
    ? () => setStatus("Selection cancelled · Select mode is still active.")
    : null,
  onBasemapAvailability: updateBasemapAvailability,
});

function isLoopbackHostname(hostname) {
  const value = String(hostname || "").toLowerCase();
  return value === "localhost" || value === "::1" || value === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(value);
}

function routeCuratorEvent(method, ...args) {
  const handler = CURATION_ENABLED ? state.curator?.[method] : null;
  if (typeof handler === "function") return handler.call(state.curator, ...args);
  return undefined;
}

function routeCuratorGroup(group, fallback) {
  const handler = CURATION_ENABLED ? state.curator?.selectGroup : null;
  if (typeof handler === "function") return handler.call(state.curator, group?.id);
  if (CURATION_ENABLED) return undefined;
  return typeof fallback === "function" ? fallback(group) : undefined;
}

function routeCuratorViewport(view) {
  const handler = CURATION_ENABLED ? state.curator?.onViewport : null;
  if (typeof handler === "function") {
    return handler.call(state.curator, view?.bounds, view);
  }
  return queueViewportGroups(view);
}

class SameOriginRepository {
  constructor(baseUrl) {
    const resolved = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`, import.meta.url);
    if (resolved.origin !== window.location.origin) {
      throw new Error("Local data mounts must use this page's origin.");
    }
    this.baseUrl = resolved;
  }

  async readText(relativePath) {
    const response = await fetch(this.resolveUrl(relativePath));
    if (!response.ok) throw new Error(`Unable to read local data (${response.status}).`);
    return response.text();
  }

  resolveUrl(relativePath) {
    const normalized = String(relativePath).replaceAll("\\", "/").split("/").filter(Boolean);
    if (!normalized.length || normalized.some((part) => part === "." || part === "..")) {
      throw new Error("The trail database contains an unsafe file path.");
    }
    return new URL(normalized.map(encodeURIComponent).join("/"), this.baseUrl);
  }

  async readJson(relativePath) {
    return JSON.parse(await this.readText(relativePath));
  }
}

function decodePolyline(encoded, precision) {
  const factor = 10 ** precision;
  const coordinates = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;
  while (index < encoded.length) {
    const latitudeResult = decodeValue(encoded, index);
    index = latitudeResult.index;
    latitude += latitudeResult.value;
    const longitudeResult = decodeValue(encoded, index);
    index = longitudeResult.index;
    longitude += longitudeResult.value;
    coordinates.push(longitude / factor, latitude / factor);
  }
  return coordinates;
}

function decodeValue(encoded, startIndex) {
  let result = 0;
  let shift = 0;
  let index = startIndex;
  let byte;
  do {
    if (index >= encoded.length) throw new Error("The map preview contains an invalid polyline.");
    byte = encoded.charCodeAt(index) - 63;
    index += 1;
    result |= (byte & 0x1f) << shift;
    shift += 5;
  } while (byte >= 0x20);
  return { value: result & 1 ? ~(result >> 1) : result >> 1, index };
}

function normalizeChunkCatalog(document, groupId) {
  const schema = chunkCatalogSchema(document.catalogFields);
  const fieldIndex = new Map(document.catalogFields.map((field, index) => [field, index]));
  const catalog = new Map();
  for (const row of document.catalog) {
    if (!Array.isArray(row) || row.length !== document.catalogFields.length) {
      throw new Error(`Trail data for ${groupId} contains an invalid catalog row.`);
    }
    const readField = (field) => row[fieldIndex.get(field)];
    const id = readField("trail_id");
    const bbox = readField("bbox");
    if (!schema || !id || !Array.isArray(bbox) || bbox.length !== 4) {
      throw new Error(`Trail data for ${groupId} is incomplete.`);
    }
    catalog.set(id, {
      id,
      name: readField("display_name"),
      groupId,
      bbox,
      lengthM: readField("length_m"),
      pointCount: readField("point_count"),
      areaId: readField("area_id") || null,
      collectionId: schema.supportsCollections ? readField("collection_id") || null : null,
    });
  }
  return catalog;
}

function chunkCatalogSchema(fields) {
  for (const [candidate, supportsCollections] of [
    [CHUNK_CATALOG_FIELDS, false],
    [CHUNK_COLLECTION_CATALOG_FIELDS, true],
    [LEGACY_CHUNK_CATALOG_FIELDS, false],
    [LEGACY_CHUNK_COLLECTION_CATALOG_FIELDS, true],
  ]) {
    if (hasExactFields(fields, candidate)) return { supportsCollections };
  }
  return null;
}

function hasExactFields(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length &&
    actual.every((field, index) => field === expected[index]);
}

function isFinitePoint(value) {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
}

function isValidBounds(value) {
  return Array.isArray(value) && value.length === 4 && value.every(Number.isFinite) &&
    value[0] <= value[2] && value[1] <= value[3];
}

function pointIsInsideBounds(point, bounds) {
  return point[0] >= bounds[0] && point[0] <= bounds[2] &&
    point[1] >= bounds[1] && point[1] <= bounds[3];
}

function normalizeOverview(document) {
  const hasCollections = document?.collectionFields !== undefined || document?.collections !== undefined;
  if (
    document?.version !== 2 ||
    !hasExactFields(document.groupFields, OVERVIEW_GROUP_FIELDS) ||
    !hasExactFields(document.areaFields, OVERVIEW_AREA_FIELDS) ||
    !Array.isArray(document.groups) || !Array.isArray(document.areas) ||
    (hasCollections && (
      !hasExactFields(document.collectionFields, OVERVIEW_COLLECTION_FIELDS) ||
      !Array.isArray(document.collections)
    ))
  ) {
    throw new Error("The riding-area overview format is not supported.");
  }
  const groups = new Map();
  for (const row of document.groups) {
    if (!Array.isArray(row) || row.length !== OVERVIEW_GROUP_FIELDS.length) {
      throw new Error("The riding-area overview contains an invalid group.");
    }
    const [
      id,
      count,
      bounds,
      center,
      file,
      unassignedCount,
      unassignedBounds,
      unassignedCenter,
    ] = row;
    const hasUnassignedRemainder = unassignedCount > 0;
    if (
      typeof id !== "string" || !id || groups.has(id) ||
      !Number.isInteger(count) || count < 1 ||
      !isValidBounds(bounds) || !isFinitePoint(center) || !pointIsInsideBounds(center, bounds) ||
      typeof file !== "string" || !file ||
      !Number.isInteger(unassignedCount) || unassignedCount < 0 || unassignedCount > count ||
      (hasUnassignedRemainder && (
        !isValidBounds(unassignedBounds) || !isFinitePoint(unassignedCenter) ||
        !pointIsInsideBounds(unassignedCenter, unassignedBounds) ||
        unassignedBounds[0] < bounds[0] || unassignedBounds[1] < bounds[1] ||
        unassignedBounds[2] > bounds[2] || unassignedBounds[3] > bounds[3]
      )) ||
      (!hasUnassignedRemainder && (unassignedBounds !== null || unassignedCenter !== null))
    ) {
      throw new Error("The riding-area overview contains an invalid group.");
    }
    groups.set(id, {
      id,
      count,
      bounds,
      center,
      file,
      unassignedCount,
      unassignedBounds,
      unassignedCenter,
    });
  }
  const areas = new Map();
  for (const row of document.areas) {
    if (!Array.isArray(row) || row.length !== OVERVIEW_AREA_FIELDS.length) {
      throw new Error("The riding-area overview contains an invalid named area.");
    }
    const [id, name, count, pointCount, viewBounds, labelPoint, groupIds] = row;
    if (
      typeof id !== "string" || !id || areas.has(id) ||
      typeof name !== "string" || !name.trim() ||
      !Number.isInteger(count) || count < 1 ||
      !Number.isInteger(pointCount) || pointCount < 1 ||
      !isValidBounds(viewBounds) || !isFinitePoint(labelPoint) ||
      !Array.isArray(groupIds) || !groupIds.length ||
      new Set(groupIds).size !== groupIds.length ||
      groupIds.some((groupId) => !groups.has(groupId))
    ) {
      throw new Error("The riding-area overview contains an invalid named area.");
    }
    areas.set(id, { id, name, count, pointCount, viewBounds, labelPoint, groupIds });
  }
  const collections = new Map();
  const memberAreaIds = new Set();
  for (const row of hasCollections ? document.collections : []) {
    if (!Array.isArray(row) || row.length !== OVERVIEW_COLLECTION_FIELDS.length) {
      throw new Error("The riding-area overview contains an invalid collection.");
    }
    const [id, name, count, pointCount, viewBounds, labelPoint, groupIds, members] = row;
    if (
      typeof id !== "string" || !id || areas.has(id) || collections.has(id) ||
      typeof name !== "string" || !name.trim() ||
      !Number.isInteger(count) || count < 1 ||
      !Number.isInteger(pointCount) || pointCount < 1 ||
      !isValidBounds(viewBounds) || !isFinitePoint(labelPoint) ||
      !Array.isArray(groupIds) || !groupIds.length ||
      new Set(groupIds).size !== groupIds.length ||
      groupIds.some((groupId) => !groups.has(groupId)) ||
      !Array.isArray(members) || !members.length ||
      new Set(members).size !== members.length ||
      members.some((areaId) => !areas.has(areaId) || memberAreaIds.has(areaId))
    ) {
      throw new Error("The riding-area overview contains an invalid collection.");
    }
    const memberAreas = members.map((areaId) => areas.get(areaId));
    if (
      memberAreas.some((area) => area.groupIds.some((groupId) => !groupIds.includes(groupId))) ||
      memberAreas.reduce((total, area) => total + area.count, 0) > count ||
      memberAreas.reduce((total, area) => total + area.pointCount, 0) > pointCount
    ) {
      throw new Error("The riding-area overview collection does not contain its member areas.");
    }
    members.forEach((areaId) => memberAreaIds.add(areaId));
    collections.set(id, {
      id,
      name,
      count,
      pointCount,
      viewBounds,
      labelPoint,
      groupIds,
      memberAreaIds: members,
    });
  }
  return { groups, areas, collections, memberAreaIds };
}

function validateChunk(document, expectedId) {
  if (
    document?.version !== 2 || document?.id !== expectedId ||
    !Number.isInteger(document.precision) ||
    !chunkCatalogSchema(document.catalogFields) ||
    !Array.isArray(document.catalog) || !Array.isArray(document.trails)
  ) {
    throw new Error(`Trail data for ${expectedId} is not supported.`);
  }
}

function normalizePreview(packedPreview, precision) {
  const preview = new Map();
  for (const [id, encodedSegments] of packedPreview) {
    preview.set(id, encodedSegments.map((segment) => decodePolyline(segment, precision)));
  }
  return preview;
}

async function loadRepository(repository, voyagerRepository) {
  elements.workspace.setAttribute("aria-busy", "true");
  setStatus("Reading the riding-area index…", false, true);
  const manifest = await repository.readJson(MANIFEST_PATH);
  validateManifest(manifest);
  const narrowViewport = window.matchMedia("(max-width: 48rem)").matches;
  const initialZoom = manifest.initialView
    ? Math.min(manifest.initialView.zoom, narrowViewport ? MOBILE_INITIAL_MAX_ZOOM : Infinity)
    : null;
  state.curator?.destroy?.();
  state.curator = null;
  if (CURATION_ENABLED) {
    document.body.classList.remove("is-curation-mode");
    if (elements.curation) elements.curation.hidden = true;
    if (elements.curationTitle) elements.curationTitle.textContent = "Grouping board";
    document.title = state.publicDocumentTitle;
  }
  const voyagerReleasePromise = loadVoyagerRelease(voyagerRepository, manifest).then(
    (release) => ({ release }),
    (error) => ({ error }),
  );
  state.repository = repository;
  state.voyagerRepository = null;
  state.voyagerManifest = null;
  state.voyagerPacks.clear();
  state.voyagerAddon = null;
  state.voyagerReleaseError = null;
  elements.contextDownload.hidden = true;
  elements.contextDownload.removeAttribute("href");
  elements.contextWarning.hidden = true;
  elements.collectionOpen.hidden = true;
  delete elements.collectionOpen.dataset.collectionId;
  state.manifest = manifest;
  state.catalog.clear();
  state.overviewGroups.clear();
  state.ridingAreas.clear();
  state.ridingCollections.clear();
  state.ridingTargets.clear();
  state.curatorAreas.clear();
  for (const button of state.areaLabelButtons.values()) button.remove();
  state.areaLabelButtons.clear();
  state.loadedGroups.clear();
  state.groupPromises.clear();
  state.activeGroupId = null;
  state.activeAreaId = null;
  state.selectedAreaId = null;
  state.selected.clear();
  state.selectionBounds = null;
  state.selectionKind = null;
  state.selectionName = null;
  state.areaRequestToken += 1;
  if (manifest.initialView) map.setView(manifest.initialView.center, initialZoom);
  void initializeBasemap(repository);

  const [overviewDocument, contextDocument] = await Promise.all([
    repository.readJson(manifest.overviewFile),
    repository.readJson(manifest.contextFile),
  ]);
  const overview = normalizeOverview(overviewDocument);
  const indexedTrailCount = [...overview.groups.values()]
    .reduce((total, group) => total + group.count, 0);
  const unassignedTrailCount = [...overview.groups.values()]
    .reduce((total, group) => total + group.unassignedCount, 0);
  const areaAssignedTrailCount = [...overview.areas.values()]
    .reduce((total, area) => total + area.count, 0);
  const collectionAssignedTrailCount = [...overview.collections.values()]
    .reduce((total, collection) => total + collection.count, 0);
  const standaloneAreaTrailCount = [...overview.areas.values()]
    .filter((area) => !overview.memberAreaIds.has(area.id))
    .reduce((total, area) => total + area.count, 0);
  const namedAssignedTrailCount = standaloneAreaTrailCount + collectionAssignedTrailCount;
  const usesCollections = Number.isInteger(manifest.counts.namedAssignedTrails);
  const totalsMatch = usesCollections
    ? areaAssignedTrailCount === manifest.counts.areaAssignedTrails &&
      collectionAssignedTrailCount === manifest.counts.collectionAssignedTrails &&
      namedAssignedTrailCount === manifest.counts.namedAssignedTrails &&
      namedAssignedTrailCount + unassignedTrailCount === indexedTrailCount
    : areaAssignedTrailCount === manifest.counts.areaAssignedTrails &&
      areaAssignedTrailCount + unassignedTrailCount === indexedTrailCount;
  if (indexedTrailCount !== manifest.counts.trails || !totalsMatch) {
    throw new Error("The riding-area overview trail totals do not match its manifest.");
  }
  state.overviewGroups = overview.groups;
  state.ridingAreas = overview.areas;
  state.ridingCollections = overview.collections;
  state.ridingTargets = new Map([
    ...state.ridingAreas,
    ...state.ridingCollections,
  ]);
  try {
    const voyagerResult = await voyagerReleasePromise;
    if (voyagerResult.error) throw voyagerResult.error;
    const { release } = voyagerResult;
    validateVoyagerCoverage(release, overview, manifest);
    state.voyagerRepository = voyagerRepository;
    state.voyagerManifest = release.manifest;
    state.voyagerPacks = release.packs;
    state.voyagerAddon = release.addon;
    configureContextDownload();
  } catch (error) {
    state.voyagerReleaseError = error?.message || "Prebuilt GPX downloads are unavailable.";
  }
  map.setOverview([...state.overviewGroups.values()], contextDocument);
  map.setAreas(
    [...state.ridingAreas.values()],
    [...state.ridingCollections.values()],
  );
  map.setSelected(state.selected);
  map.setSelectedArea(null);
  renderPackSummary();

  if (CURATION_ENABLED) await initializeTrailCuration();

  requestAnimationFrame(() => {
    if (!manifest.initialView) map.fitBounds(manifest.bounds);
    setMapMode("pan");
    queueViewportGroups({
      bounds: map.getViewBounds(),
      zoom: initialZoom ?? AUTO_GROUP_LOAD_MIN_ZOOM,
    });
  });
  elements.workspace.removeAttribute("aria-busy");
  if (CURATION_ENABLED && state.curator) {
    setStatus("Local curation mode ready · changes stay in this browser until exported.");
  } else {
    const releaseError = Boolean(state.voyagerReleaseError);
    setStatus(releaseError
      ? `Map ready · ${state.voyagerReleaseError}`
      : narrowViewport
        ? "Tap a riding-area name to download its GPX."
        : "Choose a riding area to download its GPX.", releaseError, narrowViewport && !releaseError);
  }
}

function validateManifest(manifest) {
  if (manifest?.version !== 2 || manifest?.scope !== "internal-canonical") {
    throw new Error("This folder does not contain a supported internal-canonical web-map index.");
  }
  const hasCollectionCounts = manifest.counts?.namedAssignedTrails !== undefined ||
    manifest.counts?.collectionAssignedTrails !== undefined;
  if (
    !isValidBounds(manifest.bounds) || !manifest.overviewFile || !manifest.contextFile ||
    !Number.isInteger(manifest.counts?.trails) || manifest.counts.trails < 1 ||
    !Number.isInteger(manifest.counts?.areaAssignedTrails) ||
    manifest.counts.areaAssignedTrails < 0 ||
    manifest.counts.areaAssignedTrails > manifest.counts.trails ||
    (hasCollectionCounts && (
      !Number.isInteger(manifest.counts.collectionAssignedTrails) ||
      manifest.counts.collectionAssignedTrails < 0 ||
      manifest.counts.collectionAssignedTrails > manifest.counts.trails ||
      !Number.isInteger(manifest.counts.namedAssignedTrails) ||
      manifest.counts.namedAssignedTrails < 0 ||
      manifest.counts.namedAssignedTrails > manifest.counts.trails
    ))
  ) {
    throw new Error("The trail database web-map manifest is incomplete.");
  }
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function validateVoyagerPackRecord(record, repository, expectedPrefix) {
  if (
    !record || typeof record.id !== "string" || !record.id ||
    typeof record.name !== "string" || !record.name ||
    !["riding-area", "collection-remainder"].includes(record.kind) ||
    !Number.isInteger(record.sourceTrailCount) || record.sourceTrailCount < 1 ||
    !isNonNegativeInteger(record.trackCount) || !isNonNegativeInteger(record.trackPointCount) ||
    !isNonNegativeInteger(record.routeCount) || !isNonNegativeInteger(record.routePointCount) ||
    typeof record.gpx?.file !== "string" || !record.gpx.file.startsWith(expectedPrefix) ||
    !record.gpx.file.toLowerCase().endsWith(".gpx") ||
    !Number.isInteger(record.gpx.bytes) || record.gpx.bytes < 1 ||
    typeof record.gpx.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(record.gpx.sha256)
  ) {
    throw new Error("The Voyager release contains an invalid pack record.");
  }
  repository.resolveUrl(record.gpx.file);
}

async function loadVoyagerRelease(repository, mapManifest) {
  const document = await repository.readJson(VOYAGER_MANIFEST_PATH);
  const source = document?.source;
  const validation = document?.validation;
  if (
    document?.schemaVersion !== 1 ||
    document?.purpose !== "voyager-production-semantic-riding-area-release" ||
    source?.webMapBuildKey !== mapManifest.buildKey ||
    source?.sourceCatalogSha256 !== mapManifest.sourceCatalogSha256 ||
    source?.ridingAreasSha256 !== mapManifest.ridingAreasSha256 ||
    source?.namedAssignedTrailCount !== mapManifest.counts.namedAssignedTrails ||
    source?.sourceFileSnapshotCount !== source.namedAssignedTrailCount ||
    validation?.allCanonicalSourceFilesRehashedAfterBuild !== true ||
    validation?.stateContextRehashedAfterBuild !== true ||
    validation?.allPackOutputsReparsed !== true ||
    validation?.allPacksWithinDeviceLimits !== true ||
    validation?.globalNamesUniqueAfter12Characters !== true ||
    !Array.isArray(document.packs) ||
    document.packs.length !== document.releasePolicy?.semanticTargetCount
  ) {
    throw new Error("The Voyager release does not match this trail map.");
  }

  const packs = new Map();
  for (const record of document.packs) {
    validateVoyagerPackRecord(record, repository, "packs/");
    if (packs.has(record.id)) throw new Error("The Voyager release contains a duplicate pack ID.");
    packs.set(record.id, record);
  }

  const addon = document.addon;
  if (
    !addon || addon.id !== "usa-lower-48-state-context" ||
    addon.kind !== "optional-map-context" ||
    !isNonNegativeInteger(addon.trackCount) || !isNonNegativeInteger(addon.trackPointCount) ||
    addon.routeCount !== 0 || addon.routePointCount !== 0 ||
    typeof addon.gpx?.file !== "string" || !addon.gpx.file.startsWith("addons/") ||
    !addon.gpx.file.toLowerCase().endsWith(".gpx")
  ) {
    throw new Error("The optional Voyager map context is invalid.");
  }
  repository.resolveUrl(addon.gpx.file);
  return { manifest: document, packs, addon };
}

function validateVoyagerCoverage(release, overview, mapManifest) {
  for (const area of overview.areas.values()) {
    const pack = release.packs.get(area.id);
    if (!pack || pack.kind !== "riding-area" || pack.name !== area.name || pack.sourceTrailCount !== area.count) {
      throw new Error(`The Voyager release is missing the verified ${area.name} pack.`);
    }
  }

  const expectedRemainderIds = new Set();
  for (const collection of overview.collections.values()) {
    const memberTrailCount = collection.memberAreaIds.reduce((total, areaId) => {
      const area = overview.areas.get(areaId);
      if (!area) {
        throw new Error(`The ${collection.name} collection references an unknown riding area.`);
      }
      return total + area.count;
    }, 0);
    const remainderTrailCount = collection.count - memberTrailCount;
    if (remainderTrailCount < 0) {
      throw new Error(`The ${collection.name} collection has inconsistent trail totals.`);
    }
    if (!remainderTrailCount) continue;

    const remainderId = `${collection.id}-other`;
    const remainder = release.packs.get(remainderId);
    expectedRemainderIds.add(remainderId);
    if (
      !remainder ||
      remainder.kind !== "collection-remainder" ||
      remainder.name !== `${collection.name} - Other` ||
      remainder.sourceTrailCount !== remainderTrailCount
    ) {
      throw new Error(`The Voyager release is missing the verified ${collection.name} remainder pack.`);
    }
  }

  const remainderPacks = [...release.packs.values()].filter((pack) => pack.kind === "collection-remainder");
  for (const pack of remainderPacks) {
    if (!expectedRemainderIds.has(pack.id)) {
      throw new Error(`The Voyager release contains an unknown collection remainder: ${pack.name}.`);
    }
  }
  if (
    remainderPacks.length !== expectedRemainderIds.size ||
    release.packs.size !== overview.areas.size + expectedRemainderIds.size ||
    mapManifest.counts.namedAssignedTrails !== release.manifest.source.namedAssignedTrailCount
  ) {
    throw new Error("The Voyager release coverage does not match the named riding areas.");
  }
}

function configureContextDownload() {
  if (!state.voyagerRepository || !state.voyagerAddon) return;
  elements.contextDownload.href = state.voyagerRepository.resolveUrl(state.voyagerAddon.gpx.file);
  elements.contextDownload.download = state.voyagerAddon.gpx.file.split("/").at(-1);
  elements.contextDownload.hidden = false;
  elements.contextWarning.hidden = false;
  elements.contextDownload.textContent =
    `Download optional USA map context · ${formatNumber(state.voyagerAddon.trackCount)} tracks`;
  const collection = [...state.ridingCollections.values()][0];
  if (collection) {
    elements.collectionOpen.dataset.collectionId = collection.id;
    elements.collectionOpen.textContent = `Browse ${collection.name} packs`;
    elements.collectionOpen.hidden = false;
  }
}

function boxesIntersect(left, right) {
  return left[0] <= right[2] && left[2] >= right[0] &&
    left[1] <= right[3] && left[3] >= right[1];
}

function groupsIntersectingBounds(bounds) {
  return [...state.overviewGroups.values()].filter((group) => boxesIntersect(group.bounds, bounds));
}

async function ensureGroupLoaded(groupId) {
  if (state.loadedGroups.has(groupId)) return;
  const pending = state.groupPromises.get(groupId);
  if (pending) return pending;
  const group = state.overviewGroups.get(groupId);
  if (!group || !state.repository) throw new Error("That riding area is not available.");

  const promise = (async () => {
    const document = await state.repository.readJson(group.file);
    validateChunk(document, groupId);
    const catalog = normalizeChunkCatalog(document, groupId);
    const preview = normalizePreview(document.trails, document.precision);
    if (catalog.size !== group.count || preview.size !== group.count) {
      throw new Error(`Trail data for ${groupId} does not match the riding-area index.`);
    }
    for (const id of catalog.keys()) {
      if (!preview.has(id) || state.catalog.has(id)) {
        throw new Error(`Trail data for ${groupId} contains an invalid trail ID.`);
      }
    }
    for (const [id, metadata] of catalog) state.catalog.set(id, metadata);
    map.addDataChunk(groupId, catalog, preview);
    state.loadedGroups.add(groupId);
  })();

  state.groupPromises.set(groupId, promise);
  try {
    await promise;
  } finally {
    if (state.groupPromises.get(groupId) === promise) state.groupPromises.delete(groupId);
  }
}

async function loadViewportGroups(bounds) {
  const groups = groupsIntersectingBounds(bounds)
    .filter((group) => !state.loadedGroups.has(group.id));
  await loadGroups(groups.map((group) => group.id));
}

async function loadGroups(groupIds) {
  const pendingIds = [...new Set(groupIds)].filter((groupId) => !state.loadedGroups.has(groupId));
  for (let index = 0; index < pendingIds.length; index += 4) {
    const batch = pendingIds.slice(index, index + 4);
    const results = await Promise.allSettled(batch.map((groupId) => ensureGroupLoaded(groupId)));
    const failure = results.find((result) => result.status === "rejected");
    if (failure) throw failure.reason;
  }
}

async function ensureAllOverviewGroupsLoaded() {
  await loadGroups([...state.overviewGroups.keys()]);
  const expected = state.manifest?.counts?.trails;
  if (Number.isInteger(expected) && state.catalog.size !== expected) {
    throw new Error(
      `The local curator loaded ${formatNumber(state.catalog.size)} of ` +
      `${formatNumber(expected)} indexed trails.`,
    );
  }
  return state.catalog;
}

function setCurationMapSelection(ids) {
  const nextSelected = new Set();
  for (const id of ids || []) {
    const normalizedId = String(id);
    if (state.catalog.has(normalizedId)) nextSelected.add(normalizedId);
  }

  state.selected = nextSelected;
  state.selectionBounds = boundsForTrailIds(nextSelected);
  state.selectionKind = nextSelected.size ? "curation" : null;
  state.selectionName = nextSelected.size ? "Curation selection" : null;
  state.selectedAreaId = null;
  map.setSelected(state.selected);
  map.setSelectedArea(null);
  renderPackSummary();
}

function setCuratorAssignments(assignments, displayState = {}) {
  const normalizedAssignments = assignments instanceof Map
    ? assignments
    : new Map(assignments || []);
  const areas = Array.isArray(displayState.areas)
    ? displayState.areas
    : [...state.ridingAreas.values()];
  const hiddenCoverageAreaIds = new Set(displayState.hiddenCoverageAreaIds || []);

  // The curator represents provisional and named groups uniformly as semantic
  // areas. An empty coverage-area list therefore suppresses the raw fallback
  // circles without resetting the map or reloading its geometry.
  if (Array.isArray(displayState.coverageAreas) && displayState.coverageAreas.length === 0) {
    for (const groupId of state.overviewGroups.keys()) hiddenCoverageAreaIds.add(groupId);
  }

  state.curatorAreas = new Map(areas.map((area) => [String(area.id), area]));
  state.activeAreaId = displayState.activeGroupId ?? null;
  state.activeGroupId = null;
  state.selectedAreaId = null;
  map.setTrailAreaAssignments(normalizedAssignments);
  map.setAreas(areas, []);
  map.setCoverageAreas(Array.isArray(displayState.coverageAreas) ? displayState.coverageAreas : []);
  map.setHiddenTrailIds(displayState.hiddenTrailIds || []);
  map.setHiddenAreaIds(displayState.hiddenAreaIds || []);
  map.setHiddenCoverageAreaIds(hiddenCoverageAreaIds);
  map.setSelectedArea(null);
  map.setActiveGroup(null);
  map.setActiveArea(state.activeAreaId);
  syncAreaLabelStates();
}

function createTrailCuratorHost() {
  const curationElements = Object.fromEntries(
    Object.entries(elements).filter(([name]) => name.startsWith("curation")),
  );

  return {
    get manifest() {
      return state.manifest;
    },
    get areas() {
      return state.ridingAreas;
    },
    get collections() {
      return state.ridingCollections;
    },
    get overviewGroups() {
      return state.overviewGroups;
    },
    get catalog() {
      return state.catalog;
    },
    get selectedTrailIds() {
      return new Set(state.selected);
    },
    get viewBounds() {
      return map.getViewBounds();
    },
    get mapState() {
      return {
        bounds: map.getViewBounds(),
        mode: map.mode,
        zoom: map.zoom,
      };
    },
    curationElements,
    ensureAllGroupsLoaded: ensureAllOverviewGroupsLoaded,
    getTrailIdsIntersectingBounds: async (bounds) => {
      await ensureAllOverviewGroupsLoaded();
      return map.getTrailIdsIntersectingBounds(bounds, {
        limit: state.manifest?.counts?.trails || Infinity,
      });
    },
    getTrailMetadata: (trailId) => state.catalog.get(String(trailId)) || null,
    boundsForTrailIds: (ids) => boundsForTrailIds(ids),
    setCuratorAssignments,
    setMapSelection: setCurationMapSelection,
    fitBounds: (bounds) => map.fitBounds(bounds),
    clearMapSelection: () => setCurationMapSelection([]),
    setStatus: (message, error = false) => setStatus(message, error),
  };
}

async function initializeTrailCuration() {
  if (!CURATION_ENABLED || state.curator) return;
  setStatus(
    `Loading ${formatNumber(state.manifest?.counts?.trails)} trails for local curation…`,
    false,
    true,
  );
  await ensureAllOverviewGroupsLoaded();

  let curator = null;
  try {
    if (!elements.curation || !elements.curationTitle) {
      throw new Error("The local grouping-board controls are missing from this page.");
    }
    document.body.classList.add("is-curation-mode");
    elements.curation.hidden = false;
    elements.curationTitle.textContent = "Local grouping board";
    document.title = "Local Trail Grouping Board | Bob’s App";

    // Keep the public bundle path cold unless a loopback user explicitly opts in.
    const module = await import("./trail-curator.js");
    if (typeof module.createTrailCurator !== "function") {
      throw new Error("The local trail curator module does not expose createTrailCurator().");
    }

    curator = module.createTrailCurator(createTrailCuratorHost());
    if (!curator || typeof curator.initialize !== "function") {
      throw new Error("The local trail curator did not return a valid controller.");
    }
    state.curator = curator;
    await curator.initialize();
  } catch (error) {
    state.curator = null;
    curator?.destroy?.();
    document.body.classList.remove("is-curation-mode");
    if (elements.curation) elements.curation.hidden = true;
    if (elements.curationTitle) elements.curationTitle.textContent = "Grouping board";
    document.title = state.publicDocumentTitle;
    throw error;
  }
  renderPackSummary();
}

function queueViewportGroups(view) {
  if (!view?.bounds || view.zoom < AUTO_GROUP_LOAD_MIN_ZOOM || !state.overviewGroups.size) return;
  window.clearTimeout(state.viewportLoadTimer);
  state.viewportLoadTimer = window.setTimeout(() => {
    loadViewportGroups(view.bounds).catch((error) => {
      setStatus(error?.message || "Unable to load trails for this map view.", true);
    });
  }, 80);
}

function resolveArea(areaOrId) {
  const id = typeof areaOrId === "string" ? areaOrId : areaOrId?.id;
  return id ? state.ridingTargets.get(id) : null;
}

function voyagerPacksForCollection(collection) {
  if (!collection?.memberAreaIds) return [];
  const packs = collection.memberAreaIds
    .map((areaId) => state.voyagerPacks.get(areaId))
    .filter(Boolean);
  const remainder = state.voyagerPacks.get(`${collection.id}-other`);
  if (remainder) packs.push(remainder);
  return packs;
}

function autoFitAreaSelections() {
  return elements.autoFitAreas?.checked !== false;
}

function fitAreaSelection(bounds) {
  // Labels and all overview-circle paths share this setting so selection never
  // moves the map through one entry point but stays put through another.
  if (autoFitAreaSelections()) map.easeToBounds(bounds);
}

function selectCollection(collection) {
  state.areaRequestToken += 1;
  state.selected.clear();
  state.selectionBounds = [...collection.viewBounds];
  state.selectionKind = "collection";
  state.selectionName = collection.name;
  state.selectedAreaId = collection.id;
  state.activeAreaId = collection.id;
  state.activeGroupId = null;
  map.setSelected(state.selected);
  map.setSelectedArea(collection.id);
  map.setActiveArea(collection.id);
  map.setActiveGroup(null);
  renderPackSummary();
  fitAreaSelection(collection.viewBounds);
  const packCount = voyagerPacksForCollection(collection).length;
  setStatus(packCount
    ? `${collection.name} is split into ${formatNumber(packCount)} GPX files.`
    : state.voyagerReleaseError || `${collection.name} downloads are unavailable.`, !packCount);
}

async function peekArea(areaOrId) {
  const area = resolveArea(areaOrId);
  if (!area || state.selecting) return;
  const requestToken = ++state.areaRequestToken;
  state.activeAreaId = area.id;
  state.activeGroupId = null;
  map.setActiveGroup(null);
  map.setActiveArea(area.id);
  syncAreaLabelStates();
  setStatus(`Opening ${formatNumber(area.count)} trails in ${area.name}…`);
  try {
    await loadGroups(area.groupIds);
    if (requestToken !== state.areaRequestToken) return;
    setStatus(`${area.name} is open · Tap its circle again to select it.`);
  } catch (error) {
    if (requestToken !== state.areaRequestToken) return;
    state.activeAreaId = null;
    map.setActiveArea(null);
    syncAreaLabelStates();
    setStatus(error?.message || `Unable to open ${area.name}.`, true);
  }
}

async function selectArea(areaOrId) {
  const area = resolveArea(areaOrId);
  if (!area || state.selecting) return;
  if (area.memberAreaIds) {
    selectCollection(area);
    return;
  }
  const requestToken = ++state.areaRequestToken;
  state.selecting = true;
  state.activeAreaId = area.id;
  map.setActiveGroup(null);
  map.setActiveArea(area.id);
  syncAreaLabelStates();
  renderPackSummary();
  setStatus(`Selecting ${area.name}…`, false, true);
  try {
    await loadGroups(area.groupIds);
    if (requestToken !== state.areaRequestToken) return;
    const ids = [...state.catalog.values()]
      .filter((metadata) => metadata.areaId === area.id)
      .map((metadata) => metadata.id);
    if (ids.length !== area.count) {
      throw new Error(`${area.name} did not load all of its indexed trails.`);
    }
    applyAreaSelection(ids, area);
    fitAreaSelection(area.viewBounds);
  } catch (error) {
    if (requestToken === state.areaRequestToken) {
      setStatus(error?.message || `Unable to select ${area.name}.`, true);
    }
  } finally {
    if (requestToken === state.areaRequestToken) {
      state.selecting = false;
      renderPackSummary();
    }
  }
}

function selectAreaFromLabel(areaOrId) {
  const area = resolveArea(areaOrId);
  if (!area || state.selecting) return;
  if (state.selectedAreaId === area.id) {
    clearPack();
    setStatus(`${area.name} selection cleared · Choose its label to select it again.`);
    return;
  }
  void selectArea(area.id);
}

function zoomMapFromAreaLabel(event) {
  event.preventDefault();
  event.stopPropagation();
  if (!event.deltaY) return;
  const rectangle = elements.canvas.getBoundingClientRect();
  map.zoomBy(
    event.deltaY < 0 ? 0.5 : -0.5,
    event.clientX - rectangle.left,
    event.clientY - rectangle.top,
  );
}

function boundsForTrailIds(ids) {
  let bounds = null;
  for (const id of ids) {
    const metadata = state.catalog.get(id);
    if (!metadata?.bbox) continue;
    if (!bounds) {
      bounds = [...metadata.bbox];
      continue;
    }
    bounds[0] = Math.min(bounds[0], metadata.bbox[0]);
    bounds[1] = Math.min(bounds[1], metadata.bbox[1]);
    bounds[2] = Math.max(bounds[2], metadata.bbox[2]);
    bounds[3] = Math.max(bounds[3], metadata.bbox[3]);
  }
  return bounds;
}

function applyAreaSelection(ids, area) {
  const nextIds = [...new Set(ids)].filter((id) => state.catalog.has(id));
  if (!nextIds.length) {
    setStatus(`No trails are available for ${area.name}.`, true);
    return;
  }

  state.selected = new Set(nextIds);
  state.selectionBounds = [...area.viewBounds];
  state.selectionKind = "area";
  state.selectionName = area.name;
  state.selectedAreaId = area.id;
  state.activeAreaId = area.id;
  state.activeGroupId = null;
  map.setSelected(state.selected);
  map.setSelectedArea(area.id);
  map.setActiveArea(area.id);
  map.setActiveGroup(null);
  renderPackSummary();
  setStatus(`${area.name} is ready to download.`);
}

function currentVoyagerPack() {
  if (state.selectionKind !== "area" || !state.selectedAreaId) return null;
  return state.voyagerPacks.get(state.selectedAreaId) || null;
}

function voyagerPathSummary(pack) {
  if (!pack) return "";
  const tracks = `${formatNumber(pack.trackCount)} track${pack.trackCount === 1 ? "" : "s"}`;
  const routes = pack.routeCount
    ? ` + ${formatNumber(pack.routeCount)} route${pack.routeCount === 1 ? "" : "s"}`
    : "";
  const points = pack.trackPointCount + pack.routePointCount;
  return `${tracks}${routes} · ${formatNumber(points)} points · 0 waypoints`;
}

function renderCollectionPackLinks(collection) {
  elements.collectionPackList.replaceChildren();
  if (!collection || !state.voyagerRepository) {
    elements.collectionPackList.hidden = true;
    return;
  }
  const packs = voyagerPacksForCollection(collection);
  for (const pack of packs) {
    const link = document.createElement("a");
    link.className = "collection-pack-link";
    link.href = state.voyagerRepository.resolveUrl(pack.gpx.file);
    link.download = pack.gpx.file.split("/").at(-1);
    link.setAttribute(
      "aria-label",
      `Download the GPX file for ${pack.name}${pack.routeCount ? "; this file uses routes" : ""}`,
    );
    link.addEventListener("click", () => {
      setStatus(
        `Started the ${pack.name} GPX download.` +
        (pack.routeCount ? " This file contains routes as well as tracks." : ""),
      );
    });

    const name = document.createElement("span");
    name.textContent = pack.name;
    const count = document.createElement("span");
    count.className = "collection-pack-count";
    count.textContent = `${formatNumber(pack.sourceTrailCount)} trails${pack.routeCount ? " · uses routes" : ""}`;
    link.append(name, count);
    elements.collectionPackList.append(link);
  }
  elements.collectionPackList.hidden = !packs.length;
}

function renderPackSummary() {
  if (CURATION_ENABLED) {
    elements.workspace.classList.remove("has-selection");
    elements.selectionPanel.removeAttribute("aria-busy");
    elements.selectionPanel.hidden = true;
    return;
  }

  const metadataList = [...state.selected].map((id) => state.catalog.get(id)).filter(Boolean);
  const count = metadataList.length;
  const lengthM = metadataList.reduce((sum, metadata) => sum + metadata.lengthM, 0);
  const busy = state.selecting;
  const collection = state.selectionKind === "collection"
    ? state.ridingCollections.get(state.selectedAreaId)
    : null;
  const voyagerPack = currentVoyagerPack();
  const hasPanel = Boolean(count || collection);
  const collectionPackCount = collection ? voyagerPacksForCollection(collection).length : 0;

  elements.workspace.classList.toggle("has-selection", hasPanel);
  elements.selectionPanel.toggleAttribute("aria-busy", busy);
  elements.selectionPanel.hidden = !hasPanel;
  elements.selectionTitle.textContent = collection
    ? collection.name
    : state.selectionName;
  elements.selectionKindLabel.textContent = collection
    ? "Riding-area collection"
    : "Riding area";
  elements.selectionPrimary.textContent = collection
    ? `${formatNumber(collectionPackCount)} GPX file${collectionPackCount === 1 ? "" : "s"}`
    : count
      ? `${formatNumber(count)} trail${count === 1 ? "" : "s"} · ${formatDistance(lengthM)}`
      : "";
  elements.selectionDetails.textContent = voyagerPack
    ? voyagerPathSummary(voyagerPack)
    : "";
  elements.packRule.textContent = collection
    ? collectionPackCount
      ? "Choose the part of this larger riding area you want to download."
      : state.voyagerReleaseError || "Prebuilt GPX downloads are unavailable."
    : voyagerPack
      ? "Download the selected GPX ride area for your motorcycle GPS device."
      : state.voyagerReleaseError || "The prebuilt GPX for this area is unavailable.";

  renderCollectionPackLinks(collection);
  elements.download.hidden = Boolean(collection);
  elements.selectionDetails.hidden = Boolean(collection);
  elements.download.textContent = voyagerPack
    ? "Download GPX"
    : count
      ? "GPX unavailable"
      : "Download GPX";
  elements.download.disabled = !count || busy || !voyagerPack;
  elements.clear.disabled = !hasPanel || busy;
  elements.download.setAttribute(
    "aria-label",
    voyagerPack
      ? `Download ${voyagerPack.name} as a GPX file`
      : "GPX unavailable",
  );
  syncAreaLabelStates();
}

function downloadVoyagerPack(pack) {
  if (!state.voyagerRepository) throw new Error("Prebuilt GPX downloads are unavailable.");
  const anchor = document.createElement("a");
  anchor.href = state.voyagerRepository.resolveUrl(pack.gpx.file);
  anchor.download = pack.gpx.file.split("/").at(-1);
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

function downloadSelectedPack() {
  if (!state.selected.size || state.selecting) return;
  const voyagerPack = currentVoyagerPack();
  if (!voyagerPack) {
    setStatus(state.voyagerReleaseError || "The prebuilt GPX for this area is unavailable.", true);
    return;
  }
  try {
    downloadVoyagerPack(voyagerPack);
    setStatus(
      `Started the ${voyagerPack.name} GPX download.` +
      (voyagerPack.routeCount ? " This file contains routes as well as tracks." : ""),
    );
  } catch (error) {
    setStatus(error?.message || "Unable to download the GPX file.", true);
  }
}

function resetPackSelection() {
  state.areaRequestToken += 1;
  state.selected.clear();
  state.selectionBounds = null;
  state.selectionKind = null;
  state.selectionName = null;
  state.selectedAreaId = null;
  state.activeAreaId = null;
  state.activeGroupId = null;
  map.setSelected(state.selected);
  map.setSelectedArea(null);
  map.setActiveArea(null);
  map.setActiveGroup(null);
  renderPackSummary();
}

function clearPack() {
  const selectionName = state.selectionName;
  resetPackSelection();
  setStatus(selectionName ? `${selectionName} selection cleared.` : "Selection cleared.");
}

function beginCurationSelection() {
  if (!CURATION_ENABLED) return;
  if (state.selecting) {
    setStatus("Finish checking the current area before changing the selection.");
    return;
  }
  setMapMode("box");
  setStatus("Click a trail to toggle it, drag a box to toggle a group, or click empty map to clear · Escape cancels.");
  elements.canvas.focus({ preventScroll: true });
}

function activateMapShortcutTool(mode) {
  if (mode === "box") {
    beginCurationSelection();
    return;
  }
  if (mode !== "zoom") return;
  setMapMode("zoom");
  setStatus("Zoom tool · Click to zoom in; hold Alt to zoom out.");
}

function fitAllTrails() {
  if (!state.manifest?.bounds) return;
  map.fitBounds(state.manifest.bounds);
  setStatus("Fit all trails to the map.");
}

function fitSelectedTrails() {
  if (!state.selected.size && !state.selectionBounds) {
    setStatus(CURATION_ENABLED
      ? "Select trails before fitting the current selection."
      : "Choose a riding area before fitting it.");
    return;
  }
  const bounds = state.selectionBounds || boundsForTrailIds(state.selected);
  if (!bounds) return;
  map.fitBounds(bounds);
  setStatus(CURATION_ENABLED
    ? `Fit ${formatNumber(state.selected.size)} selected trail${state.selected.size === 1 ? "" : "s"} to the map.`
    : `Fit ${state.selectionName} to the map.`);
}

function setMapMode(mode) {
  const mapMode = mode === "box" || mode === "zoom" ? mode : "pan";
  const panMode = mapMode === "pan";
  const boxMode = mapMode === "box";
  map.setMode(mapMode);
  elements.panTool.classList.toggle("is-active", panMode);
  elements.panTool.setAttribute("aria-pressed", String(panMode));
  elements.boxTool.classList.toggle("is-active", boxMode);
  elements.boxTool.setAttribute("aria-pressed", String(boxMode));
}

async function initializeBasemap(repository) {
  const override = urlParameters.get("basemap");
  if (override === "off") {
    updateBasemapAvailability("paper");
    return;
  }
  const relativePath = override || DEFAULT_BASEMAP_PATH;
  try {
    await map.setBasemapUrl(repository.resolveUrl(relativePath));
  } catch (error) {
    updateBasemapAvailability(error?.code || "unavailable");
  }
}

function updateBasemapAvailability(status) {
  if (status === "available" || status === "loading") {
    return;
  }
  if (status === "ARCHIVE_MISSING" || status === "missing") {
    setStatus("Pirate map pending; paper context is active.");
  } else if (status === "RANGE_REQUIRED" || status === "range-required") {
    setStatus("Pirate map needs a byte-range server; paper context is active.", true);
  } else if (status === "unavailable") {
    setStatus("Pirate map unavailable; paper context is active.", true);
  } else if (status === "paper") {
    setStatus(CURATION_ENABLED
      ? "Paper map active · Pan to explore, then choose Select."
      : "Paper map active · Pan to explore riding areas.");
  }
}

function setStatus(message, error = false, persistent = false) {
  window.clearTimeout(state.statusTimer);
  elements.status.textContent = message;
  elements.status.classList.toggle("is-error", error);
  elements.status.classList.remove("is-hidden");
  if (persistent) return;
  state.statusTimer = window.setTimeout(() => {
    elements.status.classList.add("is-hidden");
  }, error ? 8000 : 4800);
}

function renderAreaLabels(placements = []) {
  const visibleIds = new Set();
  for (const placement of placements) {
    const areaId = placement?.id || placement?.area?.id;
    const area = CURATION_ENABLED && state.curator
      ? state.curatorAreas.get(areaId)
      : state.ridingAreas.get(areaId);
    if (!area || placement.visible === false) continue;
    visibleIds.add(area.id);
    let button = state.areaLabelButtons.get(area.id);
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "trail-area-label";
      button.dataset.areaId = area.id;
      button.textContent = area.name;
      button.addEventListener("click", (event) => {
        const curatorHandler = CURATION_ENABLED ? state.curator?.selectGroup : null;
        if (typeof curatorHandler === "function") {
          curatorHandler.call(state.curator, area.id, { additive: event.shiftKey });
          return;
        }
        if (!CURATION_ENABLED) selectAreaFromLabel(area.id);
      });
      button.addEventListener("wheel", zoomMapFromAreaLabel, { passive: false });
      elements.areaLabels.append(button);
      state.areaLabelButtons.set(area.id, button);
    }
    button.textContent = area.name;
    button.hidden = false;
    button.style.left = `${placement.x}px`;
    button.style.top = `${placement.y}px`;
    button.style.width = `${placement.width}px`;
    button.style.height = `${placement.height}px`;
    button.dataset.side = placement.side;
    button.dataset.anchorX = placement.anchorX;
    button.dataset.anchorY = placement.anchorY;
    button.setAttribute(
      "aria-label",
      `Select the complete ${area.name} riding area, ${formatNumber(area.count)} trails`,
    );
  }
  for (const [areaId, button] of state.areaLabelButtons) {
    button.hidden = !visibleIds.has(areaId);
  }
  syncAreaLabelStates();
}

function renderTrailTooltip(hover) {
  const tooltip = elements.trackTooltip;
  const metadata = hover?.id ? state.catalog.get(String(hover.id)) : null;
  const name = String(metadata?.name || "").trim();
  if (!tooltip || !CURATION_ENABLED || !name) {
    if (tooltip) {
      tooltip.hidden = true;
      tooltip.textContent = "";
    }
    return;
  }

  tooltip.textContent = name;
  tooltip.hidden = false;
  const padding = 8;
  const offset = 14;
  let left = hover.x + offset;
  let top = hover.y + offset;
  if (left + tooltip.offsetWidth > elements.canvas.clientWidth - padding) {
    left = hover.x - tooltip.offsetWidth - offset;
  }
  if (top + tooltip.offsetHeight > elements.canvas.clientHeight - padding) {
    top = hover.y - tooltip.offsetHeight - offset;
  }
  tooltip.style.left = `${Math.max(padding, left)}px`;
  tooltip.style.top = `${Math.max(padding, top)}px`;
}

function syncAreaLabelStates() {
  for (const [areaId, button] of state.areaLabelButtons) {
    button.classList.toggle("is-active", state.activeAreaId === areaId);
    button.classList.toggle("is-selected", state.selectedAreaId === areaId);
    button.setAttribute("aria-pressed", String(state.selectedAreaId === areaId));
  }
}

function formatDistance(meters) {
  const miles = meters / 1609.344;
  const display = miles >= 100
    ? formatNumber(Math.round(miles))
    : miles.toFixed(miles >= 10 ? 1 : 2);
  return `${display} mi`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

function openQuickStart() {
  if (elements.helpDialog.open || quickStartOpenTimer) return;
  elements.helpButton.classList.add("is-open");

  const showDialog = () => {
    if (!quickStartOpenTimer || elements.helpDialog.open) return;
    window.clearTimeout(quickStartOpenTimer);
    quickStartOpenTimer = 0;
    elements.helpButton.setAttribute("aria-expanded", "true");
    elements.helpDialog.showModal();
    requestAnimationFrame(() => elements.helpClose.focus({ preventScroll: true }));
  };

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    quickStartOpenTimer = window.setTimeout(showDialog, 0);
    return;
  }

  elements.helpButton
    .querySelector(".trail-compass-arrow")
    .addEventListener("transitionend", showDialog, { once: true });
  quickStartOpenTimer = window.setTimeout(showDialog, 650);
}

function resetQuickStartCompass() {
  elements.helpButton.classList.remove("is-open");
  elements.helpButton.setAttribute("aria-expanded", "false");
  elements.helpButton.focus({ preventScroll: true });
}

elements.panTool.addEventListener("click", () => {
  setMapMode("pan");
  setStatus(CURATION_ENABLED
    ? "Pan the map. Choose Select when you want to edit the grouping."
    : "Pan the map to find a riding area.");
});
elements.boxTool.addEventListener("click", beginCurationSelection);
elements.autoFitAreas.addEventListener("change", () => {
  setStatus(elements.autoFitAreas.checked
    ? "Auto-fit on · Riding-area selections will fit the map."
    : "Auto-fit off · Riding-area selections will keep the current map view.");
});
elements.zoomIn.addEventListener("click", () => map.zoomBy(0.5));
elements.zoomOut.addEventListener("click", () => map.zoomBy(-0.5));
elements.fitTrails.addEventListener("click", () => {
  if (state.selectionBounds) fitSelectedTrails();
  else fitAllTrails();
});
elements.download.addEventListener("click", downloadSelectedPack);
elements.contextDownload.addEventListener("click", () => {
  setStatus("Started the optional USA map-context GPX download.");
});
elements.collectionOpen.addEventListener("click", () => {
  const collection = state.ridingCollections.get(elements.collectionOpen.dataset.collectionId);
  if (!collection) return;
  elements.helpDialog.close("collection");
  selectCollection(collection);
  requestAnimationFrame(() => elements.collectionPackList.querySelector("a")?.focus({ preventScroll: true }));
});
elements.clear.addEventListener("click", clearPack);
elements.helpButton.addEventListener("click", openQuickStart);
elements.helpButton.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  openQuickStart();
});
elements.helpDialog.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  event.preventDefault();
  elements.helpDialog.close("cancel");
});
elements.helpDialog.addEventListener("close", resetQuickStartCompass);

renderPackSummary();
const localDataUrl = urlParameters.get("data") || DEFAULT_RUNTIME_MAP_PATH;
const voyagerReleaseUrl = urlParameters.get("release") || DEFAULT_RUNTIME_RELEASE_PATH;
try {
  const repository = new SameOriginRepository(localDataUrl);
  const voyagerRepository = new SameOriginRepository(voyagerReleaseUrl);
  loadRepository(repository, voyagerRepository).catch((error) => {
    elements.workspace.removeAttribute("aria-busy");
    setStatus(
      error?.message || "Unable to load local trail data. Mount local-data and reload the page.",
      true,
      true,
    );
  });
} catch (error) {
  setStatus(error?.message || "Unable to load the local trail data.", true);
}
