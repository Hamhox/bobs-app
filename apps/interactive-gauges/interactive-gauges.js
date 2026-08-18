import { initializeFontPlayground } from "./font-playground.js";
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
const guideElements = {
  panel: document.querySelector("#guide-panel"),
  number: document.querySelector("#guide-number"),
  label: document.querySelector("#guide-label"),
  instruction: document.querySelector("#guide-instruction"),
  live: document.querySelector("#guide-live"),
  controls,
  stage,
};

const preloadCache = new Map();
let transitionPending = false;

function screenUrl(state) {
  return `${APP_BASE}/${state.screen}`;
}

function preloadState(manifest, stateId) {
  const state = manifest.states[stateId];
  if (!state) return Promise.resolve();
  const url = screenUrl(state);
  if (preloadCache.has(url)) return preloadCache.get(url);

  const preload = new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = async () => {
      try {
        await image.decode();
      } catch {
        // A completed image remains safe to display when decode() is unavailable.
      }
      resolve(url);
    };
    image.onerror = () => {
      preloadCache.delete(url);
      reject(new Error(`Voyager screen could not be loaded: ${state.screen}`));
    };
    image.src = url;
  });

  preloadCache.set(url, preload);
  return preload;
}

function guidedPreloadTargets(manifest) {
  const targets = new Set(manifest.guidedRoute);
  for (const stateId of manifest.guidedRoute) {
    const state = manifest.states[stateId];
    for (const target of Object.values(state.transitions)) {
      if (target) targets.add(target);
    }
    if (state.autoTransition?.target) targets.add(state.autoTransition.target);
  }
  return [...targets];
}

function pulseControl(action, moved) {
  for (const control of controls.filter((item) => item.dataset.action === action)) {
    if (stage.dataset.guideActive === "true" && !control.hasAttribute("data-guided")) continue;
    control.dataset.pressed = moved ? "true" : "noop";
    window.setTimeout(() => control.removeAttribute("data-pressed"), 180);
  }
}

function commitState(engine, state, event) {
  const manifest = engine.getManifest();
  screen.src = screenUrl(state);
  screen.alt = `Voyager interface archive state ${state.id}`;
  stateCode.textContent = state.id;
  timerStatus.textContent = state.autoTransition?.active
    ? `${Math.round(state.autoTransition.delayMs / 1000)} sec`
    : "None";

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
  for (const target of likelyTargets) preloadState(manifest, target).catch(() => {});

  if (event.type === "auto") {
    interactionLive.textContent = `Archived timer advanced the interface to ${state.id}.`;
  } else if (event.type === "dispatch" && event.to === null) {
    interactionLive.textContent = `${event.action} is an intentional no-op from ${state.id}.`;
  } else if (event.type === "dispatch") {
    interactionLive.textContent = `${event.action} opened archive state ${state.id}.`;
  }
}

async function dispatchAfterPreload(action, source, engine) {
  if (transitionPending) return null;
  const currentState = engine.getState();
  const target = currentState.transitions[action];

  if (!target || target === currentState.id) return engine.dispatch(action, source);

  transitionPending = true;
  stage.setAttribute("aria-busy", "true");
  try {
    await preloadState(engine.getManifest(), target);
    return engine.dispatch(action, source);
  } catch (error) {
    interactionLive.textContent = error.message;
    return null;
  } finally {
    transitionPending = false;
    stage.removeAttribute("aria-busy");
  }
}

function bindControl(control, engine) {
  control.addEventListener("click", async () => {
    const result = await dispatchAfterPreload(control.dataset.action, "physical-control", engine);
    if (result) pulseControl(control.dataset.action, result.to !== null);
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

  stage.addEventListener("keydown", async (event) => {
    if (
      event.target.matches("button") &&
      (event.key === "Enter" || event.key === " " || event.key === "Spacebar")
    ) {
      return;
    }
    const action = keyActions[event.key];
    if (!action) return;
    event.preventDefault();
    const result = await dispatchAfterPreload(action, "keyboard", engine);
    if (result) pulseControl(action, result.to !== null);
  });
}

function enableInterface(engine, guide) {
  for (const control of controls) {
    control.disabled = false;
    bindControl(control, engine);
  }
  startGuideButton.disabled = false;
  exploreButton.disabled = false;
  bindKeyboard(engine);
  guide.exit();

  startGuideButton.addEventListener("click", () => guide.start());
  exploreButton.addEventListener("click", () => guide.exit());
}

async function initializeVoyager() {
  try {
    const response = await fetch(`${APP_BASE}/data/voyager-states.json`);
    if (!response.ok) throw new Error(`Manifest request failed with ${response.status}`);
    const manifest = await response.json();
    const engine = new VoyagerStateEngine(manifest);
    const guide = new VoyagerGuide(engine, guideElements);
    mapViewer.connectPrototype(manifest, async (stateId) => {
      stage.setAttribute("aria-busy", "true");
      try {
        await preloadState(manifest, stateId);
        guide.exit();
        engine.reset(stateId, "map-viewer");
        interactionLive.textContent = `Interface map opened archive state ${stateId}.`;
        stage.focus({ preventScroll: true });
        stage.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
          block: "center",
        });
      } catch (error) {
        interactionLive.textContent = error.message;
      } finally {
        stage.removeAttribute("aria-busy");
      }
    });
    engine.subscribe((state, event) => {
      commitState(engine, state, event);
      guide.observe(state, event);
    });
    document.querySelector("#voyager-load-status").textContent = "Loading";
    await Promise.all(guidedPreloadTargets(manifest).map((stateId) => preloadState(manifest, stateId)));
    document.querySelector("#voyager-load-status").textContent = "Ready";
    enableInterface(engine, guide);
  } catch (error) {
    document.querySelector("#voyager-load-status").textContent = "Unavailable";
    interactionLive.textContent = error.message;
    stage.dataset.loadError = "true";
  }
}

const mapViewer = new VoyagerMapViewer({
  dialog: document.querySelector("#system-map-dialog"),
  viewport: document.querySelector("#system-map-viewport"),
  image: document.querySelector("#system-map-image"),
  status: document.querySelector("#system-map-status"),
  source: `${APP_BASE}/assets/system/voyager-screens-b3.svg`,
});

for (const opener of document.querySelectorAll("#open-system-map, #open-system-map-preview")) {
  opener.addEventListener("click", () => mapViewer.open("overview"));
}
initializeFontPlayground(document.querySelector("#font-playground"));
initializeVoyager();
