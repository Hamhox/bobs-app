const FONT_GRIDS = [8, 12, 16, 24, 32, 40, 48, 96];

export function initializeFontPlayground(root, assetBase) {
  if (!root) return;

  const gridInput = root.querySelector("#font-grid");
  const position = root.querySelector("#font-position");
  const activeFile = root.querySelector("#font-active-file");
  const download = root.querySelector("#font-download");
  const downloadLabel = root.querySelector("#font-download-label");

  function updatePreview() {
    const index = Number(gridInput.value);
    const grid = FONT_GRIDS[index];
    const fileName = `BobsFont${grid}Pixel-Regular.ttf`;

    root.dataset.grid = String(grid);
    root.style.setProperty("--font-preview-size", `${grid}pt`);
    position.textContent = `Font ${String(index + 1).padStart(2, "0")} / 08`;
    activeFile.textContent = fileName;
    gridInput.setAttribute(
      "aria-valuetext",
      `${grid} point font drawing, ${index + 1} of 8`,
    );
    download.href = `${assetBase}/ttf/${fileName}`;
    download.download = fileName;
    downloadLabel.textContent = `Download ${grid}pt TTF`;
  }

  gridInput.addEventListener("input", updatePreview);
  updatePreview();
}
