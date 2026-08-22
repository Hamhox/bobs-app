const FONT_SCALES = [8, 12, 16, 24, 32, 40, 48, 96];

export function initializeFontPlayground(root) {
  if (!root) return;

  const gridInput = root.querySelector("#font-grid");

  async function preloadFont() {
    if (typeof document === "undefined" || !document.fonts) {
      gridInput.disabled = false;
      return;
    }

    root.setAttribute("aria-busy", "true");
    root.dataset.fontsReady = "loading";
    try {
      await document.fonts.load(
        '24pt "Bobs Font 8 Pixel"',
        "TYPE YOUR TRAIL NAME HERE 37\u00b0",
      );
      root.dataset.fontsReady = "true";
    } catch {
      root.dataset.fontsReady = "fallback";
    } finally {
      root.removeAttribute("aria-busy");
      gridInput.disabled = false;
    }
  }

  function updatePreview() {
    const index = Number(gridInput.value);
    const scale = FONT_SCALES[index];

    root.style.setProperty("--font-preview-size", `${scale}pt`);
    gridInput.setAttribute(
      "aria-valuetext",
      `${scale} point display scale, ${index + 1} of 8`,
    );
  }

  gridInput.addEventListener("input", updatePreview);
  updatePreview();
  preloadFont();
}
