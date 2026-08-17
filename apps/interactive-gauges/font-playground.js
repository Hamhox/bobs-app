const FONT_GRIDS = [8, 12, 16, 24, 32, 40, 48, 96];

const PREVIEW_SIZES = {
  8: 48,
  12: 48,
  16: 48,
  24: 48,
  32: 64,
  40: 40,
  48: 48,
  96: 96,
};

export function initializeFontPlayground(root, assetBase) {
  if (!root) return;

  const gridInput = root.querySelector("#font-grid");
  const position = root.querySelector("#font-position");
  const activeFile = root.querySelector("#font-active-file");
  const activeFace = root.querySelector("#font-active-face");
  const download = root.querySelector("#font-download");

  function updatePreview() {
    const index = Number(gridInput.value);
    const grid = FONT_GRIDS[index];
    const fileName = `BobsFont${grid}Pixel-Regular.ttf`;

    root.dataset.grid = String(grid);
    root.style.setProperty("--font-preview-size", `${PREVIEW_SIZES[grid]}px`);
    position.textContent = `Font ${String(index + 1).padStart(2, "0")} / 08`;
    activeFile.textContent = fileName;
    activeFace.textContent = `${grid} PX native grid / Bob's Font 1.200`;
    gridInput.setAttribute(
      "aria-valuetext",
      `Font ${index + 1} of 8, ${grid} pixel native grid`,
    );
    download.href = `${assetBase}/ttf/${fileName}`;
    download.download = fileName;
  }

  gridInput.addEventListener("input", updatePreview);
  updatePreview();
}
