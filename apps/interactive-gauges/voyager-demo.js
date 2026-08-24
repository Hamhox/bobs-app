const DEFAULT_YIELD_MS = 12000;
const DEFAULT_MOVE_MS = 380;
const DEMO_PRE_MOVE_MS = 500;
const DEMO_CLICK_MS = 180;
const DEMO_SETTLE_MS = 250;
const CONTEXT_ACTIONS = Object.freeze(["back", "left", "right", "up", "down", "menu", "center", "enter"]);

export function demoReadingHoldMs(caption) {
  const wordCount = String(caption ?? "").trim().split(/\s+/).filter(Boolean).length;
  return Math.min(7500, Math.max(3500, 1200 + wordCount * 250));
}

export const VOYAGER_DEMO_SEQUENCE = Object.freeze([
  {
    id: "anchor-main",
    expectedStates: ["*"],
    kind: "navigate",
    destination: "index",
    intent: "Ready to ride",
    presentation: "The tour begins at the primary screen without resetting the working gauge.",
    dwellMs: 1800,
  },
  {
    id: "present-main",
    expectedStates: ["index"],
    kind: "present",
    target: "[data-live-speed]",
    intent: "Live ride data",
    presentation: "Speed, heading, temperature, time, and recording status update on the device cadence.",
    dwellMs: 2200,
  },
  {
    id: "open-quick-menu",
    expectedStates: ["index"],
    kind: "physical",
    action: "menu",
    target: ".voyager-control--menu",
    intent: "Physical controls",
    presentation: "The tour uses the same Menu button and directional controls as the rider.",
    dwellMs: 1900,
  },
  {
    id: "open-import-ride",
    expectedStates: ["m-main1-1"],
    kind: "touch",
    target: '[data-menu-row="5"]',
    intent: "Real ride library",
    presentation: "The virtual SD card holds real GPX rides collected across large trail systems.",
    dwellMs: 1800,
  },
  {
    id: "load-next-map",
    expectedStates: ["m-main1-5-1"],
    kind: "touch",
    target: "[data-menu-option]",
    targetMode: "next-option",
    intent: "Load a new riding area",
    presentation: "Voyager reads the selected ride and carries its tracks, routes, and waypoints into the map.",
    dwellMs: 2300,
  },
  {
    id: "present-map",
    expectedStates: ["map"],
    kind: "present",
    target: "[data-live-position]",
    intent: "Follow the rider",
    presentation: "The recorded line follows the rider across real trail geometry.",
    dwellMs: 2400,
  },
  {
    id: "open-map-detail",
    expectedStates: ["map"],
    kind: "touch",
    target: "[data-live-secondary-screen]",
    title: "Overview and detail maps",
    description: "One map can stay close to the trail while the second keeps the larger route in view.",
    dwellMs: 2100,
  },
  {
    id: "return-map-overview",
    expectedStates: ["map2-2"],
    kind: "physical",
    action: "back",
    target: ".voyager-control--back",
    intent: "Riding-area overview",
    presentation: "One physical press returns to the larger riding-area context.",
    dwellMs: 1800,
  },
  {
    id: "open-navigation",
    expectedStates: ["map"],
    kind: "touch",
    target: '[data-tab="nav"]',
    intent: "Waypoint navigation",
    presentation: "Navigation combines destination distance, heading, speed, and stopwatch data.",
    dwellMs: 2100,
  },
  {
    id: "open-destination-picker",
    expectedStates: ["dir"],
    kind: "touch",
    target: "[data-live-nav-destination]",
    intent: "Loaded waypoints",
    presentation: "The destination picker uses the named waypoints carried by the selected ride.",
    dwellMs: 1900,
  },
  {
    id: "select-destination",
    expectedStates: ["m-nav-destination-primary"],
    kind: "touch",
    target: "[data-menu-option]",
    targetMode: "next-option",
    intent: "Choose a destination",
    presentation: "Selecting a waypoint returns directly to navigation with a live distance readout.",
    dwellMs: 2100,
  },
  {
    id: "open-user-screen",
    expectedStates: ["dir"],
    kind: "touch",
    target: '[data-tab="user"]',
    intent: "Custom rider data",
    presentation: "A user screen turns six positions into a rider-selected instrument panel.",
    dwellMs: 2100,
  },
  {
    id: "open-readout-picker",
    expectedStates: ["cstm"],
    kind: "touch",
    target: "[data-live-user-readout]",
    intent: "Choose a readout",
    presentation: "Each position opens directly into the complete library of Voyager data blocks.",
    dwellMs: 1900,
  },
  {
    id: "choose-readout",
    expectedStates: ["m-user-screen-1-data-block"],
    kind: "touch",
    target: "[data-menu-option]",
    targetMode: "next-option-nonzero",
    intent: "Assign the readout",
    presentation: "The selected data block is staged in the six-position layout.",
    dwellMs: 1800,
  },
  {
    id: "commit-user-layout",
    expectedStates: ["m-user-screen-1-layout"],
    kind: "touch",
    target: '[data-menu-confirmation="1"]',
    intent: "Save the layout",
    presentation: "The changed readout is committed and immediately returns to the live gauge.",
    dwellMs: 2200,
  },
  {
    id: "open-satellites",
    expectedStates: ["cstm"],
    kind: "touch",
    target: '[data-tab="sat"]',
    intent: "Satellite status",
    presentation: "Signal pills, orbital position, and strength bars show the current GPS fix.",
    dwellMs: 2200,
  },
  {
    id: "open-satellite-detail",
    expectedStates: ["sat"],
    kind: "touch",
    target: "[data-live-secondary-screen]",
    intent: "GPS detail",
    presentation: "A second screen exposes coordinates, fix type, quality, and dilution values.",
    dwellMs: 2100,
  },
  {
    id: "return-satellites",
    expectedStates: ["sat2"],
    kind: "touch",
    target: "[data-live-secondary-screen]",
    intent: "Two levels of detail",
    presentation: "Primary and detailed satellite views remain one click apart.",
    dwellMs: 1900,
  },
  {
    id: "return-main",
    expectedStates: ["sat"],
    kind: "touch",
    target: '[data-tab="main"]',
    intent: "Back to the ride",
    presentation: "The tour closes where a rider spends most of the day: the primary live screen.",
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

export function contextualControlPath(manifest, fromStateId, targetStateId, resolveTransition = null) {
  if (fromStateId === targetStateId) return [];
  if (!manifest?.states?.[fromStateId] || !manifest.states[targetStateId]) return null;
  const queue = [{ actions: [], stateId: fromStateId }];
  const visited = new Set([fromStateId]);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    for (const action of CONTEXT_ACTIONS) {
      const nextStateId = resolveTransition
        ? resolveTransition(current.stateId, action)
        : manifest.states[current.stateId]?.transitions?.[action];
      if (typeof nextStateId !== "string" || nextStateId === current.stateId || visited.has(nextStateId)) continue;
      const actions = [...current.actions, action];
      if (nextStateId === targetStateId) return actions;
      visited.add(nextStateId);
      queue.push({ actions, stateId: nextStateId });
    }
  }
  return null;
}

export class VoyagerDemoDirector {
  #engine;
  #elements;
  #activateTarget;
  #performAction;
  #resolveControlTarget;
  #sequence;
  #index = 0;
  #loopIndex = 0;
  #active = false;
  #timer = null;
  #timerCallback = null;
  #timerCancel = null;
  #timerDueAt = 0;
  #pausedTimer = null;
  #animation = null;
  #pauseAnimation = null;
  #runToken = 0;
  #playing = false;
  #yielding = false;
  #overlayBlocked = false;
  #overlaySyncQueued = false;
  #stageVisible = true;
  #documentVisible = !document.hidden;
  #stateId;
  #lastPoint = null;
  #activeStepIndex = null;
  #phase = "idle";
  #phaseBeforePause = null;
  #missingTargetRetries = 0;
  #yieldMs;
  #moveMs;
  #cinemaTimer = null;
  #reducedMotion;
  #intersectionObserver;
  #visibilityListener;
  #motionListener;
  #overlayObserver;

  constructor({
    engine,
    elements,
    activateTarget,
    performAction,
    resolveControlTarget,
    sequence = VOYAGER_DEMO_SEQUENCE,
    yieldMs = DEFAULT_YIELD_MS,
    moveMs = DEFAULT_MOVE_MS,
  }) {
    this.#engine = engine;
    this.#elements = elements;
    this.#activateTarget = activateTarget;
    this.#performAction = performAction;
    this.#resolveControlTarget = resolveControlTarget;
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

  get active() {
    return this.#active;
  }

  get reducedMotion() {
    return this.#reducedMotion.matches;
  }

  start({ restart = false } = {}) {
    if (this.#active && !restart) {
      this.resume();
      return;
    }
    if (restart) {
      this.#index = 0;
      this.#loopIndex = 0;
    }
    this.#cancelRun();
    this.#active = true;
    this.#playing = true;
    this.#yielding = false;
    this.#phase = "queued";
    this.#engine.setAutoTransitionsEnabled(true);
    delete this.#elements.stage.dataset.controlCinema;
    this.#elements.stage.dataset.demoState = "playing";
    this.#setDeckActive(true);
    this.#elements.pause.textContent = "Pause";
    if (!restart) this.#index = compatibleDemoStepIndex(this.#sequence, this.#stateId, this.#index);
    this.#renderStep(this.#sequence[this.#index], "queued");
    this.#syncBlockingOverlay();
    if (!this.#overlayBlocked) this.#schedule(this.#reducedMotion.matches ? 1 : 40);
  }

  pause({ message = "Demo paused." } = {}) {
    if (!this.#active || !this.#playing) return;
    this.#playing = false;
    this.#phaseBeforePause = this.#phase;
    this.#phase = "paused";
    this.#engine.setAutoTransitionsEnabled(false);
    this.#suspendTiming();
    this.#elements.stage.dataset.demoState = "paused";
    this.#elements.narrator.dataset.demoPhase = "paused";
    this.#elements.pause.textContent = "Continue";
    this.#announce(message);
    this.#updateTransport();
    this.#parkCursorAtPause();
  }

  resume() {
    if (!this.#active || this.#playing) return;
    this.#playing = true;
    this.#engine.setAutoTransitionsEnabled(true);
    this.#phase = this.#phaseBeforePause ?? "queued";
    this.#phaseBeforePause = null;
    this.#elements.stage.dataset.demoState = this.#yielding || this.#overlayBlocked ? "waiting" : "playing";
    this.#elements.narrator.dataset.demoPhase = this.#phase;
    this.#elements.pause.textContent = "Pause";
    this.#pauseAnimation?.cancel();
    this.#pauseAnimation = null;
    this.#announce("Demo continued.");
    this.#resumeTiming();
    if (!this.#yielding && !this.#overlayBlocked && this.#timer === null && this.#animation === null) {
      this.#schedule(0);
    }
    this.#updateTransport();
  }

  toggle() {
    if (!this.#active) this.start({ restart: true });
    else if (this.#playing) this.pause();
    else this.resume();
  }

  explore({ showcase = true } = {}) {
    this.takeControl({ showcase });
  }

  takeControl({ showcase = false } = {}) {
    this.#active = false;
    this.#playing = false;
    this.#yielding = false;
    this.#phase = "idle";
    this.#phaseBeforePause = null;
    this.#engine.setAutoTransitionsEnabled(true);
    this.#cancelRun();
    this.#hideCursor();
    this.#elements.stage.dataset.demoState = "manual";
    this.#elements.toggle.textContent = "Start demo";
    this.#setDeckActive(false);
    this.#announce("Free exploration enabled. The current gauge screen is preserved.");
    if (showcase) this.#runControlCinema();
  }

  noteUserActivity() {
    if (!this.#active || !this.#playing) return;
    this.#yielding = true;
    this.#cancelRun();
    this.#hideCursor();
    this.#phase = "waiting";
    this.#elements.stage.dataset.demoState = "waiting";
    this.#elements.narrator.dataset.demoPhase = "waiting";
    this.#announce("You are in control. The demo will wait before continuing.");
    this.#schedule(this.#yieldMs, () => {
      if (!this.#playing) return;
      this.#yielding = false;
      this.#phase = "queued";
      this.#elements.stage.dataset.demoState = "playing";
      this.#index = compatibleDemoStepIndex(this.#sequence, this.#stateId, this.#index);
      this.#renderStep(this.#sequence[this.#index], "queued");
      this.#schedule(500);
    });
  }

  handleKeydown(event) {
    if (!this.#active || event.altKey || event.ctrlKey || event.metaKey) return false;
    if (event.target.matches("input, textarea, select, [contenteditable='true']")) return false;
    if ([" ", "Spacebar"].includes(event.key)) this.toggle();
    else if (event.key === "Escape") this.takeControl();
    else return false;
    return true;
  }

  observe(state) {
    this.#stateId = state.id;
    this.#queueOverlaySync();
  }

  destroy() {
    this.#cancelRun();
    this.#pauseAnimation?.cancel();
    this.#pauseAnimation = null;
    if (this.#cinemaTimer !== null) window.clearTimeout(this.#cinemaTimer);
    document.removeEventListener("visibilitychange", this.#visibilityListener);
    this.#reducedMotion.removeEventListener?.("change", this.#motionListener);
    this.#intersectionObserver?.disconnect();
    this.#overlayObserver?.disconnect();
  }

  #canRun() {
    return this.#active
      && this.#playing
      && !this.#yielding
      && !this.#overlayBlocked
      && this.#stageVisible
      && this.#documentVisible;
  }

  #syncSuspension() {
    if (this.#active && !this.#playing) return;
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
      this.#phase = "blocked";
      this.#elements.stage.dataset.demoState = "waiting";
      this.#elements.narrator.dataset.demoPhase = "waiting";
      const message = toast.dataset.liveToastMessage?.replaceAll(" / ", ": ") || "Voyager message in progress";
      this.#announce(`Waiting for Voyager: ${message}`);
      return;
    }
    if (!this.#playing || this.#yielding || !this.#stageVisible || !this.#documentVisible) return;
    this.#elements.stage.dataset.demoState = "playing";
    this.#index = compatibleDemoStepIndex(this.#sequence, this.#stateId, this.#index);
    this.#phase = "queued";
    this.#renderStep(this.#sequence[this.#index], "queued");
    this.#announce("Continuing after the Voyager message.");
    this.#schedule(650);
  }

  #cancelRun() {
    this.#runToken += 1;
    this.#clearTimer();
    this.#pausedTimer?.cancel?.();
    this.#pausedTimer = null;
    this.#animation?.cancel();
    this.#animation = null;
    this.#pauseAnimation?.cancel();
    this.#pauseAnimation = null;
  }

  #clearTimer({ preserve = false } = {}) {
    if (this.#timer === null) return;
    window.clearTimeout(this.#timer);
    if (preserve) {
      this.#pausedTimer = {
        callback: this.#timerCallback,
        cancel: this.#timerCancel,
        remainingMs: Math.max(0, this.#timerDueAt - performance.now()),
      };
    } else {
      this.#timerCancel?.();
    }
    this.#timer = null;
    this.#timerCallback = null;
    this.#timerCancel = null;
    this.#timerDueAt = 0;
  }

  #schedule(delayMs, callback = null, cancel = null) {
    this.#clearTimer();
    this.#timerCallback = callback ?? (() => this.#runStep());
    this.#timerCancel = cancel;
    this.#timerDueAt = performance.now() + delayMs;
    this.#timer = window.setTimeout(() => {
      const scheduledCallback = this.#timerCallback;
      this.#timer = null;
      this.#timerCallback = null;
      this.#timerCancel = null;
      this.#timerDueAt = 0;
      scheduledCallback?.();
    }, delayMs);
  }

  #delay(delayMs, token) {
    return new Promise((resolve) => {
      this.#schedule(
        delayMs,
        () => resolve(token === this.#runToken),
        () => resolve(false),
      );
    });
  }

  #suspendTiming() {
    this.#clearTimer({ preserve: true });
    if (this.#animation?.playState === "running") this.#animation.pause();
  }

  #resumeTiming() {
    if (this.#animation?.playState === "paused") {
      this.#animation.play();
      return;
    }
    if (!this.#pausedTimer) return;
    const pausedTimer = this.#pausedTimer;
    this.#pausedTimer = null;
    this.#schedule(pausedTimer.remainingMs, pausedTimer.callback, pausedTimer.cancel);
  }

  async #runStep() {
    if (!this.#canRun()) return;
    if (!this.#sequence[this.#index].expectedStates?.includes("*")) {
      const compatibleIndex = compatibleDemoStepIndex(this.#sequence, this.#stateId, this.#index);
      if (compatibleIndex !== this.#index) this.#index = compatibleIndex;
    }
    const step = this.#sequence[this.#index];
    const token = ++this.#runToken;
    this.#activeStepIndex = this.#index;
    this.#phase = "preparing";
    this.#renderStep(step, "preparing");

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

    if (!(await this.#delay(this.#reducedMotion.matches ? 1 : DEMO_PRE_MOVE_MS, token))) return;
    if (target) {
      this.#phase = "moving";
      await this.#moveCursor(target, token);
      if (!this.#canRun() || token !== this.#runToken) return;
    }

    if (target && step.kind !== "present") {
      this.#phase = "clicking";
      await this.#pulseClick(token);
      if (!this.#canRun() || token !== this.#runToken) return;
    }

    try {
      if (step.kind === "navigate") {
        const reachedTarget = await this.#followControlPath(step.destination, token, "demo:anchor");
        if (!reachedTarget) throw new Error("The main screen is not reachable through the current controls.");
      } else if (step.kind === "touch") {
        this.#activateTarget(target, "demo");
      } else if (step.kind === "physical") {
        this.#performAction(step.action, "demo");
      }
    } catch (error) {
      this.#announce(`Demo recovered from: ${error.message}`);
      this.#index = 0;
      this.#schedule(900);
      return;
    }

    if (!this.#canRun() || token !== this.#runToken) return;
    this.#renderStep(step, "settling");
    this.#advanceStep();
    this.#phase = "settling";
    if (!(await this.#delay(this.#reducedMotion.matches ? 1 : DEMO_SETTLE_MS, token))) return;
    if (!this.#canRun() || token !== this.#runToken) return;
    this.#phase = "holding";
    this.#elements.narrator.dataset.demoPhase = "holding";
    const holdMs = demoReadingHoldMs(`${this.#elements.title.textContent} ${this.#elements.description.textContent}`);
    this.#updateTransport();
    this.#schedule(holdMs);
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

  #parkCursorAtPause() {
    if (this.#animation || !this.#elements.pause) return;
    const stageBounds = this.#elements.stage.getBoundingClientRect();
    const targetBounds = this.#elements.pause.getBoundingClientRect();
    if (!targetBounds.width || !targetBounds.height) return;
    const point = {
      x: targetBounds.left - stageBounds.left + targetBounds.width / 2,
      y: targetBounds.top - stageBounds.top + targetBounds.height / 2,
    };
    const start = this.#lastPoint ?? point;
    const cursor = this.#elements.cursor;
    const startTransform = `translate3d(${start.x.toFixed(2)}px, ${start.y.toFixed(2)}px, 0)`;
    const endTransform = `translate3d(${point.x.toFixed(2)}px, ${point.y.toFixed(2)}px, 0)`;
    cursor.dataset.visible = "true";
    cursor.style.opacity = "1";
    this.#pauseAnimation = cursor.animate(
      [
        { opacity: 1, transform: startTransform },
        { opacity: 1, transform: endTransform },
      ],
      {
        duration: this.#reducedMotion.matches ? 1 : this.#moveMs,
        easing: "cubic-bezier(.22,.82,.25,1)",
        fill: "forwards",
      },
    );
    this.#pauseAnimation.finished.then(() => {
      if (!this.#active || this.#playing) return;
      cursor.style.transform = endTransform;
      this.#lastPoint = point;
      this.#pauseAnimation = null;
    }).catch(() => {});
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
      { duration: this.#reducedMotion.matches ? 1 : DEMO_CLICK_MS, easing: "ease-out" },
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

  async #followControlPath(targetStateId, token, source) {
    const manifest = this.#engine.getManifest();
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const currentStateId = this.#engine.getState().id;
      if (currentStateId === targetStateId) return true;
      const path = contextualControlPath(manifest, currentStateId, targetStateId, this.#resolveControlTarget);
      const action = path?.[0];
      if (!action) return false;
      const control = this.#elements.stage.querySelector(`.voyager-control--${action}`);
      if (!control) return false;
      this.#phase = "rewinding";
      this.#elements.narrator.dataset.demoPhase = "rewinding";
      await this.#moveCursor(control, token);
      if (!this.#canRun() || token !== this.#runToken) return false;
      await this.#pulseClick(token);
      if (!this.#canRun() || token !== this.#runToken) return false;
      const result = this.#performAction(action, source);
      if (!result || this.#engine.getState().id === currentStateId) return false;
      if (!(await this.#delay(this.#reducedMotion.matches ? 1 : DEMO_SETTLE_MS, token))) return false;
    }
    return this.#engine.getState().id === targetStateId;
  }

  #hideCursor() {
    this.#elements.cursor.removeAttribute("data-visible");
    this.#elements.cursor.removeAttribute("data-clicking");
    this.#elements.cursor.style.opacity = "0";
  }

  #setDeckActive(active) {
    const scrollPosition = { left: window.scrollX, top: window.scrollY };
    const previousOverflowAnchor = document.documentElement.style.overflowAnchor;
    document.documentElement.style.overflowAnchor = "none";
    this.#elements.copyRoot.dataset.demoActive = active ? "true" : "false";
    this.#elements.marketing.setAttribute("aria-hidden", String(active));
    this.#elements.narrator.setAttribute("aria-hidden", String(!active));
    const restoreScroll = () => window.scrollTo({ ...scrollPosition, behavior: "instant" });
    restoreScroll();
    window.requestAnimationFrame(() => {
      restoreScroll();
      window.requestAnimationFrame(() => {
        restoreScroll();
        document.documentElement.style.overflowAnchor = previousOverflowAnchor;
      });
    });
    window.setTimeout(restoreScroll, 80);
  }

  #renderStep(step, phase, effectResult = null) {
    const index = this.#activeStepIndex ?? this.#index;
    const ordinal = String(index + 1).padStart(2, "0");
    const total = String(this.#sequence.length).padStart(2, "0");
    const title = this.#resolveCopy(step.title ?? step.intent, effectResult);
    const description = this.#resolveCopy(step.description ?? step.presentation, effectResult);
    this.#elements.counter.textContent = `Demo ${ordinal} of ${total}`;
    this.#elements.progressFill.style.width = `${((index + 1) / this.#sequence.length) * 100}%`;
    this.#elements.title.textContent = title;
    this.#elements.description.textContent = description;
    this.#elements.narrator.dataset.demoPhase = phase;
    this.#announce(`${this.#elements.counter.textContent}. ${title}. ${description}`);
    this.#updateTransport();
  }

  #updateTransport() {
    this.#elements.pause.textContent = this.#playing ? "Pause" : "Continue";
    this.#elements.pause.dataset.transportState = this.#playing ? "pause" : "continue";
  }

  #announce(message) {
    this.#elements.live.textContent = message;
  }

  #runControlCinema() {
    if (this.#cinemaTimer !== null) window.clearTimeout(this.#cinemaTimer);
    delete this.#elements.stage.dataset.controlCinema;
    void this.#elements.stage.offsetWidth;
    this.#elements.stage.dataset.controlCinema = "true";
    this.#cinemaTimer = window.setTimeout(() => {
      delete this.#elements.stage.dataset.controlCinema;
      this.#cinemaTimer = null;
    }, 1800);
  }
}
