import { initializeFontPlayground } from "./font-playground.js";
import { VoyagerGuide } from "./voyager-guide.js";
import { VoyagerLiveRuntime } from "./voyager-live-runtime.js";
import { VOYAGER_MENU_STATE_INDEX, VOYAGER_MENU_TRANSITIONS } from "./voyager-menu-registry.js";
import { initializeVoyagerManual } from "./voyager-manual.js";
import { VoyagerMapViewer } from "./voyager-map-viewer.js";
import { VoyagerStateEngine } from "./voyager-state-engine.js";

const APP_BASE = "/apps/interactive-gauges";
const VOYAGER_URL_PARAMETER = "voyager";
const VOYAGER_LIVE_TRANSITION_OVERRIDES = {
  index: { menu: "m-main1-1", left: "index3", right: "index2", enter: "index2" },
  index2: { menu: "m-main1-1", left: "index", right: "index3", enter: "index3" },
  index3: { menu: "m-main1-1", left: "index2", right: "index", enter: "index" },
  "index3-2": { menu: "m-main1-1", left: "index2", right: "index", enter: "index" },
  map: { menu: "m-ride2-1", left: null, center: "map", right: "map2-2", enter: "map2" },
  "map1-2": { menu: "m-ride2-1", left: null, center: "map1-2", right: "map2-2", enter: "map2" },
  map2: { menu: "m-ride2-1", up: "map2", left: "map2", center: "map2", right: "map2", down: "map2", back: "map", enter: "map2" },
  "map2-2": { menu: "m-ride2-1", up: "index", left: null, center: "map2-2", right: "map", down: "eng", back: "map", enter: "map3" },
  map3: { menu: "m-ride2-1", up: "map3", left: "map3", center: "map3", right: "map3", down: "map3", back: "map2-2", enter: "map3" },
  "map3-2": { menu: "m-ride2-1", up: "map3-2", left: "map3-2", center: "map3-2", right: "map3-2", down: "map3-2", back: "map2-2", enter: "map3-2" },
  eng: { menu: "m-graph-temp-primary-display" },
  eng2: { menu: "m-graph-temp-display", up: "eng2", left: "eng2", center: "eng2", right: "eng2", down: "eng2", back: "eng", enter: "alt2" },
  eng3: { menu: "m-graph-temp-track2-display", up: "eng3", left: "eng3", center: "eng3", right: "eng3", down: "eng3", back: "eng", enter: "alt3" },
  alt: { menu: "m-graph-alt-primary-display" },
  alt2: { menu: "m-graph-alt-display", up: "alt2", left: "alt2", center: "alt2", right: "alt2", down: "alt2", back: "alt", enter: "eng2" },
  alt3: { menu: "m-graph-alt-track2-display", up: "alt3", left: "alt3", center: "alt3", right: "alt3", down: "alt3", back: "alt", enter: "eng3" },
  cstm: { menu: "m-user-screen-1-layout" },
  cstm2: { menu: "m-user-screen-2-layout" },
  dir: { menu: "m-nav-destination-primary" },
  dir2: { menu: "m-nav-destination-secondary" },
  sat: { menu: "m-main1-1", left: null, center: "sat2", right: "sat2", enter: "sat2" },
  sat2: { menu: "m-main1-1", up: "dir", left: null, center: "sat", right: "sat", down: "index", back: "sat", enter: "sat" },
};
const stage = document.querySelector("#voyager-stage");
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
  stage,
  appBase: APP_BASE,
});

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

function applyLiveTransitionOverrides(manifest) {
  manifest.states.index3 = {
    id: "index3",
    transitions: {
      menu: "m-main1-1",
      up: "sat",
      left: "index2",
      center: "index3",
      right: "index",
      down: "map",
      back: "index",
      enter: "index",
    },
    autoTransition: { delayMs: 20000, target: "index3-2", active: true },
    archiveLinks: ["index", "index2", "index3-2", "map", "sat", "m-main1-1"],
    referenceScreen: manifest.states.index2.referenceScreen,
  };
  manifest.states["index3-2"] = {
    id: "index3-2",
    transitions: {
      menu: "m-main1-1",
      up: "sat",
      left: "index2",
      center: "index3-2",
      right: "index",
      down: "map",
      back: "index3",
      enter: "index",
    },
    autoTransition: null,
    archiveLinks: ["index", "index2", "index3", "map", "sat", "m-main1-1"],
    referenceScreen: manifest.states.index2.referenceScreen,
  };
  for (const [id, definition] of Object.entries(VOYAGER_MENU_STATE_INDEX)) {
    const previousState = manifest.states[id];
    const parentState = manifest.states[definition.parentStateId];
    manifest.states[id] = {
      id,
      transitions: { ...VOYAGER_MENU_TRANSITIONS[id] },
      autoTransition: definition.autoTransition ?? null,
      archiveLinks: [...new Set([
        definition.parentStateId,
        ...Object.values(VOYAGER_MENU_TRANSITIONS[id]),
        definition.autoTransition?.target,
        manifest.initialState,
      ].filter((target) => typeof target === "string"))],
      referenceScreen: previousState?.referenceScreen
        ?? parentState?.referenceScreen
        ?? manifest.states[manifest.initialState].referenceScreen,
    };
  }
  manifest.states.sat2 = {
    id: "sat2",
    transitions: {},
    autoTransition: null,
    archiveLinks: ["dir", "index", "sat"],
    referenceScreen: manifest.states.sat.referenceScreen,
  };
  manifest.states.map2.autoTransition = { delayMs: 30000, target: "map", active: true };
  manifest.states.map3.autoTransition = { delayMs: 30000, target: "map2-2", active: true };
  manifest.states["map3-2"].autoTransition = { delayMs: 30000, target: "map2-2", active: true };
  for (const [stateId, transitions] of Object.entries(VOYAGER_LIVE_TRANSITION_OVERRIDES)) {
    const state = manifest.states[stateId];
    if (!state) throw new Error(`Voyager live transition override references missing state ${stateId}.`);
    Object.assign(state.transitions, transitions);
  }
}

function focusGauge() {
  stage.focus({ preventScroll: true });
  stage.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    block: "center",
  });
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
  liveRuntime.render(state, event);
  stateCode.textContent = state.id;
  const configuredAutoTransitionDelay = state.autoTransition?.active
    ? liveRuntime.resolveAutoTransitionDelay(state, state.autoTransition)
    : null;
  const autoTransitionDelay = configuredAutoTransitionDelay === undefined
    ? state.autoTransition?.delayMs
    : configuredAutoTransitionDelay;
  timerStatus.textContent = Number.isFinite(autoTransitionDelay)
    ? `${Math.round(autoTransitionDelay / 1000)} sec`
    : "None";

  const inputPolicyState = manifest.states[liveRuntime.getInputPolicyStateId(state.id)] ?? state;
  for (const control of controls) {
    const policyAction = liveRuntime.resolveInputAction(state.id, control.dataset.action);
    const target = liveRuntime.resolveInputTarget(
      state.id,
      policyAction,
      inputPolicyState.transitions[policyAction],
    );
    const noOp = target === null;
    control.toggleAttribute("data-noop", noOp);
    control.setAttribute("aria-disabled", String(noOp));
    control.title = noOp
      ? `${control.getAttribute("aria-label")}: no action from ${state.id}`
      : `${control.getAttribute("aria-label")}: open ${target}`;
  }

  if (event.type === "auto") {
    interactionLive.textContent = `Archived timer advanced the interface to ${state.id}.`;
  } else if (event.type === "dispatch" && event.to === null) {
    interactionLive.textContent = `${event.action} is an intentional no-op from ${state.id}.`;
  } else if (event.type === "dispatch") {
    interactionLive.textContent = `${event.action} opened archive state ${state.id}.`;
  }
}

function dispatchAction(action, source, engine) {
  liveRuntime.recordActivity();
  const currentState = engine.getState();
  const preparedInput = liveRuntime.prepareInput(currentState.id, action);
  if (preparedInput.targetStateId) {
    return engine.reset(preparedInput.targetStateId, `${source}:menu-selection`);
  }
  const policyStateId = liveRuntime.getInputPolicyStateId(currentState.id);
  return engine.dispatch(preparedInput.action, source, policyStateId);
}

function applyPointerPlan(plan, engine, source = "touchscreen") {
  if (!plan) return null;
  liveRuntime.recordActivity();
  let result = null;
  if (plan.targetStateId) {
    result = engine.reset(plan.targetStateId, `${source}:target`);
  }
  if (plan.followupAction) return dispatchAction(plan.followupAction, `${source}:activate`, engine);
  if (plan.action) return dispatchAction(plan.action, source, engine);
  if (result) interactionLive.textContent = `Touchscreen opened archive state ${result.state.id}.`;
  return result;
}

function pointerPositionInSvg(event) {
  const svg = event.target.closest?.("svg");
  const matrix = svg?.getScreenCTM?.();
  if (!svg || !matrix) return {};
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const local = point.matrixTransform(matrix.inverse());
  return { x: local.x, y: local.y };
}

function bindTouchscreen(engine) {
  liveScreen.addEventListener("click", (event) => {
    const stateId = engine.getState().id;
    const plan = liveRuntime.preparePointerInput(
      stateId,
      event.target,
      { ...pointerPositionInSvg(event), activate: true },
    );
    if (!plan) return;
    event.preventDefault();
    applyPointerPlan(plan, engine);
  });

  let hoveredConfirmation = "";
  liveScreen.addEventListener("pointerover", (event) => {
    if (event.pointerType === "touch") return;
    const confirmation = event.target.closest?.("[data-menu-confirmation]");
    if (!confirmation) return;
    const stateId = engine.getState().id;
    const hoverKey = `${stateId}:${confirmation.dataset.menuConfirmation}`;
    if (hoveredConfirmation === hoverKey) return;
    hoveredConfirmation = hoverKey;
    const plan = liveRuntime.preparePointerInput(stateId, confirmation, { activate: false });
    applyPointerPlan(plan, engine, "touchscreen:hover");
  });
  liveScreen.addEventListener("pointerleave", () => {
    hoveredConfirmation = "";
  });
}

function bindControl(control, engine) {
  control.addEventListener("click", () => {
    const result = dispatchAction(control.dataset.action, "physical-control", engine);
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
    const result = dispatchAction(action, "keyboard", engine);
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
  bindTouchscreen(engine);
  guide.exit();

  startGuideButton.addEventListener("click", () => {
    liveRuntime.recordActivity();
    guide.start().catch((error) => {
      interactionLive.textContent = error.message;
    });
  });
  exploreButton.addEventListener("click", () => {
    liveRuntime.recordActivity();
    guide.exit();
  });
}

async function initializeVoyager() {
  try {
    document.querySelector("#voyager-load-status").textContent = "Loading";
    const response = await fetch(`${APP_BASE}/data/voyager-states.json`);
    if (!response.ok) throw new Error(`Manifest request failed with ${response.status}`);
    const manifest = await response.json();
    applyLiveTransitionOverrides(manifest);
    await liveRuntime.initialize();
    const engine = new VoyagerStateEngine(manifest, {
      resolveAutoTransitionDelay: (state, transition) => liveRuntime.resolveAutoTransitionDelay(state, transition),
    });
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
      liveRuntime.recordActivity();
      const stateId = liveRuntime.resolveStateId(screenId);
      if (!manifest.states[stateId]) throw new Error(`Unknown Voyager state: ${screenId}`);
      if (!liveRuntime.supports(stateId)) throw new Error(`Voyager state ${screenId} does not have a live renderer.`);
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
initializeVoyagerManual(document.querySelector("#voyager-manual"));
initializeVoyager();
