const FONT_GRIDS = [8, 12, 16, 24, 32, 40, 48, 96];
const MAX_PREVIEW_SIZE = 192;
const DEFAULTS = {
  gridIndex: 3,
  scale: 3,
  tracking: 0,
  preset: "trail",
};

const SAMPLES = {
  trail: "VOYAGER READY\n184 SCREENS\nONE WORKING PROTOTYPE",
  alphabet: "ABCDEFGHIJKLMNOPQRSTUVWXYZ\nabcdefghijklmnopqrstuvwxyz",
  numbers: "111 101 0123456789\n8 / 12 / 16 / 24 / 32 / 40 / 48 / 96",
};

function scaleLimit(grid) {
  return Math.max(1, Math.min(8, Math.floor(MAX_PREVIEW_SIZE / grid)));
}

function defaultScale() {
  return window.matchMedia("(max-width: 620px)").matches ? 2 : DEFAULTS.scale;
}

export function initializeFontPlayground(root, assetBase) {
  if (!root) return;

  const gridInput = root.querySelector("#font-grid");
  const scaleInput = root.querySelector("#font-scale");
  const trackingInput = root.querySelector("#font-tracking");
  const gridOutput = root.querySelector("#font-grid-output");
  const scaleOutput = root.querySelector("#font-scale-output");
  const trackingOutput = root.querySelector("#font-tracking-output");
  const preview = root.querySelector("#font-preview");
  const previewPanel = root.querySelector(".font-playground__preview");
  const resetButton = root.querySelector("#font-reset");
  const download = root.querySelector("#font-download");
  const downloadLabel = root.querySelector("#font-download-label");
  const activeFile = root.querySelector("#font-active-file");
  const presetButtons = [...root.querySelectorAll("[data-font-preset]")];

  function selectPreset(name) {
    preview.value = SAMPLES[name];
    for (const button of presetButtons) {
      button.setAttribute("aria-pressed", String(button.dataset.fontPreset === name));
    }
  }

  function updatePreview() {
    const grid = FONT_GRIDS[Number(gridInput.value)];
    const maximumScale = scaleLimit(grid);
    scaleInput.max = String(maximumScale);
    if (Number(scaleInput.value) > maximumScale) scaleInput.value = String(maximumScale);

    const scale = Number(scaleInput.value);
    const tracking = Number(trackingInput.value);
    const previewSize = grid * scale;
    const fileName = `BobsFont${grid}Pixel-Regular.ttf`;

    root.dataset.grid = String(grid);
    root.style.setProperty("--font-preview-size", `${previewSize}px`);
    root.style.setProperty("--font-preview-tracking", `${tracking}px`);
    previewPanel.dataset.gridLabel = `${grid} px native grid / ${scale}\u00d7 scale`;

    gridOutput.value = `${grid} PX`;
    scaleOutput.value = `${scale}\u00d7 / ${previewSize} PX`;
    trackingOutput.value = `${tracking} PX`;

    gridInput.setAttribute("aria-valuetext", `${grid} pixel grid`);
    scaleInput.setAttribute("aria-valuetext", `${scale} times, ${previewSize} pixels`);
    trackingInput.setAttribute("aria-valuetext", `${tracking} pixels`);

    download.href = `${assetBase}/ttf/${fileName}`;
    download.download = fileName;
    downloadLabel.textContent = `Download ${grid} Pixel TTF`;
    activeFile.textContent = fileName;
  }

  gridInput.addEventListener("input", updatePreview);
  scaleInput.addEventListener("input", updatePreview);
  trackingInput.addEventListener("input", updatePreview);

  for (const button of presetButtons) {
    button.addEventListener("click", () => selectPreset(button.dataset.fontPreset));
  }

  preview.addEventListener("input", () => {
    for (const button of presetButtons) button.setAttribute("aria-pressed", "false");
  });

  resetButton.addEventListener("click", () => {
    gridInput.value = String(DEFAULTS.gridIndex);
    scaleInput.max = String(scaleLimit(FONT_GRIDS[DEFAULTS.gridIndex]));
    scaleInput.value = String(defaultScale());
    trackingInput.value = String(DEFAULTS.tracking);
    selectPreset(DEFAULTS.preset);
    updatePreview();
  });

  scaleInput.value = String(defaultScale());
  selectPreset(DEFAULTS.preset);
  updatePreview();
}
