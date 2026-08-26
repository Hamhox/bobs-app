import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const toolDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(toolDirectory, "..");
const mapSource = resolve(process.argv[2] || join(appDirectory, "local-data"));
const releaseSource = resolve(process.argv[3] || join(appDirectory, "local-voyager-release"));
const outputDirectory = resolve(process.argv[4] || join(appDirectory, "runtime"));
const mapManifestPath = "web-map/v2/manifest.json";
const releaseManifestPath = "voyager-production-manifest.json";
const basemapPath = "web-map/basemap/bobs-pirate-map.pmtiles";

function resolveInside(root, relativePath) {
  const normalized = String(relativePath || "").replaceAll("\\", "/");
  const target = resolve(root, normalized);
  const pathFromRoot = relative(root, target);
  if (!normalized || isAbsolute(normalized) || pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
    throw new Error(`Unsafe runtime asset path: ${relativePath}`);
  }
  return target;
}

async function readJson(root, relativePath) {
  return JSON.parse(await readFile(resolveInside(root, relativePath), "utf8"));
}

async function writeJson(root, relativePath, value) {
  const target = resolveInside(root, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(value));
  return (await stat(target)).size;
}

async function copyAsset(sourceRoot, targetRoot, relativePath) {
  const source = resolveInside(sourceRoot, relativePath);
  const target = resolveInside(targetRoot, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
  return (await stat(target)).size;
}

function stripCanonicalPaths(chunk, relativePath) {
  if (!Array.isArray(chunk.catalogFields) || !Array.isArray(chunk.catalog)) {
    throw new Error(`Invalid map chunk: ${relativePath}`);
  }
  const sourcePathIndex = chunk.catalogFields.indexOf("gpx_path");
  if (sourcePathIndex < 0) return chunk;
  const expectedLength = chunk.catalogFields.length;
  chunk.catalogFields = chunk.catalogFields.filter((_, index) => index !== sourcePathIndex);
  chunk.catalog = chunk.catalog.map((row) => {
    if (!Array.isArray(row) || row.length !== expectedLength) {
      throw new Error(`Invalid map catalog row: ${relativePath}`);
    }
    return row.filter((_, index) => index !== sourcePathIndex);
  });
  return chunk;
}

async function stageMap(stageRoot) {
  const mapOutput = join(stageRoot, "map");
  const manifest = await readJson(mapSource, mapManifestPath);
  const overview = await readJson(mapSource, manifest.overviewFile);
  const fileFieldIndex = overview.groupFields?.indexOf("file");
  if (manifest.version !== 2 || fileFieldIndex < 0 || !Array.isArray(overview.groups)) {
    throw new Error("The compact map manifest is not supported.");
  }

  let files = 0;
  let bytes = 0;
  for (const relativePath of [mapManifestPath, manifest.overviewFile, manifest.contextFile, basemapPath]) {
    bytes += await copyAsset(mapSource, mapOutput, relativePath);
    files += 1;
  }
  for (const row of overview.groups) {
    const relativePath = row?.[fileFieldIndex];
    const chunk = stripCanonicalPaths(await readJson(mapSource, relativePath), relativePath);
    bytes += await writeJson(mapOutput, relativePath, chunk);
    files += 1;
  }
  return { files, bytes, buildKey: manifest.buildKey };
}

async function stageRelease(stageRoot, expectedBuildKey) {
  const releaseOutput = join(stageRoot, "release");
  const manifest = await readJson(releaseSource, releaseManifestPath);
  if (
    manifest.schemaVersion !== 1 ||
    manifest.source?.webMapBuildKey !== expectedBuildKey ||
    !Array.isArray(manifest.packs) ||
    !manifest.addon?.gpx?.file
  ) {
    throw new Error("The prebuilt GPX release does not match the compact map.");
  }
  const filesToCopy = new Set([
    releaseManifestPath,
    ...manifest.packs.map((pack) => pack?.gpx?.file),
    manifest.addon.gpx.file,
  ]);
  if ([...filesToCopy].some((value) => typeof value !== "string" || !value)) {
    throw new Error("The prebuilt GPX release contains an invalid file path.");
  }

  let files = 0;
  let bytes = 0;
  for (const relativePath of filesToCopy) {
    bytes += await copyAsset(releaseSource, releaseOutput, relativePath);
    files += 1;
  }
  return { files, bytes, packs: manifest.packs.length };
}

if (await stat(outputDirectory).then(() => true, () => false)) {
  throw new Error(`Refusing to replace existing runtime directory: ${outputDirectory}`);
}

const stageRoot = await mkdtemp(join(appDirectory, ".runtime-stage-"));
try {
  const map = await stageMap(stageRoot);
  const release = await stageRelease(stageRoot, map.buildKey);
  await rename(stageRoot, outputDirectory);
  const totalFiles = map.files + release.files;
  const totalBytes = map.bytes + release.bytes;
  console.log(JSON.stringify({
    buildKey: map.buildKey,
    mapFiles: map.files,
    releaseFiles: release.files,
    ridingAreaPacks: release.packs,
    totalFiles,
    totalBytes,
    totalMiB: Number((totalBytes / 1024 / 1024).toFixed(2)),
  }, null, 2));
} catch (error) {
  await rm(stageRoot, { recursive: true, force: true });
  throw error;
}
