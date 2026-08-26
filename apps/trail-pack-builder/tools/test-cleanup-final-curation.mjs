import assert from "node:assert/strict";

import {
  TILLAMOOK_CAPACITY_EXCLUSION_IDS,
  cleanupCurationProject,
  representativeLabelPoint,
} from "./cleanup-final-curation.mjs";

assert.equal(TILLAMOOK_CAPACITY_EXCLUSION_IDS.length, 52);
assert.equal(new Set(TILLAMOOK_CAPACITY_EXCLUSION_IDS).size, 52);

function sourceRecord(trailId, displayName, center) {
  return {
    trailId,
    displayName,
    sourcePaths: `${displayName}.gpx`,
    canonicalGpxPath: `gpx/${trailId}.gpx`,
    bbox: [center[0], center[1], center[0], center[1]],
  };
}

function pack(id, name, trailIds) {
  return {
    id,
    name,
    labelPoint: [99, 99],
    provisional: false,
    transportGroupId: null,
    trailIds,
  };
}

const records = [
  sourceRecord("battle-1", "Battle road 1", [-10, 0]),
  sourceRecord("battle-2", "Battle road 2", [-9, 0]),
  sourceRecord("cle-1", "Cle trail 1", [10, 0]),
  sourceRecord("cle-2", "Cle trail 2", [10.1, 0]),
  sourceRecord("collection-a", "Collection A", [30, 0]),
  sourceRecord("collection-b", "Collection B", [31, 0]),
  sourceRecord("collection-r", "Collection remainder", [32, 0]),
  sourceRecord("delete-old-1", "Old discard 1", [-20, 0]),
  sourceRecord("delete-old-2", "Old discard 2", [-21, 0]),
  sourceRecord("leavenworth-1", "Leavenworth trail", [0, 0]),
  sourceRecord("obdr-1", "OBDR trail", [20, 0]),
  sourceRecord("standalone-1", "Standalone trail", [40, 0]),
  sourceRecord("tt", "TT to Celatchee", [-122.46, 45.84]),
];
const sourceRecords = new Map(records.map((record) => [record.trailId, record]));
const activeCatalog = {
  manifest: { sourceCatalogSha256: "fixture-sha" },
  universe: new Set(records
    .filter((record) => !record.trailId.startsWith("delete-old"))
    .map((record) => record.trailId)),
};
const input = {
  schemaVersion: 1,
  kind: "bobs-trail-pack-curation",
  source: {
    qualityScope: "internal-canonical",
    sourceCatalogSha256: "fixture-sha",
    trailCount: records.length,
    seedBuildKey: "fixture-build",
  },
  packs: [
    pack("battle-ground", "Battle Ground", ["battle-2", "battle-1"]),
    pack("cle-elum", "Cle Elum South", ["cle-2", "cle-1"]),
    pack("collection-a-pack", "Collection A", ["collection-a"]),
    pack("collection-b-pack", "Collection B", ["collection-b"]),
    pack("collection-other", "Collection Other", ["collection-r"]),
    pack("delete-one", "DELETE", ["delete-old-1"]),
    pack("delete-two", "delete2", ["delete-old-2"]),
    pack("leavenworth", "Leavenworth", ["leavenworth-1"]),
    pack("obdr", "Oregon Backcountry Discovery Route", ["obdr-1", "tt"]),
    pack("standalone", "Standalone", ["standalone-1"]),
  ],
  collections: [{
    id: "collection",
    name: "Collection",
    labelPoint: [99, 99],
    memberPackIds: ["collection-b-pack", "collection-a-pack"],
    remainderPackId: "collection-other",
  }],
  unassignedTrailIds: [],
  editor: {
    hiddenPackIds: ["battle-ground", "cle-elum", "standalone"],
    activePackId: "cle-elum",
    checkedPackIds: ["battle-ground", "standalone"],
  },
};

const first = cleanupCurationProject(input, sourceRecords, activeCatalog);
const second = cleanupCurationProject(input, sourceRecords, activeCatalog);
assert.deepEqual(first, second, "Cleanup must be deterministic.");
assert.deepEqual(first.counts, {
  physicalPackCount: 7,
  retainedPackCount: 6,
  deletePackCount: 1,
  collectionCount: 1,
  logicalAreaCount: 4,
  totalTrailCount: 13,
  unassignedTrailCount: 0,
});
assert.deepEqual(first.output.packs.map((row) => row.id), [
  "collection-a-pack",
  "collection-b-pack",
  "collection-other",
  "delete",
  "leavenworth",
  "obdr",
  "standalone",
]);
assert.deepEqual(
  first.output.packs.find((row) => row.id === "leavenworth").trailIds,
  ["cle-1", "cle-2", "leavenworth-1"],
);
assert.deepEqual(
  first.output.packs.find((row) => row.id === "leavenworth").labelPoint,
  [10, 0],
  "The label must sit on a representative trail, not the overall bounding-box center.",
);
assert.deepEqual(
  first.output.packs.find((row) => row.id === "obdr").trailIds,
  ["obdr-1"],
);
assert.deepEqual(
  first.output.packs.find((row) => row.id === "delete").trailIds,
  ["battle-1", "battle-2", "delete-old-1", "delete-old-2", "tt"],
);
assert.deepEqual(first.output.collections, [{
  id: "collection",
  name: "Collection",
  labelPoint: [31, 0],
  memberPackIds: ["collection-a-pack", "collection-b-pack"],
  remainderPackId: "collection-other",
}]);
assert.deepEqual(first.output.editor, {
  hiddenPackIds: ["standalone"],
  activePackId: null,
  checkedPackIds: ["standalone"],
});
assert.equal(first.audit.discardedNamedTrails[0].trailId, "tt");
assert.equal(first.audit.discardedNamedTrails[0].displayName, "TT to Celatchee");
assert.equal(first.audit.deleteTrailCount, 5);

const tieRecords = new Map([
  ["a", sourceRecord("a", "A", [0, 0])],
  ["b", sourceRecord("b", "B", [10, 0])],
]);
assert.deepEqual(
  representativeLabelPoint(["b", "a"], tieRecords),
  [0, 0],
  "Equal-distance labels must use the lexicographically first trail ID.",
);

const noTarget = structuredClone(input);
const noTargetRecords = new Map([...sourceRecords].map(([trailId, record]) => [
  trailId,
  trailId === "tt" ? { ...record, displayName: "Different trail", sourcePaths: "different.gpx" } : record,
]));
assert.throws(
  () => cleanupCurationProject(noTarget, noTargetRecords, activeCatalog),
  /Expected exactly one TT to Chelatchee trail in the active map; found 0/,
);

console.log("cleanup-final-curation self-test passed");
