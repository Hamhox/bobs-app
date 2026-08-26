import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const DEFAULT_MANIFEST_PATH =
  "apps/trail-pack-builder/local-data/web-map/v2/manifest.json";

function fail(message) {
  throw new Error(message);
}

function requireCondition(condition, message) {
  if (!condition) fail(message);
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
  const candidates = [
    manifestDirectory,
    resolve(manifestDirectory, "..", ".."),
  ];
  for (const root of candidates) {
    if (await exists(resolve(root, overviewFile))) return root;
  }
  fail(`Unable to resolve overview file ${overviewFile} from ${manifestPath}.`);
}

function normalizedNonemptyString(value) {
  return typeof value === "string" ? value.trim() : "";
}

async function loadCatalogUniverse(manifest, manifestPath) {
  requireCondition(
    typeof manifest?.overviewFile === "string" && manifest.overviewFile,
    "The map manifest does not identify an overview file.",
  );
  requireCondition(
    Number.isInteger(manifest?.counts?.trails) && manifest.counts.trails >= 0,
    "The map manifest has an invalid trail count.",
  );

  const dataRoot = await resolveDataRoot(manifestPath, manifest.overviewFile);
  const overviewPath = resolve(dataRoot, manifest.overviewFile);
  const overview = await readJson(overviewPath, "map overview");
  const fileIndex = Array.isArray(overview?.groupFields)
    ? overview.groupFields.indexOf("file")
    : -1;
  requireCondition(
    fileIndex >= 0 && Array.isArray(overview.groups),
    "The map overview does not contain readable chunk references.",
  );

  const chunkFiles = [];
  for (const row of overview.groups) {
    const file = Array.isArray(row) ? row[fileIndex] : null;
    requireCondition(
      typeof file === "string" && file,
      "The map overview contains an invalid chunk reference.",
    );
    chunkFiles.push(file);
  }

  const chunks = await Promise.all(
    chunkFiles.map((file) => readJson(resolve(dataRoot, file), `map chunk ${file}`)),
  );
  const universe = new Set();
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex];
    const trailIdIndex = Array.isArray(chunk?.catalogFields)
      ? chunk.catalogFields.indexOf("trail_id")
      : -1;
    requireCondition(
      trailIdIndex >= 0 && Array.isArray(chunk.catalog),
      `Map chunk ${chunkFiles[chunkIndex]} has no readable catalog.`,
    );
    for (const row of chunk.catalog) {
      const trailId = Array.isArray(row) ? normalizedNonemptyString(row[trailIdIndex]) : "";
      requireCondition(
        trailId,
        `Map chunk ${chunkFiles[chunkIndex]} contains an invalid trail ID.`,
      );
      requireCondition(!universe.has(trailId), `The map catalog repeats trail ID ${trailId}.`);
      universe.add(trailId);
    }
  }

  requireCondition(
    universe.size === manifest.counts.trails,
    `The map catalog contains ${universe.size} trails; its manifest declares ${manifest.counts.trails}.`,
  );
  return universe;
}

function validateProject(project, manifest, universe) {
  requireCondition(project?.schemaVersion === 1, "Unsupported curation schemaVersion.");
  requireCondition(
    project?.kind === "bobs-trail-pack-curation",
    "Unsupported curation project kind.",
  );
  requireCondition(project.source && typeof project.source === "object", "Missing curation source.");
  requireCondition(
    normalizedNonemptyString(manifest.sourceCatalogSha256),
    "The map manifest has no source catalog hash.",
  );
  requireCondition(
    normalizedNonemptyString(project.source.sourceCatalogSha256),
    "The curation project has no source catalog hash.",
  );
  requireCondition(
    project.source.sourceCatalogSha256 === manifest.sourceCatalogSha256,
    "The curation source catalog hash does not match the map manifest.",
  );
  requireCondition(
    project.source.trailCount === manifest.counts.trails &&
      project.source.trailCount === universe.size,
    "The curation source trail count does not match the map catalog.",
  );
  requireCondition(Array.isArray(project.packs), "The curation project has no packs array.");
  requireCondition(
    Array.isArray(project.unassignedTrailIds),
    "The curation project has no unassignedTrailIds array.",
  );

  const packIds = new Set();
  const packNames = new Set();
  const accounted = new Map();
  let assignedCount = 0;

  const accountTrail = (rawTrailId, owner) => {
    const trailId = normalizedNonemptyString(rawTrailId);
    requireCondition(trailId, `${owner} contains an invalid trail ID.`);
    requireCondition(universe.has(trailId), `${owner} contains unknown trail ID ${trailId}.`);
    const priorOwner = accounted.get(trailId);
    requireCondition(
      priorOwner === undefined,
      `Trail ${trailId} appears in both ${priorOwner} and ${owner}.`,
    );
    accounted.set(trailId, owner);
  };

  for (let index = 0; index < project.packs.length; index += 1) {
    const pack = project.packs[index];
    requireCondition(pack && typeof pack === "object", `Pack ${index + 1} is invalid.`);
    const id = normalizedNonemptyString(pack.id);
    const name = normalizedNonemptyString(pack.name);
    requireCondition(id, `Pack ${index + 1} has an empty ID.`);
    requireCondition(name, `Pack ${id} has an empty name.`);
    requireCondition(!packIds.has(id), `Duplicate pack ID ${id}.`);
    requireCondition(!packNames.has(name), `Duplicate pack name ${name}.`);
    packIds.add(id);
    packNames.add(name);
    requireCondition(Array.isArray(pack.trailIds), `Pack ${id} has no trailIds array.`);
    requireCondition(pack.trailIds.length > 0, `Pack ${id} is empty.`);
    for (const trailId of pack.trailIds) accountTrail(trailId, `pack ${id}`);
    assignedCount += pack.trailIds.length;
  }

  for (const trailId of project.unassignedTrailIds) {
    accountTrail(trailId, "unassignedTrailIds");
  }

  if (accounted.size !== universe.size) {
    const missing = [];
    for (const trailId of universe) {
      if (!accounted.has(trailId)) missing.push(trailId);
    }
    const preview = missing.slice(0, 5).join(", ");
    fail(
      `The curation project is missing ${missing.length} trail IDs` +
        (preview ? ` (${preview}${missing.length > 5 ? ", …" : ""})` : "") +
        ".",
    );
  }

  return {
    packCount: project.packs.length,
    assignedCount,
    unassignedCount: project.unassignedTrailIds.length,
    totalCount: accounted.size,
  };
}

async function main() {
  const [projectArgument, manifestArgument, ...extraArguments] = process.argv.slice(2);
  if (!projectArgument || extraArguments.length) {
    fail(
      "Usage: node validate-curation-project.mjs <exported-json> [map-manifest]",
    );
  }

  const projectPath = resolve(process.cwd(), projectArgument);
  const manifestPath = resolve(process.cwd(), manifestArgument || DEFAULT_MANIFEST_PATH);
  const [project, manifest] = await Promise.all([
    readJson(projectPath, "curation project"),
    readJson(manifestPath, "map manifest"),
  ]);
  const universe = await loadCatalogUniverse(manifest, manifestPath);
  const counts = validateProject(project, manifest, universe);
  console.log(
    `Valid curation project: ${counts.packCount.toLocaleString("en-US")} packs, ` +
      `${counts.assignedCount.toLocaleString("en-US")} assigned, ` +
      `${counts.unassignedCount.toLocaleString("en-US")} unassigned, ` +
      `${counts.totalCount.toLocaleString("en-US")} total.`,
  );
}

main().catch((error) => {
  console.error(`Curation validation failed: ${error.message}`);
  process.exitCode = 1;
});
