import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mapRoot = resolve(process.argv[2] || resolve(appRoot, "local-data"));
const releaseRoot = resolve(process.argv[3] || resolve(appRoot, "local-voyager-release"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function rowsToObjects(fields, rows) {
  assert(Array.isArray(fields) && Array.isArray(rows), "The overview table is malformed.");
  return rows.map((row) => {
    assert(Array.isArray(row) && row.length === fields.length, "An overview row is malformed.");
    return Object.fromEntries(fields.map((field, index) => [field, row[index]]));
  });
}

function safeReleasePath(relativePath) {
  assert(typeof relativePath === "string" && relativePath.length > 0, "A release file path is missing.");
  const path = resolve(releaseRoot, ...relativePath.replaceAll("\\", "/").split("/"));
  assert(path.startsWith(`${releaseRoot}\\`) || path.startsWith(`${releaseRoot}/`), `Unsafe release path: ${relativePath}`);
  return path;
}

async function verifyFile(record) {
  const path = safeReleasePath(record.file);
  const fileStat = await stat(path);
  assert(fileStat.isFile(), `Release asset is not a file: ${record.file}`);
  assert(fileStat.size === record.bytes, `Release byte count changed: ${record.file}`);
  const digest = createHash("sha256").update(await readFile(path)).digest("hex");
  assert(digest === record.sha256, `Release hash changed: ${record.file}`);
}

const mapManifest = await readJson(resolve(mapRoot, "web-map", "v2", "manifest.json"));
const overview = await readJson(resolve(mapRoot, ...mapManifest.overviewFile.split("/")));
const release = await readJson(resolve(releaseRoot, "voyager-production-manifest.json"));

assert(release.schemaVersion === 1, "Unsupported Voyager release schema.");
assert(release.source.webMapBuildKey === mapManifest.buildKey, "The Voyager release build key does not match the map.");
assert(release.source.sourceCatalogSha256 === mapManifest.sourceCatalogSha256, "The source catalog hash does not match.");
assert(release.source.ridingAreasSha256 === mapManifest.ridingAreasSha256, "The riding-area hash does not match.");
assert(release.source.namedAssignedTrailCount === mapManifest.counts.namedAssignedTrails, "The assigned-trail count does not match.");
assert(release.validation.allCanonicalSourceFilesRehashedAfterBuild === true, "Canonical GPX sources were not rehashed.");
assert(release.validation.stateContextRehashedAfterBuild === true, "The state-context source was not rehashed.");
assert(release.validation.allPacksWithinDeviceLimits === true, "Not every pack fits the device limits.");

const areas = rowsToObjects(overview.areaFields, overview.areas);
const collections = rowsToObjects(overview.collectionFields, overview.collections);
const areasById = new Map(areas.map((area) => [area.id, area]));
const packs = new Map(release.packs.map((pack) => [pack.id, pack]));
assert(packs.size === release.packs.length, "The Voyager release contains duplicate pack IDs.");

for (const area of areas) {
  const pack = packs.get(area.id);
  assert(pack, `Missing Voyager pack: ${area.name}`);
  assert(pack.kind === "riding-area", `Unexpected pack type for ${area.name}.`);
  assert(pack.name === area.name, `Pack name mismatch for ${area.id}.`);
  assert(pack.sourceTrailCount === area.count, `Pack trail-count mismatch for ${area.name}.`);
}

const expectedRemainderIds = new Set();
for (const collection of collections) {
  const memberAreas = collection.memberAreaIds.map((id) => areasById.get(id));
  assert(memberAreas.every(Boolean), `The ${collection.name} collection references an unknown riding area.`);
  assert(
    collection.memberAreaIds.every((id) => packs.get(id)?.kind === "riding-area"),
    `A ${collection.name} member pack is missing.`,
  );
  const memberTrailCount = memberAreas.reduce((total, area) => total + area.count, 0);
  const remainderTrailCount = collection.count - memberTrailCount;
  assert(remainderTrailCount >= 0, `The ${collection.name} collection has inconsistent trail totals.`);
  if (!remainderTrailCount) continue;

  const remainderId = `${collection.id}-other`;
  const remainder = packs.get(remainderId);
  expectedRemainderIds.add(remainderId);
  assert(remainder?.kind === "collection-remainder", `The ${collection.name} remainder pack is missing.`);
  assert(remainder.name === `${collection.name} - Other`, `The ${collection.name} remainder name changed.`);
  assert(
    remainder.sourceTrailCount === remainderTrailCount,
    `The ${collection.name} remainder trail count changed.`,
  );
}
const remainderPacks = release.packs.filter((pack) => pack.kind === "collection-remainder");
assert(
  remainderPacks.every((pack) => expectedRemainderIds.has(pack.id)),
  "The Voyager release contains an unexpected collection remainder.",
);
assert(remainderPacks.length === expectedRemainderIds.size, "A collection remainder is missing.");
assert(release.packs.length === areas.length + expectedRemainderIds.size, "The runtime pack coverage is not exact.");

await Promise.all([...release.packs.map((pack) => verifyFile(pack.gpx)), verifyFile(release.addon.gpx)]);

console.log(JSON.stringify({
  buildKey: mapManifest.buildKey,
  ridingAreaPacks: areas.length,
  collectionRemainders: remainderPacks.length,
  totalPacks: release.packs.length,
  optionalAddons: 1,
  verifiedGpxFiles: release.packs.length + 1,
}, null, 2));
