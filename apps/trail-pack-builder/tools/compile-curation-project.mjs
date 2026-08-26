import {
  access,
  link,
  mkdir,
  open,
  readFile,
  unlink,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DOCUMENT_KIND = "bobs-trail-pack-curation";
const SCHEMA_VERSION = 1;
const DELETE_PACK_NAME = /^DELETE\d*$/i;
const PACK_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function fail(message) {
  throw new Error(message);
}

function requireCondition(condition, message) {
  if (!condition) fail(message);
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedStrings(values) {
  return [...values].sort(compareStrings);
}

function isFinitePoint(value) {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
}

function isFiniteBounds(value) {
  return Array.isArray(value) && value.length === 4 && value.every(Number.isFinite) &&
    value[0] <= value[2] && value[1] <= value[3];
}

function centerOfBounds(bounds) {
  return [
    (bounds[0] + bounds[2]) / 2,
    (bounds[1] + bounds[3]) / 2,
  ];
}

function unionBounds(boundsValues, owner) {
  requireCondition(boundsValues.length > 0, `${owner} contains no trail bounds.`);
  const result = [Infinity, Infinity, -Infinity, -Infinity];
  for (const bounds of boundsValues) {
    requireCondition(isFiniteBounds(bounds), `${owner} contains invalid trail bounds.`);
    result[0] = Math.min(result[0], bounds[0]);
    result[1] = Math.min(result[1], bounds[1]);
    result[2] = Math.max(result[2], bounds[2]);
    result[3] = Math.max(result[3], bounds[3]);
  }
  return result;
}

function setsEqual(left, right) {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function rowsToObjects(fields, rows, owner) {
  requireCondition(Array.isArray(fields), `${owner} has no fields array.`);
  requireCondition(Array.isArray(rows), `${owner} has no rows array.`);
  return rows.map((row, index) => {
    requireCondition(
      Array.isArray(row) && row.length === fields.length,
      `${owner} row ${index + 1} does not match its fields array.`,
    );
    return Object.fromEntries(fields.map((field, fieldIndex) => [field, row[fieldIndex]]));
  });
}

async function readJson(path, label) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    fail(`Unable to read ${label} at ${path}: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`Unable to parse ${label} at ${path}: ${error.message}`);
  }
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveDataRoot(manifestPath, overviewFile) {
  const manifestDirectory = dirname(manifestPath);
  const candidates = [manifestDirectory, resolve(manifestDirectory, "..", "..")];
  for (const candidate of candidates) {
    if (await exists(resolve(candidate, overviewFile))) return candidate;
  }
  fail(`Unable to resolve overview file ${overviewFile} from ${manifestPath}.`);
}

function validateOverviewArea(area, groupIds, owner) {
  requireCondition(PACK_ID.test(cleanString(area.id)), `${owner} has an invalid ID.`);
  requireCondition(cleanString(area.name), `${owner} has an invalid name.`);
  requireCondition(Number.isInteger(area.count) && area.count > 0, `${owner} has an invalid count.`);
  requireCondition(isFinitePoint(area.labelPoint), `${owner} has an invalid labelPoint.`);
  requireCondition(
    Array.isArray(area.groupIds) && area.groupIds.length > 0 &&
      area.groupIds.every((groupId) => groupIds.has(groupId)),
    `${owner} references an unknown chunk.`,
  );
}

export async function loadMapCatalog(manifestPath) {
  const manifest = await readJson(manifestPath, "map manifest");
  requireCondition(manifest?.version === 2, "The map manifest must use version 2.");
  requireCondition(
    cleanString(manifest.sourceCatalogSha256),
    "The map manifest has no source catalog hash.",
  );
  requireCondition(
    Number.isInteger(manifest?.counts?.trails) && manifest.counts.trails >= 0,
    "The map manifest has an invalid trail count.",
  );
  requireCondition(
    cleanString(manifest.overviewFile),
    "The map manifest does not identify an overview file.",
  );

  const dataRoot = await resolveDataRoot(manifestPath, manifest.overviewFile);
  const overviewPath = resolve(dataRoot, manifest.overviewFile);
  const overview = await readJson(overviewPath, "map overview");
  requireCondition(overview?.version === 2, "The map overview must use version 2.");

  const groups = rowsToObjects(overview.groupFields, overview.groups, "Map overview groups");
  const groupIds = new Set();
  for (const group of groups) {
    const groupId = cleanString(group.id);
    requireCondition(groupId && !groupIds.has(groupId), `Invalid or duplicate map group ${groupId}.`);
    requireCondition(cleanString(group.file), `Map group ${groupId} has no chunk file.`);
    groupIds.add(groupId);
  }

  const areas = new Map();
  for (const area of rowsToObjects(overview.areaFields, overview.areas, "Map overview areas")) {
    const areaId = cleanString(area.id);
    validateOverviewArea(area, groupIds, `Map area ${areaId || "<empty>"}`);
    requireCondition(!areas.has(areaId), `Duplicate map area ${areaId}.`);
    areas.set(areaId, { ...area, id: areaId, name: area.name.trim() });
  }

  const collections = new Map();
  const collectionRows = overview.collections ?? [];
  const collectionFields = overview.collectionFields ?? [];
  for (const collection of rowsToObjects(
    collectionFields,
    collectionRows,
    "Map overview collections",
  )) {
    const collectionId = cleanString(collection.id);
    validateOverviewArea(
      collection,
      groupIds,
      `Map collection ${collectionId || "<empty>"}`,
    );
    requireCondition(
      !areas.has(collectionId) && !collections.has(collectionId),
      `Duplicate map area or collection ${collectionId}.`,
    );
    requireCondition(
      Array.isArray(collection.memberAreaIds) && collection.memberAreaIds.length > 0 &&
        new Set(collection.memberAreaIds).size === collection.memberAreaIds.length &&
        collection.memberAreaIds.every((areaId) => areas.has(areaId)),
      `Map collection ${collectionId} has invalid member areas.`,
    );
    collections.set(collectionId, {
      ...collection,
      id: collectionId,
      name: collection.name.trim(),
      memberAreaIds: [...collection.memberAreaIds],
    });
  }

  const universe = new Set();
  const trailBounds = new Map();
  const areaMembership = new Map([...areas].map(([areaId]) => [areaId, new Set()]));
  const collectionMembership = new Map(
    [...collections].map(([collectionId]) => [collectionId, new Set()]),
  );

  for (const group of groups.sort((left, right) => compareStrings(left.id, right.id))) {
    const chunk = await readJson(resolve(dataRoot, group.file), `map chunk ${group.file}`);
    requireCondition(chunk?.version === 2, `Map chunk ${group.file} must use version 2.`);
    const catalog = rowsToObjects(chunk.catalogFields, chunk.catalog, `Map chunk ${group.file}`);
    for (const row of catalog) {
      const trailId = cleanString(row.trail_id);
      requireCondition(trailId, `Map chunk ${group.file} contains an invalid trail ID.`);
      requireCondition(!universe.has(trailId), `The map catalog repeats trail ID ${trailId}.`);
      requireCondition(isFiniteBounds(row.bbox), `Trail ${trailId} has invalid bounds.`);
      universe.add(trailId);
      trailBounds.set(trailId, [...row.bbox]);

      const areaId = row.area_id === null ? "" : cleanString(row.area_id);
      const collectionId = row.collection_id === null ? "" : cleanString(row.collection_id);
      requireCondition(!areaId || areas.has(areaId), `Trail ${trailId} references unknown area ${areaId}.`);
      requireCondition(
        !collectionId || collections.has(collectionId),
        `Trail ${trailId} references unknown collection ${collectionId}.`,
      );
      if (areaId) areaMembership.get(areaId).add(trailId);
      if (collectionId) collectionMembership.get(collectionId).add(trailId);
    }
  }

  requireCondition(
    universe.size === manifest.counts.trails,
    `The map catalog contains ${universe.size} trails; its manifest declares ${manifest.counts.trails}.`,
  );
  for (const [areaId, area] of areas) {
    requireCondition(
      areaMembership.get(areaId).size === area.count,
      `Map area ${areaId} declares ${area.count} trails but its catalog contains ` +
        `${areaMembership.get(areaId).size}.`,
    );
  }
  for (const [collectionId, collection] of collections) {
    const membership = collectionMembership.get(collectionId);
    requireCondition(
      membership.size === collection.count,
      `Map collection ${collectionId} declares ${collection.count} trails but its catalog contains ` +
        `${membership.size}.`,
    );
    for (const memberAreaId of collection.memberAreaIds) {
      for (const trailId of areaMembership.get(memberAreaId)) {
        requireCondition(
          membership.has(trailId),
          `Map collection ${collectionId} does not contain member area ${memberAreaId}.`,
        );
      }
    }
  }

  return {
    manifest,
    overview,
    universe,
    trailBounds,
    areas,
    collections,
    areaMembership,
    collectionMembership,
  };
}

function normalizeEditorPack(pack, index, universe, accounted, packIds, packNames) {
  requireCondition(pack && typeof pack === "object", `Pack ${index + 1} is invalid.`);
  const id = cleanString(pack.id);
  const name = cleanString(pack.name);
  requireCondition(PACK_ID.test(id), `Pack ${index + 1} has an invalid ID.`);
  requireCondition(name && name.length <= 80, `Pack ${id} has an invalid name.`);
  requireCondition(!packIds.has(id), `Duplicate pack ID ${id}.`);
  const foldedName = name.toLocaleLowerCase();
  requireCondition(
    DELETE_PACK_NAME.test(name) || !packNames.has(foldedName),
    `Duplicate pack name ${name}.`,
  );
  requireCondition(isFinitePoint(pack.labelPoint), `Pack ${id} has an invalid labelPoint.`);
  requireCondition(typeof pack.provisional === "boolean", `Pack ${id} has an invalid provisional flag.`);
  requireCondition(
    pack.transportGroupId === null || typeof pack.transportGroupId === "string",
    `Pack ${id} has an invalid transport group.`,
  );
  requireCondition(Array.isArray(pack.trailIds) && pack.trailIds.length > 0, `Pack ${id} is empty.`);

  const trailIds = [];
  for (const rawTrailId of pack.trailIds) {
    const trailId = cleanString(rawTrailId);
    requireCondition(trailId, `Pack ${id} contains an invalid trail ID.`);
    requireCondition(universe.has(trailId), `Pack ${id} contains unknown trail ID ${trailId}.`);
    const priorOwner = accounted.get(trailId);
    requireCondition(
      priorOwner === undefined,
      `Trail ${trailId} appears in both ${priorOwner} and pack ${id}.`,
    );
    accounted.set(trailId, `pack ${id}`);
    trailIds.push(trailId);
  }

  packIds.add(id);
  if (!DELETE_PACK_NAME.test(name)) packNames.add(foldedName);
  return {
    id,
    name,
    labelPoint: [...pack.labelPoint],
    provisional: pack.provisional,
    transportGroupId: pack.transportGroupId,
    trailIds: sortedStrings(trailIds),
  };
}

export function validateEditorProject(project, catalog) {
  requireCondition(project?.schemaVersion === SCHEMA_VERSION, "Unsupported curation schemaVersion.");
  requireCondition(project?.kind === DOCUMENT_KIND, "Unsupported curation project kind.");
  requireCondition(project.source && typeof project.source === "object", "Missing curation source.");
  requireCondition(
    project.source.sourceCatalogSha256 === catalog.manifest.sourceCatalogSha256,
    "The curation source catalog hash does not match the map manifest.",
  );
  requireCondition(
    project.source.trailCount === catalog.manifest.counts.trails &&
      project.source.trailCount === catalog.universe.size,
    "The curation source trail count does not match the map catalog.",
  );
  if (cleanString(catalog.manifest.scope)) {
    requireCondition(
      project.source.qualityScope === catalog.manifest.scope,
      "The curation quality scope does not match the map manifest.",
    );
  }
  requireCondition(Array.isArray(project.packs), "The curation project has no packs array.");
  requireCondition(
    Array.isArray(project.unassignedTrailIds),
    "The curation project has no unassignedTrailIds array.",
  );

  const accounted = new Map();
  const packIds = new Set();
  const packNames = new Set();
  const packs = project.packs.map((pack, index) =>
    normalizeEditorPack(pack, index, catalog.universe, accounted, packIds, packNames));
  const unassignedTrailIds = [];
  for (const rawTrailId of project.unassignedTrailIds) {
    const trailId = cleanString(rawTrailId);
    requireCondition(trailId, "unassignedTrailIds contains an invalid trail ID.");
    requireCondition(catalog.universe.has(trailId), `unassignedTrailIds contains unknown trail ${trailId}.`);
    const priorOwner = accounted.get(trailId);
    requireCondition(
      priorOwner === undefined,
      `Trail ${trailId} appears in both ${priorOwner} and unassignedTrailIds.`,
    );
    accounted.set(trailId, "unassignedTrailIds");
    unassignedTrailIds.push(trailId);
  }
  if (accounted.size !== catalog.universe.size) {
    const missing = sortedStrings([...catalog.universe].filter((trailId) => !accounted.has(trailId)));
    fail(
      `The curation project is missing ${missing.length} trail IDs` +
        (missing.length ? ` (${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ", …" : ""})` : "") +
        ".",
    );
  }
  return { packs, unassignedTrailIds: sortedStrings(unassignedTrailIds) };
}

function derivedPack({ id, name, labelPoint, groupIds, trailIds }) {
  return {
    id,
    name,
    labelPoint: [...labelPoint],
    provisional: false,
    transportGroupId: groupIds.length === 1 ? groupIds[0] : null,
    trailIds: sortedStrings(trailIds),
  };
}

function mergedDeletePack(deletePacks, catalog) {
  if (!deletePacks.length) return null;
  const trailIds = sortedStrings(deletePacks.flatMap((pack) => pack.trailIds));
  const bounds = unionBounds(
    trailIds.map((trailId) => catalog.trailBounds.get(trailId)),
    "DELETE pack",
  );
  return {
    id: "delete",
    name: "DELETE",
    labelPoint: centerOfBounds(bounds),
    provisional: false,
    transportGroupId: null,
    trailIds,
  };
}

function normalizeEditorState(editor, packIds, idReplacements) {
  if (!editor || typeof editor !== "object") return undefined;
  const remap = (rawId) => {
    const id = cleanString(rawId);
    const replacement = idReplacements.get(id) ?? id;
    return packIds.has(replacement) ? replacement : null;
  };
  const remapArray = (value) => sortedStrings(new Set(
    (Array.isArray(value) ? value : []).map(remap).filter(Boolean),
  ));
  return {
    hiddenPackIds: remapArray(editor.hiddenPackIds),
    unassignedVisible: editor.unassignedVisible !== false,
    autoFitSelection: editor.autoFitSelection !== false,
    activePackId: remap(editor.activePackId),
    checkedPackIds: remapArray(editor.checkedPackIds),
  };
}

export function compileProject(project, catalog) {
  const validated = validateEditorProject(project, catalog);
  const deletePacks = validated.packs.filter((pack) => DELETE_PACK_NAME.test(pack.name));
  let retainedPacks = validated.packs.filter((pack) => !DELETE_PACK_NAME.test(pack.name));
  requireCondition(retainedPacks.length > 0, "The curation project contains no retained packs.");

  const idReplacements = new Map(deletePacks.map((pack) => [pack.id, "delete"]));
  const outputCollections = [];
  const replacedPackIds = new Set();
  const generatedPacks = [];

  for (const collection of [...catalog.collections.values()].sort((left, right) =>
    compareStrings(left.id, right.id))) {
    const fullMembership = catalog.collectionMembership.get(collection.id);
    const matches = retainedPacks.filter((pack) =>
      setsEqual(new Set(pack.trailIds), fullMembership));
    if (matches.length !== 1) continue;

    const logicalPack = matches[0];
    requireCondition(
      !replacedPackIds.has(logicalPack.id),
      `Pack ${logicalPack.id} exactly matches more than one map collection.`,
    );
    requireCondition(
      isFinitePoint(logicalPack.labelPoint),
      `Collection pack ${logicalPack.id} needs a labelPoint.`,
    );
    replacedPackIds.add(logicalPack.id);

    const memberPackIds = [];
    const memberTrailIds = new Set();
    for (const memberAreaId of collection.memberAreaIds) {
      const area = catalog.areas.get(memberAreaId);
      const membership = catalog.areaMembership.get(memberAreaId);
      requireCondition(membership.size > 0, `Collection member area ${memberAreaId} is empty.`);
      generatedPacks.push(derivedPack({
        id: area.id,
        name: area.name,
        labelPoint: area.labelPoint,
        groupIds: area.groupIds,
        trailIds: membership,
      }));
      memberPackIds.push(area.id);
      membership.forEach((trailId) => memberTrailIds.add(trailId));
    }

    const remainderTrailIds = sortedStrings(
      [...fullMembership].filter((trailId) => !memberTrailIds.has(trailId)),
    );
    let remainderPackId = null;
    if (remainderTrailIds.length) {
      const remainderId = `${collection.id}-other`;
      const remainderBounds = unionBounds(
        remainderTrailIds.map((trailId) => catalog.trailBounds.get(trailId)),
        `Collection remainder ${remainderId}`,
      );
      generatedPacks.push(derivedPack({
        id: remainderId,
        name: `${collection.name} - Other`,
        labelPoint: centerOfBounds(remainderBounds),
        groupIds: collection.groupIds,
        trailIds: remainderTrailIds,
      }));
      remainderPackId = remainderId;
    }

    requireCondition(memberPackIds.length >= 2, `Collection ${collection.id} has fewer than two packs.`);
    const outputCollection = {
      id: collection.id,
      name: logicalPack.name,
      labelPoint: [...logicalPack.labelPoint],
      memberPackIds: sortedStrings(memberPackIds),
    };
    if (remainderPackId) outputCollection.remainderPackId = remainderPackId;
    outputCollections.push(outputCollection);
    idReplacements.set(logicalPack.id, "");
  }

  retainedPacks = retainedPacks.filter((pack) => !replacedPackIds.has(pack.id));
  const deletePack = mergedDeletePack(deletePacks, catalog);
  const packs = [...retainedPacks, ...generatedPacks, ...(deletePack ? [deletePack] : [])]
    .sort((left, right) => compareStrings(left.id, right.id));

  const packIds = new Set();
  const packNames = new Set();
  const accounted = new Map();
  for (const pack of packs) {
    requireCondition(!packIds.has(pack.id), `Compilation produced duplicate pack ID ${pack.id}.`);
    requireCondition(PACK_ID.test(pack.id), `Compilation produced invalid pack ID ${pack.id}.`);
    const foldedName = pack.name.toLocaleLowerCase();
    requireCondition(!packNames.has(foldedName), `Compilation produced duplicate pack name ${pack.name}.`);
    packIds.add(pack.id);
    packNames.add(foldedName);
    for (const trailId of pack.trailIds) {
      const priorOwner = accounted.get(trailId);
      requireCondition(
        priorOwner === undefined,
        `Compilation placed trail ${trailId} in both ${priorOwner} and pack ${pack.id}.`,
      );
      accounted.set(trailId, `pack ${pack.id}`);
    }
  }
  for (const trailId of validated.unassignedTrailIds) {
    const priorOwner = accounted.get(trailId);
    requireCondition(
      priorOwner === undefined,
      `Compilation placed trail ${trailId} in both ${priorOwner} and unassignedTrailIds.`,
    );
    accounted.set(trailId, "unassignedTrailIds");
  }
  requireCondition(
    accounted.size === catalog.universe.size &&
      [...catalog.universe].every((trailId) => accounted.has(trailId)),
    "The compiled project does not cover the exact map trail universe.",
  );

  const usedCollectionPackIds = new Set();
  for (const collection of outputCollections) {
    requireCondition(!packIds.has(collection.id), `Collection ID ${collection.id} collides with a pack.`);
    requireCondition(
      collection.memberPackIds.every((packId) => packIds.has(packId)),
      `Collection ${collection.id} references a missing pack.`,
    );
    for (const packId of collection.memberPackIds) {
      requireCondition(
        !usedCollectionPackIds.has(packId),
        `Pack ${packId} belongs to more than one collection.`,
      );
      usedCollectionPackIds.add(packId);
    }
    if (collection.remainderPackId) {
      requireCondition(
        packIds.has(collection.remainderPackId),
        `Collection ${collection.id} references a missing remainder pack.`,
      );
      requireCondition(
        !collection.memberPackIds.includes(collection.remainderPackId),
        `Collection ${collection.id} repeats its remainder as a member pack.`,
      );
      requireCondition(
        !usedCollectionPackIds.has(collection.remainderPackId),
        `Pack ${collection.remainderPackId} belongs to more than one collection.`,
      );
      usedCollectionPackIds.add(collection.remainderPackId);
    }
  }

  const editor = normalizeEditorState(project.editor, packIds, idReplacements);
  const output = {
    schemaVersion: SCHEMA_VERSION,
    kind: DOCUMENT_KIND,
    source: {
      qualityScope: project.source.qualityScope,
      sourceCatalogSha256: project.source.sourceCatalogSha256,
      trailCount: project.source.trailCount,
      seedBuildKey: project.source.seedBuildKey ?? catalog.manifest.buildKey ?? null,
    },
    packs,
    collections: outputCollections.sort((left, right) => compareStrings(left.id, right.id)),
    unassignedTrailIds: validated.unassignedTrailIds,
  };
  if (editor) output.editor = editor;

  const collectionMemberIds = new Set(output.collections.flatMap((row) => row.memberPackIds));
  const collectionRemainderIds = new Set(
    output.collections
      .map((row) => row.remainderPackId)
      .filter(Boolean),
  );
  const retainedPackCount = packs.length - (deletePack ? 1 : 0);
  return {
    output,
    counts: {
      physicalPackCount: packs.length,
      retainedPackCount,
      deletePackCount: deletePack ? 1 : 0,
      collectionCount: output.collections.length,
      logicalAreaCount:
        retainedPackCount - collectionMemberIds.size - collectionRemainderIds.size +
        output.collections.length,
      totalTrailCount: accounted.size,
      unassignedTrailCount: validated.unassignedTrailIds.length,
    },
  };
}

export async function writeJsonAtomicNew(outputPath, document) {
  await mkdir(dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp-${process.pid}-${Date.now()}`;
  let temporaryCreated = false;
  try {
    const handle = await open(temporaryPath, "wx");
    temporaryCreated = true;
    try {
      await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(temporaryPath, outputPath);
    } catch (error) {
      if (error.code === "EEXIST") {
        fail(`Refusing to overwrite existing output: ${outputPath}`);
      }
      throw error;
    }
  } finally {
    if (temporaryCreated) {
      try {
        await unlink(temporaryPath);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }
}

export async function compileCurationProject(inputPath, manifestPath, outputPath) {
  const [project, catalog] = await Promise.all([
    readJson(inputPath, "editor curation export"),
    loadMapCatalog(manifestPath),
  ]);
  const compiled = compileProject(project, catalog);
  await writeJsonAtomicNew(outputPath, compiled.output);
  return compiled;
}

async function main() {
  const [inputArgument, manifestArgument, outputArgument, ...extraArguments] = process.argv.slice(2);
  if (!inputArgument || !manifestArgument || !outputArgument || extraArguments.length) {
    fail(
      "Usage: node compile-curation-project.mjs " +
        "<editor-export.json> <map-manifest.json> <output.json>",
    );
  }
  const inputPath = resolve(process.cwd(), inputArgument);
  const manifestPath = resolve(process.cwd(), manifestArgument);
  const outputPath = resolve(process.cwd(), outputArgument);
  requireCondition(inputPath !== outputPath, "Input and output paths must be different.");

  const { counts } = await compileCurationProject(inputPath, manifestPath, outputPath);
  console.log(
    `Compiled curation project: ${counts.physicalPackCount.toLocaleString("en-US")} physical packs ` +
      `(${counts.retainedPackCount.toLocaleString("en-US")} retained + ` +
      `${counts.deletePackCount.toLocaleString("en-US")} DELETE), ` +
      `${counts.collectionCount.toLocaleString("en-US")} ` +
      `${counts.collectionCount === 1 ? "collection" : "collections"}, ` +
      `${counts.logicalAreaCount.toLocaleString("en-US")} logical map areas, ` +
      `${counts.totalTrailCount.toLocaleString("en-US")} total trails, ` +
      `${counts.unassignedTrailCount.toLocaleString("en-US")} unassigned.`,
  );
  console.log(`Wrote ${outputPath}`);
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().catch((error) => {
    console.error(`Curation compilation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
