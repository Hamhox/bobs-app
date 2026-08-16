#!/usr/bin/env node

import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ACTIONS = ["menu", "up", "left", "center", "right", "down", "back", "enter"];
const EXPECTED = {
  states: 146,
  referencedScreens: 146,
  availableScreens: 156,
  noOps: 330,
  autoTransitions: 15,
  screenWidth: 504,
  screenHeight: 303,
};

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const appDirectory = path.resolve(toolDirectory, "..");
const outputManifest = path.join(appDirectory, "data", "voyager-states.json");
const outputScreens = path.join(appDirectory, "assets", "screens");

function parseArguments(argv) {
  const sourceIndex = argv.indexOf("--source");
  if (sourceIndex === -1 || !argv[sourceIndex + 1]) {
    throw new Error(
      "Usage: node tools/build-voyager-manifest.mjs --source <extracted gps_demo3 directory>",
    );
  }

  return { source: path.resolve(argv[sourceIndex + 1]) };
}

function getAttribute(source, name) {
  const expression = new RegExp(
    `${name}\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))`,
    "i",
  );
  const match = source.match(expression);
  return match ? match[1] ?? match[2] ?? match[3] ?? "" : null;
}

function basenameFromWebPath(value) {
  return path.posix.basename(value.replaceAll("\\", "/"));
}

function normalizeStateTarget(href) {
  const normalized = href.trim().replaceAll("\\", "/");
  if (!normalized || normalized === "#") return null;

  const withoutFragment = normalized.split("#", 1)[0].split("?", 1)[0];
  const target = basenameFromWebPath(withoutFragment).replace(/\.html?$/i, "");
  return target || null;
}

function actionFromButtonImage(source) {
  const filename = basenameFromWebPath(source).toLowerCase();
  if (/^b-menu\+?-/.test(filename)) return "menu";
  if (filename.startsWith("b-pup-")) return "up";
  if (filename.startsWith("b-pleft-")) return "left";
  if (filename.startsWith("b-pcenter-")) return "center";
  if (filename.startsWith("b-pright-")) return "right";
  if (filename.startsWith("b-pdown-")) return "down";
  if (filename.startsWith("b-back-")) return "back";
  if (filename.startsWith("b-ok-") || filename.startsWith("b-enter-")) return "enter";
  return null;
}

function parseAutoTransition(html) {
  const activeHtml = html.replace(/<!--[\s\S]*?-->/g, "");
  const candidates = [
    ...[...activeHtml.matchAll(/<meta\b([^>]*)>/gi)].map((match) => ({ match, active: true })),
    ...[...html.matchAll(/<meta\b([^>]*)>/gi)].map((match) => ({ match, active: false })),
  ];

  for (const candidate of candidates) {
    const { match, active } = candidate;
    const httpEquiv = getAttribute(match[1], "http-equiv");
    if (httpEquiv?.toLowerCase() !== "refresh") continue;

    const content = getAttribute(match[1], "content");
    const refresh = content?.match(/^\s*([\d.]+)\s*;\s*url\s*=\s*(.+?)\s*$/i);
    if (!refresh) throw new Error(`Could not parse meta refresh: ${content}`);

    return {
      delayMs: Math.round(Number(refresh[1]) * 1000),
      target: normalizeStateTarget(refresh[2]),
      active,
    };
  }

  return null;
}

function parseState(filename, html) {
  const id = filename.replace(/\.html?$/i, "");
  const transitions = {};
  const archiveLinks = new Set();

  for (const anchor of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = getAttribute(anchor[1], "href");
    const archiveTarget = normalizeStateTarget(href ?? "");
    if (archiveTarget) archiveLinks.add(archiveTarget);
    const image = anchor[2].match(/<img\b([^>]*)>/i);
    const imageSource = image ? getAttribute(image[1], "src") : null;
    const action = imageSource ? actionFromButtonImage(imageSource) : null;
    if (!action) continue;
    if (Object.hasOwn(transitions, action)) {
      throw new Error(`${filename} contains more than one ${action} control`);
    }
    transitions[action] = normalizeStateTarget(href ?? "");
  }

  const missingActions = ACTIONS.filter((action) => !Object.hasOwn(transitions, action));
  if (missingActions.length) {
    throw new Error(`${filename} is missing controls: ${missingActions.join(", ")}`);
  }

  const screenSources = [...html.matchAll(/<img\b([^>]*)>/gi)]
    .map((match) => getAttribute(match[1], "src"))
    .filter(Boolean)
    .map(basenameFromWebPath)
    .filter((screen) => screen.toLowerCase().endsWith(".gif") && !screen.startsWith("b-"));

  if (screenSources.length !== 1) {
    throw new Error(`${filename} has ${screenSources.length} explicit screen images`);
  }

  return {
    id,
    screen: `assets/screens/${screenSources[0]}`,
    transitions: Object.fromEntries(ACTIONS.map((action) => [action, transitions[action]])),
    autoTransition: parseAutoTransition(html),
    archiveLinks: [...archiveLinks].sort((a, b) => a.localeCompare(b)),
  };
}

async function gifDimensions(filename) {
  const handle = await readFile(filename);
  const signature = handle.subarray(0, 6).toString("ascii");
  if (signature !== "GIF87a" && signature !== "GIF89a") {
    throw new Error(`${filename} is not a GIF`);
  }
  return { width: handle.readUInt16LE(6), height: handle.readUInt16LE(8) };
}

function assertInsideApp(target) {
  const relative = path.relative(appDirectory, path.resolve(target));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to replace output outside the app: ${target}`);
  }
}

function countReachable(states, initialState, includeArchiveLinks = false) {
  const visited = new Set();
  const queue = [initialState];

  while (queue.length) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    const state = states[id];
    if (!state) continue;

    for (const target of Object.values(state.transitions)) {
      if (target && !visited.has(target)) queue.push(target);
    }
    if (state.autoTransition?.target && !visited.has(state.autoTransition.target)) {
      queue.push(state.autoTransition.target);
    }
    if (includeArchiveLinks) {
      for (const target of state.archiveLinks) {
        if (!visited.has(target)) queue.push(target);
      }
    }
  }

  return visited.size;
}

async function main() {
  const { source } = parseArguments(process.argv.slice(2));
  const sourceImages = path.join(source, "images");
  const sourceInfo = await stat(source).catch(() => null);
  if (!sourceInfo?.isDirectory()) throw new Error(`Source directory does not exist: ${source}`);

  const htmlFiles = (await readdir(source))
    .filter((filename) => filename.toLowerCase().endsWith(".html"))
    .sort((a, b) => a.localeCompare(b));

  const stateRecords = await Promise.all(
    htmlFiles.map(async (filename) =>
      parseState(filename, await readFile(path.join(source, filename), "utf8")),
    ),
  );
  const states = Object.fromEntries(stateRecords.map((state) => [state.id, state]));
  const referencedScreens = new Set(
    stateRecords.map((state) => path.posix.basename(state.screen)),
  );

  const sourceGifFiles = (await readdir(sourceImages)).filter((filename) =>
    filename.toLowerCase().endsWith(".gif"),
  );
  let availableScreens = 0;
  for (const filename of sourceGifFiles) {
    const dimensions = await gifDimensions(path.join(sourceImages, filename));
    if (dimensions.width === EXPECTED.screenWidth && dimensions.height === EXPECTED.screenHeight) {
      availableScreens += 1;
    }
  }

  for (const state of stateRecords) {
    for (const [action, target] of Object.entries(state.transitions)) {
      if (target && !states[target]) {
        throw new Error(`${state.id}.${action} points to missing state ${target}`);
      }
    }
    if (state.autoTransition?.target && !states[state.autoTransition.target]) {
      throw new Error(`${state.id} auto-transitions to missing state ${state.autoTransition.target}`);
    }
    for (const target of state.archiveLinks) {
      if (!states[target]) throw new Error(`${state.id} archive link points to missing state ${target}`);
    }

    const sourceScreen = path.join(sourceImages, path.posix.basename(state.screen));
    const dimensions = await gifDimensions(sourceScreen);
    if (dimensions.width !== EXPECTED.screenWidth || dimensions.height !== EXPECTED.screenHeight) {
      throw new Error(
        `${state.screen} is ${dimensions.width}x${dimensions.height}, expected 504x303`,
      );
    }
  }

  const noOps = stateRecords.reduce(
    (total, state) => total + Object.values(state.transitions).filter((target) => target === null).length,
    0,
  );
  const autoTransitions = stateRecords.filter((state) => state.autoTransition).length;
  const activeAutoTransitions = stateRecords.filter((state) => state.autoTransition?.active).length;
  const actionReachableStates = countReachable(states, "index");
  const archiveReachableStates = countReachable(states, "index", true);
  const stateScreenNameDifferences = stateRecords.filter(
    (state) => state.id !== path.posix.basename(state.screen, ".gif"),
  ).length;

  const audit = {
    states: stateRecords.length,
    referencedScreens: referencedScreens.size,
    availableScreens,
    noOps,
    autoTransitions,
    activeAutoTransitions,
    actionReachableStates,
    archiveReachableStates,
    stateScreenNameDifferences,
  };

  for (const [key, expected] of Object.entries(EXPECTED)) {
    if (key === "screenWidth" || key === "screenHeight") continue;
    if (audit[key] !== expected) {
      throw new Error(`Audit mismatch for ${key}: received ${audit[key]}, expected ${expected}`);
    }
  }
  if (archiveReachableStates !== EXPECTED.states) {
    throw new Error(
      `Only ${archiveReachableStates} of ${EXPECTED.states} states are reachable with archive links`,
    );
  }

  const manifest = {
    version: 1,
    title: "Trail Tech Voyager linked-prototype manifest",
    initialState: "index",
    actions: ACTIONS,
    guidedRoute: ["index", "m-main1-1", "m-main1-2", "m-main1-3", "m-main1-3-1"],
    stats: audit,
    states,
  };

  assertInsideApp(outputScreens);
  assertInsideApp(outputManifest);
  await rm(outputScreens, { recursive: true, force: true });
  await mkdir(outputScreens, { recursive: true });
  await mkdir(path.dirname(outputManifest), { recursive: true });

  for (const screen of [...referencedScreens].sort((a, b) => a.localeCompare(b))) {
    await copyFile(path.join(sourceImages, screen), path.join(outputScreens, screen));
  }
  await writeFile(outputManifest, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log(JSON.stringify(audit, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
