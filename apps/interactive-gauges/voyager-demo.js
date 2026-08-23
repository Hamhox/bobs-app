const DEFAULT_YIELD_MS = 12000;
const DEFAULT_MOVE_MS = 790;
const DEFAULT_DWELL_MS = 1900;

export const VOYAGER_DEMO_SEQUENCE = Object.freeze([
  {
    id: "anchor-main",
    expectedStates: ["*"],
    kind: "navigate",
    destination: "gauge.main.primary",
    target: "#voyager-live-screen",
    intent: "Return to live ride data",
    presentation: "Viewing speed, heading, and ride telemetry",
    dwellMs: 1800,
  },
  {
    id: "present-main",
    expectedStates: ["index"],
    kind: "present",
    target: "[data-live-speed]",
    intent: "Inspect the primary ride screen",
    presentation: "Live ride data updates on the device cadence",
    dwellMs: 2200,
  },
  {
    id: "warning-led-cycle",
    expectedStates: ["index"],
    kind: "effect",
    effect: "warning-led-cycle",
    target: '[data-voyager-warning-led="yellow"]',
    intent: ({ loopIndex }) => loopIndex % 2 === 0
      ? "Arm the temperature warning LEDs"
      : "Rest the warning LEDs for this loop",
    presentation: ({ effectResult }) => effectResult?.enabled
      ? "Stored warning thresholds trigger two hardware-style flashes"
      : "The next loop will arm the warning lights again",
    dwellMs: 2300,
  },
  {
    id: "open-quick-menu",
    expectedStates: ["index"],
    kind: "physical",
    action: "menu",
    target: ".voyager-control--menu",
    intent: "Open the Quick menu",
    presentation: "The demo can operate the same controls as a rider",
    dwellMs: 1900,
  },
  {
    id: "open-log-track",
    expectedStates: ["m-main1-1"],
    kind: "touch",
    target: '[data-menu-row="0"]',
    intent: "Open ride logging",
    presentation: "Logging is a real stored Voyager setting",
    dwellMs: 1800,
  },
  {
    id: "toggle-log-track",
    expectedStates: ["m-main1-2-1"],
    kind: "touch",
    target: "[data-menu-option]",
    targetMode: "opposite-option",
    intent: "Toggle ride logging for this loop",
    presentation: "The recording state now belongs to the live gauge",
    dwellMs: 2100,
  },
  {
    id: "open-import-ride",
    expectedStates: ["m-main1-2"],
    kind: "touch",
    target: '[data-menu-row="5"]',
    intent: "Open the fake SD card",
    presentation: "Four real ride files are ready to load",
    dwellMs: 1800,
  },
  {
    id: "load-next-map",
    expectedStates: ["m-main1-5-1"],
    kind: "touch",
    target: "[data-menu-option]",
    targetMode: "next-option",
    intent: "Load the next ride from the SD card",
    presentation: "Voyager is reading the selected GPX ride",
    dwellMs: 2300,
  },
  {
    id: "present-map",
    expectedStates: ["map"],
    kind: "present",
    target: "[data-live-position]",
    intent: "Follow the rider through the newly loaded map",
    presentation: "The recorded line follows the rider across real trail geometry",
    dwellMs: 2400,
  },
  {
    id: "open-map-detail",
    expectedStates: ["map"],
    kind: "touch",
    target: "[data-live-secondary-screen]",
    intent: "Open the nearby trail view",
    presentation: "Map screen two keeps a separate detail zoom",
    dwellMs: 2100,
  },
  {
    id: "return-map-overview",
    expectedStates: ["map2-2"],
    kind: "physical",
    action: "back",
    target: ".voyager-control--back",
    intent: "Return to the riding-area overview",
    presentation: "Overview and detail views remain independently useful",
    dwellMs: 1800,
  },
  {
    id: "open-navigation",
    expectedStates: ["map"],
    kind: "touch",
    target: '[data-tab="nav"]',
    intent: "Switch to navigation",
    presentation: "Navigation combines destination, heading, and stopwatch data",
    dwellMs: 2100,
  },
  {
    id: "open-destination-picker",
    expectedStates: ["dir"],
    kind: "touch",
    target: "[data-live-nav-destination]",
    intent: "Open the destination waypoint picker",
    presentation: "Loaded GPX waypoints are ready for navigation",
    dwellMs: 1900,
  },
  {
    id: "select-destination",
    expectedStates: ["m-nav-destination-primary"],
    kind: "touch",
    target: "[data-menu-option]",
    targetMode: "next-option",
    intent: "Choose the next loaded destination",
    presentation: "The navigation screen now owns a real waypoint",
    dwellMs: 2100,
  },
  {
    id: "start-stopwatch",
    expectedStates: ["dir"],
    kind: "touch",
    target: "[data-live-stopwatch-toggle]",
    intent: "Start the ride stopwatch",
    presentation: "The stopwatch is running on a one-second cadence",
    dwellMs: 2800,
  },
  {
    id: "stop-stopwatch",
    expectedStates: ["dir2"],
    kind: "touch",
    target: "[data-live-stopwatch-toggle]",
    intent: "Pause the ride stopwatch",
    presentation: "Stopwatch time is held without resetting the ride",
    dwellMs: 1900,
  },
  {
    id: "open-user-screen",
    expectedStates: ["dir"],
    kind: "touch",
    target: '[data-tab="user"]',
    intent: "Switch to a custom user screen",
    presentation: "Six readouts share the same embedded-device grid",
    dwellMs: 2100,
  },
  {
    id: "open-readout-picker",
    expectedStates: ["cstm"],
    kind: "touch",
    target: "[data-live-user-readout]",
    intent: "Choose a user-screen readout",
    presentation: "Every data block can be reassigned independently",
    dwellMs: 1900,
  },
  {
    id: "choose-readout",
    expectedStates: ["m-user-screen-1-data-block"],
    kind: "touch",
    target: "[data-menu-option]",
    targetMode: "next-option-nonzero",
    intent: "Assign a different data block",
    presentation: "The selected readout is staged in the user layout",
    dwellMs: 1800,
  },
  {
    id: "commit-user-layout",
    expectedStates: ["m-user-screen-1-layout"],
    kind: "touch",
    target: '[data-menu-confirmation="1"]',
    intent: "Save the user-screen layout",
    presentation: "The changed readout is now live on the gauge",
    dwellMs: 2200,
  },
  {
    id: "open-satellites",
    expectedStates: ["cstm"],
    kind: "touch",
    target: '[data-tab="sat"]',
    intent: "Switch to satellite status",
    presentation: "Signal pills and bars show the current GPS fix",
    dwellMs: 2200,
  },
  {
    id: "open-satellite-detail",
    expectedStates: ["sat"],
    kind: "touch",
    target: "[data-live-secondary-screen]",
    intent: "Open detailed satellite data",
    presentation: "Latitude, longitude, and dilution values remain readable",
    dwellMs: 2100,
  },
  {
    id: "return-satellites",
    expectedStates: ["sat2"],
    kind: "touch",
    target: "[data-live-secondary-screen]",
    intent: "Return to the satellite radar",
    presentation: "Primary and detailed satellite screens stay one click apart",
    dwellMs: 1900,
  },
  {
    id: "return-main",
    expectedStates: ["sat"],
    kind: "touch",
    target: '[data-tab="main"]',
    intent: "Return to the main ride screen",
    presentation: "The autonomous tour will continue from the live gauge",
    dwellMs: 2300,
  },
]);

function elementIsVisible(element) {
  if (!element) return false;
  const bounds = element.getBoundingClientRect();
  return bounds.width > 0 && bounds.height > 0;
}

function mutationContainsToast(records) {
  return records.some((record) => [...record.addedNodes, ...record.removedNodes].some((node) =>
    node?.nodeType === 1
      && (node.matches?.("[data-live-toast]") || node.querySelector?.("[data-live-toast]")),
  ));
}

export function compatibleDemoStepIndex(sequence, stateId, startIndex = 0) {
  for (let offset = 0; offset < sequence.length; offset += 1) {
    const index = (startIndex + offset) % sequence.length;
    const expectedStates = sequence[index].expectedStates ?? [];
    if (expectedStates.includes(stateId)) return index;
  }
  for (let offset = 0; offset < sequence.length; offset += 1) {
    const index = (startIndex + offset) % sequence.length;
    if (sequence[index].expectedStates?.includes("*")) return index;
  }
  return 0;
}

export class VoyagerDemoDirector {
  #engine;
  #elements;
  #navigate;
  #activateTarget;
  #performAction;
  #performEffect;
  #sequence;
  #index = 0;
  #loopIndex = 0;
  #timer = null;
  #animation = null;
  #runToken = 0;
  #playing = false;
  #yielding = false;
  #overlayBlocked = false;
  #overlaySyncQueued = false;
  #stageVisible = true;
  #documentVisible = !document.hidden;
  #stateId;
  #lastPoint = null;
  #missingTargetRetries = 0;
  #yieldMs;
  #moveMs;
  #reducedMotion;
  #intersectionObserver;
  #visibilityListener;
  #motionListener;
  #overlayObserver;

  constructor({
    engine,
    elements,
    navigate,
    activateTarget,
    performAction,
    performEffect,
    sequence = VOYAGER_DEMO_SEQUENCE,
    yieldMs = DEFAULT_YIELD_MS,
    moveMs = DEFAULT_MOVE_MS,
  }) {
    this.#engine = engine;
    this.#elements = elements;
    this.#navigate = navigate;
    this.#activateTarget = activateTarget;
    this.#performAction = performAction;
    this.#performEffect = performEffect;
    this.#sequence = sequence;
    this.#yieldMs = yieldMs;
    this.#moveMs = moveMs;
    this.#stateId = engine.getState().id;
    this.#reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    this.#visibilityListener = () => {
      this.#documentVisible = !document.hidden;
      this.#syncSuspension();
    };
    document.addEventListener("visibilitychange", this.#visibilityListener);

    this.#motionListener = (event) => {
      if (!event.matches || !this.#playing) return;
      this.pause({ message: "Demo paused for reduced-motion preferences." });
    };
    this.#reducedMotion.addEventListener?.("change", this.#motionListener);

    if ("IntersectionObserver" in window) {
      this.#intersectionObserver = new IntersectionObserver(([entry]) => {
        this.#stageVisible = Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.35);
        this.#syncSuspension();
      }, { threshold: [0, 0.35, 0.7] });
      this.#intersectionObserver.observe(this.#elements.stage);
    }

    if ("MutationObserver" in window && this.#elements.liveScreen) {
      this.#overlayObserver = new MutationObserver((records) => {
        if (mutationContainsToast(records)) this.#queueOverlaySync();
      });
      this.#overlayObserver.observe(this.#elements.liveScreen, { childList: true, subtree: true });
    }
  }

  get playing() {
    return this.#playing;
  }

  get reducedMotion() {
    return this.#reducedMotion.matches;
  }

  start({ restart = false } = {}) {
    if (restart) {
      this.#index = 0;
      this.#loopIndex = 0;
    }
    this.#playing = true;
    this.#yielding = false;
    this.#engine.setAutoTransitionsEnabled(true);
    this.#elements.stage.dataset.demoState = "playing";
    this.#elements.panel.dataset.mode = "active";
    this.#elements.toggle.setAttribute("aria-pressed", "true");
    this.#elements.toggle.textContent = "Demo playing";
    this.#renderCue("Starting the autonomous Voyager demo", "playing");
    this.#cancelRun();
    this.#index = compatibleDemoStepIndex(this.#sequence, this.#stateId, this.#index);
    this.#syncBlockingOverlay();
    if (!this.#overlayBlocked) this.#schedule(this.#reducedMotion.matches ? 120 : 520);
  }

  pause({ message = "Demo paused. Explore freely or resume when ready." } = {}) {
    this.#playing = false;
    this.#yielding = false;
    this.#engine.setAutoTransitionsEnabled(true);
    this.#cancelRun();
    this.#hideCursor();
    this.#elements.stage.dataset.demoState = "paused";
    this.#elements.panel.dataset.mode = "idle";
    this.#elements.toggle.setAttribute("aria-pressed", "false");
    this.#elements.toggle.textContent = "Demo paused";
    this.#renderCue(message, "paused");
  }

  toggle() {
    if (this.#playing) this.pause();
    else this.start();
  }

  explore() {
    this.pause({ message: "Free exploration enabled. The demo will stay paused." });
  }

  noteUserActivity() {
    if (!this.#playing) return;
    this.#yielding = true;
    this.#cancelRun();
    this.#hideCursor();
    this.#elements.stage.dataset.demoState = "waiting";
    this.#renderCue("You're in control. Demo waiting before it continues.", "waiting");
    this.#schedule(this.#yieldMs, () => {
      if (!this.#playing) return;
      this.#yielding = false;
      this.#elements.stage.dataset.demoState = "playing";
      this.#index = compatibleDemoStepIndex(this.#sequence, this.#stateId, this.#index);
      this.#renderCue("Resuming from this screen", "playing");
      this.#schedule(650);
    });
  }

  observe(state) {
    this.#stateId = state.id;
    this.#queueOverlaySync();
  }

  destroy() {
    this.#cancelRun();
    document.removeEventListener("visibilitychange", this.#visibilityListener);
    this.#reducedMotion.removeEventListener?.("change", this.#motionListener);
    this.#intersectionObserver?.disconnect();
    this.#overlayObserver?.disconnect();
  }

  #canRun() {
    return this.#playing
      && !this.#yielding
      && !this.#overlayBlocked
      && this.#stageVisible
      && this.#documentVisible;
  }

  #syncSuspension() {
    if (!this.#canRun()) {
      this.#cancelRun();
      this.#hideCursor();
      return;
    }
    if (this.#timer === null && this.#animation === null) this.#schedule(450);
  }

  #queueOverlaySync() {
    if (this.#overlaySyncQueued) return;
    this.#overlaySyncQueued = true;
    queueMicrotask(() => {
      this.#overlaySyncQueued = false;
      this.#syncBlockingOverlay();
    });
  }

  #syncBlockingOverlay() {
    const toast = this.#elements.liveScreen?.querySelector("[data-live-toast]");
    const blocked = Boolean(toast);
    if (blocked === this.#overlayBlocked) return;
    this.#overlayBlocked = blocked;
    if (blocked) {
      if (!this.#playing) return;
      this.#cancelRun();
      this.#hideCursor();
      this.#elements.stage.dataset.demoState = "waiting";
      const message = toast.dataset.liveToastMessage?.replaceAll(" / ", ": ") || "Voyager message in progress";
      this.#renderCue(`Waiting for Voyager: ${message}`, "waiting");
      return;
    }
    if (!this.#playing || this.#yielding || !this.#stageVisible || !this.#documentVisible) return;
    this.#elements.stage.dataset.demoState = "playing";
    this.#index = compatibleDemoStepIndex(this.#sequence, this.#stateId, this.#index);
    this.#renderCue("Continuing after the Voyager message", "playing");
    this.#schedule(650);
  }

  #cancelRun() {
    this.#runToken += 1;
    if (this.#timer !== null) {
      window.clearTimeout(this.#timer);
      this.#timer = null;
    }
    this.#animation?.cancel();
    this.#animation = null;
  }

  #schedule(delayMs, callback = null) {
    if (this.#timer !== null) window.clearTimeout(this.#timer);
    this.#timer = window.setTimeout(() => {
      this.#timer = null;
      if (callback) callback();
      else this.#runStep();
    }, delayMs);
  }

  async #runStep() {
    if (!this.#canRun()) return;
    const compatibleIndex = compatibleDemoStepIndex(this.#sequence, this.#stateId, this.#index);
    if (compatibleIndex !== this.#index) this.#index = compatibleIndex;
    const step = this.#sequence[this.#index];
    const token = ++this.#runToken;
    this.#renderCue(this.#resolveCopy(step.intent), "intent");

    const target = this.#findTarget(step);
    if (step.target && !target) {
      this.#missingTargetRetries += 1;
      if (this.#missingTargetRetries <= 2) {
        this.#schedule(260);
        return;
      }
      this.#missingTargetRetries = 0;
      this.#index = 0;
      this.#schedule(320);
      return;
    }
    this.#missingTargetRetries = 0;

    await this.#moveCursor(target, token);
    if (!this.#canRun() || token !== this.#runToken) return;

    if (step.kind !== "present") {
      await this.#pulseClick(token);
      if (!this.#canRun() || token !== this.#runToken) return;
    }

    let effectResult = null;
    try {
      if (step.kind === "navigate") {
        await this.#navigate(step.destination, {
          history: "replace",
          preserveDemo: true,
          source: "demo:anchor",
        });
      } else if (step.kind === "touch") {
        this.#activateTarget(target, "demo");
      } else if (step.kind === "physical") {
        this.#performAction(step.action, "demo");
      } else if (step.kind === "effect") {
        effectResult = this.#performEffect?.(step.effect, { loopIndex: this.#loopIndex }) ?? null;
      }
    } catch (error) {
      this.#renderCue(`Demo recovered from: ${error.message}`, "waiting");
      this.#index = 0;
      this.#schedule(900);
      return;
    }

    if (!this.#canRun() || token !== this.#runToken) return;
    this.#renderCue(this.#resolveCopy(step.presentation, effectResult), "presenting");
    this.#advanceStep();
    this.#schedule(step.dwellMs ?? DEFAULT_DWELL_MS);
  }

  #findTarget(step) {
    const selector = step.target;
    if (!selector) return null;
    let candidates = [...this.#elements.stage.querySelectorAll(selector)].filter(elementIsVisible);
    if (!candidates.length) return null;
    if (step.targetMode === "opposite-option") {
      return candidates.find((candidate) => !candidate.hasAttribute("data-menu-option-selected")) ?? candidates[0];
    }
    if (["next-option", "next-option-nonzero"].includes(step.targetMode)) {
      candidates = candidates
        .filter((candidate) => step.targetMode !== "next-option-nonzero" || Number(candidate.dataset.menuOption) > 0)
        .sort((left, right) => Number(left.dataset.menuOption) - Number(right.dataset.menuOption));
      if (!candidates.length) return null;
      const selected = [...this.#elements.stage.querySelectorAll(`${selector}[data-menu-option-selected]`)]
        .find(elementIsVisible);
      const selectedIndex = Number(selected?.dataset.menuOption);
      return candidates.find((candidate) => Number(candidate.dataset.menuOption) > selectedIndex) ?? candidates[0];
    }
    return candidates[0];
  }

  #advanceStep() {
    this.#index = (this.#index + 1) % this.#sequence.length;
    if (this.#index === 0) this.#loopIndex += 1;
  }

  #resolveCopy(copy, effectResult = null) {
    return typeof copy === "function"
      ? copy({ loopIndex: this.#loopIndex, effectResult })
      : copy;
  }

  async #moveCursor(target, token) {
    if (!target || !this.#canRun()) return;
    const stageBounds = this.#elements.stage.getBoundingClientRect();
    const targetBounds = target.getBoundingClientRect();
    const point = {
      x: targetBounds.left - stageBounds.left + targetBounds.width / 2,
      y: targetBounds.top - stageBounds.top + targetBounds.height / 2,
    };
    const start = this.#lastPoint ?? { x: point.x - 24, y: point.y + 34 };
    const cursor = this.#elements.cursor;
    cursor.dataset.visible = "true";
    cursor.style.opacity = "1";
    const startTransform = `translate3d(${start.x.toFixed(2)}px, ${start.y.toFixed(2)}px, 0)`;
    const endTransform = `translate3d(${point.x.toFixed(2)}px, ${point.y.toFixed(2)}px, 0)`;
    const duration = this.#reducedMotion.matches ? 1 : this.#moveMs;
    this.#animation = cursor.animate(
      [
        { opacity: this.#lastPoint ? 1 : 0, transform: startTransform },
        { opacity: 1, transform: endTransform },
      ],
      { duration, easing: "cubic-bezier(.22,.82,.25,1)", fill: "forwards" },
    );
    try {
      await this.#animation.finished;
    } catch {
      return;
    }
    if (token !== this.#runToken) return;
    cursor.style.transform = endTransform;
    this.#animation = null;
    this.#lastPoint = point;
  }

  async #pulseClick(token) {
    const cursor = this.#elements.cursor;
    const point = this.#lastPoint;
    if (!point) return;
    const transform = `translate3d(${point.x.toFixed(2)}px, ${point.y.toFixed(2)}px, 0)`;
    cursor.dataset.clicking = "true";
    this.#animation = cursor.animate(
      [
        { transform: `${transform} scale(1)` },
        { transform: `${transform} scale(.84)`, offset: 0.4 },
        { transform: `${transform} scale(1)` },
      ],
      { duration: this.#reducedMotion.matches ? 1 : 260, easing: "ease-out" },
    );
    try {
      await this.#animation.finished;
    } catch {
      return;
    } finally {
      delete cursor.dataset.clicking;
    }
    if (token !== this.#runToken) return;
    cursor.style.transform = transform;
    this.#animation = null;
  }

  #hideCursor() {
    this.#elements.cursor.removeAttribute("data-visible");
    this.#elements.cursor.removeAttribute("data-clicking");
    this.#elements.cursor.style.opacity = "0";
  }

  #renderCue(message, phase) {
    this.#elements.number.textContent = "DEMO";
    this.#elements.label.textContent = `Autonomous Voyager demo, ${phase}`;
    this.#elements.instruction.textContent = message;
    this.#elements.live.textContent = `${this.#elements.label.textContent}. ${message}`;
    this.#elements.panel.dataset.demoPhase = phase;
  }
}
