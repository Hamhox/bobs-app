import { voyagerUiIcon } from "./voyager-ui-icons.js";
import { VOYAGER_KEYBOARD_ROWS } from "./voyager-menu-model.js";

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

function titleBandMarkup(title, { x, y, width, height = 36, titleClassName = "" } = {}) {
  return `
    <rect class="voyager-menu__title-band" x="${x}" y="${y}" width="${width}" height="${height}" />
    <text class="voyager-live__text voyager-live__text--inverse voyager-menu__title${titleClassName ? ` ${titleClassName}` : ""}" x="${x + width / 2}" y="${y + 28}" text-anchor="middle">${escapeMarkup(title)}</text>`;
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
    const active = selected && !row.disabled;
    const rowClass = `voyager-live__text voyager-menu__row${active ? " voyager-live__text--inverse" : ""}${row.disabled ? " voyager-menu__row--disabled" : ""}`;
    visualRow += 1;
    return `
      <g data-menu-row="${sourceIndex}"${row.disabled ? " data-menu-row-disabled=\"true\" aria-disabled=\"true\"" : ""}>
        ${active ? `<rect class="voyager-menu__selection" x="${selectionLeft}" y="${y - selectionOffset}" width="${selectionWidth}" height="${selectionHeight}" />` : ""}
        <text class="${rowClass}" x="${left}" y="${y}">${escapeMarkup(row.label)}</text>
        ${row.value ? `<text class="${rowClass}" x="${left + (row.meter ? 202 : width)}" y="${y}" text-anchor="end">${escapeMarkup(row.value)}</text>` : ""}
        ${row.submenu ? `<text class="${rowClass}" x="${left + width}" y="${y}" text-anchor="end">&gt;</text>` : ""}
        ${row.meter ? `
          <rect class="voyager-menu__meter" x="${left + 216}" y="${y - 15}" width="${width - 219}" height="17" />
          <rect class="voyager-menu__meter-fill" x="${left + 218}" y="${y - 13}" width="${Math.round((width - 223) * row.meter)}" height="13" />` : ""}
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
  const lineHeight = definition.rowSpacing ?? (definition.compact ? 20 : 24);
  return `
    <rect class="voyager-live__surface" width="504" height="303" />
    ${sectionChrome(definition.section)}
    ${panelFrameMarkup()}
    ${titleBandMarkup(definition.title, { x: 48, y: 27, width: 408 })}
    ${rowsMarkup(definition, {
      left: 70,
      top: definition.rowTop ?? 89,
      width: 344,
      lineHeight,
      selectionLeft: 45,
      selectionWidth: 414,
    })}
    ${definition.note ? noteLines(definition.note, 254) : ""}`;
}

function memoryScreen(definition) {
  return `
    <rect class="voyager-live__surface" width="504" height="303" />
    ${sectionChrome(definition.section)}
    ${panelFrameMarkup({ x: 55, y: 18, width: 400, height: 267 })}
    ${titleBandMarkup(definition.title, { x: 64, y: 27, width: 382 })}
    ${rowsMarkup(definition, {
      left: 70,
      top: 89,
      width: 366,
      lineHeight: 20,
      selectionLeft: 62,
      selectionWidth: 386,
    })}`;
}

function modalFrame(definition, innerMarkup, { x = 77, y = 49, width = 350, height = 225 } = {}) {
  const modifier = definition.dataBlockPicker
    ? " voyager-menu__overlay--data-picker"
    : definition.destinationWaypointPicker
      ? " voyager-menu__overlay--destination-waypoint"
      : ` voyager-menu__overlay--${definition.kind}`;
  return `
    <g class="voyager-menu__overlay${modifier}" data-menu-overlay="${definition.id}" data-menu-parent="${definition.parentStateId ?? ""}">
    <rect class="voyager-menu__modal-shadow" x="${x + 6}" y="${y + 6}" width="${width}" height="${height}" />
    <rect class="voyager-menu__modal" x="${x}" y="${y}" width="${width}" height="${height}" />
    ${titleBandMarkup(definition.title, {
    x: x + 9,
    y: y + 9,
    width: width - 18,
    titleClassName: definition.titleNarrow ? "voyager-menu__title--narrow" : "",
  })}
    ${innerMarkup}
    </g>`;
}

function noteLines(lines, startY, className = "voyager-menu__note") {
  const normalized = Array.isArray(lines) ? lines : [lines];
  return normalized.filter(Boolean).map((line, index) =>
    `<text class="voyager-live__text ${className}" x="252" y="${startY + index * 20}" text-anchor="middle">${escapeMarkup(line)}</text>`,
  ).join("");
}

export function renderVoyagerToastMarkup(message) {
  const lines = (Array.isArray(message) ? message : [message]).map((line) => String(line ?? "")).filter(Boolean);
  const width = lines.length > 1 ? 300 : 238;
  const height = 58 + Math.max(0, lines.length - 1) * 24;
  const x = Math.floor((504 - width) / 2);
  const y = Math.floor((303 - height) / 2);
  return `
    <g class="voyager-menu__toast" data-live-toast data-live-toast-message="${escapeMarkup(lines.join(" / "))}">
      <rect class="voyager-menu__modal-shadow" x="${x + 6}" y="${y + 6}" width="${width}" height="${height}" />
      <rect class="voyager-menu__modal" x="${x}" y="${y}" width="${width}" height="${height}" />
      ${lines.map((line, index) => `<text class="voyager-live__text voyager-menu__toast-copy" x="252" y="${y + 36 + index * 24}" text-anchor="middle">${escapeMarkup(line)}</text>`).join("")}
    </g>`;
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

function progressModal(definition) {
  const progress = Math.max(0, Math.min(1, Number(definition.progress) || 0));
  return modalFrame(definition, `
    ${noteLines(definition.lines, 126, "voyager-menu__confirm-copy")}
    <rect class="voyager-menu__progress-track" x="116" y="158" width="272" height="27" />
    <rect class="voyager-menu__progress-fill" x="120" y="162" width="${Math.round(264 * progress)}" height="19" />
    <text class="voyager-live__text voyager-menu__note" x="252" y="226" text-anchor="middle">ENTER: COMPLETE · BACK: CANCEL</text>`);
}

function compactUserLayoutLabel(option) {
  return option
    .replace("CURRENT (BATTERY CHARGER)", "CHARGER CURRENT")
    .replace("INTERNAL BATTERY VOLTAGE", "INT BATTERY V")
    .replace("MAX ENGINE TEMPERATURE", "MAX ENG TEMP")
    .replace("AVG ENGINE TEMPERATURE", "AVG ENG TEMP")
    .replace("ENGINE TEMPERATURE", "ENG TEMP")
    .replace("ENGINE ACC. RUN TIME", "ENG RUN TIME")
    .replace("GPS ACC. RUN TIME", "GPS RUN TIME")
    .replace("COMPASS DIRECTION", "COMPASS DIR")
    .replace("WHEEL ODOMETER", "WHEEL ODO")
    .replace("GPS ODOMETER", "GPS ODO")
    .replace("WHEEL DISTANCE", "WHEEL DST")
    .replace("GPS DISTANCE", "GPS DST")
    .replace("WHEEL SPEED", "WHEEL SPD")
    .replace("GPS SPEED", "GPS SPD")
    .replace("ENGINE TRIP TIME", "ENG TRIP TIME");
}

function userLayoutModal(definition) {
  const slots = definition.options.map((option, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const cellX = 72 + column * 181;
    const y = 142 + row * 37;
    const selected = index + 1 === definition.selectedIndex;
    const label = compactUserLayoutLabel(option);
    return `
      <g data-menu-layout-slot="${index}"${selected ? " data-menu-layout-slot-selected=\"true\"" : ""}>
        ${selected ? `<rect class="voyager-menu__selection voyager-menu__layout-selection" x="${cellX}" y="${y - 25}" width="177" height="32" />` : ""}
        <rect class="voyager-menu__layout-number${selected ? " voyager-menu__layout-number--selected" : ""}" x="${cellX + 7}" y="${y - 20}" width="18" height="18" />
        <text class="voyager-live__text voyager-menu__layout-index${selected ? "" : " voyager-live__text--inverse"}" x="${cellX + 16}" y="${y - 5}" text-anchor="middle">${index + 1}</text>
        <text class="voyager-live__text voyager-menu__layout-label${selected ? " voyager-live__text--inverse" : ""}" x="${cellX + 32}" y="${y - 4}">${escapeMarkup(label)}</text>
      </g>`;
  }).join("");
  const nameSelected = definition.selectedIndex === 0;
  const confirmationSelection = definition.selectedIndex >= 7 ? definition.selectedIndex - 7 : -1;
  return modalFrame(definition, `
    <rect class="voyager-menu__layout-name-field${nameSelected ? " voyager-menu__layout-name-field--selected" : ""}" x="72" y="79" width="356" height="31" />
    <text class="voyager-live__text voyager-menu__layout-name${nameSelected ? " voyager-live__text--inverse" : ""}" x="250" y="101" text-anchor="middle">${escapeMarkup(definition.name)}</text>
    <path class="voyager-menu__layout-divider" d="M252 118V222" />
    ${slots}
    <path class="voyager-menu__layout-footer-rule" d="M72 226H432" />
    ${pairedConfirmationButtons(239, confirmationSelection)}`, {
    x: 58,
    y: 28,
    width: 388,
    height: 266,
  });
}

function settingsModal(definition) {
  const dataBlockPicker = definition.dataBlockPicker === true;
  const destinationWaypointPicker = definition.destinationWaypointPicker === true;
  const top = dataBlockPicker ? 110 : destinationWaypointPicker ? 122 : definition.summary ? 154 : 118;
  const lineHeight = dataBlockPicker ? 21 : destinationWaypointPicker ? 32 : definition.scroll ? 24 : 28;
  const visibleCount = dataBlockPicker ? 7 : definition.scroll ? 5 : definition.options.length;
  const maximumStart = Math.max(0, definition.options.length - visibleCount);
  const windowStart = definition.scroll
    ? Math.min(maximumStart, Math.max(0, definition.selectedIndex - 2))
    : 0;
  const visibleOptions = definition.options.slice(windowStart, windowStart + visibleCount);
  const options = visibleOptions.map((option, visibleIndex) => {
    const sourceIndex = windowStart + visibleIndex;
    const groupOffset = (definition.optionGroupBreaks ?? [])
      .filter((breakBeforeIndex) => sourceIndex >= breakBeforeIndex)
      .length * 10;
    const y = top + visibleIndex * lineHeight + groupOffset;
    const selected = sourceIndex === definition.selectedIndex;
    const selectionX = dataBlockPicker ? 73 : 83;
    const selectionWidth = dataBlockPicker ? 354 : 338;
    const radioX = dataBlockPicker ? 85 : 113;
    const labelX = dataBlockPicker ? 111 : 143;
    const selectionY = dataBlockPicker ? y - 18 : y - 20;
    const selectionHeight = dataBlockPicker ? 21 : 24;
    const radioY = dataBlockPicker ? y - 17 : y - 18;
    const radioSize = dataBlockPicker ? 17 : 18;
    if (definition.optionLabels) {
      return `
        <g data-menu-option="${sourceIndex}"${selected ? " data-menu-option-selected=\"true\"" : ""}>
          ${selected ? `<rect class="voyager-menu__selection" x="83" y="${selectionY}" width="338" height="${selectionHeight}" />` : ""}
          <text class="voyager-live__text voyager-menu__row${selected ? " voyager-live__text--inverse" : ""}" x="101" y="${y}">${escapeMarkup(definition.optionLabels[sourceIndex])}</text>
          <text class="voyager-live__text voyager-menu__row${selected ? " voyager-live__text--inverse" : ""}" x="404" y="${y}" text-anchor="end">${escapeMarkup(option)}</text>
        </g>`;
    }
    if (destinationWaypointPicker) {
      const waypoint = definition.waypointOptions?.[sourceIndex];
      const waypointDigit = waypoint?.label ?? String(sourceIndex + 1);
      return `
        <g data-menu-option="${sourceIndex}" data-menu-waypoint-name="${escapeMarkup(option)}"${selected ? " data-menu-option-selected=\"true\"" : ""}>
          ${selected ? `<rect class="voyager-menu__selection" x="73" y="${y - 23}" width="358" height="29" />` : ""}
          ${voyagerUiIcon("circle-digit-black", {
      x: 101,
      y: y - 22,
      width: 40,
      height: 27,
      className: selected ? "voyager-ui-icon--inverse" : "",
    })}
          <text class="voyager-live__text voyager-menu__waypoint-digit${selected ? "" : " voyager-live__text--inverse"}" x="121" y="${y - 3}" text-anchor="middle">${escapeMarkup(waypointDigit)}</text>
          <text class="voyager-live__text voyager-menu__row voyager-menu__row--option${selected ? " voyager-live__text--inverse" : ""}" x="153" y="${y}">${escapeMarkup(option)}</text>
        </g>`;
    }
    return `
      <g data-menu-option="${sourceIndex}"${selected ? " data-menu-option-selected=\"true\"" : ""}>
        ${selected ? `<rect class="voyager-menu__selection" x="${selectionX}" y="${selectionY}" width="${selectionWidth}" height="${selectionHeight}" />` : ""}
        ${voyagerUiIcon(selected ? "radio-16pt-checked" : "radio-16pt-unchecked", {
          x: radioX,
          y: radioY,
          width: radioSize,
          height: radioSize,
          className: selected ? "voyager-ui-icon--inverse" : "",
        })}
        <text class="voyager-live__text voyager-menu__row voyager-menu__row--option${selected ? " voyager-live__text--inverse" : ""}" x="${labelX}" y="${y}">${escapeMarkup(option)}</text>
      </g>`;
  }).join("");
  const noteY = definition.scroll ? 251 : Math.min(250, top + visibleOptions.length * lineHeight + 18);
  const trackHeight = dataBlockPicker ? 145 : 116;
  const thumbHeight = definition.scroll
    ? Math.max(18, Math.round(trackHeight * visibleCount / definition.options.length))
    : trackHeight;
  const thumbTravel = trackHeight - thumbHeight - 6;
  const trackY = dataBlockPicker ? 101 : 109;
  const trackX = dataBlockPicker ? 415 : 399;
  const thumbOffset = maximumStart ? Math.round(thumbTravel * windowStart / maximumStart) : 0;
  const thumbY = trackY + 3 + thumbOffset;
  return modalFrame(definition, `
    ${definition.summary ? `
      <text class="voyager-live__text voyager-menu__summary" x="95" y="119">${escapeMarkup(definition.summary)}</text>
      <path class="voyager-menu__rule" d="M92 132H412" />
    ` : ""}
    ${options}
    ${definition.scroll ? `<rect class="voyager-menu__scroll-track" x="${trackX}" y="${trackY}" width="12" height="${trackHeight}" /><rect class="voyager-menu__scroll-thumb" x="${trackX + 2}" y="${thumbY}" width="8" height="${thumbHeight}" />` : ""}
    ${definition.note ? noteLines(definition.note, noteY) : ""}`, dataBlockPicker ? {
    x: 64,
    y: 38,
    width: 376,
    height: 238,
  } : destinationWaypointPicker ? {
    x: 67,
    y: 49,
    width: 370,
    height: 225,
  } : undefined);
}

function checklistModal(definition) {
  const options = definition.options.map((option, index) => {
    const y = 119 + index * 31;
    const selected = index === definition.selectedIndex;
    const checked = definition.checkedOptions.includes(index);
    return `
      <g data-menu-option="${index}"${selected ? " data-menu-option-selected=\"true\"" : ""}>
        ${selected ? `<rect class="voyager-menu__selection" x="82" y="${y - 21}" width="340" height="27" />` : ""}
        <rect class="voyager-menu__checkbox${selected ? " voyager-menu__checkbox--selected" : ""}" x="104" y="${y - 18}" width="18" height="18" />
        ${checked ? `<path class="voyager-menu__checkmark${selected ? " voyager-menu__checkmark--selected" : ""}" d="M108 ${y - 9}l4 4 8-10" />` : ""}
        <text class="voyager-live__text voyager-menu__row voyager-menu__row--option${selected ? " voyager-live__text--inverse" : ""}" x="139" y="${y}">${escapeMarkup(option)}</text>
      </g>`;
  }).join("");
  return modalFrame(definition, `${options}${noteLines("ENTER: TOGGLE · BACK: SAVE", 253)}`);
}

function slotInputTokens(definition) {
  const characters = [...String(definition.value)];
  const tokens = [];
  let slotIndex = 0;
  for (let index = 0; index < characters.length;) {
    const timeSuffix = definition.slotType === "time"
      ? characters.slice(index).join("").match(/^\s(AM|PM)$/)
      : null;
    if (timeSuffix) {
      tokens.push({ text: "", width: 14, kind: "space" });
      tokens.push({ text: timeSuffix[1], width: 56, kind: "meridiem", slotIndex });
      slotIndex += 1;
      break;
    }
    if (/\d/.test(characters[index])) {
      tokens.push({ text: characters[index], width: 31, kind: "digit", slotIndex });
      slotIndex += 1;
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < characters.length && !/\d/.test(characters[end])) {
      if (definition.slotType === "time" && /^\s(?:AM|PM)$/.test(characters.slice(end).join(""))) break;
      end += 1;
    }
    const text = characters.slice(index, end).join("");
    const punctuation = /^[.:]+$/.test(text);
    tokens.push({ text, width: punctuation ? text.length * 18 : text.length * 23, kind: "affix" });
    index = end;
  }
  return tokens;
}

function slotInputModal(definition) {
  const tokens = slotInputTokens(definition);
  const totalWidth = tokens.reduce((sum, token) => sum + token.width, 0);
  let tokenX = 252 - totalWidth / 2;
  const value = tokens.map((token) => {
    const x = tokenX;
    tokenX += token.width;
    if (token.kind === "space") return "";
    const selected = token.slotIndex === definition.activeDigit;
    const editable = token.slotIndex !== undefined;
    const className = token.kind === "digit"
      ? "voyager-menu__slot-value"
      : token.kind === "meridiem" ? "voyager-menu__slot-meridiem" : "voyager-menu__slot-affix";
    return `
      <g${editable ? ` data-menu-slot="${token.slotIndex}"` : ""}${selected ? " data-menu-slot-selected=\"true\"" : ""}>
        ${selected ? `<rect class="voyager-menu__slot-selection" x="${x - 2}" y="107" width="${token.width + 4}" height="54" />` : ""}
        <text class="voyager-live__text ${className}${selected ? " voyager-live__text--inverse" : ""}" x="${x + token.width / 2}" y="151" text-anchor="middle">${escapeMarkup(token.text)}</text>
        ${editable ? `<path class="voyager-menu__slot-underline" d="M${x + 3} 163H${x + token.width - 3}" />` : ""}
      </g>`;
  }).join("");
  return modalFrame(definition, `
    ${value}
    ${definition.note ? noteLines(definition.note, 188) : ""}
    ${noteLines("L/R: DIGIT · U/D: VALUE · ENTER: SAVE", definition.note ? 254 : 218, "voyager-menu__slot-help")}`);
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

function toastModal(definition) {
  return `
    <g data-menu-overlay="${definition.id}" data-menu-parent="${definition.parentStateId ?? ""}">
      ${renderVoyagerToastMarkup(definition.message ?? definition.title)}
    </g>`;
}

const KEYBOARD_ICON_MAP = Object.freeze({
  BACKSPACE: { id: "keyboard-16pt-backspace", width: 24 },
  SPACE: { id: "keyboard-16pt-space", width: 24 },
  BACK: { id: "keyboard-16pt-back", width: 23 },
  FORWARD: { id: "keyboard-16pt-forward", width: 23 },
  DELETE: { id: "keyboard-16pt-delete", width: 27 },
});

function keyboardKeyMarkup(key, row, column, selected) {
  const x = 72 + column * 30;
  const y = 157 + row * 24;
  const icon = KEYBOARD_ICON_MAP[key];
  return `
    <g data-menu-key="${escapeMarkup(key)}"${selected ? " data-menu-key-selected=\"true\"" : ""}>
      ${selected ? `<rect class="voyager-menu__keyboard-key-selection" x="${x - 13}" y="${y - 19}" width="26" height="22" />` : ""}
      ${icon
    ? voyagerUiIcon(icon.id, {
      x: x - icon.width / 2,
      y: y - 18,
      width: icon.width,
      height: 20,
      className: selected ? "voyager-menu__keyboard-icon--selected" : "",
    })
    : `<text class="voyager-live__text voyager-menu__keyboard-key${selected ? " voyager-menu__keyboard-key--selected" : ""}" x="${x}" y="${y}" text-anchor="middle">${escapeMarkup(key)}</text>`}
    </g>`;
}

function keyboardModal(definition) {
  const valueCharacters = [...String(definition.value)];
  const cursor = Math.min(valueCharacters.length, Math.max(0, definition.keyboardCursor ?? valueCharacters.length));
  valueCharacters.splice(cursor, 0, "|");
  const keys = VOYAGER_KEYBOARD_ROWS.map((row, rowIndex) => row.map((key, columnIndex) => {
    const keyboardIndex = rowIndex * row.length + columnIndex;
    const keyboardHasFocus = (definition.selectedConfirmation ?? -1) < 0;
    return keyboardKeyMarkup(key, rowIndex, columnIndex, keyboardHasFocus && keyboardIndex === definition.keyboardIndex);
  }).join("")).join("");
  return modalFrame(definition, `
    <g transform="translate(0 -21)">
      <rect class="voyager-menu__input" x="58" y="101" width="388" height="34" />
      <text class="voyager-live__text voyager-menu__keyboard-value" x="70" y="125">${escapeMarkup(valueCharacters.join(""))}</text>
      ${keys}
      ${pairedConfirmationButtons(247, definition.selectedConfirmation ?? -1)}
    </g>`, { x: 39, y: 18, width: 426, height: 267 });
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
    memory: memoryScreen,
    confirm: confirmModal,
    notice: noticeModal,
    progress: progressModal,
    "settings-modal": settingsModal,
    "checklist-modal": checklistModal,
    "slot-input": slotInputModal,
    toast: toastModal,
    "user-layout": userLayoutModal,
    brightness: brightnessModal,
    keyboard: keyboardModal,
    "waypoint-map": waypointMapModal,
  };
  const markup = renderers[definition.kind](definition);
  if (definition.presentation !== "overlay") return markup;
  const underlay = underlayMarkup
    || `<rect class="voyager-live__surface" width="504" height="303" />${sectionChrome(definition.section)}`;
  if (definition.kind === "toast") return `${underlay}${markup}`;
  return `${underlay}<rect class="voyager-menu__underlay-wash" width="504" height="303" />${markup}`;
}

export function voyagerMenuAriaLabel(definition) {
  return `Live Voyager ${definition.title.toLowerCase()} ${definition.kind.replaceAll("-", " ")}`;
}
