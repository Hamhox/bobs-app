(function() {
  "use strict";

  const fileRows = Array.from(document.querySelectorAll("[data-file-field]"));
  const runButton = document.getElementById("runUpload");
  const progressArea = document.getElementById("uploadProgress");
  const progressBar = document.getElementById("progressBar");
  const progressLabel = document.getElementById("progressLabel");
  const progressPercent = document.getElementById("progressPercent");
  let running = false;

  function allFilesReady() {
    return fileRows.every(function(row) {
      const input = row.querySelector("input[type='file']");
      return input.files && input.files.length > 0;
    });
  }

  function updateRunButton() {
    runButton.disabled = running || !allFilesReady();
  }

  fileRows.forEach(function(row) {
    const input = row.querySelector("input[type='file']");
    const name = row.querySelector("[data-file-name]");
    const action = row.querySelector("[data-file-action]");

    input.addEventListener("change", function() {
      const file = input.files && input.files[0];
      row.classList.toggle("is-added", !!file);
      name.textContent = file ? file.name : "No file selected";
      action.textContent = file ? "File added" : "Add file";
      updateRunButton();
    });
  });

  function setProgress(percent, label) {
    progressBar.style.width = percent + "%";
    progressLabel.textContent = label;
    progressPercent.textContent = percent + "%";
  }

  runButton.addEventListener("click", function() {
    if (running || !allFilesReady()) { return; }

    running = true;
    updateRunButton();
    runButton.textContent = "Working…";
    progressArea.classList.add("is-visible");
    setProgress(8, "Reading local files…");

    const stages = [
      { delay: 650, percent: 34, label: "Checking package structure…" },
      { delay: 1300, percent: 68, label: "Preparing Buildbooks records…" },
      { delay: 1950, percent: 91, label: "Running final checks…" },
      { delay: 2550, percent: 100, label: "Demo complete — no files were uploaded." }
    ];

    stages.forEach(function(stage, index) {
      window.setTimeout(function() {
        setProgress(stage.percent, stage.label);
        if (index === stages.length - 1) {
          running = false;
          runButton.textContent = "Run again";
          updateRunButton();
        }
      }, stage.delay);
    });
  });
})();
