import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { VOYAGER_LIVE_STATE_IDS } from "../voyager-live-screens.js";
import { VOYAGER_MENU_STATE_IDS } from "../voyager-menu-registry.js";

const toolDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = join(toolDirectory, "..");
const manifestPath = join(appDirectory, "data", "voyager-states.json");
const outputPath = join(appDirectory, "data", "voyager-live-coverage.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

function familyFor(state) {
  const file = state.referenceScreen.toLowerCase();
  if (state.id === "startup") return "startup";
  if (state.id.startsWith("index")) return "main-gauge";
  if (state.id.startsWith("map")) return "track-map";
  if (state.id.startsWith("eng")) return "temperature";
  if (state.id.startsWith("alt")) return "altitude";
  if (state.id.startsWith("cstm")) return "user-screen";
  if (state.id.startsWith("dir")) return "navigation";
  if (state.id.startsWith("sat")) return "satellite";
  if (file.includes("m-main")) return "main-menu";
  if (file.includes("m-ride")) return "ride-menu";
  if (file.includes("m-set")) return "settings-menu";
  return "unclassified-legacy";
}

const liveStateIds = new Set([...VOYAGER_LIVE_STATE_IDS, ...VOYAGER_MENU_STATE_IDS]);

const states = Object.values(manifest.states)
  .sort((a, b) => a.id.localeCompare(b.id))
  .map((state) => ({
    id: state.id,
    family: familyFor(state),
    renderer: liveStateIds.has(state.id) ? "live-svg" : "missing",
    status: state.id === "startup"
      ? "pass-5-live"
      : VOYAGER_LIVE_STATE_IDS.has(state.id)
        ? "pass-2-live"
        : VOYAGER_MENU_STATE_IDS.has(state.id)
          ? "pass-3-live"
          : "unimplemented",
    referenceScreen: state.referenceScreen,
    reachableInputs: Object.entries(state.transitions)
      .filter(([, target]) => target !== null)
      .map(([input]) => input),
    noOpInputs: Object.entries(state.transitions)
      .filter(([, target]) => target === null)
      .map(([input]) => input),
    autoTransition: state.autoTransition ?? null,
  }));

const coverage = {
  schemaVersion: 1,
  sourceManifest: "voyager-states.json",
  rendererPolicy: "Every production-reachable state uses the live SVG renderer. Historical screen filenames remain metadata only.",
  mapScope: "Track-only: current recording and loaded GPX tracks/routes. No basemap, terrain, tiles, roads, or place labels.",
  totals: {
    knownStates: states.length,
    liveStates: states.filter((state) => state.renderer === "live-svg").length,
    nonLiveStates: states.filter((state) => state.renderer !== "live-svg").length,
  },
  states,
};

if (coverage.totals.liveStates !== coverage.totals.knownStates || coverage.totals.nonLiveStates !== 0) {
  throw new Error(
    `Live coverage is incomplete: ${coverage.totals.liveStates}/${coverage.totals.knownStates} states`,
  );
}

await writeFile(outputPath, `${JSON.stringify(coverage, null, 2)}\n`, "utf8");
console.log(JSON.stringify(coverage.totals, null, 2));
