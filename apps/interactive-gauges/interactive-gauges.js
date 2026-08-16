import { VoyagerGuide } from "./voyager-guide.js";
import { VoyagerMapViewer } from "./voyager-map-viewer.js";
import { VoyagerStateEngine } from "./voyager-state-engine.js";

const APP_BASE = "/apps/interactive-gauges";
const stage = document.querySelector("#voyager-stage");
const screen = document.querySelector("#voyager-screen");
const stateCode = document.querySelector("#voyager-state-code");
const timerStatus = document.querySelector("#voyager-timer-status");
const interactionLive = document.querySelector("#interaction-live");
const controls = [...document.querySelectorAll("[data-action]")];
const startGuideButton = document.querySelector("#start-guided-ride");
const exploreButton = document.querySelector("#explore-freely");
const resetButton = document.querySelector("#reset-archive");
const guideExitButton = document.querySelector("#exit-guide");
const guideElements = {
  panel: document.querySelector("#guide-panel"),
  number: document.querySelector("#guide-number"),
  label: document.querySelector("#guide-label"),
  instruction: document.querySelector("#guide-instruction"),
  live: document.querySelector("#guide-live"),
  exit: guideExitButton,
  controls,
  stage,
};

const preloadCache = new Set();

function screenUrl(state) {
  return `${APP_BASE}/${state.screen}`;
}

function preloadState(manifest, stateId) {
  const state = manifest.states[stateId];
  if (!state) return;
  const url = screenUrl(state);
  if (preloadCache.has(url)) return;
  preloadCache.add(url);
  const image = new Image();
  image.src = url;
}

function pulseControl(action, moved) {
  for (const control of controls.filter((item) => item.dataset.action === action)) {
    control.dataset.pressed = moved ? "true" : "noop";
    window.setTimeout(() => control.removeAttribute("data-pressed"), 180);
  }
}

function renderState(engine, state, event) {
  const manifest = engine.getManifest();
  screen.src = screenUrl(state);
  screen.alt = `Voyager interface archive state ${state.id}`;
  stateCode.textContent = state.id;
  timerStatus.textContent = state.autoTransition?.active
    ? `Archive timer: ${Math.round(state.autoTransition.delayMs / 1000)} seconds`
    : "Archive timer: none";

  for (const control of controls) {
    const target = state.transitions[control.dataset.action];
    const noOp = target === null;
    control.toggleAttribute("data-noop", noOp);
    control.setAttribute("aria-disabled", String(noOp));
    control.title = noOp
      ? `${control.getAttribute("aria-label")}: no action from ${state.id}`
      : `${control.getAttribute("aria-label")}: open ${target}`;
  }

  const likelyTargets = new Set(
    [...Object.values(state.transitions), state.autoTransition?.target].filter(Boolean),
  );
  for (const target of likelyTargets) preloadState(manifest, target);

  if (event.type === "auto") {
    interactionLive.textContent = `Archived timer advanced the interface to ${state.id}.`;
  } else if (event.type === "dispatch" && event.to === null) {
    interactionLive.textContent = `${event.action} is an intentional no-op from ${state.id}.`;
  } else if (event.type === "dispatch") {
    interactionLive.textContent = `${event.action} opened archive state ${state.id}.`;
  }
}

function bindControl(control, engine) {
  control.addEventListener("click", () => {
    const result = engine.dispatch(control.dataset.action, "physical-control");
    pulseControl(control.dataset.action, result.to !== null);
  });
}

function bindKeyboard(engine) {
  const keyActions = {
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
    Enter: "enter",
    Escape: "back",
    m: "menu",
    M: "menu",
    c: "center",
    C: "center",
  };

  stage.addEventListener("keydown", (event) => {
    if (
      event.target.matches("button") &&
      (event.key === "Enter" || event.key === " " || event.key === "Spacebar")
    ) {
      return;
    }
    const action = keyActions[event.key];
    if (!action) return;
    event.preventDefault();
    const result = engine.dispatch(action, "keyboard");
    pulseControl(action, result.to !== null);
  });
}

function enableInterface(engine, guide) {
  for (const control of controls) {
    control.disabled = false;
    bindControl(control, engine);
  }
  startGuideButton.disabled = false;
  exploreButton.disabled = false;
  resetButton.disabled = false;
  bindKeyboard(engine);
  guide.exit();

  startGuideButton.addEventListener("click", () => {
    guide.start();
    stage.focus({ preventScroll: true });
  });
  exploreButton.addEventListener("click", () => guide.exit({ focusStage: true }));
  guideExitButton.addEventListener("click", () => guide.exit({ focusStage: true }));
  resetButton.addEventListener("click", () => {
    if (guide.active) guide.start();
    else engine.reset("index", "archive-reset");
    stage.focus({ preventScroll: true });
  });
}

async function initializeVoyager() {
  try {
    const response = await fetch(`${APP_BASE}/data/voyager-states.json`);
    if (!response.ok) throw new Error(`Manifest request failed with ${response.status}`);
    const manifest = await response.json();
    const engine = new VoyagerStateEngine(manifest);
    const guide = new VoyagerGuide(engine, guideElements);
    engine.subscribe((state, event) => {
      renderState(engine, state, event);
      guide.observe(state, event);
    });
    for (const stateId of manifest.guidedRoute) preloadState(manifest, stateId);
    enableInterface(engine, guide);
  } catch (error) {
    document.querySelector("#voyager-load-status").textContent =
      "The interface archive could not be loaded. Please refresh the page.";
    interactionLive.textContent = error.message;
    stage.dataset.loadError = "true";
  }
}

const mapViewer = new VoyagerMapViewer({
  dialog: document.querySelector("#system-map-dialog"),
  viewport: document.querySelector("#system-map-viewport"),
  image: document.querySelector("#system-map-image"),
  status: document.querySelector("#system-map-status"),
  source: `${APP_BASE}/assets/system/voyager-screens-b1.svg`,
});

document.querySelector("#open-system-map").addEventListener("click", () => mapViewer.open());
initializeVoyager();
