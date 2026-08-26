import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compileProject } from "./compile-curation-project.mjs";
import {
  TILLAMOOK_CAPACITY_EXCLUSION_IDS,
  loadSourceRecords,
  representativeLabelPoint,
} from "./cleanup-final-curation.mjs";

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(toolsDirectory, "..");
const dataRoot = join(appDirectory, "local-data");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function rowsToObjects(fields, rows) {
  return rows.map((row) => Object.fromEntries(fields.map((field, index) => [field, row[index]])));
}

async function loadSeedCatalog(project) {
  const seedBuildKey = project.source.seedBuildKey;
  assert.match(seedBuildKey, /^[a-f0-9]{16}$/);
  const overview = await readJson(
    join(dataRoot, "web-map", "v2", "generations", seedBuildKey, "overview.json"),
  );
  const groups = rowsToObjects(overview.groupFields, overview.groups);
  const areaRows = rowsToObjects(overview.areaFields, overview.areas);
  const collectionRows = rowsToObjects(overview.collectionFields, overview.collections ?? []);
  const areas = new Map(areaRows.map((area) => [area.id, area]));
  const collections = new Map(collectionRows.map((collection) => [collection.id, collection]));
  const universe = new Set();
  const trailBounds = new Map();
  const areaMembership = new Map(areaRows.map((area) => [area.id, new Set()]));
  const collectionMembership = new Map(
    collectionRows.map((collection) => [collection.id, new Set()]),
  );

  for (const group of groups) {
    const chunk = await readJson(join(dataRoot, group.file));
    const index = Object.fromEntries(chunk.catalogFields.map((field, offset) => [field, offset]));
    for (const row of chunk.catalog) {
      const trailId = row[index.trail_id];
      assert.equal(universe.has(trailId), false, `Seed catalog repeats ${trailId}.`);
      universe.add(trailId);
      trailBounds.set(trailId, row[index.bbox]);
      const areaId = row[index.area_id];
      const collectionId = row[index.collection_id];
      if (areaId) areaMembership.get(areaId).add(trailId);
      if (collectionId) collectionMembership.get(collectionId).add(trailId);
    }
  }
  assert.equal(universe.size, project.source.trailCount);
  return {
    manifest: {
      scope: project.source.qualityScope,
      sourceCatalogSha256: project.source.sourceCatalogSha256,
      counts: { trails: universe.size },
      buildKey: seedBuildKey,
    },
    overview,
    universe,
    trailBounds,
    areas,
    collections,
    areaMembership,
    collectionMembership,
  };
}

const authored = await readJson(join(toolsDirectory, "final-riding-area-curation.json"));
const production = await readJson(join(toolsDirectory, "final-production-curation.json"));
const sourceCatalogPath = join(dataRoot, "catalog", "trails.csv");
const [{ sourceCatalogSha256, sourceRecords }, seedCatalog] = await Promise.all([
  loadSourceRecords(sourceCatalogPath, authored),
  loadSeedCatalog(authored),
]);
assert.equal(sourceCatalogSha256, authored.source.sourceCatalogSha256);

const compiled = compileProject(authored, seedCatalog);
assert.deepEqual(
  production,
  compiled.output,
  "final-production-curation.json must be the exact deterministic compilation of the authored file.",
);
assert.deepEqual(compiled.counts, {
  physicalPackCount: 47,
  retainedPackCount: 46,
  deletePackCount: 1,
  collectionCount: 0,
  logicalAreaCount: 46,
  totalTrailCount: 15375,
  unassignedTrailCount: 0,
});

const deletePack = authored.packs.find((pack) => pack.name === "DELETE");
const leavenworth = authored.packs.find((pack) => pack.name === "Leavenworth");
const tillamook = authored.packs.find((pack) => pack.id === "tillamook-state-forest");
assert.equal(authored.packs.length, 47);
assert.equal(authored.packs.some((pack) => pack.name === "Battle Ground"), false);
assert.equal(authored.packs.some((pack) => pack.name === "Cle Elum South"), false);
assert.equal(deletePack.trailIds.length, 205);
assert.equal(deletePack.trailIds.includes("trail-35e74275b4713053"), true);
assert.equal(leavenworth.trailIds.length, 150);
assert.equal(tillamook.name, "Tillamook");
assert.equal(tillamook.trailIds.length, 1050);
assert.equal(
  TILLAMOOK_CAPACITY_EXCLUSION_IDS.every((trailId) => deletePack.trailIds.includes(trailId)),
  true,
);
assert.equal(
  TILLAMOOK_CAPACITY_EXCLUSION_IDS.some((trailId) => tillamook.trailIds.includes(trailId)),
  false,
);
for (const trailId of TILLAMOOK_CAPACITY_EXCLUSION_IDS) {
  const sourceName = sourceRecords.get(trailId).displayName;
  assert.equal(
    sourceName === "" || sourceName === "<Null>",
    true,
    `Tillamook capacity exclusion ${trailId} has a source-provided name.`,
  );
}
assert.equal(authored.unassignedTrailIds.length, 0);

const accountedTrailIds = authored.packs.flatMap((pack) => pack.trailIds);
assert.equal(accountedTrailIds.length, sourceRecords.size);
assert.equal(new Set(accountedTrailIds).size, sourceRecords.size);
for (const pack of authored.packs.filter((candidate) => candidate.name !== "DELETE")) {
  assert.deepEqual(
    pack.labelPoint,
    representativeLabelPoint(pack.trailIds, sourceRecords),
    `${pack.id} does not use the representative-cluster label placement.`,
  );
}

console.log(
  "Final curation parity passed: 47 authored packs -> 47 production packs, " +
    "46 logical areas, 205 DELETE trails, 15,375 total, 0 unassigned.",
);
