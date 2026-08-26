const SCHEMA_VERSION = 1;
const DOCUMENT_KIND = "bobs-trail-pack-curation";
const UNASSIGNED_LAYER_ID = "__unassigned__";
const HISTORY_LIMIT = 40;
const SAVE_DELAY_MS = 180;
const PACK_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const elementIds = {
  root: "trailCuration",
  dirty: "trailCurationDirty",
  summary: "trailCurationSummary",
  selection: "trailCurationSelection",
  packName: "trailCurationPackName",
  create: "trailCurationNew",
  rename: "trailCurationRename",
  add: "trailCurationAdd",
  replace: "trailCurationReplace",
  unassign: "trailCurationUnassign",
  clearSelection: "trailCurationClearSelection",
  search: "trailCurationSearch",
  inView: "trailCurationInView",
  merge: "trailCurationMerge",
  showAll: "trailCurationShowAll",
  checkVisible: "trailCurationCheckVisible",
  checked: "trailCurationChecked",
  layers: "trailCurationLayers",
  loose: "trailCurationLoose",
  export: "trailCurationExport",
  import: "trailCurationImport",
  reset: "trailCurationReset",
  importFile: "trailCurationImportFile",
  undo: "trailCurationUndo",
  redo: "trailCurationRedo",
  autoFit: "trailCurationAutoFit",
};

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(Number(value) || 0);
}

function isFinitePoint(value) {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
}

function isValidBounds(value) {
  return Array.isArray(value) && value.length === 4 && value.every(Number.isFinite) &&
    value[0] <= value[2] && value[1] <= value[3];
}

function boxesIntersect(left, right) {
  return isValidBounds(left) && isValidBounds(right) &&
    left[0] <= right[2] && left[2] >= right[0] &&
    left[1] <= right[3] && left[3] >= right[1];
}

function extendBounds(target, source) {
  if (!isValidBounds(source)) return;
  target[0] = Math.min(target[0], source[0]);
  target[1] = Math.min(target[1], source[1]);
  target[2] = Math.max(target[2], source[2]);
  target[3] = Math.max(target[3], source[3]);
}

function centerOfBounds(bounds) {
  return isValidBounds(bounds)
    ? [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2]
    : null;
}

function sortedStrings(values) {
  return [...values].map(String).sort((left, right) => left.localeCompare(right));
}

function slugify(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "riding-pack";
}

function valuesOf(value) {
  if (value instanceof Map) return [...value.values()];
  if (Array.isArray(value)) return [...value];
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function entriesOf(value) {
  if (value instanceof Map) return [...value.entries()];
  if (Array.isArray(value)) {
    return value.map((item, index) => [item?.id ?? item?.trail_id ?? index, item]);
  }
  if (value && typeof value === "object") return Object.entries(value);
  return [];
}

function editableTarget(target) {
  return target instanceof Element && (
    target.matches("input, textarea, select") || target.isContentEditable
  );
}

function safeCall(host, method, ...args) {
  if (typeof host?.[method] !== "function") return undefined;
  return host[method](...args);
}

function readHostValue(host, property, fallback = null) {
  const value = host?.[property];
  if (typeof value === "function") return value.call(host);
  return value ?? fallback;
}

function normalizeTrail(idHint, metadata) {
  const id = String(metadata?.id ?? metadata?.trailId ?? metadata?.trail_id ?? idHint ?? "");
  if (!id.startsWith("trail-")) throw new Error(`Invalid trail ID in loaded catalog: ${id || "<empty>"}`);
  const bbox = metadata?.bbox;
  if (!isValidBounds(bbox)) throw new Error(`Trail ${id} has invalid bounds.`);
  const pointCount = Number(metadata?.pointCount ?? metadata?.point_count ?? 0);
  if (!Number.isInteger(pointCount) || pointCount < 1) {
    throw new Error(`Trail ${id} has an invalid source point count.`);
  }
  const lengthM = Number(metadata?.lengthM ?? metadata?.length_m ?? 0);
  return {
    id,
    bbox: [...bbox],
    pointCount,
    lengthM: Number.isFinite(lengthM) && lengthM >= 0 ? lengthM : 0,
    groupId: String(metadata?.groupId ?? metadata?.group_id ?? metadata?.tile ?? "unknown"),
    areaId: metadata?.areaId ?? metadata?.area_id ?? null,
    collectionId: metadata?.collectionId ?? metadata?.collection_id ?? null,
  };
}

export function createTrailCurator(host) {
  if (!host || typeof host !== "object") throw new TypeError("Trail curator needs a host object.");

  const elements = Object.fromEntries(
    Object.entries(elementIds).map(([key, id]) => [key, document.getElementById(id)]),
  );
  if (!elements.root || !elements.layers) {
    throw new Error("The local grouping-board container is missing.");
  }

  const state = {
    initialized: false,
    initializing: null,
    destroyed: false,
    manifest: null,
    source: null,
    storageKey: null,
    trails: new Map(),
    groups: new Map(),
    assignments: new Map(),
    selected: new Set(),
    checked: new Set(),
    activeGroupId: null,
    unassignedVisible: true,
    autoFitSelection: true,
    currentViewBounds: null,
    visibleRowGroupIds: [],
    seedDocument: null,
    undoStack: [],
    redoStack: [],
    saveTimer: 0,
    listeners: [],
  };

  function report(message, error = false) {
    safeCall(host, "setStatus", message, error);
  }

  function on(element, type, listener, options) {
    if (!element) return;
    element.addEventListener(type, listener, options);
    state.listeners.push(() => element.removeEventListener(type, listener, options));
  }

  function groupDerived(group) {
    const bounds = [Infinity, Infinity, -Infinity, -Infinity];
    let pointCount = 0;
    let lengthM = 0;
    const transportGroupIds = new Set();
    for (const trailId of group.trailIds) {
      const trail = state.trails.get(trailId);
      if (!trail) continue;
      extendBounds(bounds, trail.bbox);
      pointCount += trail.pointCount;
      lengthM += trail.lengthM;
      transportGroupIds.add(trail.groupId);
    }
    const validBounds = isValidBounds(bounds) ? bounds : null;
    return {
      bounds: validBounds,
      pointCount,
      lengthM,
      labelPoint: isFinitePoint(group.labelPoint)
        ? [...group.labelPoint]
        : centerOfBounds(validBounds),
      transportGroupIds: sortedStrings(transportGroupIds),
    };
  }

  function unassignedIds() {
    return [...state.assignments]
      .filter(([, groupId]) => groupId === null)
      .map(([trailId]) => trailId);
  }

  function selectedPointCount() {
    let total = 0;
    for (const trailId of state.selected) total += state.trails.get(trailId)?.pointCount || 0;
    return total;
  }

  function uniquePackId(name) {
    const base = slugify(name);
    if (!state.groups.has(base)) return base;
    let suffix = 2;
    while (state.groups.has(`${base}-${suffix}`)) suffix += 1;
    return `${base}-${suffix}`;
  }

  function createGroupRecord({
    id,
    name,
    labelPoint = null,
    provisional = false,
    transportGroupId = null,
    trailIds = [],
    visible = true,
  }) {
    return {
      id: String(id),
      name: String(name),
      labelPoint: isFinitePoint(labelPoint) ? [...labelPoint] : null,
      provisional: Boolean(provisional),
      transportGroupId: transportGroupId === null ? null : String(transportGroupId),
      trailIds: new Set(trailIds),
      visible: Boolean(visible),
    };
  }

  function setAssignment(trailId, nextGroupId) {
    const previousGroupId = state.assignments.get(trailId);
    if (previousGroupId === nextGroupId) return false;
    if (previousGroupId !== null) state.groups.get(previousGroupId)?.trailIds.delete(trailId);
    if (nextGroupId !== null) {
      const nextGroup = state.groups.get(nextGroupId);
      if (!nextGroup) throw new Error(`Unknown target pack: ${nextGroupId}`);
      nextGroup.trailIds.add(trailId);
    }
    state.assignments.set(trailId, nextGroupId);
    return true;
  }

  function pruneEmptyGroups() {
    for (const [groupId, group] of state.groups) {
      if (group.trailIds.size) continue;
      state.groups.delete(groupId);
      state.checked.delete(groupId);
      if (state.activeGroupId === groupId) state.activeGroupId = null;
    }
  }

  function buildDocument() {
    const packs = [...state.groups.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((group) => {
        const derived = groupDerived(group);
        return {
          id: group.id,
          name: group.name,
          labelPoint: derived.labelPoint,
          provisional: group.provisional,
          transportGroupId: group.transportGroupId,
          trailIds: sortedStrings(group.trailIds),
        };
      });
    return {
      schemaVersion: SCHEMA_VERSION,
      kind: DOCUMENT_KIND,
      source: {
        qualityScope: state.source.qualityScope,
        sourceCatalogSha256: state.source.sourceCatalogSha256,
        trailCount: state.source.trailCount,
        seedBuildKey: state.source.seedBuildKey,
      },
      packs,
      unassignedTrailIds: sortedStrings(unassignedIds()),
      editor: {
        hiddenPackIds: sortedStrings(
          [...state.groups.values()].filter((group) => !group.visible).map((group) => group.id),
        ),
        unassignedVisible: state.unassignedVisible,
        autoFitSelection: state.autoFitSelection,
        activePackId: state.groups.has(state.activeGroupId) ? state.activeGroupId : null,
        checkedPackIds: sortedStrings([...state.checked].filter((id) => state.groups.has(id))),
      },
    };
  }

  function validateDocument(document) {
    if (document?.schemaVersion !== SCHEMA_VERSION || document?.kind !== DOCUMENT_KIND) {
      throw new Error("That file is not a supported Bob's trail grouping draft.");
    }
    const source = document.source;
    if (
      source?.qualityScope !== state.source.qualityScope ||
      source?.sourceCatalogSha256 !== state.source.sourceCatalogSha256 ||
      source?.trailCount !== state.source.trailCount
    ) {
      throw new Error("That grouping file belongs to a different trail catalog.");
    }
    if (!Array.isArray(document.packs) || !Array.isArray(document.unassignedTrailIds)) {
      throw new Error("The grouping file is missing packs or unassigned trails.");
    }

    const groups = new Map();
    const assignments = new Map([...state.trails.keys()].map((trailId) => [trailId, null]));
    const seenTrailIds = new Set();
    const seenNames = new Set();
    for (const pack of document.packs) {
      const id = pack?.id;
      const name = typeof pack?.name === "string" ? pack.name.trim() : "";
      if (typeof id !== "string" || !PACK_ID_PATTERN.test(id) || groups.has(id)) {
        throw new Error(`Invalid or duplicate pack ID: ${id || "<empty>"}`);
      }
      if (!name || name.length > 80) throw new Error(`Pack ${id} has an invalid name.`);
      const foldedName = name.toLocaleLowerCase();
      if (seenNames.has(foldedName)) throw new Error(`Duplicate pack name: ${name}`);
      seenNames.add(foldedName);
      if (pack.labelPoint !== null && !isFinitePoint(pack.labelPoint)) {
        throw new Error(`Pack ${id} has an invalid label point.`);
      }
      if (typeof pack.provisional !== "boolean") {
        throw new Error(`Pack ${id} has an invalid provisional flag.`);
      }
      if (pack.transportGroupId !== null && typeof pack.transportGroupId !== "string") {
        throw new Error(`Pack ${id} has an invalid transport group.`);
      }
      if (!Array.isArray(pack.trailIds) || !pack.trailIds.length) {
        throw new Error(`Pack ${id} contains no trails.`);
      }
      const trailIds = new Set();
      for (const rawTrailId of pack.trailIds) {
        if (typeof rawTrailId !== "string" || !rawTrailId) {
          throw new Error(`Pack ${id} contains an invalid trail ID.`);
        }
        const trailId = rawTrailId;
        if (!state.trails.has(trailId)) throw new Error(`Pack ${id} references unknown trail ${trailId}.`);
        if (seenTrailIds.has(trailId)) throw new Error(`Trail ${trailId} appears more than once.`);
        seenTrailIds.add(trailId);
        trailIds.add(trailId);
        assignments.set(trailId, id);
      }
      groups.set(id, createGroupRecord({
        id,
        name,
        labelPoint: pack.labelPoint,
        provisional: pack.provisional,
        transportGroupId: pack.transportGroupId,
        trailIds,
      }));
    }

    for (const rawTrailId of document.unassignedTrailIds) {
      if (typeof rawTrailId !== "string" || !rawTrailId) {
        throw new Error("The unassigned list contains an invalid trail ID.");
      }
      const trailId = rawTrailId;
      if (!state.trails.has(trailId)) throw new Error(`Unknown unassigned trail ${trailId}.`);
      if (seenTrailIds.has(trailId)) throw new Error(`Trail ${trailId} appears more than once.`);
      seenTrailIds.add(trailId);
    }
    if (seenTrailIds.size !== state.trails.size) {
      const missing = [...state.trails.keys()].find((trailId) => !seenTrailIds.has(trailId));
      throw new Error(`The grouping file does not account for every trail${missing ? `; missing ${missing}` : ""}.`);
    }

    const editor = document.editor;
    if (
      !editor || typeof editor !== "object" || Array.isArray(editor) ||
      !Array.isArray(editor.hiddenPackIds) || !Array.isArray(editor.checkedPackIds) ||
      typeof editor.unassignedVisible !== "boolean" ||
      (editor.autoFitSelection !== undefined && typeof editor.autoFitSelection !== "boolean") ||
      (editor.activePackId !== null && typeof editor.activePackId !== "string")
    ) {
      throw new Error("The grouping file has invalid editor state.");
    }
    if (
      editor.hiddenPackIds.some((id) => typeof id !== "string") ||
      editor.checkedPackIds.some((id) => typeof id !== "string")
    ) {
      throw new Error("The grouping file has invalid editor pack IDs.");
    }
    const hiddenPackIds = new Set(editor.hiddenPackIds);
    const checkedPackIds = new Set(editor.checkedPackIds);
    if (
      hiddenPackIds.size !== editor.hiddenPackIds.length ||
      checkedPackIds.size !== editor.checkedPackIds.length
    ) {
      throw new Error("The grouping file repeats an editor pack ID.");
    }
    for (const id of [...hiddenPackIds, ...checkedPackIds]) {
      if (!groups.has(id)) throw new Error(`Editor state references unknown pack ${id}.`);
    }
    for (const group of groups.values()) group.visible = !hiddenPackIds.has(group.id);
    const activeGroupId = editor.activePackId ?? null;
    if (activeGroupId !== null && !groups.has(activeGroupId)) {
      throw new Error(`Editor state references unknown active pack ${activeGroupId}.`);
    }
    return {
      groups,
      assignments,
      activeGroupId,
      checked: checkedPackIds,
      unassignedVisible: editor.unassignedVisible,
      autoFitSelection: editor.autoFitSelection !== false,
    };
  }

  function applyValidatedDocument(validated) {
    state.groups = validated.groups;
    state.assignments = validated.assignments;
    state.activeGroupId = validated.activeGroupId;
    state.checked = validated.checked;
    state.unassignedVisible = validated.unassignedVisible;
    state.autoFitSelection = validated.autoFitSelection;
    state.selected = new Set([...state.selected].filter((trailId) => state.trails.has(trailId)));
  }

  function captureSnapshot() {
    return {
      document: buildDocument(),
      selectedTrailIds: sortedStrings(state.selected),
    };
  }

  function restoreSnapshot(snapshot) {
    applyValidatedDocument(validateDocument(snapshot.document));
    state.selected = new Set(
      (snapshot.selectedTrailIds || []).filter((trailId) => state.trails.has(trailId)),
    );
  }

  function hiddenState() {
    const hiddenGroupIds = new Set(
      [...state.groups.values()].filter((group) => !group.visible).map((group) => group.id),
    );
    const hiddenTrailIds = new Set();
    for (const [trailId, groupId] of state.assignments) {
      if ((groupId === null && !state.unassignedVisible) || hiddenGroupIds.has(groupId)) {
        hiddenTrailIds.add(trailId);
      }
    }
    return { hiddenGroupIds, hiddenTrailIds };
  }

  function areasForHost() {
    return [...state.groups.values()].map((group) => {
      const derived = groupDerived(group);
      return {
        id: group.id,
        name: group.name,
        count: group.trailIds.size,
        pointCount: derived.pointCount,
        viewBounds: derived.bounds,
        labelPoint: derived.labelPoint,
        groupIds: derived.transportGroupIds,
      };
    }).filter((area) => isValidBounds(area.viewBounds) && isFinitePoint(area.labelPoint));
  }

  function syncHostAssignments() {
    const { hiddenGroupIds, hiddenTrailIds } = hiddenState();
    safeCall(
      host,
      "setCuratorAssignments",
      new Map(state.assignments),
      {
        hiddenTrailIds,
        hiddenAreaIds: new Set(hiddenGroupIds),
        hiddenCoverageAreaIds: new Set(hiddenGroupIds),
        areas: areasForHost(),
        coverageAreas: [],
        activeGroupId: state.groups.has(state.activeGroupId) ? state.activeGroupId : null,
      },
    );
  }

  function notifyMapSelection() {
    if (typeof host.setMapSelection === "function") {
      host.setMapSelection(new Set(state.selected));
    } else if (!state.selected.size) {
      safeCall(host, "clearMapSelection");
    }
  }

  function setDirty(saving, failed = false) {
    if (!elements.dirty) return;
    elements.dirty.classList.toggle("is-dirty", saving || failed);
    elements.dirty.textContent = failed ? "Export this draft" : saving ? "Saving locally…" : "Saved locally";
  }

  function saveNow() {
    window.clearTimeout(state.saveTimer);
    state.saveTimer = 0;
    try {
      window.localStorage.setItem(state.storageKey, JSON.stringify(buildDocument()));
      setDirty(false);
    } catch (error) {
      setDirty(false, true);
      report(`The grouping draft could not be saved locally: ${error.message}`, true);
    }
  }

  function scheduleSave() {
    if (!state.initialized || state.destroyed) return;
    setDirty(true);
    window.clearTimeout(state.saveTimer);
    state.saveTimer = window.setTimeout(saveNow, SAVE_DELAY_MS);
  }

  function groupIsInView(group, viewBounds) {
    if (!isValidBounds(viewBounds)) return true;
    return boxesIntersect(groupDerived(group).bounds, viewBounds);
  }

  function filteredGroups() {
    const query = (elements.search?.value || "").trim().toLocaleLowerCase();
    const requireInView = Boolean(elements.inView?.checked);
    return [...state.groups.values()]
      .filter((group) => !query || group.name.toLocaleLowerCase().includes(query) || group.id.includes(query))
      .filter((group) => !requireInView || groupIsInView(group, state.currentViewBounds))
      .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
  }

  function createLayerRow(group) {
    const derived = groupDerived(group);
    const row = document.createElement("div");
    row.className = "trail-curation-layer";
    row.classList.toggle("is-active", state.activeGroupId === group.id);
    row.classList.toggle("is-checked", state.checked.has(group.id));
    row.classList.toggle("is-hidden", !group.visible);
    row.dataset.groupId = group.id;

    const eye = document.createElement("button");
    eye.type = "button";
    eye.className = "trail-curation-layer-eye";
    eye.textContent = group.visible ? "●" : "○";
    eye.title = group.visible ? `Hide ${group.name}` : `Show ${group.name}`;
    eye.setAttribute("aria-label", eye.title);
    eye.setAttribute("aria-pressed", String(group.visible));
    eye.addEventListener("click", () => toggleVisibility(group.id));

    const checkLabel = document.createElement("label");
    checkLabel.className = "trail-curation-layer-check";
    checkLabel.title = `Check ${group.name} for merging`;
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.checked.has(group.id);
    checkbox.setAttribute("aria-label", checkLabel.title);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) state.checked.add(group.id);
      else state.checked.delete(group.id);
      render();
      scheduleSave();
    });
    checkLabel.append(checkbox);

    const name = document.createElement("button");
    name.type = "button";
    name.className = "trail-curation-layer-name";
    name.textContent = group.name;
    name.title = group.provisional ? `${group.name} · provisional loose cluster` : group.name;
    name.addEventListener("click", (event) => {
      selectGroup(group.id, { additive: event.shiftKey });
    });

    const meta = document.createElement("span");
    meta.className = "trail-curation-layer-meta";
    meta.textContent = `${formatNumber(group.trailIds.size)} trails · ` +
      `${formatNumber(derived.pointCount)} pts · Needs pack check`;

    row.append(eye, checkLabel, name, meta);
    return row;
  }

  function createUnassignedRow(ids) {
    const group = createGroupRecord({
      id: UNASSIGNED_LAYER_ID,
      name: "Unassigned",
      trailIds: ids,
      visible: state.unassignedVisible,
    });
    const derived = groupDerived(group);
    const row = document.createElement("div");
    row.className = "trail-curation-layer";
    row.classList.toggle("is-active", state.activeGroupId === UNASSIGNED_LAYER_ID);
    row.classList.toggle("is-hidden", !state.unassignedVisible);

    const eye = document.createElement("button");
    eye.type = "button";
    eye.className = "trail-curation-layer-eye";
    eye.textContent = state.unassignedVisible ? "●" : "○";
    eye.title = state.unassignedVisible ? "Hide unassigned trails" : "Show unassigned trails";
    eye.setAttribute("aria-label", eye.title);
    eye.addEventListener("click", toggleUnassignedVisibility);

    const spacer = document.createElement("span");
    spacer.className = "trail-curation-layer-check";
    spacer.setAttribute("aria-hidden", "true");

    const name = document.createElement("button");
    name.type = "button";
    name.className = "trail-curation-layer-name";
    name.textContent = "Unassigned";
    name.addEventListener("click", () => selectGroup(UNASSIGNED_LAYER_ID));

    const meta = document.createElement("span");
    meta.className = "trail-curation-layer-meta";
    meta.textContent = `${formatNumber(ids.length)} trails · ${formatNumber(derived.pointCount)} pts`;
    row.append(eye, spacer, name, meta);
    return row;
  }

  function render() {
    if (state.destroyed) return;
    const groups = filteredGroups();
    state.visibleRowGroupIds = groups.map((group) => group.id);
    const fragment = document.createDocumentFragment();
    for (const group of groups) fragment.append(createLayerRow(group));

    const looseIds = unassignedIds();
    const query = (elements.search?.value || "").trim().toLocaleLowerCase();
    const unassignedMatches = !query || "unassigned loose".includes(query);
    const looseGroup = createGroupRecord({ id: UNASSIGNED_LAYER_ID, name: "Unassigned", trailIds: looseIds });
    const unassignedInView = !elements.inView?.checked || groupIsInView(looseGroup, state.currentViewBounds);
    if (looseIds.length && unassignedMatches && unassignedInView) fragment.append(createUnassignedRow(looseIds));
    elements.layers.replaceChildren(fragment);

    const assignedCount = state.trails.size - looseIds.length;
    if (elements.summary) {
      elements.summary.textContent = `${formatNumber(state.groups.size)} packs · ` +
        `${formatNumber(assignedCount)} assigned · ${formatNumber(looseIds.length)} unassigned`;
    }
    if (elements.selection) {
      elements.selection.textContent = state.selected.size
        ? `${formatNumber(state.selected.size)} selected · ${formatNumber(selectedPointCount())} source points`
        : "No trails selected.";
    }
    if (elements.loose) {
      const provisionalCount = [...state.groups.values()].filter((group) => group.provisional).length;
      elements.loose.textContent = `${formatNumber(provisionalCount)} provisional loose clusters · ` +
        "Every trail remains represented in a pack or Unassigned.";
    }
    if (elements.checked) elements.checked.textContent = `${formatNumber(state.checked.size)} checked`;
    if (elements.autoFit) elements.autoFit.checked = state.autoFitSelection;

    const hasSelection = state.selected.size > 0;
    const hasActivePack = state.groups.has(state.activeGroupId);
    if (elements.create) elements.create.disabled = !hasSelection;
    if (elements.rename) elements.rename.disabled = !hasActivePack;
    if (elements.add) elements.add.disabled = !hasSelection || !hasActivePack;
    if (elements.replace) elements.replace.disabled = !hasSelection || !hasActivePack;
    if (elements.unassign) elements.unassign.disabled = !hasSelection;
    if (elements.clearSelection) elements.clearSelection.disabled = !hasSelection;
    if (elements.merge) elements.merge.disabled = state.checked.size < 2;
    if (elements.undo) elements.undo.disabled = !state.undoStack.length;
    if (elements.redo) elements.redo.disabled = !state.redoStack.length;
    if (elements.checkVisible) elements.checkVisible.disabled = !state.visibleRowGroupIds.length;
  }

  function afterDataChange(message) {
    pruneEmptyGroups();
    syncHostAssignments();
    notifyMapSelection();
    render();
    scheduleSave();
    if (message) report(message);
  }

  function transact(mutator, message) {
    const before = captureSnapshot();
    let changed = false;
    try {
      changed = mutator() !== false;
    } catch (error) {
      restoreSnapshot(before);
      throw error;
    }
    if (!changed) return false;
    state.undoStack.push(before);
    if (state.undoStack.length > HISTORY_LIMIT) state.undoStack.shift();
    state.redoStack = [];
    afterDataChange(message);
    return true;
  }

  function requestedName(fallback = "") {
    return (elements.packName?.value || fallback).trim();
  }

  function assertUniqueName(name, exceptId = null) {
    if (!name) throw new Error("Enter a pack name first.");
    if (name.length > 80) throw new Error("Pack names are limited to 80 characters.");
    const duplicate = [...state.groups.values()].find(
      (group) => group.id !== exceptId && group.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    );
    if (duplicate) throw new Error(`A pack named ${name} already exists.`);
  }

  function newFromSelection() {
    if (!state.selected.size) return;
    try {
      const name = requestedName();
      assertUniqueName(name);
      const id = uniquePackId(name);
      transact(() => {
        const group = createGroupRecord({ id, name, trailIds: [], visible: true });
        state.groups.set(id, group);
        for (const trailId of state.selected) setAssignment(trailId, id);
        const derived = groupDerived(group);
        group.labelPoint = derived.labelPoint;
        state.activeGroupId = id;
        state.checked.clear();
      }, `Created ${name} from ${formatNumber(state.selected.size)} selected trails.`);
      if (elements.packName) elements.packName.value = name;
    } catch (error) {
      report(error.message, true);
    }
  }

  function renameActive() {
    const group = state.groups.get(state.activeGroupId);
    if (!group) return;
    try {
      const name = requestedName();
      assertUniqueName(name, group.id);
      if (name === group.name && !group.provisional) return;
      transact(() => {
        group.name = name;
        group.provisional = false;
      }, `Renamed the active pack to ${name}.`);
    } catch (error) {
      report(error.message, true);
    }
  }

  function addSelectionToActive() {
    const group = state.groups.get(state.activeGroupId);
    if (!group || !state.selected.size) return;
    const changedIds = [...state.selected].filter(
      (trailId) => state.assignments.get(trailId) !== group.id,
    );
    if (!changedIds.length) {
      report("Every selected trail is already in the active pack.");
      return;
    }
    transact(() => {
      for (const trailId of changedIds) setAssignment(trailId, group.id);
    }, `Moved ${formatNumber(changedIds.length)} trails into ${group.name}.`);
  }

  function replaceActiveFromSelection() {
    const group = state.groups.get(state.activeGroupId);
    if (!group || !state.selected.size) return;
    transact(() => {
      const nextIds = new Set(state.selected);
      for (const trailId of [...group.trailIds]) {
        if (!nextIds.has(trailId)) setAssignment(trailId, null);
      }
      for (const trailId of nextIds) setAssignment(trailId, group.id);
    }, `Replaced ${group.name} with ${formatNumber(state.selected.size)} selected trails.`);
  }

  function unassignSelection() {
    const assignedSelection = [...state.selected].filter(
      (trailId) => state.assignments.get(trailId) !== null,
    );
    if (!assignedSelection.length) {
      report("The selected trails are already unassigned.");
      return;
    }
    transact(() => {
      for (const trailId of assignedSelection) setAssignment(trailId, null);
      state.activeGroupId = UNASSIGNED_LAYER_ID;
    }, `Moved ${formatNumber(assignedSelection.length)} trails to Unassigned.`);
  }

  function clearSelection({ notify = true } = {}) {
    if (!state.selected.size) return;
    state.selected.clear();
    notifyMapSelection();
    render();
    if (notify) report("Trail selection cleared.");
  }

  function mergeChecked() {
    const ids = [...state.checked].filter((groupId) => state.groups.has(groupId));
    if (ids.length < 2) return;
    const targetId = ids.includes(state.activeGroupId) ? state.activeGroupId : ids[0];
    const target = state.groups.get(targetId);
    transact(() => {
      for (const sourceId of ids) {
        if (sourceId === targetId) continue;
        const source = state.groups.get(sourceId);
        for (const trailId of source.trailIds) setAssignment(trailId, targetId);
        state.groups.delete(sourceId);
      }
      state.activeGroupId = targetId;
      state.checked.clear();
    }, `Merged ${formatNumber(ids.length)} layers into ${target.name}.`);
    if (elements.packName) elements.packName.value = target.name;
  }

  function toggleVisibility(groupId) {
    const group = state.groups.get(groupId);
    if (!group) return;
    const willBeVisible = !group.visible;
    transact(() => {
      group.visible = willBeVisible;
    }, `${willBeVisible ? "Showed" : "Hid"} ${group.name}.`);
  }

  function toggleUnassignedVisibility() {
    const willBeVisible = !state.unassignedVisible;
    transact(() => {
      state.unassignedVisible = willBeVisible;
    }, `${willBeVisible ? "Showed" : "Hid"} unassigned trails.`);
  }

  function showAll() {
    const hasHidden = !state.unassignedVisible || [...state.groups.values()].some((group) => !group.visible);
    if (!hasHidden) return;
    transact(() => {
      for (const group of state.groups.values()) group.visible = true;
      state.unassignedVisible = true;
    }, "All trail layers are visible.");
  }

  function checkVisible() {
    state.checked = new Set(state.visibleRowGroupIds.filter((id) => state.groups.has(id)));
    render();
    scheduleSave();
  }

  function selectionForGroup(groupId) {
    if (groupId === UNASSIGNED_LAYER_ID) return new Set(unassignedIds());
    return new Set(state.groups.get(groupId)?.trailIds || []);
  }

  function selectionForCheckedGroups() {
    const trailIds = new Set();
    for (const groupId of state.checked) {
      const group = state.groups.get(groupId);
      if (!group) continue;
      for (const trailId of group.trailIds) trailIds.add(trailId);
    }
    return trailIds;
  }

  function boundsForTrailIds(trailIds) {
    const bounds = [Infinity, Infinity, -Infinity, -Infinity];
    for (const trailId of trailIds) extendBounds(bounds, state.trails.get(trailId)?.bbox);
    return isValidBounds(bounds) ? bounds : null;
  }

  function selectGroup(groupId, { additive = false } = {}) {
    if (groupId !== UNASSIGNED_LAYER_ID && !state.groups.has(groupId)) return false;

    if (groupId === UNASSIGNED_LAYER_ID) {
      state.activeGroupId = groupId;
      state.checked.clear();
      state.selected = selectionForGroup(groupId);
      if (elements.packName) elements.packName.value = "";
      syncHostAssignments();
      notifyMapSelection();
      render();
      scheduleSave();
      const bounds = boundsForTrailIds(state.selected);
      if (state.autoFitSelection && bounds) safeCall(host, "fitBounds", bounds);
      report(`Unassigned selected · ${formatNumber(state.selected.size)} source trails.`);
      return true;
    }

    const clickedGroup = state.groups.get(groupId);
    if (!additive) {
      state.activeGroupId = groupId;
      state.checked = new Set([groupId]);
      state.selected = selectionForGroup(groupId);
    } else {
      if (state.checked.has(groupId)) state.checked.delete(groupId);
      else state.checked.add(groupId);

      if (state.checked.size && !state.checked.has(state.activeGroupId)) {
        state.activeGroupId = state.checked.values().next().value;
      } else if (!state.checked.size) {
        state.activeGroupId = groupId;
      }
      state.selected = selectionForCheckedGroups();
    }

    const activeGroup = state.groups.get(state.activeGroupId) || clickedGroup;
    if (elements.packName) elements.packName.value = activeGroup.name;
    syncHostAssignments();
    notifyMapSelection();
    render();
    scheduleSave();
    const bounds = boundsForTrailIds(state.selected);
    if (state.autoFitSelection && bounds) safeCall(host, "fitBounds", bounds);

    if (!additive) {
      report(
        `${clickedGroup.name} active · ${formatNumber(state.selected.size)} source trails. ` +
        "Shift-click another pack to add it to the merge set.",
      );
    } else if (!state.checked.size) {
      report(`No packs checked for merging. ${clickedGroup.name} remains active.`);
    } else if (state.checked.size === 1) {
      report(
        `1 pack checked · ${formatNumber(state.selected.size)} source trails. ` +
        "Shift-click another pack to build a merge set.",
      );
    } else {
      report(
        `${formatNumber(state.checked.size)} packs checked for merge · ` +
        `${formatNumber(state.selected.size)} source trails. Target: ${activeGroup.name}.`,
      );
    }
    return true;
  }

  function undo() {
    const snapshot = state.undoStack.pop();
    if (!snapshot) return;
    state.redoStack.push(captureSnapshot());
    restoreSnapshot(snapshot);
    syncHostAssignments();
    notifyMapSelection();
    render();
    scheduleSave();
    report("Undid the last grouping change.");
  }

  function redo() {
    const snapshot = state.redoStack.pop();
    if (!snapshot) return;
    state.undoStack.push(captureSnapshot());
    restoreSnapshot(snapshot);
    syncHostAssignments();
    notifyMapSelection();
    render();
    scheduleSave();
    report("Redid the grouping change.");
  }

  function resetToSeed() {
    if (!state.seedDocument) return;
    if (!window.confirm("Reset the grouping board to the currently loaded map catalog?")) return;
    transact(() => {
      applyValidatedDocument(validateDocument(state.seedDocument));
      state.selected.clear();
      state.activeGroupId = null;
      state.checked.clear();
    }, "Grouping board reset to the loaded catalog.");
  }

  function exportDocument() {
    try {
      const document = buildDocument();
      validateDocument(document);
      const text = `${JSON.stringify(document, null, 2)}\n`;
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = `bobs-trail-pack-curation-${state.source.sourceCatalogSha256.slice(0, 12)}.json`;
      window.document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      report(
        `Exported ${formatNumber(document.packs.length)} packs and ` +
        `${formatNumber(document.unassignedTrailIds.length)} unassigned trails.`,
      );
    } catch (error) {
      report(error.message, true);
    }
  }

  async function importFile(file) {
    if (!file) return;
    try {
      const document = JSON.parse(await file.text());
      const validated = validateDocument(document);
      transact(() => {
        applyValidatedDocument(validated);
        state.selected.clear();
      }, `Imported ${formatNumber(document.packs.length)} riding packs.`);
      if (elements.packName) {
        elements.packName.value = state.groups.get(state.activeGroupId)?.name || "";
      }
    } catch (error) {
      report(`Grouping import failed: ${error.message}`, true);
    } finally {
      if (elements.importFile) elements.importFile.value = "";
    }
  }

  function seedFromLoadedCatalog() {
    const areas = valuesOf(readHostValue(host, "areas", []))
      .map((area) => ({ ...area, id: String(area.id) }))
      .sort((left, right) => left.id.localeCompare(right.id));
    const collections = valuesOf(readHostValue(host, "collections", []))
      .map((collection) => ({ ...collection, id: String(collection.id) }))
      .sort((left, right) => left.id.localeCompare(right.id));
    const groups = new Map();
    const assignments = new Map([...state.trails.keys()].map((trailId) => [trailId, null]));

    for (const area of areas) {
      if (!PACK_ID_PATTERN.test(area.id) || groups.has(area.id)) {
        throw new Error(`Invalid or duplicate named riding-area ID: ${area.id}`);
      }
      groups.set(area.id, createGroupRecord({
        id: area.id,
        name: area.name,
        labelPoint: area.labelPoint,
      }));
    }

    for (const trail of state.trails.values()) {
      if (trail.areaId === null || trail.areaId === undefined || trail.areaId === "") continue;
      const areaId = String(trail.areaId);
      const group = groups.get(areaId);
      if (!group) throw new Error(`Trail ${trail.id} references unavailable named area ${areaId}.`);
      group.trailIds.add(trail.id);
      assignments.set(trail.id, areaId);
    }

    for (const collection of collections) {
      const trailIds = [...state.trails.values()]
        .filter((trail) => assignments.get(trail.id) === null && String(trail.collectionId || "") === collection.id)
        .map((trail) => trail.id);
      if (!trailIds.length) continue;
      const id = `${collection.id}-other`;
      if (!PACK_ID_PATTERN.test(id) || groups.has(id)) {
        throw new Error(`Invalid or duplicate collection remainder ID: ${id}`);
      }
      groups.set(id, createGroupRecord({
        id,
        name: `${collection.name} - Other`,
        labelPoint: collection.labelPoint,
        trailIds,
      }));
      for (const trailId of trailIds) assignments.set(trailId, id);
    }

    const remainingByTransportGroup = new Map();
    for (const trail of state.trails.values()) {
      if (assignments.get(trail.id) !== null) continue;
      const groupId = trail.groupId || "unknown";
      if (!remainingByTransportGroup.has(groupId)) remainingByTransportGroup.set(groupId, []);
      remainingByTransportGroup.get(groupId).push(trail.id);
    }
    for (const [transportGroupId, trailIds] of [...remainingByTransportGroup].sort(([left], [right]) => left.localeCompare(right))) {
      const id = uniqueIdAgainst(groups, `loose-${slugify(transportGroupId)}`);
      const displayToken = transportGroupId.replace(/[-_]+/g, " ").toUpperCase();
      groups.set(id, createGroupRecord({
        id,
        name: `Loose ${displayToken}`,
        provisional: true,
        transportGroupId,
        trailIds,
      }));
      for (const trailId of trailIds) assignments.set(trailId, id);
    }

    state.groups = groups;
    state.assignments = assignments;
    state.activeGroupId = null;
    state.checked.clear();
    state.unassignedVisible = true;
    const emptyGroups = [...state.groups.values()].filter((group) => !group.trailIds.size);
    for (const group of emptyGroups) state.groups.delete(group.id);
    if (state.assignments.size !== state.trails.size || [...state.assignments.values()].some((id) => id === null)) {
      throw new Error("The initial grouping board did not account for every loaded trail.");
    }
  }

  function uniqueIdAgainst(groups, preferred) {
    if (!groups.has(preferred)) return preferred;
    let suffix = 2;
    while (groups.has(`${preferred}-${suffix}`)) suffix += 1;
    return `${preferred}-${suffix}`;
  }

  function loadSavedDraft() {
    let text;
    try {
      text = window.localStorage.getItem(state.storageKey);
    } catch {
      return false;
    }
    if (!text) return false;
    try {
      applyValidatedDocument(validateDocument(JSON.parse(text)));
      return true;
    } catch (error) {
      report(`Ignored an incompatible local grouping draft: ${error.message}`, true);
      return false;
    }
  }

  function bindControls() {
    on(elements.create, "click", newFromSelection);
    on(elements.rename, "click", renameActive);
    on(elements.add, "click", addSelectionToActive);
    on(elements.replace, "click", replaceActiveFromSelection);
    on(elements.unassign, "click", unassignSelection);
    on(elements.clearSelection, "click", () => clearSelection());
    on(elements.merge, "click", mergeChecked);
    on(elements.showAll, "click", showAll);
    on(elements.checkVisible, "click", checkVisible);
    on(elements.export, "click", exportDocument);
    on(elements.import, "click", () => elements.importFile?.click());
    on(elements.importFile, "change", () => void importFile(elements.importFile.files?.[0]));
    on(elements.reset, "click", resetToSeed);
    on(elements.undo, "click", undo);
    on(elements.redo, "click", redo);
    on(elements.search, "input", render);
    on(elements.inView, "change", render);
    on(elements.autoFit, "change", () => {
      state.autoFitSelection = elements.autoFit.checked;
      scheduleSave();
      report(`Auto-fit selection ${state.autoFitSelection ? "enabled" : "disabled"}.`);
    });
    on(elements.packName, "keydown", (event) => {
      if (event.key === "Enter" && state.groups.has(state.activeGroupId)) {
        event.preventDefault();
        renameActive();
      }
    });
    on(window, "keydown", (event) => {
      if (editableTarget(event.target) || !(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLocaleLowerCase();
      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (key === "y") {
        event.preventDefault();
        redo();
      }
    });
  }

  async function initialize() {
    if (state.initialized) return api;
    if (state.initializing) return state.initializing;
    state.initializing = (async () => {
      elements.root.hidden = false;
      document.body.classList.add("is-curation-mode");
      setDirty(true);
      report("Loading the complete local trail catalog for grouping…");

      await safeCall(host, "ensureAllGroupsLoaded");
      state.manifest = readHostValue(host, "manifest");
      if (
        state.manifest?.scope !== "internal-canonical" ||
        typeof state.manifest?.sourceCatalogSha256 !== "string" ||
        !Number.isInteger(state.manifest?.counts?.trails)
      ) {
        throw new Error("The grouping board needs a complete internal-canonical map manifest.");
      }
      state.source = {
        qualityScope: state.manifest.scope,
        sourceCatalogSha256: state.manifest.sourceCatalogSha256,
        trailCount: state.manifest.counts.trails,
        seedBuildKey: state.manifest.buildKey || null,
      };
      state.storageKey = `bobs-trail-curation:v1:${state.source.sourceCatalogSha256}`;

      const catalogEntries = entriesOf(readHostValue(host, "catalog", new Map()));
      for (const [id, metadata] of catalogEntries) {
        const trail = normalizeTrail(id, metadata);
        if (state.trails.has(trail.id)) throw new Error(`Duplicate trail ${trail.id} in loaded catalog.`);
        state.trails.set(trail.id, trail);
      }
      if (state.trails.size !== state.source.trailCount) {
        throw new Error(
          `Grouping needs all ${formatNumber(state.source.trailCount)} trails; ` +
          `${formatNumber(state.trails.size)} are loaded.`,
        );
      }

      seedFromLoadedCatalog();
      state.seedDocument = buildDocument();
      const restored = loadSavedDraft();
      bindControls();
      state.currentViewBounds = readHostValue(host, "viewBounds");
      syncHostAssignments();
      render();
      state.initialized = true;
      saveNow();
      report(
        restored
          ? `Recovered the local grouping draft for all ${formatNumber(state.trails.size)} trails.`
          : `Grouping board ready · all ${formatNumber(state.trails.size)} trails are accounted for.`,
      );
      return api;
    })();
    try {
      return await state.initializing;
    } catch (error) {
      elements.root.hidden = true;
      document.body.classList.remove("is-curation-mode");
      for (const remove of state.listeners.splice(0)) remove();
      state.trails.clear();
      state.groups.clear();
      state.assignments.clear();
      state.initialized = false;
      throw error;
    } finally {
      state.initializing = null;
    }
  }

  function onViewport(bounds) {
    state.currentViewBounds = isValidBounds(bounds) ? [...bounds] : null;
    render();
  }

  function onSelectionChange(ids) {
    state.selected = new Set([...ids || []].filter((trailId) => state.trails.has(trailId)));
    render();
  }

  function onTrailToggle(trailId) {
    if (!state.trails.has(trailId)) return false;
    if (state.selected.has(trailId)) state.selected.delete(trailId);
    else state.selected.add(trailId);
    notifyMapSelection();
    render();
    return true;
  }

  async function onBox(bounds, suppliedIds = null) {
    let result = suppliedIds;
    if (result === null) {
      const finder = host.getTrailIdsIntersectingBounds || host.trailIdsInBounds;
      if (typeof finder !== "function") return false;
      result = await finder.call(host, bounds);
    }
    const ids = result?.ids ?? result ?? [];
    let changed = false;
    for (const trailId of ids) {
      if (!state.trails.has(trailId)) continue;
      if (state.selected.has(trailId)) state.selected.delete(trailId);
      else state.selected.add(trailId);
      changed = true;
    }
    if (changed) {
      notifyMapSelection();
      render();
    }
    return changed;
  }

  function onBackgroundSelect() {
    clearSelection({ notify: false });
  }

  function refresh() {
    const selection = readHostValue(host, "selectedTrailIds", null);
    if (selection) onSelectionChange(selection);
    const viewBounds = readHostValue(host, "viewBounds", null);
    if (viewBounds) state.currentViewBounds = [...viewBounds];
    syncHostAssignments();
    render();
  }

  function destroy() {
    if (state.destroyed) return;
    state.destroyed = true;
    window.clearTimeout(state.saveTimer);
    if (state.initialized) saveNow();
    for (const remove of state.listeners.splice(0)) remove();
    document.body.classList.remove("is-curation-mode");
    elements.root.hidden = true;
  }

  const api = {
    initialize,
    destroy,
    refresh,
    onViewport,
    onSelectionChange,
    selectGroup,
    onBox,
    onTrailToggle,
    onBackgroundSelect,
    undo,
    redo,
    exportDocument,
    getDocument: buildDocument,
    getAssignments: () => new Map(state.assignments),
    getSelectedTrailIds: () => new Set(state.selected),
  };
  return api;
}
