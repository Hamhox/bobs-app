(() => {
  const directory = document.querySelector(".story-directory");
  const atmosphere = document.querySelector(".story-atmosphere");

  if (!directory || !atmosphere) return;

  const rows = [...directory.querySelectorAll(".directory-row[data-story]")];
  const layers = [...atmosphere.querySelectorAll(".story-atmosphere__layer[data-story]")];
  const stories = new Set(rows.map((row) => row.dataset.story));
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const state = {
    recommendedStory: "gauge-story",
    hoveredStory: null,
    displayedStory: "gauge-story",
  };

  let pointerStory = null;
  let focusStory = null;
  let rowReleaseTimer = 0;
  let previewReturnTimer = 0;
  let settlingTimer = 0;
  let bootTimers = [];

  function render() {
    directory.dataset.recommendedStory = state.recommendedStory;
    directory.dataset.hoveredStory = state.hoveredStory || "";
    directory.dataset.displayedStory = state.displayedStory;
    directory.classList.toggle("is-engaged", state.hoveredStory !== null);
    atmosphere.classList.toggle("is-idle", state.hoveredStory === null);

    rows.forEach((row) => {
      row.classList.toggle("is-active", row.dataset.story === state.hoveredStory);
    });

    layers.forEach((layer) => {
      layer.classList.toggle("is-displayed", layer.dataset.story === state.displayedStory);
    });
  }

  function clearSettleTimers() {
    window.clearTimeout(rowReleaseTimer);
    window.clearTimeout(previewReturnTimer);
    window.clearTimeout(settlingTimer);
    rowReleaseTimer = 0;
    previewReturnTimer = 0;
    settlingTimer = 0;
    atmosphere.classList.remove("is-settling");
  }

  function clearBootSequence() {
    bootTimers.forEach((timer) => window.clearTimeout(timer));
    bootTimers = [];
    directory.classList.remove("is-boot-sequence");
    rows.forEach((row) => row.classList.remove("is-booting"));
  }

  function showStory(story) {
    if (!stories.has(story)) return;

    clearSettleTimers();
    clearBootSequence();
    state.hoveredStory = story;
    state.displayedStory = story;
    render();
  }

  function settleToRecommendation() {
    clearSettleTimers();

    rowReleaseTimer = window.setTimeout(() => {
      if (pointerStory || focusStory) return;
      state.hoveredStory = null;
      render();
    }, 320);

    previewReturnTimer = window.setTimeout(() => {
      if (pointerStory || focusStory) return;
      atmosphere.classList.add("is-settling");
      state.displayedStory = state.recommendedStory;
      render();

      settlingTimer = window.setTimeout(() => {
        atmosphere.classList.remove("is-settling");
      }, 680);
    }, 600);
  }

  function runBootSequence() {
    if (reducedMotion) return;

    directory.classList.add("is-boot-sequence");
    const startDelay = 360;
    const stepDelay = 150;

    rows.forEach((row, index) => {
      bootTimers.push(window.setTimeout(() => {
        row.classList.add("is-booting");
      }, startDelay + (index * stepDelay)));
    });

    const allLitAt = startDelay + ((rows.length - 1) * stepDelay);

    bootTimers.push(window.setTimeout(() => {
      rows.slice(1).forEach((row) => row.classList.remove("is-booting"));
    }, allLitAt + 240));

    bootTimers.push(window.setTimeout(() => {
      rows[0]?.classList.remove("is-booting");
      directory.classList.remove("is-boot-sequence");
      bootTimers = [];
    }, allLitAt + 440));
  }

  rows.forEach((row) => {
    row.addEventListener("pointerenter", () => {
      pointerStory = row.dataset.story;
      showStory(pointerStory);
    });

    row.addEventListener("focusin", () => {
      focusStory = row.dataset.story;
      showStory(focusStory);
    });
  });

  directory.addEventListener("pointerenter", () => {
    if (state.hoveredStory) clearSettleTimers();
  });

  directory.addEventListener("pointerleave", () => {
    pointerStory = null;

    if (focusStory) {
      showStory(focusStory);
      return;
    }

    settleToRecommendation();
  });

  directory.addEventListener("focusout", () => {
    window.queueMicrotask(() => {
      const focusedRow = document.activeElement?.closest?.(".directory-row[data-story]");
      focusStory = directory.contains(focusedRow) ? focusedRow.dataset.story : null;

      if (focusStory) {
        showStory(focusStory);
      } else if (pointerStory) {
        showStory(pointerStory);
      } else {
        settleToRecommendation();
      }
    });
  });

  render();
  runBootSequence();
})();
