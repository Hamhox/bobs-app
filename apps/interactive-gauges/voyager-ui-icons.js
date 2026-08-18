const VOYAGER_UI_ICON_SPRITE = "/apps/interactive-gauges/assets/ui/voyager-ui-icons.svg";

const ICON_VIEW_BOXES = Object.freeze({
  "battery-24pt-empty": [83.676, 108.862, 10.483, 5.615],
  "btn-cancel-disabled": [137.94, 51.285, 32.947, 10.483],
  "btn-cancel-selected": [209.825, 47.914, 32.947, 13.854],
  "btn-ok-disabled": [103.495, 51.285, 32.948, 10.483],
  "btn-ok-selected": [174.257, 47.915, 32.947, 13.854],
  "compass-arrow": [223.717, 77.671, 6.365, 28.08],
  "compass-dial": [203.86, 68.692, 45.676, 45.674],
  "compass-indicator-24pt": [51.804, 108.111, 4.867, 6.738],
  "crosshair-center": [166.395, 72.25, 11.606, 11.606],
  "dpad-pan": [123.339, 67.007, 20.216, 20.218],
  "dpad-zoom": [99.005, 67.007, 20.216, 20.218],
  "fluid-temp-icon": [83.653, 71.499, 10.857, 10.11],
  "icon-16pt-pause": [54.623, 95.539, 4.493, 5.242],
  "icon-16pt-play": [66.604, 95.538, 2.996, 5.242],
  "icon-16pt-record": [59.864, 95.538, 5.242, 5.243],
  "keyboard-16pt-back": [94.309, 95.539, 6.365, 5.991],
  "keyboard-16pt-backspace": [75.964, 95.538, 6.365, 5.992],
  "keyboard-16pt-checkmark": [111.532, 95.538, 6.365, 5.992],
  "keyboard-16pt-delete": [84.201, 95.538, 8.236, 5.992],
  "keyboard-16pt-forward": [102.547, 95.538, 6.365, 5.992],
  "keyboard-16pt-space": [128.38, 95.538, 6.365, 5.992],
  "panzoom-pill": [55.197, 49.785, 20.219, 13.478],
  "pauseplay-pill": [77.287, 49.785, 20.219, 13.478],
  "radio-16pt-checked": [136.243, 95.54, 5.241, 5.242],
  "radio-16pt-unchecked": [142.608, 95.54, 5.241, 5.242],
  "screen-arrow-left": [150.67, 71.501, 4.119, 11.981],
  "screen-arrow-right": [158.531, 71.501, 4.12, 11.981],
  "screen-indicator-16pt-1": [158.332, 95.539, 4.493, 5.241],
  "screen-indicator-16pt-1-narrow": [174.431, 95.539, 4.119, 5.241],
  "screen-indicator-16pt-2": [151.219, 95.539, 4.492, 5.242],
  "screen-indicator-16pt-2-narrow": [166.943, 95.539, 4.118, 5.242],
});

function numericAttribute(value) {
  if (!Number.isFinite(value)) throw new TypeError("Voyager icon coordinates must be finite numbers.");
  return Number(value.toFixed(3));
}

export function voyagerUiIcon(id, {
  x,
  y,
  width,
  height,
  className = "",
  viewBox = ICON_VIEW_BOXES[id],
  attributes = "",
} = {}) {
  if (!ICON_VIEW_BOXES[id] || !viewBox) throw new Error(`Unknown Voyager UI icon: ${id}`);
  const [viewX, viewY, viewWidth, viewHeight] = viewBox;
  const classes = ["voyager-ui-icon", className].filter(Boolean).join(" ");
  return `<svg class="${classes}" x="${numericAttribute(x)}" y="${numericAttribute(y)}" width="${numericAttribute(width)}" height="${numericAttribute(height)}" viewBox="${viewX} ${viewY} ${viewWidth} ${viewHeight}" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false" ${attributes}><use href="${VOYAGER_UI_ICON_SPRITE}#${id}"></use></svg>`;
}

export const VOYAGER_COMPASS_VIEW_BOX = ICON_VIEW_BOXES["compass-dial"];
