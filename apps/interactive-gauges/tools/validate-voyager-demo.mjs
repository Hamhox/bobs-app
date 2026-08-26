import assert from "node:assert/strict";

import {
  VOYAGER_DEMO_SEQUENCE,
  compatibleDemoStepIndex,
  contextualControlPath,
  demoReadingHoldMs,
} from "../voyager-demo.js";

const ALLOWED_KINDS = new Set(["navigate", "physical", "present", "touch"]);
const NON_DESTRUCTIVE_PHYSICAL_ACTIONS = new Set(["back", "menu"]);

function hasCue(copy) {
  return typeof copy === "function" || Boolean(copy?.trim());
}

assert.ok(VOYAGER_DEMO_SEQUENCE.length >= 16, "The autonomous demo should tell a complete gauge story.");
assert.equal(
  new Set(VOYAGER_DEMO_SEQUENCE.map((step) => step.id)).size,
  VOYAGER_DEMO_SEQUENCE.length,
  "Demo step IDs must be unique.",
);

for (const step of VOYAGER_DEMO_SEQUENCE) {
  assert.ok(ALLOWED_KINDS.has(step.kind), `${step.id} uses an unsupported step kind.`);
  assert.ok(hasCue(step.title ?? step.intent), `${step.id} needs a title cue.`);
  assert.ok(hasCue(step.description ?? step.presentation), `${step.id} needs a description cue.`);
  assert.ok(step.expectedStates?.length, `${step.id} needs compatible source states.`);
  if (step.kind !== "navigate") assert.ok(step.target?.trim(), `${step.id} needs a visible cursor target.`);

  if (step.kind === "physical") {
    assert.ok(
      NON_DESTRUCTIVE_PHYSICAL_ACTIONS.has(step.action),
      `${step.id} uses an unsupported physical action.`,
    );
  }
}

for (const id of ["load-next-map", "select-destination", "choose-readout", "commit-user-layout"]) {
  assert.ok(VOYAGER_DEMO_SEQUENCE.some((step) => step.id === id), `Stateful demo step ${id} is missing.`);
}
assert.ok(
  !VOYAGER_DEMO_SEQUENCE.some((step) => step.id === "warning-led-cycle" || step.kind === "effect"),
  "The main tour must not mutate warning-light settings.",
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
  compatibleDemoStepIndex(VOYAGER_DEMO_SEQUENCE, "map", 0),
  VOYAGER_DEMO_SEQUENCE.findIndex((step) => step.id === "present-map"),
  "Resume should find the next exact compatible map step before the recovery anchor.",
);

const contextualManifest = {
  states: {
    main: { transitions: { menu: "quick" } },
    quick: { transitions: { back: "main", down: "import" } },
    import: { transitions: { back: "quick" } },
  },
};
assert.deepEqual(
  contextualControlPath(contextualManifest, "import", "main"),
  ["back", "back"],
  "Previous must use visible contextual control presses instead of a state reset.",
);
assert.equal(
  contextualControlPath(contextualManifest, "main", "missing"),
  null,
  "Unreachable states must not fall back to teleportation.",
);
assert.equal(
  compatibleDemoStepIndex(VOYAGER_DEMO_SEQUENCE, "unknown-state", 5),
  VOYAGER_DEMO_SEQUENCE.findIndex((step) => step.id === "anchor-main"),
  "Unknown states should recover through the main-screen anchor.",
);

assert.equal(demoReadingHoldMs("Short caption"), 3500, "Short narration should still receive a generous hold.");
assert.equal(
  demoReadingHoldMs("One two three four five six seven eight nine ten"),
  3700,
  "Narration hold should scale with word count.",
);
assert.equal(
  demoReadingHoldMs(Array.from({ length: 40 }, (_, index) => `word${index}`).join(" ")),
  7500,
  "Long narration should respect the 7.5 second cap.",
);

console.log(`Voyager demo validation passed (${VOYAGER_DEMO_SEQUENCE.length} stateful steps).`);
