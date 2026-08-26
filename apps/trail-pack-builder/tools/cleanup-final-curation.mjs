import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadMapCatalog, writeJsonAtomicNew } from "./compile-curation-project.mjs";

const DOCUMENT_KIND = "bobs-trail-pack-curation";
const SCHEMA_VERSION = 1;
const QUALITY_SCOPE = "internal-canonical";
const DELETE_PACK_NAME = /^DELETE\d*$/i;
const PACK_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TARGET_TRAIL_NAME = /\btt\s+to\s+c(?:h)?elatchee\b/i;
const EARTH_RADIUS_METERS = 6_371_008.8;

const CLEANUP = Object.freeze({
  mergeSourceName: "Cle Elum South",
  mergeTargetName: "Leavenworth",
  discardPackName: "Battle Ground",
  discardTrailLabel: "TT to Chelatchee",
  tillamookPackName: "Tillamook",
  tillamookPackId: "tillamook-state-forest",
});

export const TILLAMOOK_CAPACITY_EXCLUSION_IDS = Object.freeze([
  "trail-14932bb5dbaa7817",
  "trail-1aa2c075612ae28a",
  "trail-2183d994db1365c0",
  "trail-22d53f1748fc2d32",
  "trail-26a0c078a1c421f6",
  "trail-2e9fb18089f71c80",
  "trail-2f107e541405f439",
  "trail-3123eab99c608055",
  "trail-332fc6d78b7e89ab",
  "trail-373cbeba625a9f2f",
  "trail-3832d896e6c1dd18",
  "trail-475fb665ca789310",
  "trail-4b19c0f091f9ce0e",
  "trail-4b9eb491648f6db4",
  "trail-4da7758da140cdce",
  "trail-5217c24d97aaf451",
  "trail-59ef474abb701642",
  "trail-5b944a99a19d054e",
  "trail-5b94d404446a55b5",
  "trail-5baed2024848ab50",
  "trail-5e0d4ee05ea40cbb",
  "trail-68e6e0bd6acf130c",
  "trail-6a6e391cf6e2a85b",
  "trail-6e6a361dc1b365aa",
  "trail-6fa5539c850d869d",
  "trail-770f04c852b4838c",
  "trail-7969fa817f9dc512",
  "trail-805ae952f5dd0d55",
  "trail-811b3bdcaac36ab5",
  "trail-81f40fab6215294d",
  "trail-8599032720ffe723",
  "trail-88110c995991d593",
  "trail-9b447256a2b58184",
  "trail-a0dde1e9ae17bbff",
  "trail-a3f913911e715923",
  "trail-a4870d14ab8a0647",
  "trail-a820501075a8c000",
  "trail-aa0bcd3711ab8b6a",
  "trail-aa85e345088a6e5e",
  "trail-b7057d3688ea9f46",
  "trail-b9de5aaeb774f9d4",
  "trail-bae36a3fdbd9a758",
  "trail-c1642346c1b61001",
  "trail-c80d100a5f8654e0",
  "trail-d65b6d5dc7d61ae9",
  "trail-e7775d644f4b7a5b",
  "trail-ee38037024da9a2f",
  "trail-f3af90fa5648c746",
  "trail-f3f08e4c1fe95fe2",
  "trail-f43249d617eabb75",
  "trail-fb16ce936610c3b1",
  "trail-ffde2eeb7798cc1e",
]);

function fail(message) {
  throw new Error(message);
}

function requireCondition(condition, message) {
  if (!condition) fail(message);
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedStrings(values) {
  return [...values].sort(compareStrings);
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function folded(value) {
  return cleanString(value).toLocaleLowerCase();
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

function distanceMeters(first, second) {
  const longitudeDelta = (second[0] - first[0]) * Math.PI / 180;
  const latitudeDelta = (second[1] - first[1]) * Math.PI / 180;
  const meanLatitude = ((first[1] + second[1]) / 2) * Math.PI / 180;
  const x = longitudeDelta * Math.cos(meanLatitude);
  return EARTH_RADIUS_METERS * Math.hypot(x, latitudeDelta);
}

export function representativeLabelPoint(trailIds, sourceRecords) {
  requireCondition(trailIds.length > 0, "Cannot place a label for an empty trail set.");
  const trails = trailIds.map((trailId) => {
    const record = sourceRecords.get(trailId);
    requireCondition(record, `Missing source-catalog record for ${trailId}.`);
    requireCondition(isFiniteBounds(record.bbox), `Trail ${trailId} has invalid bounds.`);
    return { trailId, center: centerOfBounds(record.bbox) };
  });
  const meanPoint = [
    trails.reduce((total, trail) => total + trail.center[0], 0) / trails.length,
    trails.reduce((total, trail) => total + trail.center[1], 0) / trails.length,
  ];
  trails.sort((left, right) => {
    const distanceDelta =
      distanceMeters(meanPoint, left.center) - distanceMeters(meanPoint, right.center);
    return distanceDelta || compareStrings(left.trailId, right.trailId);
  });
  return trails[0].center.map((value) => Number(value.toFixed(7)));
}

function findOnePack(packs, name) {
  const matches = packs.filter((pack) => folded(pack.name) === folded(name));
  requireCondition(matches.length === 1, `Expected exactly one ${name} pack; found ${matches.length}.`);
  return matches[0];
}

function normalizePack(pack, index, sourceRecords, accounted, packIds) {
  requireCondition(pack && typeof pack === "object", `Pack ${index + 1} is invalid.`);
  const id = cleanString(pack.id);
  const name = cleanString(pack.name);
  requireCondition(PACK_ID.test(id), `Pack ${index + 1} has invalid ID ${id || "<empty>"}.`);
  requireCondition(name, `Pack ${id} has an invalid name.`);
  requireCondition(!packIds.has(id), `Duplicate pack ID ${id}.`);
  requireCondition(isFinitePoint(pack.labelPoint), `Pack ${id} has an invalid labelPoint.`);
  requireCondition(Array.isArray(pack.trailIds) && pack.trailIds.length > 0, `Pack ${id} is empty.`);
  packIds.add(id);

  const trailIds = [];
  for (const rawTrailId of pack.trailIds) {
    const trailId = cleanString(rawTrailId);
    requireCondition(sourceRecords.has(trailId), `Pack ${id} references unknown trail ${trailId}.`);
    requireCondition(!accounted.has(trailId), `Trail ${trailId} appears in more than one pack.`);
    accounted.add(trailId);
    trailIds.push(trailId);
  }
  return {
    ...pack,
    id,
    name,
    labelPoint: [...pack.labelPoint],
    trailIds: sortedStrings(trailIds),
  };
}

function validateProject(project, sourceRecords, sourceCatalogSha256, activeCatalog) {
  requireCondition(project?.schemaVersion === SCHEMA_VERSION, "Unsupported curation schemaVersion.");
  requireCondition(project?.kind === DOCUMENT_KIND, "Unsupported curation project kind.");
  requireCondition(project.source?.qualityScope === QUALITY_SCOPE, "Unexpected curation quality scope.");
  requireCondition(
    project.source.sourceCatalogSha256 === sourceCatalogSha256,
    "The curation source hash does not match catalog/trails.csv.",
  );
  requireCondition(
    activeCatalog.manifest.sourceCatalogSha256 === sourceCatalogSha256,
    "The active map and curation do not use the same source catalog.",
  );
  requireCondition(
    project.source.trailCount === sourceRecords.size,
    `The curation declares ${project.source.trailCount} trails; the scoped catalog has ` +
      `${sourceRecords.size}.`,
  );
  requireCondition(Array.isArray(project.packs), "The curation project has no packs array.");
  requireCondition(Array.isArray(project.unassignedTrailIds), "Missing unassignedTrailIds array.");

  const accounted = new Set();
  const packIds = new Set();
  const packs = project.packs.map((pack, index) =>
    normalizePack(pack, index, sourceRecords, accounted, packIds));
  const unassignedTrailIds = [];
  for (const rawTrailId of project.unassignedTrailIds) {
    const trailId = cleanString(rawTrailId);
    requireCondition(sourceRecords.has(trailId), `Unknown unassigned trail ${trailId}.`);
    requireCondition(!accounted.has(trailId), `Trail ${trailId} is both assigned and unassigned.`);
    accounted.add(trailId);
    unassignedTrailIds.push(trailId);
  }
  requireCondition(
    accounted.size === sourceRecords.size,
    `The curation accounts for ${accounted.size} of ${sourceRecords.size} source trails.`,
  );

  const collections = Array.isArray(project.collections) ? structuredClone(project.collections) : [];
  for (const collection of collections) {
    requireCondition(PACK_ID.test(cleanString(collection.id)), "A collection has an invalid ID.");
    requireCondition(cleanString(collection.name), `Collection ${collection.id} has an invalid name.`);
    requireCondition(isFinitePoint(collection.labelPoint), `Collection ${collection.id} has no labelPoint.`);
    requireCondition(
      Array.isArray(collection.memberPackIds) && collection.memberPackIds.length >= 2,
      `Collection ${collection.id} has invalid memberPackIds.`,
    );
    for (const memberPackId of collection.memberPackIds) {
      requireCondition(packIds.has(memberPackId), `Collection ${collection.id} has missing member ${memberPackId}.`);
    }
    if (collection.remainderPackId) {
      requireCondition(
        packIds.has(collection.remainderPackId) &&
          !collection.memberPackIds.includes(collection.remainderPackId),
        `Collection ${collection.id} has an invalid remainder pack.`,
      );
    }
  }
  return { packs, collections, unassignedTrailIds: sortedStrings(unassignedTrailIds) };
}

function remapEditor(editor, outputPackIds, renamedPackIds = new Map()) {
  if (!editor || typeof editor !== "object") return undefined;
  const keep = (rawId) => {
    const raw = cleanString(rawId);
    const id = renamedPackIds.get(raw) ?? raw;
    return outputPackIds.has(id) ? id : null;
  };
  const keepArray = (value) => sortedStrings(new Set(
    (Array.isArray(value) ? value : []).map(keep).filter(Boolean),
  ));
  return {
    ...editor,
    hiddenPackIds: keepArray(editor.hiddenPackIds),
    activePackId: keep(editor.activePackId),
    checkedPackIds: keepArray(editor.checkedPackIds),
  };
}

function trailNameFields(record) {
  return [record.displayName, record.sourcePaths, record.canonicalGpxPath]
    .filter((value) => typeof value === "string");
}

export function cleanupCurationProject(project, sourceRecords, activeCatalog) {
  const validated = validateProject(
    project,
    sourceRecords,
    project.source.sourceCatalogSha256,
    activeCatalog,
  );
  const deletePacks = validated.packs.filter((pack) => DELETE_PACK_NAME.test(pack.name));
  const retainedPacks = validated.packs.filter((pack) => !DELETE_PACK_NAME.test(pack.name));
  const mergeSource = findOnePack(retainedPacks, CLEANUP.mergeSourceName);
  const mergeTarget = findOnePack(retainedPacks, CLEANUP.mergeTargetName);
  const discardPack = findOnePack(retainedPacks, CLEANUP.discardPackName);
  const tillamookMatches = retainedPacks.filter(
    (pack) => folded(pack.name) === folded(CLEANUP.tillamookPackName),
  );
  requireCondition(
    tillamookMatches.length <= 1,
    `Expected at most one ${CLEANUP.tillamookPackName} pack; found ${tillamookMatches.length}.`,
  );
  const tillamookPack = tillamookMatches[0] ?? null;
  const tillamookExclusionIds = tillamookPack
    ? [...TILLAMOOK_CAPACITY_EXCLUSION_IDS]
    : [];
  if (tillamookPack) {
    const tillamookIds = new Set(tillamookPack.trailIds);
    requireCondition(
      tillamookExclusionIds.every((trailId) => sourceRecords.has(trailId)),
      "A Tillamook capacity exclusion is missing from the source catalog.",
    );
    requireCondition(
      tillamookExclusionIds.every((trailId) => tillamookIds.has(trailId)),
      "A Tillamook capacity exclusion is not owned by the Tillamook pack.",
    );
  }

  const targetTrailIds = sortedStrings([...sourceRecords.values()]
    .filter((record) => trailNameFields(record).some((value) => TARGET_TRAIL_NAME.test(value)))
    .map((record) => record.trailId));
  requireCondition(
    targetTrailIds.length === 1,
    `Expected exactly one ${CLEANUP.discardTrailLabel} trail in the active map; found ` +
      `${targetTrailIds.length}${targetTrailIds.length ? ` (${targetTrailIds.join(", ")})` : ""}.`,
  );
  const targetTrailId = targetTrailIds[0];
  const targetOwner = retainedPacks.find((pack) => pack.trailIds.includes(targetTrailId));
  requireCondition(targetOwner, `Target trail ${targetTrailId} is not in a retained pack.`);

  const discardedTrailIds = new Set([
    ...deletePacks.flatMap((pack) => pack.trailIds),
    ...discardPack.trailIds,
    ...targetTrailIds,
    ...tillamookExclusionIds,
  ]);
  const mergedTrailIds = sortedStrings(new Set([
    ...mergeTarget.trailIds,
    ...mergeSource.trailIds,
  ]));

  const removedPackIds = new Set([mergeSource.id, discardPack.id, ...deletePacks.map((pack) => pack.id)]);
  const outputPacks = [];
  for (const pack of retainedPacks) {
    if (removedPackIds.has(pack.id)) continue;
    let trailIds = pack.id === mergeTarget.id ? mergedTrailIds : [...pack.trailIds];
    trailIds = sortedStrings(trailIds.filter((trailId) => !discardedTrailIds.has(trailId)));
    requireCondition(trailIds.length > 0, `Cleanup would empty retained pack ${pack.id}.`);
    outputPacks.push({
      ...pack,
      id: pack.id === tillamookPack?.id ? CLEANUP.tillamookPackId : pack.id,
      labelPoint: representativeLabelPoint(trailIds, sourceRecords),
      trailIds,
    });
  }
  const deleteTrailIds = sortedStrings(discardedTrailIds);
  outputPacks.push({
    id: "delete",
    name: "DELETE",
    labelPoint: representativeLabelPoint(deleteTrailIds, sourceRecords),
    provisional: false,
    transportGroupId: null,
    trailIds: deleteTrailIds,
  });
  outputPacks.sort((left, right) => compareStrings(left.id, right.id));

  const renamedPackIds = new Map(
    tillamookPack ? [[tillamookPack.id, CLEANUP.tillamookPackId]] : [],
  );
  const outputPackById = new Map(outputPacks.map((pack) => [pack.id, pack]));
  const collections = validated.collections.map((collection) => {
    const referencedPackIds = [
      ...collection.memberPackIds.map((packId) => renamedPackIds.get(packId) ?? packId),
      ...(collection.remainderPackId
        ? [renamedPackIds.get(collection.remainderPackId) ?? collection.remainderPackId]
        : []),
    ];
    requireCondition(
      referencedPackIds.every((packId) => outputPackById.has(packId)),
      `Cleanup would remove a physical pack used by collection ${collection.id}.`,
    );
    const trailIds = referencedPackIds.flatMap((packId) => outputPackById.get(packId).trailIds);
    return {
      ...collection,
      labelPoint: representativeLabelPoint(trailIds, sourceRecords),
      memberPackIds: sortedStrings(
        collection.memberPackIds.map((packId) => renamedPackIds.get(packId) ?? packId),
      ),
      ...(collection.remainderPackId
        ? { remainderPackId: renamedPackIds.get(collection.remainderPackId) ?? collection.remainderPackId }
        : {}),
    };
  }).sort((left, right) => compareStrings(left.id, right.id));

  const outputPackIds = new Set(outputPacks.map((pack) => pack.id));
  const editor = remapEditor(project.editor, outputPackIds, renamedPackIds);
  const output = {
    ...project,
    source: structuredClone(project.source),
    packs: outputPacks,
    unassignedTrailIds: validated.unassignedTrailIds,
  };
  if (Array.isArray(project.collections)) output.collections = collections;
  if (editor) output.editor = editor;

  const outputTrailIds = outputPacks.flatMap((pack) => pack.trailIds);
  requireCondition(
    outputTrailIds.length + output.unassignedTrailIds.length === sourceRecords.size &&
      new Set([...outputTrailIds, ...output.unassignedTrailIds]).size === sourceRecords.size,
    "Cleanup changed the exact source-trail universe.",
  );
  const collectionMemberIds = new Set(collections.flatMap((collection) => collection.memberPackIds));
  const collectionRemainderIds = new Set(
    collections.map((collection) => collection.remainderPackId).filter(Boolean),
  );
  const retainedPackCount = outputPacks.length - 1;
  return {
    output,
    audit: {
      mergeSource: { id: mergeSource.id, name: mergeSource.name, trailCount: mergeSource.trailIds.length },
      mergeTarget: {
        id: mergeTarget.id,
        name: mergeTarget.name,
        beforeTrailCount: mergeTarget.trailIds.length,
        afterTrailCount: mergedTrailIds.length,
      },
      discardedPack: { id: discardPack.id, name: discardPack.name, trailCount: discardPack.trailIds.length },
      discardedNamedTrails: targetTrailIds.map((trailId) => ({
        trailId,
        displayName: sourceRecords.get(trailId).displayName,
        priorPackId: targetOwner.id,
        priorPackName: targetOwner.name,
      })),
      priorDeleteTrailCount: deletePacks.reduce((total, pack) => total + pack.trailIds.length, 0),
      tillamookCapacityExclusions: tillamookExclusionIds.map((trailId) => ({
        trailId,
        pointCount: sourceRecords.get(trailId).pointCount,
        lengthMeters: sourceRecords.get(trailId).lengthMeters,
      })),
      deleteTrailCount: deleteTrailIds.length,
    },
    counts: {
      physicalPackCount: outputPacks.length,
      retainedPackCount,
      deletePackCount: 1,
      collectionCount: collections.length,
      logicalAreaCount:
        retainedPackCount - collectionMemberIds.size - collectionRemainderIds.size + collections.length,
      totalTrailCount: sourceRecords.size,
      unassignedTrailCount: output.unassignedTrailIds.length,
    },
  };
}

async function sha256File(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    fail(`Unable to read ${label} at ${path}: ${error.message}`);
  }
}

export async function loadSourceRecords(catalogCsvPath, project) {
  const catalogJsonPath = resolve(dirname(catalogCsvPath), "trails.json");
  const [sourceCatalogSha256, rows] = await Promise.all([
    sha256File(catalogCsvPath),
    readJson(catalogJsonPath, "catalog/trails.json"),
  ]);
  requireCondition(Array.isArray(rows), "catalog/trails.json must contain an array.");
  const sourceRecords = new Map();
  for (const row of rows) {
    if (row.quality_status !== project.source?.qualityScope) continue;
    const trailId = cleanString(row.trail_id);
    requireCondition(trailId && !sourceRecords.has(trailId), `Invalid or duplicate source trail ${trailId}.`);
    const bbox = [row.min_lon, row.min_lat, row.max_lon, row.max_lat];
    requireCondition(isFiniteBounds(bbox), `Source trail ${trailId} has invalid bounds.`);
    sourceRecords.set(trailId, {
      trailId,
      displayName: cleanString(row.display_name),
      sourcePaths: cleanString(row.source_paths),
      canonicalGpxPath: cleanString(row.canonical_gpx_path),
      pointCount: row.point_count,
      lengthMeters: row.length_m,
      bbox,
    });
  }
  requireCondition(sourceRecords.size > 0, "The scoped source catalog is empty.");
  return { sourceCatalogSha256, sourceRecords };
}

export async function cleanupCurationFile(inputPath, manifestPath, catalogCsvPath, outputPath) {
  const project = await readJson(inputPath, "curation project");
  const [{ sourceCatalogSha256, sourceRecords }, activeCatalog] = await Promise.all([
    loadSourceRecords(catalogCsvPath, project),
    loadMapCatalog(manifestPath),
  ]);
  requireCondition(
    project.source?.sourceCatalogSha256 === sourceCatalogSha256,
    "The curation source hash does not match catalog/trails.csv.",
  );
  const result = cleanupCurationProject(project, sourceRecords, activeCatalog);
  await writeJsonAtomicNew(outputPath, result.output);
  return result;
}

async function main() {
  const [inputArgument, manifestArgument, catalogArgument, outputArgument, ...extraArguments] =
    process.argv.slice(2);
  if (!inputArgument || !manifestArgument || !catalogArgument || !outputArgument || extraArguments.length) {
    fail(
      "Usage: node cleanup-final-curation.mjs " +
        "<curation.json> <active-map-manifest.json> <catalog/trails.csv> <output.json>",
    );
  }
  const inputPath = resolve(process.cwd(), inputArgument);
  const manifestPath = resolve(process.cwd(), manifestArgument);
  const catalogCsvPath = resolve(process.cwd(), catalogArgument);
  const outputPath = resolve(process.cwd(), outputArgument);
  requireCondition(inputPath !== outputPath, "Input and output paths must be different.");

  const result = await cleanupCurationFile(inputPath, manifestPath, catalogCsvPath, outputPath);
  console.log(
    `Cleaned curation project: ${result.counts.physicalPackCount} physical packs ` +
      `(${result.counts.retainedPackCount} retained + 1 DELETE), ` +
      `${result.counts.collectionCount} collections, ${result.counts.logicalAreaCount} logical areas, ` +
      `${result.counts.totalTrailCount.toLocaleString("en-US")} trails, ` +
      `${result.counts.unassignedTrailCount} unassigned.`,
  );
  console.log(
    `Merged ${result.audit.mergeSource.trailCount} trails from ${result.audit.mergeSource.name} into ` +
      `${result.audit.mergeTarget.name}; discarded ${result.audit.discardedPack.trailCount} ` +
      `${result.audit.discardedPack.name} trails and ` +
      `${result.audit.discardedNamedTrails.map((row) => `${row.displayName} (${row.trailId})`).join(", ")}.`,
  );
  console.log(`DELETE now contains ${result.audit.deleteTrailCount} trails. Wrote ${outputPath}`);
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().catch((error) => {
    console.error(`Curation cleanup failed: ${error.message}`);
    process.exitCode = 1;
  });
}
