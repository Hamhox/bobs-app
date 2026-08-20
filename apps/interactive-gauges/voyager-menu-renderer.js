import { voyagerUiIcon } from "./voyager-ui-icons.js";

const escapeMarkup = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

function sectionChrome(section) {
  const slots = [
    { id: "main", label: "QUICK" },
    { id: "ride", label: "RIDE" },
    {},
    {},
    {},
    {},
    { id: "set", label: "SET" },
  ];
  const activeIndex = slots.findIndex((slot) => slot.id === section);
  return `
    <g data-menu-sidebar="persistent" aria-hidden="true">
      ${slots.map((slot, index) => {
        const y = index * 43;
        const bottom = index === slots.length - 1 ? 303 : y + 43;
        const active = index === activeIndex;
        const followsActiveTab = index === activeIndex + 1;
        return `
          <g${slot.id ? ` data-menu-tab="${slot.id}"` : ""}>
            ${followsActiveTab ? `<path class="voyager-live__tab-active-tail" d="M-3 ${y - 1}H8L-3 ${y + 8}Z" />` : ""}
            <path class="voyager-live__tab${active ? " voyager-live__tab--active" : ""}" d="M-3 ${y + 8} 8 ${y}H67V${bottom}H-3Z" />
            <path class="voyager-live__tab-top" d="M-3 ${y + 8} 8 ${y}H67" />
            <path class="voyager-live__tab-right" d="M67 ${y}V${bottom}" />
            ${slot.label ? `<text class="voyager-live__text voyager-live__text--medium${active ? " voyager-live__text--inverse" : ""}" x="33" y="${y + 29}" text-anchor="middle">${slot.label}</text>` : ""}
          </g>`;
      }).join("")}
    </g>`;
}

function titleMarkup(title, x = 285, y = 31, showRule = true) {
  return `
    <text class="voyager-live__text voyager-menu__title" x="${x}" y="${y}" text-anchor="middle">${escapeMarkup(title)}</text>
    ${showRule ? `<path class="voyager-menu__rule" d="M78 ${y + 10}H454" />` : ""}`;
}

function titleBandMarkup(title, { x, y, width, height = 36 } = {}) {
  return `
    <rect class="voyager-menu__title-band" x="${x}" y="${y}" width="${width}" height="${height}" />
    <text class="voyager-live__text voyager-live__text--inverse voyager-menu__title" x="${x + width / 2}" y="${y + 28}" text-anchor="middle">${escapeMarkup(title)}</text>`;
}

function panelFrameMarkup({ x = 39, y = 18, width = 426, height = 278 } = {}) {
  return `
    <rect class="voyager-menu__panel-shadow" x="${x + 6}" y="${y + 6}" width="${width}" height="${height}" />
    <rect class="voyager-menu__panel" x="${x}" y="${y}" width="${width}" height="${height}" />`;
}

function rowsMarkup(definition, {
  left = 70,
  top = 57,
  width = 376,
  lineHeight = 25,
  selectionLeft = left - 12,
  selectionWidth = width + 4,
  selectionHeight = 24,
  selectionOffset = 19,
} = {}) {
  let visualRow = 0;
  return definition.rows.map((row, sourceIndex) => {
    if (row.spacer) {
      visualRow += 0.62;
      return "";
    }
    const y = top + visualRow * lineHeight;
    const selected = sourceIndex === definition.selectedIndex;
    visualRow += 1;
    return `
      <g data-menu-row="${sourceIndex}">
        ${selected ? `<rect class="voyager-menu__selection" x="${selectionLeft}" y="${y - selectionOffset}" width="${selectionWidth}" height="${selectionHeight}" />` : ""}
        <text class="voyager-live__text voyager-menu__row${selected ? " voyager-live__text--inverse" : ""}" x="${left}" y="${y}">${escapeMarkup(row.label)}</text>
        ${row.value ? `<text class="voyager-live__text voyager-menu__row${selected ? " voyager-live__text--inverse" : ""}" x="${left + width}" y="${y}" text-anchor="end">${escapeMarkup(row.value)}</text>` : ""}
        ${row.meter ? `
          <rect class="voyager-menu__meter" x="${left + 202}" y="${y - 15}" width="${width - 205}" height="17" />
          <rect class="voyager-menu__meter-fill" x="${left + 204}" y="${y - 13}" width="${Math.round((width - 209) * row.meter)}" height="13" />` : ""}
      </g>`;
  }).join("");
}

function menuScreen(definition) {
  return `
    <rect class="voyager-live__surface" width="504" height="303" />
    ${sectionChrome(definition.section)}
    ${titleMarkup(definition.title, definition.titleX ?? 285, 31, definition.showTitleRule !== false)}
    ${rowsMarkup(definition, {
      left: 91,
      top: definition.rowTop ?? 67,
      width: 342,
      lineHeight: definition.rowSpacing ?? 25,
      selectionLeft: 68,
      selectionWidth: 436,
      selectionHeight: definition.rowSpacing ? 32 : 24,
      selectionOffset: definition.rowSpacing ? 24 : 19,
    })}`;
}

function panelScreen(definition) {
  const lineHeight = definition.compact ? 20 : 24;
  return `
    <rect class="voyager-live__surface" width="504" height="303" />
    ${sectionChrome(definition.section)}
    ${panelFrameMarkup()}
    ${titleBandMarkup(definition.title, { x: 48, y: 27, width: 408 })}
    ${rowsMarkup(definition, {
      left: 70,
      top: 89,
      width: 344,
      lineHeight,
      selectionLeft: 45,
      selectionWidth: 414,
    })}
    ${definition.note ? noteLines(definition.note, 254) : ""}`;
}

function modalFrame(definition, innerMarkup, { x = 77, y = 49, width = 350, height = 225 } = {}) {
  return `
    <g data-menu-overlay="${definition.id}" data-menu-parent="${definition.parentStateId ?? ""}">
    <rect class="voyager-menu__modal-shadow" x="${x + 6}" y="${y + 6}" width="${width}" height="${height}" />
    <rect class="voyager-menu__modal" x="${x}" y="${y}" width="${width}" height="${height}" />
    ${titleBandMarkup(definition.title, { x: x + 9, y: y + 9, width: width - 18 })}
    ${innerMarkup}
    </g>`;
}

function noteLines(lines, startY, className = "voyager-menu__note") {
  const normalized = Array.isArray(lines) ? lines : [lines];
  return normalized.filter(Boolean).map((line, index) =>
    `<text class="voyager-live__text ${className}" x="252" y="${startY + index * 20}" text-anchor="middle">${escapeMarkup(line)}</text>`,
  ).join("");
}

function pairedConfirmationButtons(y, selected = 0) {
  return `
    ${voyagerUiIcon(selected === 0 ? "btn-cancel-selected" : "btn-cancel-disabled", { x: 143, y: selected === 0 ? y : y + 11, width: 100, height: selected === 0 ? 42 : 32 })}
    ${voyagerUiIcon(selected === 1 ? "btn-ok-selected" : "btn-ok-disabled", { x: 263, y: selected === 1 ? y : y + 11, width: 100, height: selected === 1 ? 42 : 32 })}`;
}

function selectedOkButton(x, y) {
  return voyagerUiIcon("btn-ok-selected", { x, y, width: 100, height: 42 });
}

function confirmModal(definition) {
  const startY = definition.lines.length > 2 ? 124 : 136;
  return modalFrame(definition, `
    ${noteLines(definition.lines, startY, "voyager-menu__confirm-copy")}
    ${pairedConfirmationButtons(216, definition.selectedConfirmation)}`);
}

function noticeModal(definition) {
  return modalFrame(definition, `
    ${noteLines(definition.lines, 128, "voyager-menu__confirm-copy")}
    ${selectedOkButton(202, 219)}`);
}

function userLayoutModal(definition) {
  const slots = definition.options.map((option, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = 93 + column * 166;
    const y = 126 + row * 47;
    const selected = index === definition.selectedIndex;
    return `
      <g data-menu-layout-slot="${index}"${selected ? " data-menu-layout-slot-selected=\"true\"" : ""}>
        ${selected ? `<rect class="voyager-menu__selection" x="${x - 7}" y="${y - 23}" width="156" height="30" />` : ""}
        <text class="voyager-live__text voyager-menu__layout-label${selected ? " voyager-live__text--inverse" : ""}" x="${x}" y="${y}">${index + 1} · ${escapeMarkup(option)}</text>
      </g>`;
  }).join("");
  return modalFrame(definition, `
    ${slots}
    <text class="voyager-live__text voyager-menu__note" x="252" y="263" text-anchor="middle">SELECT A POSITION · ENTER TO CHANGE</text>`);
}

function settingsModal(definition) {
  const top = definition.summary ? 154 : 118;
  const lineHeight = definition.scroll ? 24 : 28;
  const visibleCount = definition.scroll ? 5 : definition.options.length;
  const maximumStart = Math.max(0, definition.options.length - visibleCount);
  const windowStart = definition.scroll
    ? Math.min(maximumStart, Math.max(0, definition.selectedIndex - 2))
    : 0;
  const visibleOptions = definition.options.slice(windowStart, windowStart + visibleCount);
  const options = visibleOptions.map((option, visibleIndex) => {
    const sourceIndex = windowStart + visibleIndex;
    const y = top + visibleIndex * lineHeight;
    const selected = sourceIndex === definition.selectedIndex;
    return `
      <g data-menu-option="${sourceIndex}"${selected ? " data-menu-option-selected=\"true\"" : ""}>
        ${selected ? `<rect class="voyager-menu__selection" x="83" y="${y - 20}" width="338" height="24" />` : ""}
        ${voyagerUiIcon(selected ? "radio-16pt-checked" : "radio-16pt-unchecked", {
          x: 113,
          y: y - 18,
          width: 18,
          height: 18,
          className: selected ? "voyager-ui-icon--inverse" : "",
        })}
        <text class="voyager-live__text voyager-menu__row voyager-menu__row--option${selected ? " voyager-live__text--inverse" : ""}" x="143" y="${y}">${escapeMarkup(option)}</text>
      </g>`;
  }).join("");
  const noteY = definition.scroll ? 251 : Math.min(250, top + visibleOptions.length * lineHeight + 18);
  const trackHeight = 116;
  const thumbHeight = definition.scroll
    ? Math.max(18, Math.round(trackHeight * visibleCount / definition.options.length))
    : trackHeight;
  const thumbTravel = trackHeight - thumbHeight - 6;
  const thumbY = 105 + (maximumStart ? Math.round(thumbTravel * windowStart / maximumStart) : 0);
  return modalFrame(definition, `
    ${definition.summary ? `
      <text class="voyager-live__text voyager-menu__summary" x="95" y="119">${escapeMarkup(definition.summary)}</text>
      <path class="voyager-menu__rule" d="M92 132H412" />
    ` : ""}
    ${options}
    ${definition.scroll ? `<rect class="voyager-menu__scroll-track" x="399" y="109" width="12" height="${trackHeight}" /><rect class="voyager-menu__scroll-thumb" x="401" y="${thumbY + 7}" width="8" height="${thumbHeight}" />` : ""}
    ${definition.note ? noteLines(definition.note, noteY) : ""}`);
}

function slotInputModal(definition) {
  const value = escapeMarkup(definition.value);
  return modalFrame(definition, `
    <text class="voyager-live__text voyager-menu__slot-value" x="252" y="151" text-anchor="middle">${value}</text>
    <path class="voyager-menu__slot-underline" d="M181 161H323" />
    <path class="voyager-menu__slot-cursor" d="M${214 + definition.activeDigit * 12} 117h18v43h-18Z" />
    ${definition.note ? noteLines(definition.note, 196) : ""}`);
}

function brightnessModal(definition) {
  const barWidth = 280;
  const fill = barWidth * definition.value / 100;
  return modalFrame(definition, `
    <rect class="voyager-menu__brightness-track" x="112" y="111" width="${barWidth}" height="43" />
    <rect class="voyager-menu__brightness-fill" x="115" y="114" width="${fill - 3}" height="37" />
    <line class="voyager-menu__brightness-thumb" x1="${112 + fill}" y1="111" x2="${112 + fill}" y2="154" />
    <text class="voyager-live__text voyager-menu__slot-value" x="252" y="222" text-anchor="middle">${definition.value}%</text>`);
}

function keyboardModal(definition) {
  return modalFrame(definition, `
    <rect class="voyager-menu__input" x="58" y="101" width="388" height="34" />
    <text class="voyager-live__text voyager-menu__keyboard-value" x="70" y="125">${escapeMarkup(definition.value)}|</text>
    <text class="voyager-live__text voyager-menu__keyboard" x="68" y="162">1 2 3 4 5 6 7 8 9 0 - +</text>
    <text class="voyager-live__text voyager-menu__keyboard" x="68" y="184">Q W E R T Y U I O P ! °</text>
    <text class="voyager-live__text voyager-menu__keyboard" x="68" y="206">A S D F G H J K L : “ ’</text>
    <text class="voyager-live__text voyager-menu__keyboard" x="68" y="228">Z X C V B N M _</text>
    <text class="voyager-live__text voyager-menu__note" x="421" y="228" text-anchor="end">${escapeMarkup(definition.keyboardKey)}</text>
    ${voyagerUiIcon("keyboard-16pt-backspace", { x: 248, y: 210, width: 24, height: 20 })}
    ${voyagerUiIcon("keyboard-16pt-delete", { x: 278, y: 210, width: 29, height: 20 })}
    ${voyagerUiIcon("keyboard-16pt-back", { x: 313, y: 210, width: 23, height: 20 })}
    ${voyagerUiIcon("keyboard-16pt-forward", { x: 342, y: 210, width: 23, height: 20 })}
    ${voyagerUiIcon("keyboard-16pt-checkmark", { x: 371, y: 210, width: 23, height: 20 })}
    ${voyagerUiIcon("keyboard-16pt-space", { x: 400, y: 210, width: 23, height: 20 })}
    ${pairedConfirmationButtons(236)}`, { x: 39, y: 39, width: 426, height: 250 });
}

function waypointMapModal(definition) {
  const confirm = definition.mode.includes("confirm");
  const crosshair = definition.mode === "crosshair";
  return `
    <rect class="voyager-live__surface" width="504" height="303" />
    ${sectionChrome(definition.section)}
    ${panelFrameMarkup()}
    ${titleBandMarkup(definition.title, { x: 48, y: 27, width: 408 })}
    <clipPath id="voyager-menu-map-clip"><rect x="60" y="66" width="384" height="168" /></clipPath>
    <g clip-path="url(#voyager-menu-map-clip)">
      <path class="voyager-menu__map-route" data-menu-route />
      <path class="voyager-menu__map-recorded" data-menu-recorded />
      <g data-menu-waypoints></g>
      <path class="voyager-menu__map-position" data-menu-position d="M0-10 8 9 0 4-8 9Z" />
      <g data-menu-pending-waypoint></g>
    </g>
    ${crosshair ? voyagerUiIcon("crosshair-center", { x: 232, y: 127, width: 40, height: 40 }) : ""}
    ${confirm ? `
      ${pairedConfirmationButtons(246)}` : `
      <text class="voyager-live__text voyager-menu__note" x="252" y="271" text-anchor="middle">${definition.mode === "select-delete" ? "SELECT WAYPOINT · ENTER TO DELETE" : crosshair ? "MOVE CROSSHAIRS · ENTER TO CONFIRM" : "SELECT WAYPOINT · ENTER TO CONFIRM"}</text>`}`;
}

export function renderVoyagerMenuMarkup(definition, { underlayMarkup = "" } = {}) {
  const renderers = {
    menu: menuScreen,
    panel: panelScreen,
    confirm: confirmModal,
    notice: noticeModal,
    "settings-modal": settingsModal,
    "slot-input": slotInputModal,
    "user-layout": userLayoutModal,
    brightness: brightnessModal,
    keyboard: keyboardModal,
    "waypoint-map": waypointMapModal,
  };
  const markup = renderers[definition.kind](definition);
  if (definition.presentation !== "overlay") return markup;
  const underlay = underlayMarkup
    || `<rect class="voyager-live__surface" width="504" height="303" />${sectionChrome(definition.section)}`;
  return `${underlay}<rect class="voyager-menu__underlay-wash" width="504" height="303" />${markup}`;
}

export function voyagerMenuAriaLabel(definition) {
  return `Live Voyager ${definition.title.toLowerCase()} ${definition.kind.replaceAll("-", " ")}`;
}
