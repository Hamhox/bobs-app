export class VoyagerStateEngine {
  #manifest;
  #stateId;
  #listeners = new Set();
  #timer = null;
  #autoTransitionsEnabled = true;

  constructor(manifest) {
    if (!manifest?.states?.[manifest.initialState]) {
      throw new Error("Voyager manifest does not contain its initial state.");
    }
    this.#manifest = manifest;
    this.#stateId = manifest.initialState;
    this.#scheduleAutoTransition();
  }

  getState() {
    return this.#manifest.states[this.#stateId];
  }

  getManifest() {
    return this.#manifest;
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    listener(this.getState(), { type: "initial", moved: false });
    return () => this.#listeners.delete(listener);
  }

  dispatch(action, source = "control") {
    const state = this.getState();
    if (!Object.hasOwn(state.transitions, action)) {
      return { action, moved: false, reason: "unknown-action", state };
    }

    const target = state.transitions[action];
    if (!target) {
      const event = { type: "dispatch", action, source, moved: false, from: state.id, to: null };
      this.#notify(event);
      return { ...event, state };
    }

    return this.#moveTo(target, { type: "dispatch", action, source });
  }

  reset(stateId = this.#manifest.initialState, source = "reset") {
    if (!this.#manifest.states[stateId]) throw new Error(`Unknown Voyager state: ${stateId}`);
    return this.#moveTo(stateId, { type: "reset", source });
  }

  setAutoTransitionsEnabled(enabled) {
    this.#autoTransitionsEnabled = Boolean(enabled);
    this.#clearAutoTransition();
    this.#scheduleAutoTransition();
  }

  #moveTo(target, event) {
    const from = this.#stateId;
    this.#clearAutoTransition();
    this.#stateId = target;
    const result = { ...event, moved: from !== target, from, to: target };
    this.#notify(result);
    this.#scheduleAutoTransition();
    return { ...result, state: this.getState() };
  }

  #notify(event) {
    const state = this.getState();
    for (const listener of this.#listeners) listener(state, event);
  }

  #scheduleAutoTransition() {
    const transition = this.getState().autoTransition;
    if (!this.#autoTransitionsEnabled || !transition?.active) return;
    this.#timer = window.setTimeout(() => {
      this.#moveTo(transition.target, { type: "auto", source: "archive-timer" });
    }, transition.delayMs);
  }

  #clearAutoTransition() {
    if (this.#timer === null) return;
    window.clearTimeout(this.#timer);
    this.#timer = null;
  }
}
