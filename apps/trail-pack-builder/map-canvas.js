import { PmtilesBasemap } from "./pmtiles-basemap.js";

const MAX_MERCATOR_LAT = 85.05112878;
const OVERVIEW_MAX_ZOOM = 6;
const FULL_DETAIL_MIN_ZOOM = 7.5;
const AREA_LABEL_MIN_ZOOM = OVERVIEW_MAX_ZOOM;
const AREA_SINGLE_CLICK_DELAY_MS = 240;
const AREA_DOUBLE_CLICK_WINDOW_MS = 320;
const AREA_DOUBLE_CLICK_DISTANCE_PX = 12;
const AREA_LABEL_HEIGHT_PX = 24;
const AREA_LABEL_MOBILE_HEIGHT_PX = 44;
const AREA_LABEL_GAP_PX = 6;
const WEB_MERCATOR_CIRCUMFERENCE_METERS = 40075016.68557849;
const COARSE_TOLERANCE_WORLD = 500 / WEB_MERCATOR_CIRCUMFERENCE_METERS;
const TRAIL_INDEX_ZOOM = 9;

const ORNAMENTS = [
  {
    url: new URL("./assets/galleon-symbol.png", import.meta.url).href,
    coordinate: [-68, 28],
  },
  {
    url: new URL("./assets/serpent-symbol.png", import.meta.url).href,
    coordinate: [-132, 39.5],
  },
];

const ORNAMENT_WIDTH_STOPS = [
  [2, 34],
  [3, 58],
  [4, 92],
  [5, 130],
  [6, 165],
  [6.5, 180],
];

const ORNAMENT_OPACITY_STOPS = [
  [2, 0],
  [2.4, 0.28],
  [3.5, 0.48],
  [4.5, 0.55],
  [5.5, 0.38],
  [6.25, 0.14],
  [6.5, 0],
];

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function interpolateStops(value, stops) {
  if (value <= stops[0][0]) return stops[0][1];
  for (let index = 1; index < stops.length; index += 1) {
    const [stopValue, stopResult] = stops[index];
    const [previousValue, previousResult] = stops[index - 1];
    if (value <= stopValue) {
      const progress = (value - previousValue) / (stopValue - previousValue);
      return previousResult + (stopResult - previousResult) * progress;
    }
  }
  return stops.at(-1)[1];
}

function pointSegmentDistanceSquared(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return (px - ax) ** 2 + (py - ay) ** 2;
  const progress = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy), 0, 1);
  const nearestX = ax + progress * dx;
  const nearestY = ay + progress * dy;
  return (px - nearestX) ** 2 + (py - nearestY) ** 2;
}

function simplifyOpenSegment(segment, toleranceSquared) {
  const pointCount = segment.length / 2;
  if (pointCount <= 2) return segment;

  const keep = new Uint8Array(pointCount);
  keep[0] = 1;
  keep[pointCount - 1] = 1;
  const stack = [[0, pointCount - 1]];

  while (stack.length) {
    const [start, end] = stack.pop();
    const ax = segment[start * 2];
    const ay = segment[start * 2 + 1];
    const bx = segment[end * 2];
    const by = segment[end * 2 + 1];
    let farthestIndex = -1;
    let farthestDistance = toleranceSquared;

    for (let index = start + 1; index < end; index += 1) {
      const distance = pointSegmentDistanceSquared(
        segment[index * 2],
        segment[index * 2 + 1],
        ax,
        ay,
        bx,
        by,
      );
      if (distance > farthestDistance) {
        farthestDistance = distance;
        farthestIndex = index;
      }
    }

    if (farthestIndex !== -1) {
      keep[farthestIndex] = 1;
      stack.push([start, farthestIndex], [farthestIndex, end]);
    }
  }

  let keptCount = 0;
  for (const value of keep) keptCount += value;
  const simplified = new Float32Array(keptCount * 2);
  let target = 0;
  for (let index = 0; index < pointCount; index += 1) {
    if (!keep[index]) continue;
    simplified[target] = segment[index * 2];
    simplified[target + 1] = segment[index * 2 + 1];
    target += 2;
  }
  return simplified;
}

function simplifyProjectedSegment(segment, tolerance) {
  if (segment.length <= 4) return segment;
  const last = segment.length - 2;
  const isClosed = segment[0] === segment[last] && segment[1] === segment[last + 1];
  const toleranceSquared = tolerance ** 2;
  if (!isClosed) return simplifyOpenSegment(segment, toleranceSquared);

  let splitOffset = 2;
  let farthestDistance = -1;
  for (let offset = 2; offset < last; offset += 2) {
    const distance = (segment[offset] - segment[0]) ** 2 + (segment[offset + 1] - segment[1]) ** 2;
    if (distance > farthestDistance) {
      farthestDistance = distance;
      splitOffset = offset;
    }
  }

  const firstArc = simplifyOpenSegment(segment.slice(0, splitOffset + 2), toleranceSquared);
  const secondArc = simplifyOpenSegment(segment.slice(splitOffset), toleranceSquared);
  const simplified = new Float32Array(firstArc.length + secondArc.length - 2);
  simplified.set(firstArc);
  simplified.set(secondArc.slice(2), firstArc.length);
  return simplified;
}

export function projectCoordinate(lon, lat) {
  const limitedLat = clamp(lat, -MAX_MERCATOR_LAT, MAX_MERCATOR_LAT);
  const sin = Math.sin((limitedLat * Math.PI) / 180);
  return {
    x: (lon + 180) / 360,
    y: 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI),
  };
}

export function unprojectCoordinate(x, y) {
  return {
    lon: x * 360 - 180,
    lat: (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI,
  };
}

function boxesIntersect(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function pointInBox(x, y, box) {
  return x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3];
}

function direction(ax, ay, bx, by, cx, cy) {
  return (cx - ax) * (by - ay) - (cy - ay) * (bx - ax);
}

function pointOnSegment(point, start, end) {
  const epsilon = 1e-12;
  return Math.abs(direction(start[0], start[1], end[0], end[1], point[0], point[1])) <= epsilon &&
    point[0] >= Math.min(start[0], end[0]) - epsilon &&
    point[0] <= Math.max(start[0], end[0]) + epsilon &&
    point[1] >= Math.min(start[1], end[1]) - epsilon &&
    point[1] <= Math.max(start[1], end[1]) + epsilon;
}

function segmentsIntersect(a, b, c, d) {
  const d1 = direction(c[0], c[1], d[0], d[1], a[0], a[1]);
  const d2 = direction(c[0], c[1], d[0], d[1], b[0], b[1]);
  const d3 = direction(a[0], a[1], b[0], b[1], c[0], c[1]);
  const d4 = direction(a[0], a[1], b[0], b[1], d[0], d[1]);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return pointOnSegment(a, c, d) || pointOnSegment(b, c, d) ||
    pointOnSegment(c, a, b) || pointOnSegment(d, a, b);
}

function segmentIntersectsBox(x1, y1, x2, y2, box) {
  if (pointInBox(x1, y1, box) || pointInBox(x2, y2, box)) return true;
  if (Math.max(x1, x2) < box[0] || Math.min(x1, x2) > box[2]) return false;
  if (Math.max(y1, y2) < box[1] || Math.min(y1, y2) > box[3]) return false;

  const corners = [
    [box[0], box[1]],
    [box[2], box[1]],
    [box[2], box[3]],
    [box[0], box[3]],
  ];
  const start = [x1, y1];
  const end = [x2, y2];
  return corners.some((corner, index) =>
    segmentsIntersect(start, end, corner, corners[(index + 1) % corners.length]),
  );
}

export class TrailMap {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.context2d = canvas.getContext("2d");
    this.callbacks = callbacks;
    this.catalog = new Map();
    this.preview = new Map();
    this.projectedPreview = new Map();
    this.coarseProjectedPreview = new Map();
    this.trailIds = [];
    this.trailOrdinals = new Map();
    this.trailGroups = new Map();
    this.trailAreas = new Map();
    this.trailCollections = new Map();
    this.indexedTrailIds = new Set();
    this.trailSpatialCells = new Map();
    this.trailSpatialMarks = new Uint32Array();
    this.trailSpatialGeneration = 0;
    this.visibleTrailCache = null;
    this.coverageAreas = [];
    this.coverageHitTargets = [];
    this.areas = [];
    this.areaById = new Map();
    this.collections = [];
    this.collectionById = new Map();
    this.overviewAreas = [];
    this.namedTargetById = new Map();
    this.activeGroupId = null;
    this.activeAreaId = null;
    this.selectedAreaId = null;
    this.pendingAreaClick = null;
    this.cameraAnimationFrame = 0;
    this.trailHoverFrame = 0;
    this.pendingTrailHover = null;
    this.hoveredTrailId = null;
    this.lastAreaLabelSignature = null;
    this.hasData = false;
    this.ornaments = ORNAMENTS.map(({ url, coordinate }) => ({
      image: null,
      status: "idle",
      url,
      world: projectCoordinate(coordinate[0], coordinate[1]),
    }));
    this.selected = new Set();
    this.hiddenTrailIds = new Set();
    this.hiddenAreaIds = new Set();
    this.hiddenCoverageAreaIds = new Set();
    this.contextLines = [];
    this.contextCities = [];
    this.basemap = new PmtilesBasemap({
      onChange: () => this.scheduleRender(),
      onAvailabilityChange: (status) => this.callbacks.onBasemapAvailability?.(status),
    });
    this.center = projectCoordinate(-121.6, 45.5);
    this.zoom = 6;
    this.mode = "pan";
    this.spacePanActive = false;
    this.zoomOutModifier = false;
    this.pointer = null;
    this.lastTrailToggle = null;
    this.selectionBox = null;
    this.frameRequested = false;
    this.lastViewportSignature = null;
    this.width = 1;
    this.height = 1;
    this.pixelRatio = 1;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.bindEvents();
  }

  get scale() {
    return 256 * 2 ** this.zoom;
  }

  setData(catalog, preview, contextGeoJson) {
    const groups = this.buildCoverageAreas(catalog);
    this.setOverview(groups, contextGeoJson);
    this.addDataChunk(null, catalog, preview);
  }

  reset() {
    this.clearTrailHover();
    this.catalog = new Map();
    this.preview = new Map();
    this.projectedPreview = new Map();
    this.coarseProjectedPreview = new Map();
    this.trailIds = [];
    this.trailOrdinals = new Map();
    this.trailGroups = new Map();
    this.trailAreas = new Map();
    this.trailCollections = new Map();
    this.indexedTrailIds = new Set();
    this.trailSpatialCells = new Map();
    this.trailSpatialMarks = new Uint32Array();
    this.trailSpatialGeneration = 0;
    this.visibleTrailCache = null;
    this.coverageAreas = [];
    this.coverageHitTargets = [];
    this.areas = [];
    this.areaById = new Map();
    this.collections = [];
    this.collectionById = new Map();
    this.overviewAreas = [];
    this.namedTargetById = new Map();
    this.activeGroupId = null;
    this.activeAreaId = null;
    this.selectedAreaId = null;
    this.selected = new Set();
    this.hiddenTrailIds = new Set();
    this.hiddenAreaIds = new Set();
    this.hiddenCoverageAreaIds = new Set();
    this.lastTrailToggle = null;
    this.contextLines = [];
    this.contextCities = [];
    this.hasData = false;
    this.lastViewportSignature = null;
    this.lastAreaLabelSignature = null;
    this.cancelPendingAreaClick();
    this.cancelCameraAnimation();
    this.callbacks.onAreaLabels?.([]);
    this.scheduleRender();
  }

  setOverview(groups, contextGeoJson) {
    this.reset();
    this.coverageAreas = this.normalizeCoverageAreas(groups);
    this.setContext(contextGeoJson);
    this.hasData = this.coverageAreas.length > 0;
    this.scheduleViewportCallback();
    this.scheduleRender();
  }

  setAreas(areas, collections = []) {
    this.areas = this.normalizeAreas(areas);
    this.areaById = new Map(this.areas.map((area) => [area.id, area]));
    this.collections = this.normalizeAreas(collections, true);
    this.collectionById = new Map(this.collections.map((collection) => [collection.id, collection]));
    const memberAreaIds = new Set(this.collections.flatMap((collection) => collection.memberAreaIds));
    this.overviewAreas = [
      ...this.collections,
      ...this.areas.filter((area) => !memberAreaIds.has(area.id)),
    ];
    this.namedTargetById = new Map([
      ...this.areaById,
      ...this.collectionById,
    ]);
    if (this.activeAreaId !== null && !this.namedTargetById.has(this.activeAreaId)) this.activeAreaId = null;
    if (this.selectedAreaId !== null && !this.namedTargetById.has(this.selectedAreaId)) this.selectedAreaId = null;
    this.hasData = this.coverageAreas.length > 0 || this.preview.size > 0 ||
      this.areas.length > 0 || this.collections.length > 0;
    this.lastAreaLabelSignature = null;
    this.scheduleRender();
  }

  setCoverageAreas(groups) {
    this.coverageAreas = this.normalizeCoverageAreas(groups || []);
    this.hasData = this.coverageAreas.length > 0 || this.preview.size > 0 ||
      this.areas.length > 0 || this.collections.length > 0;
    this.scheduleRender();
  }

  addDataChunk(groupId, catalog, preview) {
    const normalizedGroupId = this.normalizeGroupId(groupId);
    for (const [id, metadata] of catalog || []) {
      this.catalog.set(id, metadata);
      const trailGroupId = normalizedGroupId ?? this.groupIdForMetadata(metadata);
      if (trailGroupId !== null) this.trailGroups.set(id, trailGroupId);
      const trailAreaId = this.areaIdForMetadata(metadata);
      if (trailAreaId !== null) this.trailAreas.set(id, trailAreaId);
      const trailCollectionId = this.collectionIdForMetadata(metadata);
      if (trailCollectionId !== null) this.trailCollections.set(id, trailCollectionId);
    }

    const projectedChunk = this.projectPreview(preview || new Map());
    const coarseChunk = this.simplifyProjectedPreview(projectedChunk);
    for (const [id, segments] of preview || []) {
      this.preview.set(id, segments);
      this.projectedPreview.set(id, projectedChunk.get(id));
      this.coarseProjectedPreview.set(id, coarseChunk.get(id));
      this.indexTrail(id, this.catalog.get(id));
    }

    this.hasData ||= this.coverageAreas.length > 0 || this.preview.size > 0;
    this.visibleTrailCache = null;
    this.scheduleRender();
  }

  setActiveGroup(groupId) {
    this.activeGroupId = this.normalizeGroupId(groupId);
    if (this.activeGroupId !== null) this.activeAreaId = null;
    this.scheduleRender();
  }

  setActiveArea(areaId) {
    this.activeAreaId = this.normalizeGroupId(areaId);
    if (this.activeAreaId !== null) this.activeGroupId = null;
    this.scheduleRender();
  }

  setSelectedArea(areaId) {
    this.selectedAreaId = this.normalizeGroupId(areaId);
    this.scheduleRender();
  }

  setTrailAreaAssignments(assignments) {
    this.trailAreas = new Map(assignments || []);
    this.trailCollections = new Map();
    this.scheduleRender();
  }

  setHiddenTrailIds(ids) {
    this.hiddenTrailIds = new Set(ids || []);
    if (this.hoveredTrailId && this.hiddenTrailIds.has(this.hoveredTrailId)) {
      this.clearTrailHover();
    }
    this.scheduleRender();
  }

  setHiddenAreaIds(ids) {
    this.hiddenAreaIds = new Set(ids || []);
    this.lastAreaLabelSignature = null;
    this.scheduleRender();
  }

  setHiddenCoverageAreaIds(ids) {
    this.hiddenCoverageAreaIds = new Set(ids || []);
    this.scheduleRender();
  }

  normalizeGroupId(groupId) {
    return groupId === null || groupId === undefined ? null : String(groupId);
  }

  groupIdForMetadata(metadata) {
    return this.normalizeGroupId(
      metadata?.groupId ?? metadata?.group_id ??
      metadata?.collectionId ?? metadata?.collection_id ??
      metadata?.areaId ?? metadata?.area_id ?? metadata?.tile,
    );
  }

  areaIdForMetadata(metadata) {
    return this.normalizeGroupId(metadata?.areaId ?? metadata?.area_id);
  }

  collectionIdForMetadata(metadata) {
    return this.normalizeGroupId(metadata?.collectionId ?? metadata?.collection_id);
  }

  ensureTrailOrdinal(id) {
    const existing = this.trailOrdinals.get(id);
    if (existing !== undefined) return existing;
    const ordinal = this.trailIds.length;
    this.trailIds.push(id);
    this.trailOrdinals.set(id, ordinal);
    if (this.trailSpatialMarks.length <= ordinal) {
      const nextLength = Math.max(256, this.trailSpatialMarks.length * 2, ordinal + 1);
      const nextMarks = new Uint32Array(nextLength);
      nextMarks.set(this.trailSpatialMarks);
      this.trailSpatialMarks = nextMarks;
    }
    return ordinal;
  }

  indexTrail(id, metadata) {
    if (this.indexedTrailIds.has(id) || !metadata?.bbox) return;
    const ordinal = this.ensureTrailOrdinal(id);
    const gridSize = 2 ** TRAIL_INDEX_ZOOM;
    const range = this.spatialCellRange(metadata.bbox, gridSize);
    if (!range) return;
    for (let y = range.minY; y <= range.maxY; y += 1) {
      for (let x = range.minX; x <= range.maxX; x += 1) {
        const key = y * gridSize + x;
        let bucket = this.trailSpatialCells.get(key);
        if (!bucket) {
          bucket = [];
          this.trailSpatialCells.set(key, bucket);
        }
        bucket.push(ordinal);
      }
    }
    this.indexedTrailIds.add(id);
    this.visibleTrailCache = null;
  }

  spatialCellRange(bounds, gridSize = 2 ** TRAIL_INDEX_ZOOM) {
    if (!Array.isArray(bounds) || bounds.length !== 4 || bounds.some((value) => !Number.isFinite(value))) {
      return null;
    }
    const west = clamp(bounds[0], -180, 180);
    const south = clamp(bounds[1], -MAX_MERCATOR_LAT, MAX_MERCATOR_LAT);
    const east = clamp(bounds[2], -180, 180);
    const north = clamp(bounds[3], -MAX_MERCATOR_LAT, MAX_MERCATOR_LAT);
    if (west > east || south > north) return null;
    const northWest = projectCoordinate(west, north);
    const southEast = projectCoordinate(east, south);
    return {
      minX: clamp(Math.floor(northWest.x * gridSize), 0, gridSize - 1),
      maxX: clamp(Math.floor(southEast.x * gridSize), 0, gridSize - 1),
      minY: clamp(Math.floor(northWest.y * gridSize), 0, gridSize - 1),
      maxY: clamp(Math.floor(southEast.y * gridSize), 0, gridSize - 1),
    };
  }

  visibleTrailIds(viewBounds) {
    const cached = this.visibleTrailCache;
    if (cached && cached.bounds.every((value, index) => value === viewBounds[index])) {
      return cached.ids;
    }

    const ids = this.trailIdsInBounds(viewBounds);
    this.visibleTrailCache = { bounds: [...viewBounds], ids };
    return ids;
  }

  trailIdsInBounds(bounds) {
    const range = this.spatialCellRange(bounds);
    if (!range) return [];
    this.trailSpatialGeneration += 1;
    if (this.trailSpatialGeneration >= 0xffffffff) {
      this.trailSpatialMarks.fill(0);
      this.trailSpatialGeneration = 1;
    }

    const gridSize = 2 ** TRAIL_INDEX_ZOOM;
    const ordinals = [];
    for (let y = range.minY; y <= range.maxY; y += 1) {
      for (let x = range.minX; x <= range.maxX; x += 1) {
        const bucket = this.trailSpatialCells.get(y * gridSize + x);
        if (!bucket) continue;
        for (const ordinal of bucket) {
          if (this.trailSpatialMarks[ordinal] === this.trailSpatialGeneration) continue;
          this.trailSpatialMarks[ordinal] = this.trailSpatialGeneration;
          ordinals.push(ordinal);
        }
      }
    }

    ordinals.sort((a, b) => a - b);
    const ids = [];
    for (const ordinal of ordinals) {
      const id = this.trailIds[ordinal];
      const metadata = this.catalog.get(id);
      if (metadata && boxesIntersect(metadata.bbox, bounds)) ids.push(id);
    }
    return ids;
  }

  projectPreview(preview) {
    const projectedPreview = new Map();
    for (const [id, segments] of preview) {
      projectedPreview.set(id, segments.map((segment) => {
        const projected = new Float32Array(segment.length);
        for (let index = 0; index < segment.length; index += 2) {
          const point = projectCoordinate(segment[index], segment[index + 1]);
          projected[index] = point.x;
          projected[index + 1] = point.y;
        }
        return projected;
      }));
    }
    return projectedPreview;
  }

  simplifyProjectedPreview(projectedPreview) {
    const simplifiedPreview = new Map();
    for (const [id, segments] of projectedPreview) {
      simplifiedPreview.set(
        id,
        segments.map((segment) => simplifyProjectedSegment(segment, COARSE_TOLERANCE_WORLD)),
      );
    }
    return simplifiedPreview;
  }

  ensureOrnamentsLoaded() {
    for (const ornament of this.ornaments) {
      if (ornament.status !== "idle") continue;
      ornament.status = "loading";
      const image = new Image();
      image.decoding = "async";
      image.addEventListener("load", () => {
        ornament.image = image;
        ornament.status = "loaded";
        this.scheduleRender();
      }, { once: true });
      image.addEventListener("error", () => {
        ornament.status = "error";
      }, { once: true });
      image.src = ornament.url;
    }
  }

  buildCoverageAreas(catalog) {
    const areas = new Map();
    for (const metadata of catalog.values()) {
      const key = this.groupIdForMetadata(metadata) ?? metadata.id;
      const existing = areas.get(key);
      if (existing) {
        existing.count += 1;
        existing.bounds[0] = Math.min(existing.bounds[0], metadata.bbox[0]);
        existing.bounds[1] = Math.min(existing.bounds[1], metadata.bbox[1]);
        existing.bounds[2] = Math.max(existing.bounds[2], metadata.bbox[2]);
        existing.bounds[3] = Math.max(existing.bounds[3], metadata.bbox[3]);
      } else {
        areas.set(key, { id: key, count: 1, bounds: [...metadata.bbox] });
      }
    }
    return this.normalizeCoverageAreas([...areas.values()]);
  }

  normalizeCoverageAreas(groups) {
    const source = groups instanceof Map
      ? [...groups.values()]
      : Array.isArray(groups)
        ? groups
        : Array.isArray(groups?.groups)
          ? groups.groups
          : [];
    const areas = [];
    for (let index = 0; index < source.length; index += 1) {
      const group = source[index];
      const hasUnassignedSummary = Number.isInteger(group?.unassignedCount);
      const count = hasUnassignedSummary
        ? group.unassignedCount
        : Number(group?.count ?? group?.trailCount ?? group?.trail_count) || 0;
      if (count <= 0) continue;
      const bounds = hasUnassignedSummary
        ? group.unassignedBounds
        : group?.bounds || group?.bbox;
      if (!Array.isArray(bounds) || bounds.length !== 4 || bounds.some((value) => !Number.isFinite(value))) {
        continue;
      }
      const sourceCenter = hasUnassignedSummary ? group.unassignedCenter : group?.center;
      const center = Array.isArray(sourceCenter) && sourceCenter.length >= 2
        ? [sourceCenter[0], sourceCenter[1]]
        : [
            (bounds[0] + bounds[2]) / 2,
            (bounds[1] + bounds[3]) / 2,
          ];
      const id = this.normalizeGroupId(
        group.id ?? group.groupId ?? group.group_id ?? group.areaId ?? group.area_id ?? group.tile ?? index,
      );
      areas.push({
        id,
        bounds: [...bounds],
        center,
        count,
        world: projectCoordinate(center[0], center[1]),
      });
    }
    return areas;
  }

  normalizeAreas(areas, isCollection = false) {
    const normalized = [];
    for (const source of Array.isArray(areas) ? areas : []) {
      const id = this.normalizeGroupId(source?.id);
      const viewBounds = source?.viewBounds || source?.bounds;
      if (
        id === null ||
        !Array.isArray(viewBounds) ||
        viewBounds.length !== 4 ||
        viewBounds.some((value) => !Number.isFinite(value))
      ) {
        continue;
      }
      const labelPoint = Array.isArray(source?.labelPoint) && source.labelPoint.length >= 2 &&
        source.labelPoint.slice(0, 2).every((value) => Number.isFinite(value))
        ? [source.labelPoint[0], source.labelPoint[1]]
        : [
            (viewBounds[0] + viewBounds[2]) / 2,
            (viewBounds[1] + viewBounds[3]) / 2,
          ];
      const groupIds = [...new Set(
        (Array.isArray(source?.groupIds) ? source.groupIds : [])
          .map((groupId) => this.normalizeGroupId(groupId))
          .filter((groupId) => groupId !== null),
      )];
      const memberAreaIds = isCollection
        ? [...new Set(
            (Array.isArray(source?.memberAreaIds) ? source.memberAreaIds : [])
              .map((areaId) => this.normalizeGroupId(areaId))
              .filter((areaId) => areaId !== null),
          )]
        : [];
      normalized.push({
        id,
        name: String(source?.name || "Riding area").trim() || "Riding area",
        count: Math.max(0, Number(source?.count) || 0),
        pointCount: Math.max(0, Number(source?.pointCount) || 0),
        viewBounds: [...viewBounds],
        labelPoint,
        groupIds,
        memberAreaIds,
        kind: isCollection ? "collection" : "area",
        world: projectCoordinate(labelPoint[0], labelPoint[1]),
      });
    }
    return normalized;
  }

  publicArea(area) {
    return {
      id: area.id,
      name: area.name,
      count: area.count,
      pointCount: area.pointCount,
      viewBounds: [...area.viewBounds],
      labelPoint: [...area.labelPoint],
      groupIds: [...area.groupIds],
      memberAreaIds: [...area.memberAreaIds],
      kind: area.kind,
    };
  }

  publicCoverageArea(area) {
    return {
      id: area.id,
      bounds: [...area.bounds],
      center: [...area.center],
      count: area.count,
    };
  }

  setContext(geoJson) {
    this.contextLines = [];
    this.contextCities = [];
    for (const feature of geoJson?.features || []) {
      const geometry = feature?.geometry;
      if (!geometry) continue;
      if (geometry.type === "Point") {
        this.contextCities.push({
          coordinates: geometry.coordinates,
          name: feature.properties?.name || feature.properties?.NAME || "",
        });
      } else if (geometry.type === "LineString") {
        this.contextLines.push(geometry.coordinates);
      } else if (geometry.type === "MultiLineString") {
        this.contextLines.push(...geometry.coordinates);
      }
    }
  }

  setSelected(selected) {
    this.selected = selected;
    this.scheduleRender();
  }

  setBasemapUrl(url) {
    return this.basemap.open(url);
  }

  setMode(mode) {
    this.cancelPendingAreaClick();
    this.clearTrailHover();
    this.mode = mode === "box" || mode === "zoom" ? mode : "pan";
    if (this.mode !== "zoom") this.zoomOutModifier = false;
    this.lastTrailToggle = null;
    if (!this.pointer) this.selectionBox = null;
    this.updateToolCursor();
    this.scheduleRender();
  }

  desktopShortcutsEnabled() {
    return window.matchMedia?.("(any-hover: hover) and (any-pointer: fine)")?.matches ?? true;
  }

  interactionMode() {
    return this.spacePanActive ? "pan" : this.mode;
  }

  setSpacePanActive(active) {
    const next = Boolean(active);
    if (this.spacePanActive === next) return;
    this.spacePanActive = next;
    this.updateToolCursor();
  }

  setZoomOutModifier(active) {
    const next = Boolean(active) && this.mode === "zoom";
    if (this.zoomOutModifier === next) return;
    this.zoomOutModifier = next;
    this.updateToolCursor();
  }

  updateToolCursor() {
    const interactionMode = this.pointer?.interactionMode ?? this.interactionMode();
    const temporaryPan = this.spacePanActive || this.pointer?.temporaryPan;
    this.canvas.classList.toggle("is-box-mode", interactionMode === "box");
    this.canvas.classList.toggle("is-zoom-mode", interactionMode === "zoom");
    this.canvas.classList.toggle(
      "is-zoom-out",
      interactionMode === "zoom" && this.zoomOutModifier,
    );
    this.canvas.classList.toggle("is-space-pan", Boolean(temporaryPan));
  }

  releaseTemporaryTools() {
    this.setSpacePanActive(false);
    this.setZoomOutModifier(false);
  }

  setView(center, zoom) {
    this.cancelCameraAnimation();
    this.cancelPendingAreaClick();
    this.center = projectCoordinate(center[0], center[1]);
    this.zoom = clamp(zoom, 2, 16);
    this.cameraChanged();
  }

  fitBounds(bounds, padding = 34) {
    const view = this.fitViewForBounds(bounds, padding);
    if (!view) return;
    this.cancelCameraAnimation();
    this.cancelPendingAreaClick();
    this.zoom = view.zoom;
    this.center = view.center;
    this.cameraChanged();
  }

  fitViewForBounds(bounds, padding = 34) {
    if (
      !Array.isArray(bounds) || bounds.length !== 4 ||
      bounds.some((value) => !Number.isFinite(value)) ||
      this.width < 2 || this.height < 2
    ) {
      return null;
    }
    const northWest = projectCoordinate(bounds[0], bounds[3]);
    const southEast = projectCoordinate(bounds[2], bounds[1]);
    const dx = Math.max(1e-9, Math.abs(southEast.x - northWest.x));
    const dy = Math.max(1e-9, Math.abs(southEast.y - northWest.y));
    const availableWidth = Math.max(1, this.width - padding * 2);
    const availableHeight = Math.max(1, this.height - padding * 2);
    const requiredScale = Math.min(availableWidth / dx, availableHeight / dy);
    return {
      zoom: clamp(Math.log2(requiredScale / 256), 2, 16),
      center: {
        x: (northWest.x + southEast.x) / 2,
        y: (northWest.y + southEast.y) / 2,
      },
    };
  }

  isAtBoundsView(bounds, options = {}) {
    const padding = Number.isFinite(options.padding) ? Math.max(0, options.padding) : 54;
    const view = this.fitViewForBounds(bounds, padding);
    if (!view) return false;
    let deltaX = view.center.x - this.center.x;
    if (deltaX > 0.5) deltaX -= 1;
    if (deltaX < -0.5) deltaX += 1;
    const targetScale = 256 * 2 ** view.zoom;
    const centerDistancePx = Math.hypot(deltaX, view.center.y - this.center.y) * targetScale;
    return centerDistancePx <= 1.5 && Math.abs(view.zoom - this.zoom) <= 0.01;
  }

  easeToBounds(bounds, options = {}) {
    const padding = Number.isFinite(options.padding) ? Math.max(0, options.padding) : 54;
    const duration = Number.isFinite(options.duration) ? clamp(options.duration, 0, 2000) : 650;
    const view = this.fitViewForBounds(bounds, padding);
    if (!view) return false;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (reducedMotion || duration === 0) {
      this.fitBounds(bounds, padding);
      return true;
    }

    this.cancelCameraAnimation();
    this.cancelPendingAreaClick();
    const startCenter = { ...this.center };
    const startZoom = this.zoom;
    let deltaX = view.center.x - startCenter.x;
    if (deltaX > 0.5) deltaX -= 1;
    if (deltaX < -0.5) deltaX += 1;
    const deltaY = view.center.y - startCenter.y;
    const deltaZoom = view.zoom - startZoom;
    const startedAt = performance.now();

    const step = (now) => {
      if (!this.cameraAnimationFrame) return;
      const progress = clamp((now - startedAt) / duration, 0, 1);
      const eased = 1 - (1 - progress) ** 3;
      this.center = {
        x: startCenter.x + deltaX * eased,
        y: startCenter.y + deltaY * eased,
      };
      this.zoom = startZoom + deltaZoom * eased;
      this.cameraChanged();
      if (progress < 1) {
        this.cameraAnimationFrame = requestAnimationFrame(step);
      } else {
        this.cameraAnimationFrame = 0;
      }
    };
    this.cameraAnimationFrame = requestAnimationFrame(step);
    return true;
  }

  cancelCameraAnimation() {
    if (!this.cameraAnimationFrame) return;
    cancelAnimationFrame(this.cameraAnimationFrame);
    this.cameraAnimationFrame = 0;
  }

  zoomBy(delta, screenX = this.width / 2, screenY = this.height / 2) {
    this.cancelCameraAnimation();
    this.cancelPendingAreaClick();
    const worldBefore = this.screenToWorld(screenX, screenY);
    this.zoom = clamp(this.zoom + delta, 2, 16);
    const nextScale = this.scale;
    this.center = {
      x: worldBefore.x - (screenX - this.width / 2) / nextScale,
      y: worldBefore.y - (screenY - this.height / 2) / nextScale,
    };
    this.cameraChanged();
  }

  panPixels(dx, dy) {
    this.cancelCameraAnimation();
    this.cancelPendingAreaClick();
    this.center.x += dx / this.scale;
    this.center.y += dy / this.scale;
    this.cameraChanged();
  }

  getViewBounds() {
    const northWest = unprojectCoordinate(
      this.center.x - this.width / 2 / this.scale,
      this.center.y - this.height / 2 / this.scale,
    );
    const southEast = unprojectCoordinate(
      this.center.x + this.width / 2 / this.scale,
      this.center.y + this.height / 2 / this.scale,
    );
    return [northWest.lon, southEast.lat, southEast.lon, northWest.lat];
  }

  getTrailIdsIntersectingBounds(bounds, options = {}) {
    const limit = Number.isFinite(options.limit) ? Math.max(1, options.limit) : Infinity;
    const predicate = options.predicate || (() => true);
    const ids = [];
    for (const id of this.trailIdsInBounds(bounds)) {
      if (this.hiddenTrailIds.has(id)) continue;
      const meta = this.catalog.get(id);
      if (!meta || !predicate(meta) || !boxesIntersect(meta.bbox, bounds)) continue;
      const segments = this.preview.get(id);
      if (!segments) continue;
      let intersects = false;
      for (const segment of segments) {
        for (let index = 0; index < segment.length - 2; index += 2) {
          if (segmentIntersectsBox(
            segment[index],
            segment[index + 1],
            segment[index + 2],
            segment[index + 3],
            bounds,
          )) {
            intersects = true;
            break;
          }
        }
        if (intersects) break;
      }
      if (intersects) {
        ids.push(id);
        if (ids.length >= limit) return { ids, overflow: true };
      }
    }
    return { ids, overflow: false };
  }

  trailIdAtPoint(point, pointerType = "mouse") {
    if (this.zoom < OVERVIEW_MAX_ZOOM) return null;
    const tolerance = pointerType === "touch" ? 14 : 7;
    const northWest = this.screenToCoordinate(point.x - tolerance, point.y - tolerance);
    const southEast = this.screenToCoordinate(point.x + tolerance, point.y + tolerance);
    const hitBounds = [
      Math.min(northWest.lon, southEast.lon),
      Math.min(northWest.lat, southEast.lat),
      Math.max(northWest.lon, southEast.lon),
      Math.max(northWest.lat, southEast.lat),
    ];
    const displayPreview = this.zoom < FULL_DETAIL_MIN_ZOOM
      ? this.coarseProjectedPreview
      : this.projectedPreview;
    const worldPoint = this.screenToWorld(point.x, point.y);
    const toleranceSquared = (tolerance / this.scale) ** 2;
    const tieToleranceSquared = (0.5 / this.scale) ** 2;
    let nearestId = null;
    let nearestDistance = toleranceSquared;

    for (const id of this.trailIdsInBounds(hitBounds)) {
      if (this.hiddenTrailIds.has(id)) continue;
      const segments = displayPreview.get(id);
      if (!segments) continue;
      let trailDistance = Infinity;
      for (const segment of segments) {
        for (let index = 0; index < segment.length - 2; index += 2) {
          trailDistance = Math.min(
            trailDistance,
            pointSegmentDistanceSquared(
              worldPoint.x,
              worldPoint.y,
              segment[index],
              segment[index + 1],
              segment[index + 2],
              segment[index + 3],
            ),
          );
        }
      }
      const isNearer = nearestId === null
        ? trailDistance <= nearestDistance
        : trailDistance < nearestDistance - tieToleranceSquared;
      const winsTie = Math.abs(trailDistance - nearestDistance) <= tieToleranceSquared &&
        this.selected.has(id) && !this.selected.has(nearestId);
      if (isNearer || winsTie) {
        nearestId = id;
        nearestDistance = trailDistance;
      }
    }
    return nearestId;
  }

  scheduleTrailHover(point, pointerType = "mouse") {
    if (!this.callbacks.onTrailHover || pointerType === "touch" || !this.desktopShortcutsEnabled()) {
      this.clearTrailHover();
      return;
    }
    this.pendingTrailHover = { point: { ...point }, pointerType };
    if (this.trailHoverFrame) return;
    this.trailHoverFrame = requestAnimationFrame(() => {
      this.trailHoverFrame = 0;
      const pending = this.pendingTrailHover;
      this.pendingTrailHover = null;
      if (!pending || this.pointer) {
        this.clearTrailHover();
        return;
      }
      const id = this.trailIdAtPoint(pending.point, pending.pointerType);
      this.hoveredTrailId = id;
      this.callbacks.onTrailHover(id ? { id, x: pending.point.x, y: pending.point.y } : null);
    });
  }

  clearTrailHover() {
    if (this.trailHoverFrame) cancelAnimationFrame(this.trailHoverFrame);
    const hadHover = this.hoveredTrailId !== null || this.pendingTrailHover !== null;
    this.trailHoverFrame = 0;
    this.pendingTrailHover = null;
    this.hoveredTrailId = null;
    if (hadHover) this.callbacks.onTrailHover?.(null);
  }

  resize() {
    this.clearTrailHover();
    const rect = this.canvas.getBoundingClientRect();
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.width * this.pixelRatio);
    this.canvas.height = Math.round(this.height * this.pixelRatio);
    this.scheduleViewportCallback();
    this.scheduleRender();
  }

  bindEvents() {
    this.canvas.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    this.canvas.addEventListener("pointermove", (event) => this.onPointerMove(event));
    this.canvas.addEventListener("pointerleave", () => this.clearTrailHover());
    this.canvas.addEventListener("pointerup", (event) => this.onPointerUp(event));
    this.canvas.addEventListener("pointercancel", (event) => this.cancelPointer(event));
    this.canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      this.cancelCameraAnimation();
      this.cancelPendingAreaClick();
      const point = this.eventPoint(event);
      this.zoomBy(event.deltaY < 0 ? 0.5 : -0.5, point.x, point.y);
    }, { passive: false });
    this.canvas.addEventListener("keydown", (event) => this.onKeyDown(event));
    this.canvas.addEventListener("blur", () => this.releaseTemporaryTools());
    window.addEventListener("keyup", (event) => this.onKeyUp(event));
    window.addEventListener("blur", () => {
      this.cancelPointer();
      this.releaseTemporaryTools();
    });
  }

  onPointerDown(event) {
    if (event.button !== 0 || event.isPrimary === false || this.pointer) return;
    this.clearTrailHover();
    this.cancelCameraAnimation();
    const point = this.eventPoint(event);
    const interactionMode = this.interactionMode();
    this.canvas.setPointerCapture(event.pointerId);
    this.pointer = {
      id: event.pointerId,
      interactionMode,
      temporaryPan: this.spacePanActive,
      start: point,
      last: point,
      startCenter: { ...this.center },
      moved: false,
      pointerType: event.pointerType || "mouse",
    };
    if (interactionMode === "box") this.selectionBox = { start: point, end: point };
    this.canvas.classList.add("is-dragging");
    this.updateToolCursor();
  }

  onPointerMove(event) {
    const point = this.eventPoint(event);
    if (!this.pointer) {
      this.scheduleTrailHover(point, event.pointerType || "mouse");
      return;
    }
    if (this.pointer.id !== event.pointerId) return;

    const dx = point.x - this.pointer.start.x;
    const dy = point.y - this.pointer.start.y;
    const dragSlop = this.pointer.pointerType === "touch" ? 10 : 4;
    this.pointer.moved ||= Math.hypot(dx, dy) > dragSlop;
    if (this.pointer.moved) this.cancelPendingAreaClick();
    this.pointer.last = point;
    if (this.pointer.interactionMode === "box") {
      if (!this.selectionBox) return;
      this.selectionBox.end = point;
      this.scheduleRender();
      return;
    }
    if (this.pointer.interactionMode === "zoom") return;
    this.center = {
      x: this.pointer.startCenter.x - dx / this.scale,
      y: this.pointer.startCenter.y - dy / this.scale,
    };
    this.cameraChanged();
  }

  onPointerUp(event) {
    if (!this.pointer || this.pointer.id !== event.pointerId) return;
    const pointer = this.pointer;
    const point = this.eventPoint(event);
    this.canvas.releasePointerCapture(event.pointerId);
    this.canvas.classList.remove("is-dragging");

    if (pointer.interactionMode === "box" && this.selectionBox) {
      const start = this.screenToCoordinate(this.selectionBox.start.x, this.selectionBox.start.y);
      const end = this.screenToCoordinate(point.x, point.y);
      this.selectionBox = null;
      this.pointer = null;
      this.updateToolCursor();
      this.scheduleRender();
      if (pointer.moved) {
        this.callbacks.onBox?.([
          Math.min(start.lon, end.lon),
          Math.min(start.lat, end.lat),
          Math.max(start.lon, end.lon),
          Math.max(start.lat, end.lat),
        ]);
        return;
      }

      if (this.zoom < OVERVIEW_MAX_ZOOM && this.activateCoverageAreaAt(point, performance.now(), pointer.pointerType)) {
        return;
      }
      const trailId = this.trailIdAtPoint(point, pointer.pointerType);
      if (trailId) {
        this.cancelPendingAreaClick();
        const now = performance.now();
        const previous = this.lastTrailToggle;
        const isRepeat = previous && previous.id === trailId &&
          now - previous.time <= AREA_DOUBLE_CLICK_WINDOW_MS &&
          Math.hypot(point.x - previous.point.x, point.y - previous.point.y) <=
            (pointer.pointerType === "touch" ? 24 : AREA_DOUBLE_CLICK_DISTANCE_PX);
        this.lastTrailToggle = { id: trailId, time: now, point: { ...point } };
        if (!isRepeat) this.callbacks.onTrailToggle?.(trailId);
        return;
      }
      this.lastTrailToggle = null;
      this.cancelPendingAreaClick();
      this.callbacks.onBackgroundSelect?.();
      return;
    }

    this.pointer = null;
    this.updateToolCursor();
    if (pointer.interactionMode === "zoom") {
      if (!pointer.moved) {
        const delta = event.altKey || this.zoomOutModifier ? -0.5 : 0.5;
        this.zoomBy(delta, point.x, point.y);
      }
      return;
    }
    if (!pointer.moved && !pointer.temporaryPan && this.zoom < OVERVIEW_MAX_ZOOM) {
      this.activateCoverageAreaAt(point, performance.now(), pointer.pointerType);
    }
  }

  cancelPointer(event) {
    if (event && this.pointer && event.pointerId !== this.pointer.id) return;
    if (this.pointer && this.canvas.hasPointerCapture?.(this.pointer.id)) {
      this.canvas.releasePointerCapture(this.pointer.id);
    }
    this.pointer = null;
    this.selectionBox = null;
    this.cancelPendingAreaClick();
    this.canvas.classList.remove("is-dragging");
    this.updateToolCursor();
    this.scheduleRender();
  }

  onKeyDown(event) {
    const desktopShortcuts = this.desktopShortcutsEnabled();
    const commandKey = event.ctrlKey || event.metaKey;

    if (desktopShortcuts && commandKey && !event.altKey) {
      if (event.code === "Digit0" || event.code === "Numpad0") {
        event.preventDefault();
        if (!event.repeat && !this.pointer) this.callbacks.onFitAllShortcut?.();
        return;
      }
      if (event.code === "Digit1" || event.code === "Numpad1") {
        event.preventDefault();
        if (!event.repeat && !this.pointer) this.callbacks.onFitSelectedShortcut?.();
        return;
      }
      if (event.code === "Equal" || event.code === "NumpadAdd") {
        event.preventDefault();
        if (!this.pointer) this.zoomBy(0.5);
        return;
      }
      if (event.code === "Minus" || event.code === "NumpadSubtract") {
        event.preventDefault();
        if (!this.pointer) this.zoomBy(-0.5);
        return;
      }
    }

    if (desktopShortcuts && !commandKey) {
      if (event.code === "Space") {
        event.preventDefault();
        if (!event.repeat && !this.pointer) this.setSpacePanActive(true);
        return;
      }
      if (
        typeof this.callbacks.onBox === "function" &&
        !event.altKey &&
        (event.code === "KeyV" || event.code === "KeyA")
      ) {
        event.preventDefault();
        if (!event.repeat && !this.pointer) this.callbacks.onToolShortcut?.("box");
        return;
      }
      if (event.code === "KeyZ") {
        event.preventDefault();
        if (!event.repeat && !this.pointer) this.callbacks.onToolShortcut?.("zoom");
        this.setZoomOutModifier(event.altKey);
        return;
      }
      if (event.key === "Alt" && this.mode === "zoom") {
        event.preventDefault();
        this.setZoomOutModifier(true);
        return;
      }
    }

    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "=", "-", "Escape"];
    if (!keys.includes(event.key) || commandKey || event.altKey) return;
    event.preventDefault();
    if (event.key === "ArrowLeft") this.panPixels(-80, 0);
    if (event.key === "ArrowRight") this.panPixels(80, 0);
    if (event.key === "ArrowUp") this.panPixels(0, -80);
    if (event.key === "ArrowDown") this.panPixels(0, 80);
    if (event.key === "+" || event.key === "=") this.zoomBy(0.5);
    if (event.key === "-") this.zoomBy(-0.5);
    if (event.key === "Escape") {
      const cancellingSelection = this.mode === "box";
      this.cancelPointer();
      if (cancellingSelection) this.callbacks.onEscape?.();
    }
  }

  onKeyUp(event) {
    if (event.code === "Space") this.setSpacePanActive(false);
    if (event.key === "Alt") this.setZoomOutModifier(false);
  }

  eventPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  worldToScreen(world) {
    return {
      x: (world.x - this.center.x) * this.scale + this.width / 2,
      y: (world.y - this.center.y) * this.scale + this.height / 2,
    };
  }

  screenToWorld(x, y) {
    return {
      x: this.center.x + (x - this.width / 2) / this.scale,
      y: this.center.y + (y - this.height / 2) / this.scale,
    };
  }

  coordinateToScreen(lon, lat) {
    return this.worldToScreen(projectCoordinate(lon, lat));
  }

  screenToCoordinate(x, y) {
    const world = this.screenToWorld(x, y);
    return unprojectCoordinate(world.x, world.y);
  }

  cameraChanged() {
    this.clearTrailHover();
    this.center.x = ((this.center.x % 1) + 1) % 1;
    this.center.y = clamp(this.center.y, 0, 1);
    this.scheduleViewportCallback();
    this.scheduleRender();
  }

  scheduleViewportCallback() {
    if (!this.callbacks.onViewport || !this.hasData || this.zoom < OVERVIEW_MAX_ZOOM) {
      this.lastViewportSignature = null;
      return;
    }
    const bounds = this.getViewBounds();
    const signature = `${this.zoom.toFixed(3)}:${bounds.map((value) => value.toFixed(6)).join(":")}`;
    if (signature === this.lastViewportSignature) return;
    this.lastViewportSignature = signature;
    this.callbacks.onViewport({ bounds, zoom: this.zoom });
  }

  scheduleRender() {
    if (this.frameRequested) return;
    this.frameRequested = true;
    requestAnimationFrame(() => {
      this.frameRequested = false;
      this.render();
    });
  }

  render() {
    const context = this.context2d;
    context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    context.clearRect(0, 0, this.width, this.height);
    context.fillStyle = "#cdb178";
    context.fillRect(0, 0, this.width, this.height);
    this.drawContext(context);
    this.basemap.draw(context, {
      center: this.center,
      zoom: this.zoom,
      scale: this.scale,
      width: this.width,
      height: this.height,
    });
    this.drawOrnaments(context);
    this.drawChartVignette(context);
    this.drawTrails(context);
    this.drawSelectionBox(context);
    this.publishAreaLabels(context);
  }

  drawChartVignette(context) {
    const radius = Math.hypot(this.width, this.height) * 0.58;
    const vignette = context.createRadialGradient(
      this.width * 0.5,
      this.height * 0.45,
      Math.min(this.width, this.height) * 0.16,
      this.width * 0.5,
      this.height * 0.45,
      radius,
    );
    vignette.addColorStop(0, "rgb(255 246 210 / 0)");
    vignette.addColorStop(0.68, "rgb(92 60 28 / 0.05)");
    vignette.addColorStop(1, "rgb(49 31 16 / 0.27)");
    context.save();
    context.fillStyle = vignette;
    context.fillRect(0, 0, this.width, this.height);
    context.restore();
  }

  drawOrnaments(context) {
    const opacity = interpolateStops(this.zoom, ORNAMENT_OPACITY_STOPS);
    if (!this.hasData || opacity <= 0) return;
    this.ensureOrnamentsLoaded();

    const width = interpolateStops(this.zoom, ORNAMENT_WIDTH_STOPS);
    context.save();
    context.globalAlpha = opacity;
    context.globalCompositeOperation = "multiply";
    for (const ornament of this.ornaments) {
      if (ornament.status !== "loaded" || !ornament.image?.naturalWidth) continue;
      const point = this.worldToScreen(ornament.world);
      const height = width * ornament.image.naturalHeight / ornament.image.naturalWidth;
      if (
        point.x < -width / 2 || point.x > this.width + width / 2 ||
        point.y < -height / 2 || point.y > this.height + height / 2
      ) continue;
      context.drawImage(ornament.image, point.x - width / 2, point.y - height / 2, width, height);
    }
    context.restore();
  }

  drawContext(context) {
    context.save();
    context.strokeStyle = "rgb(67 45 27 / 0.6)";
    context.lineWidth = 1.15;
    context.beginPath();
    for (const line of this.contextLines) {
      let started = false;
      for (const coordinate of line) {
        const point = this.coordinateToScreen(coordinate[0], coordinate[1]);
        if (!started) {
          context.moveTo(point.x, point.y);
          started = true;
        } else {
          context.lineTo(point.x, point.y);
        }
      }
    }
    context.stroke();

    if (this.zoom >= 5) {
      context.fillStyle = "#3b291b";
      context.font = '10px "IBM Plex Mono", Consolas, monospace';
      for (const city of this.contextCities) {
        const point = this.coordinateToScreen(city.coordinates[0], city.coordinates[1]);
        if (point.x < -20 || point.x > this.width + 20 || point.y < -20 || point.y > this.height + 20) continue;
        context.beginPath();
        context.arc(point.x, point.y, 2.2, 0, Math.PI * 2);
        context.fill();
        if (this.zoom >= 6.5 && city.name) {
          context.strokeStyle = "rgb(224 207 157 / 0.9)";
          context.lineWidth = 3;
          context.strokeText(city.name, point.x + 5, point.y - 4);
          context.fillText(city.name, point.x + 5, point.y - 4);
        }
      }
    }
    context.restore();
  }

  drawTrails(context) {
    const viewBounds = this.getViewBounds();
    context.save();
    this.coverageHitTargets = [];
    if (this.zoom < OVERVIEW_MAX_ZOOM) {
      this.drawCoverageAreas(context);
      if (this.activeAreaId !== null) {
        const activeTarget = this.namedTargetById.get(this.activeAreaId);
        this.drawUnselectedTrails(context, this.coarseProjectedPreview, viewBounds, (id) =>
          activeTarget?.kind === "collection"
            ? this.trailCollections.get(id) === this.activeAreaId
            : this.trailAreas.get(id) === this.activeAreaId,
        );
      } else if (this.activeGroupId !== null) {
        this.drawUnselectedTrails(context, this.coarseProjectedPreview, viewBounds, (id) =>
          this.trailGroups.get(id) === this.activeGroupId &&
            !this.trailAreas.has(id) && !this.trailCollections.has(id),
        );
      }
    } else {
      const displayPreview = this.zoom < FULL_DETAIL_MIN_ZOOM
        ? this.coarseProjectedPreview
        : this.projectedPreview;
      this.drawUnselectedTrails(context, displayPreview, viewBounds);
    }

    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    for (const id of this.visibleTrailIds(viewBounds)) {
      if (!this.selected.has(id) || this.hiddenTrailIds.has(id)) continue;
      const segments = this.projectedPreview.get(id);
      if (segments) this.traceProjectedSegments(context, segments);
    }
    context.strokeStyle = "rgb(185 55 32 / 0.94)";
    context.lineWidth = 6;
    context.stroke();
    context.strokeStyle = "#fff0bd";
    context.lineWidth = 2.25;
    context.stroke();
    context.restore();
  }

  drawUnselectedTrails(context, displayPreview, viewBounds, predicate = () => true) {
    context.lineCap = "butt";
    context.lineJoin = "bevel";
    const trailLineWidth = this.zoom < 9 ? 1.25 : this.zoom < 11 ? 1.5 : 1.8;
    const casingLineWidth = this.zoom < 9 ? 3 : this.zoom < 11 ? 3.25 : 3.6;
    context.beginPath();
    for (const id of this.visibleTrailIds(viewBounds)) {
      if (this.selected.has(id) || this.hiddenTrailIds.has(id) || !predicate(id)) continue;
      const segments = displayPreview.get(id);
      if (!segments) continue;
      this.traceProjectedSegments(context, segments);
    }
    context.strokeStyle = "rgb(230 210 157 / 0.72)";
    context.lineWidth = casingLineWidth;
    context.stroke();
    context.strokeStyle = "rgb(84 48 75 / 0.94)";
    context.lineWidth = trailLineWidth;
    context.stroke();
  }

  drawCoverageAreas(context) {
    context.fillStyle = "rgb(84 48 75 / 0.13)";
    context.strokeStyle = "rgb(84 48 75 / 0.46)";
    context.lineWidth = 0.8;
    for (const area of this.coverageAreas) {
      if (this.hiddenCoverageAreaIds.has(area.id)) continue;
      const sourcePoint = this.worldToScreen(area.world);
      if (
        sourcePoint.x < -16 || sourcePoint.x > this.width + 16 ||
        sourcePoint.y < -16 || sourcePoint.y > this.height + 16
      ) {
        continue;
      }
      const radius = Math.max(2.5, this.coverageRadius(area) * 0.72);
      const point = this.separateFallbackCoveragePoint(area, sourcePoint, radius);
      this.coverageHitTargets.push({ kind: "fallback", area, point, radius: Math.max(10, radius + 4) });
      context.beginPath();
      context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }

    for (const area of this.overviewAreas) {
      if (this.hiddenAreaIds.has(area.id)) continue;
      const point = this.worldToScreen(area.world);
      if (point.x < -20 || point.x > this.width + 20 || point.y < -20 || point.y > this.height + 20) {
        continue;
      }
      const selected = area.id === this.selectedAreaId;
      const active = area.id === this.activeAreaId;
      context.fillStyle = selected
        ? "rgb(185 55 32 / 0.34)"
        : active
          ? "rgb(84 48 75 / 0.5)"
          : "rgb(84 48 75 / 0.34)";
      context.strokeStyle = selected ? "rgb(185 55 32 / 0.96)" : "rgb(84 48 75 / 0.9)";
      context.lineWidth = selected || active ? 1.5 : 1;
      const radius = this.coverageRadius(area);
      this.coverageHitTargets.push({ kind: "semantic", area, point, radius: Math.max(12, radius + 5) });
      context.beginPath();
      context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }
  }

  separateFallbackCoveragePoint(area, point, radius) {
    let nearest = null;
    for (const semanticArea of this.overviewAreas) {
      if (this.hiddenAreaIds.has(semanticArea.id)) continue;
      const semanticPoint = this.worldToScreen(semanticArea.world);
      const semanticRadius = this.coverageRadius(semanticArea);
      const separation = Math.max(10, radius + 4) + Math.max(12, semanticRadius + 5) + 2;
      const dx = point.x - semanticPoint.x;
      const dy = point.y - semanticPoint.y;
      const distance = Math.hypot(dx, dy);
      if (distance >= separation || (nearest && nearest.distance <= distance)) continue;
      nearest = { semanticPoint, separation, dx, dy, distance };
    }
    if (!nearest) return point;

    let { dx, dy, distance } = nearest;
    if (distance < 0.01) {
      let hash = 0;
      for (const character of area.id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
      const angle = (hash % 360) * Math.PI / 180;
      dx = Math.cos(angle);
      dy = Math.sin(angle);
      distance = 1;
    }
    return {
      x: nearest.semanticPoint.x + dx / distance * nearest.separation,
      y: nearest.semanticPoint.y + dy / distance * nearest.separation,
    };
  }

  computeAreaLabelPlacements(context) {
    const showAllAreaLabels = this.callbacks.showAllAreaLabels === true;
    if ((!showAllAreaLabels && this.zoom < AREA_LABEL_MIN_ZOOM) || !this.areas.length) return [];
    const viewBounds = this.getViewBounds();
    const occupied = [];
    const placements = [];
    const margin = 8;
    context.save();
    context.font = '700 11px "IBM Plex Mono", Consolas, monospace';
    const candidates = this.areas
      .filter((area) =>
        !this.hiddenAreaIds.has(area.id) && boxesIntersect(area.viewBounds, viewBounds)
      )
      .sort((left, right) => {
        const leftPriority = Number(left.id === this.selectedAreaId) * 2 + Number(left.id === this.activeAreaId);
        const rightPriority = Number(right.id === this.selectedAreaId) * 2 + Number(right.id === this.activeAreaId);
        return rightPriority - leftPriority || right.count - left.count || left.name.localeCompare(right.name);
      });

    for (const area of candidates) {
      const anchor = this.worldToScreen(area.world);
      if (!showAllAreaLabels && (
        anchor.x < -40 || anchor.x > this.width + 40 ||
        anchor.y < -40 || anchor.y > this.height + 40
      )) {
        continue;
      }
      // Reserve room for the diamond, its halo, the gap, and button padding.
      // Without it, short labels can squeeze the marker behind the label fill.
      const labelWidth = clamp(context.measureText(area.name).width + 40, 76, 248);
      const labelHeight = this.width <= 768
        ? AREA_LABEL_MOBILE_HEIGHT_PX
        : AREA_LABEL_HEIGHT_PX;
      const positions = [
        {
          side: "right",
          x: anchor.x + 10,
          y: anchor.y - labelHeight / 2,
        },
        {
          side: "left",
          x: anchor.x - labelWidth - 10,
          y: anchor.y - labelHeight / 2,
        },
        {
          side: "below",
          x: anchor.x - labelWidth / 2,
          y: anchor.y + 10,
        },
        {
          side: "above",
          x: anchor.x - labelWidth / 2,
          y: anchor.y - labelHeight - 10,
        },
      ];
      const position = showAllAreaLabels
        ? positions.map((candidate, index) => {
            const clamped = {
              ...candidate,
              x: clamp(candidate.x, margin, Math.max(margin, this.width - labelWidth - margin)),
              y: clamp(candidate.y, margin, Math.max(margin, this.height - labelHeight - margin)),
            };
            const rectangle = {
              left: clamped.x - AREA_LABEL_GAP_PX,
              top: clamped.y - AREA_LABEL_GAP_PX,
              right: clamped.x + labelWidth + AREA_LABEL_GAP_PX,
              bottom: clamped.y + labelHeight + AREA_LABEL_GAP_PX,
            };
            const overlap = occupied.reduce((total, existing) => {
              const width = Math.max(
                0,
                Math.min(rectangle.right, existing.right) - Math.max(rectangle.left, existing.left),
              );
              const height = Math.max(
                0,
                Math.min(rectangle.bottom, existing.bottom) - Math.max(rectangle.top, existing.top),
              );
              return total + width * height;
            }, 0);
            const displacement = Math.abs(clamped.x - candidate.x) + Math.abs(clamped.y - candidate.y);
            return { position: clamped, overlap, displacement, index };
          }).sort((left, right) =>
            left.overlap - right.overlap ||
            left.displacement - right.displacement ||
            left.index - right.index
          )[0].position
        : positions.find((candidate) => {
            const rectangle = {
              left: candidate.x,
              top: candidate.y,
              right: candidate.x + labelWidth,
              bottom: candidate.y + labelHeight,
            };
            if (
              rectangle.left < margin || rectangle.top < margin ||
              rectangle.right > this.width - margin || rectangle.bottom > this.height - margin
            ) {
              return false;
            }
            return !occupied.some((existing) => !(
              rectangle.right + AREA_LABEL_GAP_PX <= existing.left ||
              rectangle.left >= existing.right + AREA_LABEL_GAP_PX ||
              rectangle.bottom + AREA_LABEL_GAP_PX <= existing.top ||
              rectangle.top >= existing.bottom + AREA_LABEL_GAP_PX
            ));
          });
      if (!position) continue;

      const rectangle = {
        left: position.x,
        top: position.y,
        right: position.x + labelWidth,
        bottom: position.y + labelHeight,
      };
      occupied.push(rectangle);
      placements.push({
        ...this.publicArea(area),
        x: Math.round(position.x),
        y: Math.round(position.y),
        width: Math.round(labelWidth),
        height: labelHeight,
        anchorX: Math.round(anchor.x),
        anchorY: Math.round(anchor.y),
        side: position.side,
        active: area.id === this.activeAreaId,
        selected: area.id === this.selectedAreaId,
      });
    }
    context.restore();
    return placements;
  }

  publishAreaLabels(context) {
    if (!this.callbacks.onAreaLabels) return;
    const placements = this.computeAreaLabelPlacements(context);
    const signature = placements.map((placement) => [
      placement.id,
      placement.x,
      placement.y,
      placement.width,
      placement.side,
      placement.active,
      placement.selected,
    ].join(":")).join("|");
    if (signature === this.lastAreaLabelSignature) return;
    this.lastAreaLabelSignature = signature;
    this.callbacks.onAreaLabels(placements);
  }

  coverageRadius(area) {
    const zoomScale = 0.85 + clamp((this.zoom - 2) / (OVERVIEW_MAX_ZOOM - 2), 0, 1) * 0.95;
    return Math.min(17, (2.25 + Math.log2(area.count + 1) * 0.8) * zoomScale);
  }

  nearestCoverageTarget(point, kind) {
    let match = null;
    let nearestDistance = Infinity;
    for (const target of this.coverageHitTargets) {
      if (kind && target.kind !== kind) continue;
      const distance = Math.hypot(point.x - target.point.x, point.y - target.point.y);
      if (distance <= target.radius && distance < nearestDistance) {
        match = target;
        nearestDistance = distance;
      }
    }
    return match;
  }

  queueCoverageAreaClick(kind, area, point, now, pointerType = "mouse") {
    const pending = this.pendingAreaClick;
    const doubleClickDistance = pointerType === "touch" ? 24 : AREA_DOUBLE_CLICK_DISTANCE_PX;
    const isSecondClick = pending &&
      pending.kind === kind &&
      pending.area.id === area.id &&
      now - pending.time <= AREA_DOUBLE_CLICK_WINDOW_MS &&
      Math.hypot(point.x - pending.point.x, point.y - pending.point.y) <= doubleClickDistance;
    if (isSecondClick) {
      this.cancelPendingAreaClick();
      if (kind === "semantic") {
        this.setActiveArea(area.id);
        this.callbacks.onAreaSelect?.(this.publicArea(area));
      } else {
        this.setActiveGroup(area.id);
        this.callbacks.onGroupSelect?.(this.publicCoverageArea(area));
      }
      return;
    }

    this.cancelPendingAreaClick();
    const click = {
      kind,
      area,
      point: { ...point },
      time: now,
      peekTimer: 0,
      expiryTimer: 0,
    };
    click.peekTimer = window.setTimeout(() => {
      if (this.pendingAreaClick !== click) return;
      click.peekTimer = 0;
      if (kind === "semantic") {
        this.setActiveArea(area.id);
        this.callbacks.onAreaPeek?.(this.publicArea(area));
      } else {
        this.setActiveGroup(area.id);
        this.callbacks.onGroupPeek?.(this.publicCoverageArea(area));
      }
    }, AREA_SINGLE_CLICK_DELAY_MS);
    click.expiryTimer = window.setTimeout(() => {
      if (this.pendingAreaClick === click) this.pendingAreaClick = null;
    }, AREA_DOUBLE_CLICK_WINDOW_MS);
    this.pendingAreaClick = click;
  }

  cancelPendingAreaClick() {
    if (!this.pendingAreaClick) return;
    window.clearTimeout(this.pendingAreaClick.peekTimer);
    window.clearTimeout(this.pendingAreaClick.expiryTimer);
    this.pendingAreaClick = null;
  }

  activateCoverageAreaAt(point, now = performance.now(), pointerType = "mouse") {
    const semanticTarget = this.nearestCoverageTarget(point, "semantic");
    if (semanticTarget) {
      this.queueCoverageAreaClick("semantic", semanticTarget.area, point, now, pointerType);
      return true;
    }

    const fallbackTarget = this.nearestCoverageTarget(point, "fallback");
    if (!fallbackTarget) return false;
    this.queueCoverageAreaClick("fallback", fallbackTarget.area, point, now, pointerType);
    return true;
  }

  traceProjectedSegments(context, segments) {
    for (const segment of segments) {
      if (segment.length < 4) continue;
      context.moveTo(
        (segment[0] - this.center.x) * this.scale + this.width / 2,
        (segment[1] - this.center.y) * this.scale + this.height / 2,
      );
      for (let index = 2; index < segment.length; index += 2) {
        context.lineTo(
          (segment[index] - this.center.x) * this.scale + this.width / 2,
          (segment[index + 1] - this.center.y) * this.scale + this.height / 2,
        );
      }
    }
  }

  drawSelectionBox(context) {
    if (!this.selectionBox) return;
    const x = Math.min(this.selectionBox.start.x, this.selectionBox.end.x);
    const y = Math.min(this.selectionBox.start.y, this.selectionBox.end.y);
    const width = Math.abs(this.selectionBox.end.x - this.selectionBox.start.x);
    const height = Math.abs(this.selectionBox.end.y - this.selectionBox.start.y);
    context.save();
    context.fillStyle = "rgb(185 55 32 / 0.14)";
    context.strokeStyle = "#b93722";
    context.lineWidth = 1;
    context.setLineDash([5, 4]);
    context.fillRect(x, y, width, height);
    context.strokeRect(x, y, width, height);
    context.restore();
  }
}
