import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  compileCurationProject,
  compileProject,
  loadMapCatalog,
} from "./compile-curation-project.mjs";

function pack(id, name, trailIds) {
  return {
    id,
    name,
    labelPoint: [0, 0],
    provisional: false,
    transportGroupId: "g1",
    trailIds,
  };
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "bobs-curation-compiler-test-"));
try {
  const manifestPath = join(temporaryRoot, "manifest.json");
  const overviewPath = join(temporaryRoot, "overview.json");
  const chunkPath = join(temporaryRoot, "chunk.json");
  const inputPath = join(temporaryRoot, "editor.json");
  const outputPath = join(temporaryRoot, "compiled.json");
  const secondOutputPath = join(temporaryRoot, "compiled-again.json");

  const catalogRows = [
    ["t1", [-2, 0, -1, 1], "area-a", "collection-a"],
    ["t2", [-1, 0, 0, 1], "area-a", "collection-a"],
    ["t3", [0, 0, 1, 1], "area-b", "collection-a"],
    ["t4", [1, 0, 2, 1], null, "collection-a"],
    ["t5", [5, 5, 6, 6], null, null],
    ["t6", [10, 10, 11, 11], null, null],
    ["t7", [12, 12, 13, 13], null, null],
  ];
  await writeJson(manifestPath, {
    version: 2,
    scope: "fixture",
    overviewFile: "overview.json",
    sourceCatalogSha256: "fixture-sha",
    buildKey: "fixture-build",
    counts: { trails: catalogRows.length },
  });
  await writeJson(overviewPath, {
    version: 2,
    groupFields: ["id", "file"],
    groups: [["g1", "chunk.json"]],
    areaFields: ["id", "name", "count", "labelPoint", "groupIds"],
    areas: [
      ["area-a", "Area A", 2, [-1.5, 0.5], ["g1"]],
      ["area-b", "Area B", 1, [0.5, 0.5], ["g1"]],
    ],
    collectionFields: ["id", "name", "count", "labelPoint", "groupIds", "memberAreaIds"],
    collections: [[
      "collection-a",
      "Collection A",
      4,
      [0, 0.5],
      ["g1"],
      ["area-b", "area-a"],
    ]],
  });
  await writeJson(chunkPath, {
    version: 2,
    catalogFields: ["trail_id", "bbox", "area_id", "collection_id"],
    catalog: catalogRows,
  });
  await writeJson(inputPath, {
    schemaVersion: 1,
    kind: "bobs-trail-pack-curation",
    source: {
      qualityScope: "fixture",
      sourceCatalogSha256: "fixture-sha",
      trailCount: catalogRows.length,
      seedBuildKey: "fixture-build",
    },
    packs: [
      pack("standalone", "Standalone", ["t5"]),
      pack("logical", "Whole Collection", ["t4", "t2", "t1", "t3"]),
      pack("discard-two", "delete", ["t7"]),
      pack("discard-one", "DELETE", ["t6"]),
    ],
    unassignedTrailIds: [],
    editor: {
      hiddenPackIds: ["discard-two", "standalone"],
      unassignedVisible: true,
      autoFitSelection: false,
      activePackId: "discard-one",
      checkedPackIds: ["discard-two", "logical"],
    },
  });

  const catalog = await loadMapCatalog(manifestPath);
  const input = JSON.parse(await readFile(inputPath, "utf8"));
  const first = compileProject(input, catalog);
  const second = compileProject(input, catalog);
  assert.deepEqual(first, second, "Compilation must be deterministic.");
  assert.deepEqual(first.counts, {
    physicalPackCount: 5,
    retainedPackCount: 4,
    deletePackCount: 1,
    collectionCount: 1,
    logicalAreaCount: 2,
    totalTrailCount: 7,
    unassignedTrailCount: 0,
  });
  assert.deepEqual(first.output.packs.map((row) => row.id), [
    "area-a",
    "area-b",
    "collection-a-other",
    "delete",
    "standalone",
  ]);
  assert.deepEqual(first.output.collections, [{
    id: "collection-a",
    name: "Whole Collection",
    labelPoint: [0, 0],
    memberPackIds: ["area-a", "area-b"],
    remainderPackId: "collection-a-other",
  }]);
  assert.deepEqual(
    first.output.packs.find((row) => row.id === "delete").trailIds,
    ["t6", "t7"],
  );
  assert.deepEqual(
    first.output.packs.find((row) => row.id === "collection-a-other").trailIds,
    ["t4"],
  );
  assert.equal(
    first.output.packs.find((row) => row.id === "collection-a-other").name,
    "Collection A - Other",
  );
  assert.equal(
    first.output.collections[0].memberPackIds.includes("collection-a-other"),
    false,
    "A collection remainder must not be emitted as a riding-area member.",
  );

  const written = await compileCurationProject(inputPath, manifestPath, outputPath);
  assert.deepEqual(written, first);
  assert.deepEqual(JSON.parse(await readFile(outputPath, "utf8")), first.output);
  await compileCurationProject(inputPath, manifestPath, secondOutputPath);
  assert.equal(
    await readFile(secondOutputPath, "utf8"),
    await readFile(outputPath, "utf8"),
    "Equivalent inputs must produce byte-identical output.",
  );
  await assert.rejects(
    compileCurationProject(inputPath, manifestPath, outputPath),
    /Refusing to overwrite existing output/,
  );

  const noMatch = structuredClone(input);
  noMatch.packs = [
    pack("partial", "Partial", ["t1", "t2", "t3"]),
    pack("remainder", "Remainder", ["t4"]),
    pack("standalone", "Standalone", ["t5"]),
    pack("discard", "DELETE", ["t6", "t7"]),
  ];
  const unchanged = compileProject(noMatch, catalog);
  assert.equal(unchanged.output.collections.length, 0);
  assert.deepEqual(
    unchanged.output.packs.filter((row) => row.id !== "delete").map((row) => row.id),
    ["partial", "remainder", "standalone"],
  );

  const wrongHash = structuredClone(input);
  wrongHash.source.sourceCatalogSha256 = "wrong";
  assert.throws(
    () => compileProject(wrongHash, catalog),
    /source catalog hash does not match/,
  );

  for (const invalidId of ["bad--id", "bad-", "-bad", "Bad"]) {
    const invalidPackId = structuredClone(input);
    invalidPackId.packs[0].id = invalidId;
    assert.throws(
      () => compileProject(invalidPackId, catalog),
      /invalid ID/,
      `Pack ID ${invalidId} must match the Python curation contract.`,
    );
  }

  const nullLabelPoint = structuredClone(input);
  nullLabelPoint.packs[0].labelPoint = null;
  assert.throws(
    () => compileProject(nullLabelPoint, catalog),
    /invalid labelPoint/,
  );

  console.log("Curation compiler self-test passed.");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
