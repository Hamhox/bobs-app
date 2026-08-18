import { initializeFontPlayground } from "./font-playground.js";
import { VoyagerGuide } from "./voyager-guide.js";
import { VoyagerLiveRuntime } from "./voyager-live-runtime.js";
import { initializeVoyagerManual } from "./voyager-manual.js";
import { VoyagerMapViewer } from "./voyager-map-viewer.js";
import { VoyagerStateEngine } from "./voyager-state-engine.js";

const APP_BASE = "/apps/interactive-gauges";
const VOYAGER_URL_PARAMETER = "voyager";
const stage = document.querySelector("#voyager-stage");
const screen = document.querySelector("#voyager-screen");
const liveScreen = document.querySelector("#voyager-live-screen");
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
const liveRuntime = new VoyagerLiveRuntime({
  mount: liveScreen,
  legacyImage: screen,
  stage,
  appBase: APP_BASE,
});

const preloadCache = new Map();
let transitionPending = false;
let pendingHistoryMode = null;

function voyagerStateFromUrl() {
  return new URL(window.location.href).searchParams.get(VOYAGER_URL_PARAMETER);
}

function writeVoyagerStateToUrl(screenId, mode = "replace") {
  if (!screenId || mode === "none") return;
  const url = new URL(window.location.href);
  url.searchParams.set(VOYAGER_URL_PARAMETER, screenId);
  if (url.href === window.location.href) return;
  const state = { ...(window.history.state ?? {}), voyagerScreenId: screenId };
  window.history[mode === "push" ? "pushState" : "replaceState"](state, "", url);
}

function focusGauge() {
  stage.focus({ preventScroll: true });
  stage.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    block: "center",
  });
}

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
  liveRuntime.pulseInput(action);
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
  liveRuntime.render(state, event);
  stateCode.textContent = state.id;
  timerStatus.textContent = state.autoTransition?.active
    ? `${Math.round(state.autoTransition.delayMs / 1000)} sec`
    : "None";

  const inputPolicyState = manifest.states[liveRuntime.getInputPolicyStateId(state.id)] ?? state;
  for (const control of controls) {
    const target = inputPolicyState.transitions[control.dataset.action];
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
  const policyStateId = liveRuntime.getInputPolicyStateId(currentState.id);
  const policyState = engine.getManifest().states[policyStateId] ?? currentState;
  const target = policyState.transitions[action];

  if (!target || target === currentState.id) return engine.dispatch(action, source, policyStateId);

  transitionPending = true;
  stage.setAttribute("aria-busy", "true");
  try {
    if (!liveRuntime.supports(target)) await preloadState(engine.getManifest(), target);
    return engine.dispatch(action, source, policyStateId);
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

  startGuideButton.addEventListener("click", () => {
    guide.start().catch((error) => {
      interactionLive.textContent = error.message;
    });
  });
  exploreButton.addEventListener("click", () => guide.exit());
}

async function initializeVoyager() {
  try {
    const response = await fetch(`${APP_BASE}/data/voyager-states.json`);
    if (!response.ok) throw new Error(`Manifest request failed with ${response.status}`);
    const manifest = await response.json();
    let liveRuntimeError = null;
    try {
      await liveRuntime.initialize();
    } catch (error) {
      liveRuntimeError = error;
    }
    const engine = new VoyagerStateEngine(manifest);
    let guide;
    const syncDestinationHighlights = (stateId) => {
      for (const destination of document.querySelectorAll("[data-voyager-state]")) {
        const active = liveRuntime.resolveStateId(destination.dataset.voyagerState) === stateId;
        destination.toggleAttribute("data-voyager-active", active);
        if (destination.matches("a, button")) {
          if (active) destination.setAttribute("aria-current", "true");
          else destination.removeAttribute("aria-current");
        }
      }
    };
    const navigateToState = async (screenId, parameters = {}) => {
      const {
        focus = false,
        history = "push",
        preserveGuide = false,
        source = "public-api",
        ...runtimeParameters
      } = parameters;
      const stateId = liveRuntime.resolveStateId(screenId);
      if (!manifest.states[stateId]) throw new Error(`Unknown Voyager state: ${screenId}`);
      if (!liveRuntime.supports(stateId)) await preloadState(manifest, stateId);
      if (!preserveGuide) guide.exit();
      liveRuntime.applyNavigationParameters(runtimeParameters);
      pendingHistoryMode = history;
      const result = engine.reset(stateId, source);
      if (focus) focusGauge();
      return result;
    };
    guide = new VoyagerGuide(engine, guideElements, navigateToState);
    window.navigateToVoyagerState = navigateToState;

    document.addEventListener("click", (event) => {
      const destination = event.target.closest?.("a[data-voyager-state], button[data-voyager-state]");
      if (!destination) return;
      event.preventDefault();
      let parameters = {};
      if (destination.dataset.voyagerParameters) {
        try {
          parameters = JSON.parse(destination.dataset.voyagerParameters);
        } catch {
          interactionLive.textContent = "This Voyager destination has invalid navigation parameters.";
          return;
        }
      }
      navigateToState(destination.dataset.voyagerState, {
        ...parameters,
        focus: true,
        history: "push",
        source: "manual-destination",
      }).catch((error) => {
        interactionLive.textContent = error.message;
      });
    });

    mapViewer.connectPrototype(manifest, async (stateId) => {
      stage.setAttribute("aria-busy", "true");
      try {
        await navigateToState(stateId, { history: "push", source: "map-viewer" });
        interactionLive.textContent = `Interface map opened archive state ${stateId}.`;
        focusGauge();
      } catch (error) {
        interactionLive.textContent = error.message;
      } finally {
        stage.removeAttribute("aria-busy");
      }
    });

    const requestedState = voyagerStateFromUrl();
    if (requestedState) {
      try {
        await navigateToState(requestedState, { history: "none", source: "url-restore" });
      } catch (error) {
        interactionLive.textContent = `${error.message} Showing the main Voyager gauge instead.`;
      }
    }

    engine.subscribe((state, event) => {
      commitState(engine, state, event);
      guide.observe(state, event);
      mapViewer.setActiveState(state.id);
      syncDestinationHighlights(state.id);
      const stableId = liveRuntime.getStableStateId(state.id);
      const historyMode = pendingHistoryMode ?? (event.source === "url-history" ? "none" : "replace");
      pendingHistoryMode = null;
      writeVoyagerStateToUrl(stableId, historyMode);
      document.dispatchEvent(
        new CustomEvent("voyager:statechange", {
          detail: { archiveStateId: state.id, event, screenId: stableId, state },
        }),
      );
    });

    window.addEventListener("popstate", () => {
      navigateToState(voyagerStateFromUrl() ?? manifest.initialState, {
        history: "none",
        source: "url-history",
      }).catch((error) => {
        interactionLive.textContent = error.message;
      });
    });
    document.querySelector("#voyager-load-status").textContent = "Loading";
    await Promise.all(guidedPreloadTargets(manifest).map((stateId) => preloadState(manifest, stateId)));
    document.querySelector("#voyager-load-status").textContent = "Ready";
    enableInterface(engine, guide);
    if (liveRuntimeError) {
      stage.dataset.liveError = "true";
      interactionLive.textContent = `${liveRuntimeError.message} The original Voyager screen captures remain available.`;
    }
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
initializeVoyagerManual(document.querySelector("#voyager-manual"));
initializeVoyager();
