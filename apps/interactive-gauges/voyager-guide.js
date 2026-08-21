const STEPS = [
  {
    number: "01",
    state: "index",
    destination: "gauge.main.primary",
    actions: ["menu"],
    instruction: "Press MENU to open the main menu.",
  },
  {
    number: "02",
    state: "m-main1-1",
    destination: "menu.main",
    actions: ["right", "enter"],
    instruction: "Press RIGHT or ENTER to highlight Log Track.",
  },
  {
    number: "03",
    state: "m-main1-2",
    destination: "m-main1-2",
    actions: ["down"],
    instruction: "Press DOWN to highlight Reset Ride Memory.",
  },
  {
    number: "04",
    state: "m-main1-3",
    destination: "m-main1-3",
    actions: ["down"],
    instruction: "Press DOWN to highlight Reset Trip DST.",
  },
  {
    number: "05",
    state: "m-main1-4",
    destination: "m-main1-4",
    actions: ["right", "enter"],
    instruction: "Press RIGHT or ENTER to open the confirmation.",
  },
];

export class VoyagerGuide {
  #engine;
  #elements;
  #navigate;
  #active = false;
  #complete = false;
  #stepIndex = 0;

  constructor(engine, elements, navigate) {
    this.#engine = engine;
    this.#elements = elements;
    this.#navigate = navigate;
  }

  get active() {
    return this.#active;
  }

  async start() {
    this.#active = true;
    this.#complete = false;
    this.#stepIndex = 0;
    this.#engine.setAutoTransitionsEnabled(false);
    this.#elements.panel.dataset.mode = "active";
    this.#elements.stage.dataset.guideActive = "true";
    this.#render();
    await this.#navigate(STEPS[0].destination, {
      history: "push",
      preserveGuide: true,
      source: "guided-ride",
    });
  }

  exit() {
    this.#active = false;
    this.#complete = false;
    this.#engine.setAutoTransitionsEnabled(true);
    this.#clearHighlights();
    this.#elements.panel.removeAttribute("data-voyager-state");
    delete this.#elements.stage.dataset.guideActive;
    this.#elements.panel.dataset.mode = "idle";
    this.#elements.number.textContent = "01";
    this.#elements.label.textContent = "Archive controls enabled";
    this.#elements.instruction.textContent = "Press MENU to begin.";
  }

  observe(state, event) {
    if (!this.#active || !event.moved) return;

    const nextIndex = STEPS.findIndex((step) => step.state === state.id);
    if (state.id === "m-main1-4-1") {
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
    this.#elements.panel.dataset.voyagerState = step.destination;
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
    delete this.#elements.stage.dataset.guideActive;
    this.#elements.panel.dataset.mode = "complete";
    this.#elements.number.textContent = "DONE";
    this.#elements.panel.dataset.voyagerState = "modal.reset-ride-distance";
    this.#elements.label.textContent = "Objective complete";
    this.#elements.instruction.textContent =
      "You opened the Reset Trip Distance confirmation with Cancel selected.";
    this.#elements.live.textContent =
      "Guided objective complete. The archived confirmation is open with Cancel selected.";
  }

  #clearHighlights() {
    for (const control of this.#elements.controls) control.removeAttribute("data-guided");
  }
}
