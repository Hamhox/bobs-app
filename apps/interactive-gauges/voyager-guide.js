const STEPS = [
  {
    number: "01",
    state: "index",
    actions: ["menu"],
    instruction: "Press MENU to open the main menu.",
  },
  {
    number: "02",
    state: "m-main1-1",
    actions: ["right", "enter"],
    instruction: "Press RIGHT or ENTER to highlight Reset Stop Watch.",
  },
  {
    number: "03",
    state: "m-main1-2",
    actions: ["down"],
    instruction: "Press DOWN to highlight Reset Ride DST.",
  },
  {
    number: "04",
    state: "m-main1-3",
    actions: ["right", "enter"],
    instruction: "Press RIGHT or ENTER to open the confirmation.",
  },
];

export class VoyagerGuide {
  #engine;
  #elements;
  #active = false;
  #complete = false;
  #stepIndex = 0;

  constructor(engine, elements) {
    this.#engine = engine;
    this.#elements = elements;
  }

  get active() {
    return this.#active;
  }

  start() {
    this.#active = true;
    this.#complete = false;
    this.#stepIndex = 0;
    this.#engine.setAutoTransitionsEnabled(false);
    this.#engine.reset("index", "guided-start");
    this.#elements.panel.dataset.mode = "active";
    this.#elements.exit.hidden = false;
    this.#render();
  }

  exit({ focusStage = false } = {}) {
    this.#active = false;
    this.#complete = false;
    this.#engine.setAutoTransitionsEnabled(true);
    this.#clearHighlights();
    this.#elements.panel.dataset.mode = "idle";
    this.#elements.number.textContent = "FREE";
    this.#elements.label.textContent = "Archive controls enabled";
    this.#elements.instruction.textContent = "Use the device buttons or focus the gauge for keyboard controls.";
    this.#elements.exit.hidden = true;
    if (focusStage) this.#elements.stage.focus({ preventScroll: true });
  }

  observe(state, event) {
    if (!this.#active || !event.moved) return;

    const nextIndex = STEPS.findIndex((step) => step.state === state.id);
    if (state.id === "m-main1-3-1") {
      this.#complete = true;
      this.#renderComplete();
      return;
    }

    if (nextIndex >= 0) {
      this.#stepIndex = nextIndex;
      this.#render();
      return;
    }

    this.#elements.label.textContent = "Guide paused";
    this.#elements.instruction.textContent = "Return to the highlighted route or restart the guided ride.";
    this.#clearHighlights();
  }

  #render() {
    const step = STEPS[this.#stepIndex];
    this.#elements.number.textContent = step.number;
    this.#elements.label.textContent = `Guided ride, step ${this.#stepIndex + 1} of ${STEPS.length}`;
    this.#elements.instruction.textContent = step.instruction;
    this.#elements.live.textContent = `${this.#elements.label.textContent}. ${step.instruction}`;
    this.#clearHighlights();
    for (const action of step.actions) {
      this.#elements.controls
        .filter((control) => control.dataset.action === action)
        .forEach((control) => control.setAttribute("data-guided", "active"));
    }
  }

  #renderComplete() {
    this.#clearHighlights();
    this.#elements.panel.dataset.mode = "complete";
    this.#elements.number.textContent = "DONE";
    this.#elements.label.textContent = "Objective complete";
    this.#elements.instruction.textContent =
      "You opened the archived Reset Ride Distance confirmation. CANCEL is the only recovered selection.";
    this.#elements.live.textContent =
      "Guided objective complete. The archived confirmation is open with Cancel selected.";
  }

  #clearHighlights() {
    for (const control of this.#elements.controls) control.removeAttribute("data-guided");
  }
}
