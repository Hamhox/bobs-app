(() => {
  const directory = document.querySelector(".story-directory");
  const atmosphereImage = document.querySelector(".story-atmosphere__image");

  if (!directory) return;

  const rows = [...directory.querySelectorAll(".directory-row[data-story]")];
  const stories = new Set(rows.map((row) => row.dataset.story));
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const recommendedStory = "gauge-story";

  const state = {
    recommendedStory,
    hoveredStory: null,
  };

  let pointerStory = null;
  let focusStory = null;
  let rowReleaseTimer = 0;
  let bootTimers = [];

  function render() {
    directory.dataset.recommendedStory = state.recommendedStory;
    directory.dataset.hoveredStory = state.hoveredStory || "";
    directory.classList.toggle("is-engaged", state.hoveredStory !== null);

    rows.forEach((row) => {
      row.classList.toggle("is-active", row.dataset.story === state.hoveredStory);
    });
  }

  function clearRowReleaseTimer() {
    window.clearTimeout(rowReleaseTimer);
    rowReleaseTimer = 0;
  }

  function clearBootSequence() {
    bootTimers.forEach((timer) => window.clearTimeout(timer));
    bootTimers = [];
    directory.classList.remove("is-boot-sequence");
    rows.forEach((row) => row.classList.remove("is-booting"));
  }

  function showStory(story) {
    if (!stories.has(story)) return;

    clearRowReleaseTimer();
    clearBootSequence();
    state.hoveredStory = story;
    render();
  }

  function settleToRecommendation() {
    clearRowReleaseTimer();

    rowReleaseTimer = window.setTimeout(() => {
      if (pointerStory || focusStory) return;
      state.hoveredStory = null;
      render();
    }, 320);
  }

  async function revealAtmosphere() {
    if (!atmosphereImage) return;

    try {
      await atmosphereImage.decode();
    } catch {
      // The entrance can still run if decoding is unsupported or interrupted.
    }

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        atmosphereImage.classList.add("is-visible");
      });
    });
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
    if (state.hoveredStory) clearRowReleaseTimer();
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
  revealAtmosphere();
  runBootSequence();
})();
