import assert from "node:assert/strict";

import {
  VOYAGER_DEMO_SEQUENCE,
  compatibleDemoStepIndex,
} from "../voyager-demo.js";

const ALLOWED_KINDS = new Set(["effect", "navigate", "physical", "present", "touch"]);
const NON_DESTRUCTIVE_PHYSICAL_ACTIONS = new Set(["back", "menu"]);

function hasCue(copy) {
  return typeof copy === "function" || Boolean(copy?.trim());
}

assert.ok(VOYAGER_DEMO_SEQUENCE.length >= 20, "The autonomous demo should tell a complete gauge story.");
assert.equal(
  new Set(VOYAGER_DEMO_SEQUENCE.map((step) => step.id)).size,
  VOYAGER_DEMO_SEQUENCE.length,
  "Demo step IDs must be unique.",
);

for (const step of VOYAGER_DEMO_SEQUENCE) {
  assert.ok(ALLOWED_KINDS.has(step.kind), `${step.id} uses an unsupported step kind.`);
  assert.ok(hasCue(step.intent), `${step.id} needs an intent cue.`);
  assert.ok(hasCue(step.presentation), `${step.id} needs a presentation cue.`);
  assert.ok(step.expectedStates?.length, `${step.id} needs compatible source states.`);
  assert.ok(step.target?.trim(), `${step.id} needs a visible cursor target.`);

  if (step.kind === "physical") {
    assert.ok(
      NON_DESTRUCTIVE_PHYSICAL_ACTIONS.has(step.action),
      `${step.id} uses an unsupported physical action.`,
    );
  }
}

for (const id of ["toggle-log-track", "load-next-map", "select-destination", "choose-readout", "commit-user-layout", "warning-led-cycle"]) {
  assert.ok(VOYAGER_DEMO_SEQUENCE.some((step) => step.id === id), `Stateful demo step ${id} is missing.`);
}
assert.equal(
  VOYAGER_DEMO_SEQUENCE.find((step) => step.id === "toggle-log-track")?.targetMode,
  "opposite-option",
  "Ride logging must alternate each loop.",
);
assert.equal(
  VOYAGER_DEMO_SEQUENCE.find((step) => step.id === "choose-readout")?.targetMode,
  "next-option-nonzero",
  "User readout changes must not choose the OFF option.",
);

assert.equal(
  VOYAGER_DEMO_SEQUENCE.filter((step) => step.kind === "navigate").length,
  1,
  "Only the loop recovery anchor may navigate directly.",
);
assert.equal(
  compatibleDemoStepIndex(VOYAGER_DEMO_SEQUENCE, "map", 7),
  VOYAGER_DEMO_SEQUENCE.findIndex((step) => step.id === "present-map"),
  "Resume should find the next exact compatible map step before the recovery anchor.",
);
assert.equal(
  compatibleDemoStepIndex(VOYAGER_DEMO_SEQUENCE, "unknown-state", 5),
  VOYAGER_DEMO_SEQUENCE.findIndex((step) => step.id === "anchor-main"),
  "Unknown states should recover through the main-screen anchor.",
);

console.log(`Voyager demo validation passed (${VOYAGER_DEMO_SEQUENCE.length} stateful steps).`);
