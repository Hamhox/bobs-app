const DEFAULT_YIELD_MS = 11000;
const DEFAULT_MOVE_MS = 720;
const DEFAULT_DWELL_MS = 1550;

export const VOYAGER_DEMO_SEQUENCE = Object.freeze([
  {
    id: "anchor-main",
    expectedStates: ["*"],
    kind: "navigate",
    destination: "gauge.main.primary",
    target: "#voyager-live-screen",
    intent: "Return to live ride data",
    presentation: "Viewing speed, heading, and ride telemetry",
    dwellMs: 1350,
  },
  {
    id: "present-main",
    expectedStates: ["index"],
    kind: "present",
    target: "[data-live-speed]",
    intent: "Inspect the primary ride screen",
    presentation: "Live ride data updates on the device cadence",
  },
  {
    id: "open-map",
    expectedStates: ["index"],
    kind: "touch",
    target: '[data-tab="map"]',
    intent: "Switch to the map screen",
    presentation: "Viewing the Baker trail network",
    dwellMs: 1800,
  },
  {
    id: "present-map",
    expectedStates: ["map"],
    kind: "present",
    target: "[data-live-position]",
    intent: "Follow the rider through the loaded track",
    presentation: "The recorded line follows the rider, not a terrain map",
    dwellMs: 1850,
  },
  {
    id: "open-map-detail",
    expectedStates: ["map"],
    kind: "touch",
    target: "[data-live-secondary-screen]",
    intent: "Open the nearby trail view",
    presentation: "Map screen two keeps a separate detail zoom",
    dwellMs: 1800,
  },
  {
    id: "return-map-overview",
    expectedStates: ["map2-2"],
    kind: "physical",
    action: "back",
    target: ".voyager-control--back",
    intent: "Return to the riding-area overview",
    presentation: "Overview and detail views remain independently useful",
  },
  {
    id: "open-navigation",
    expectedStates: ["map"],
    kind: "touch",
    target: '[data-tab="nav"]',
    intent: "Switch to navigation",
    presentation: "Navigation combines destination, heading, and stopwatch data",
    dwellMs: 1800,
  },
  {
    id: "open-destination-picker",
    expectedStates: ["dir"],
    kind: "touch",
    target: "[data-live-nav-destination]",
    intent: "Open the destination waypoint picker",
    presentation: "Loaded GPX waypoints are ready for navigation",
    dwellMs: 1800,
  },
  {
    id: "close-destination-picker",
    expectedStates: ["m-nav-destination-primary"],
    kind: "physical",
    action: "back",
    target: ".voyager-control--back",
    intent: "Leave the waypoint list unchanged",
    presentation: "The demo never commits a destination for you",
    dwellMs: 1200,
  },
  {
    id: "start-stopwatch",
    expectedStates: ["dir"],
    kind: "touch",
    target: "[data-live-stopwatch-toggle]",
    intent: "Start the ride stopwatch",
    presentation: "The stopwatch is running on a one-second cadence",
    dwellMs: 2600,
  },
  {
    id: "stop-stopwatch",
    expectedStates: ["dir2"],
    kind: "touch",
    target: "[data-live-stopwatch-toggle]",
    intent: "Pause the ride stopwatch",
    presentation: "Stopwatch time is held without resetting the ride",
    dwellMs: 1250,
  },
  {
    id: "open-user-screen",
    expectedStates: ["dir"],
    kind: "touch",
    target: '[data-tab="user"]',
    intent: "Switch to a custom user screen",
    presentation: "Six readouts share the same embedded-device grid",
    dwellMs: 1700,
  },
  {
    id: "open-readout-picker",
    expectedStates: ["cstm"],
    kind: "touch",
    target: "[data-live-user-readout]",
    intent: "Choose a user-screen readout",
    presentation: "Every data block can be reassigned independently",
    dwellMs: 1750,
  },
  {
    id: "leave-readout-picker",
    expectedStates: ["m-user-screen-1-data-block"],
    kind: "physical",
    action: "back",
    target: ".voyager-control--back",
    intent: "Return without changing the readout",
    presentation: "The original user-screen layout remains intact",
    dwellMs: 900,
  },
  {
    id: "leave-user-layout",
    expectedStates: ["m-user-screen-1-layout"],
    kind: "physical",
    action: "back",
    target: ".voyager-control--back",
    intent: "Close the layout editor",
    presentation: "Back returns directly to the live user screen",
    dwellMs: 1100,
  },
  {
    id: "open-satellites",
    expectedStates: ["cstm"],
    kind: "touch",
    target: '[data-tab="sat"]',
    intent: "Switch to satellite status",
    presentation: "Signal pills and bars show the current GPS fix",
    dwellMs: 1900,
  },
  {
    id: "open-satellite-detail",
    expectedStates: ["sat"],
    kind: "touch",
    target: "[data-live-secondary-screen]",
    intent: "Open detailed satellite data",
    presentation: "Latitude, longitude, and dilution values remain readable",
    dwellMs: 1850,
  },
  {
    id: "return-satellites",
    expectedStates: ["sat2"],
    kind: "touch",
    target: "[data-live-secondary-screen]",
    intent: "Return to the satellite radar",
    presentation: "Primary and detailed satellite screens stay one click apart",
    dwellMs: 1250,
  },
  {
    id: "open-quick-menu",
    expectedStates: ["sat"],
    kind: "physical",
    action: "menu",
    target: ".voyager-control--menu",
    intent: "Open the Quick menu",
    presentation: "Common ride actions are available without leaving the gauge",
    dwellMs: 1900,
  },
  {
    id: "present-quick-menu",
    expectedStates: ["m-main1-1"],
    kind: "present",
    target: '[data-menu-row="0"]',
    intent: "Inspect the live menu structure",
    presentation: "The same rows work with buttons, keyboard, or touch",
    dwellMs: 1850,
  },
  {
    id: "close-quick-menu",
    expectedStates: ["m-main1-1"],
    kind: "physical",
    action: "back",
    target: ".voyager-control--back",
    intent: "Close the Quick menu",
    presentation: "Returning preserves the satellite screen underneath",
    dwellMs: 1100,
  },
  {
    id: "return-main",
    expectedStates: ["sat"],
    kind: "touch",
    target: '[data-tab="main"]',
    intent: "Return to the main ride screen",
    presentation: "The autonomous tour will continue from the live gauge",
    dwellMs: 1900,
  },
]);

function elementIsVisible(element) {
  if (!element) return false;
  const bounds = element.getBoundingClientRect();
  return bounds.width > 0 && bounds.height > 0;
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
  #sequence;
  #index = 0;
  #timer = null;
  #animation = null;
  #runToken = 0;
  #playing = false;
  #yielding = false;
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

  constructor({
    engine,
    elements,
    navigate,
    activateTarget,
    performAction,
    sequence = VOYAGER_DEMO_SEQUENCE,
    yieldMs = DEFAULT_YIELD_MS,
    moveMs = DEFAULT_MOVE_MS,
  }) {
    this.#engine = engine;
    this.#elements = elements;
    this.#navigate = navigate;
    this.#activateTarget = activateTarget;
    this.#performAction = performAction;
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
  }

  get playing() {
    return this.#playing;
  }

  get reducedMotion() {
    return this.#reducedMotion.matches;
  }

  start({ restart = false } = {}) {
    if (restart) this.#index = 0;
    this.#playing = true;
    this.#yielding = false;
    this.#engine.setAutoTransitionsEnabled(false);
    this.#elements.stage.dataset.demoState = "playing";
    this.#elements.panel.dataset.mode = "active";
    this.#elements.toggle.setAttribute("aria-pressed", "true");
    this.#elements.toggle.textContent = "Demo playing";
    this.#renderCue("Starting the autonomous Voyager demo", "playing");
    this.#cancelRun();
    this.#index = compatibleDemoStepIndex(this.#sequence, this.#stateId, this.#index);
    this.#schedule(this.#reducedMotion.matches ? 120 : 520);
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
  }

  destroy() {
    this.#cancelRun();
    document.removeEventListener("visibilitychange", this.#visibilityListener);
    this.#reducedMotion.removeEventListener?.("change", this.#motionListener);
    this.#intersectionObserver?.disconnect();
  }

  #canRun() {
    return this.#playing
      && !this.#yielding
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
    this.#renderCue(step.intent, "intent");

    const target = this.#findTarget(step.target);
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
      }
    } catch (error) {
      this.#renderCue(`Demo recovered from: ${error.message}`, "waiting");
      this.#index = 0;
      this.#schedule(900);
      return;
    }

    if (!this.#canRun() || token !== this.#runToken) return;
    this.#renderCue(step.presentation, "presenting");
    this.#index = (this.#index + 1) % this.#sequence.length;
    this.#schedule(step.dwellMs ?? DEFAULT_DWELL_MS);
  }

  #findTarget(selector) {
    if (!selector) return null;
    return [...this.#elements.stage.querySelectorAll(selector)].find(elementIsVisible) ?? null;
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
