import assert from "node:assert/strict";

import {
  VOYAGER_DEMO_SEQUENCE,
  compatibleDemoStepIndex,
} from "../voyager-demo.js";

const ALLOWED_KINDS = new Set(["navigate", "physical", "present", "touch"]);
const NON_DESTRUCTIVE_PHYSICAL_ACTIONS = new Set(["back", "menu"]);

assert.ok(VOYAGER_DEMO_SEQUENCE.length >= 20, "Phase 1 should tell a complete gauge story.");
assert.equal(
  new Set(VOYAGER_DEMO_SEQUENCE.map((step) => step.id)).size,
  VOYAGER_DEMO_SEQUENCE.length,
  "Demo step IDs must be unique.",
);

for (const step of VOYAGER_DEMO_SEQUENCE) {
  assert.ok(ALLOWED_KINDS.has(step.kind), `${step.id} uses an unsupported step kind.`);
  assert.ok(step.intent?.trim(), `${step.id} needs an intent cue.`);
  assert.ok(step.presentation?.trim(), `${step.id} needs a presentation cue.`);
  assert.ok(step.expectedStates?.length, `${step.id} needs compatible source states.`);
  assert.ok(step.target?.trim(), `${step.id} needs a visible cursor target.`);

  if (step.kind === "physical") {
    assert.ok(
      NON_DESTRUCTIVE_PHYSICAL_ACTIONS.has(step.action),
      `${step.id} performs a state-changing physical action outside Phase 1.`,
    );
  }
  if (step.kind === "touch") {
    assert.doesNotMatch(
      step.target,
      /data-menu-(confirmation|option|row|slot|key)/,
      `${step.id} commits a menu value instead of inspecting it.`,
    );
  }
}

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

console.log(`Voyager demo validation passed (${VOYAGER_DEMO_SEQUENCE.length} non-destructive steps).`);
