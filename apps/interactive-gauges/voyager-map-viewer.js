const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const IMAGE_WIDTH = 4195.24;
const IMAGE_HEIGHT = 6483.58;
const PRESETS = {
  overview: { groupId: "regions", label: "Overview" },
  "screen-layout": { groupId: "screen-layout-screens", label: "Screen layout" },
  "menu-screens": { groupId: "menu-screens", label: "Menu screens" },
  "menu-flow": { groupId: "flowchart-screens", label: "Menu flow" },
};

const SCREEN_LAYOUT_STATE_MAP = {
  "satellite-screen-2": "sat1-2",
  "satellite-screen": "sat",
  "nav-full-2": "dir3",
  "nav-full": "dir1-2",
  "nav-2": "dir2",
  nav: "dir",
  "user-screen-2-2": "cstm2-2",
  "user-screen-2": "cstm2",
  "user-screen-1-2": "cstm1-2",
  "user-screen-1": "cstm",
  "altitude-full-2": "alt1-2",
  "altitude-full": "alt",
  "altitude-2": "alt2",
  altitude: "alt3",
  "engine-temp-full-2": "eng1-2",
  "engine-temp-full": "eng",
  "engine-temp-2": "eng2",
  "engine-temp": "eng3",
  "map-3-2": "map3-2",
  "map-3": "map3",
  "map-2-2": "map2-2",
  "map-2": "map2",
  "map-1-2": "map1-2",
  "map-1": "map",
  "main-2-2": "index2-2",
  "main-2": "index2",
  "main-1-2": "index1-2",
  "main-1": "index",
};

const MENU_GROUP_STATE_OVERRIDES = {
  "set3-3-9": "m-set3-3-8",
  "set3-5-1-2-3": "m-set3-5-1-2-1",
  "set3-5-1-3-2": "m-set3-5-1-3-1",
};

const FLOWCHART_CONTAINER_IDS = new Set([
  "set",
  "settings-menu",
  "user-screens",
  "unit-settings",
  "warning-led-lights",
  "gps-settings",
  "system-settings",
  "ride",
  "main",
  "main-options",
  "waypoints",
]);

export class VoyagerMapViewer {
  #dialog;
  #viewport;
  #image;
  #status;
  #source;
  #scale = 1;
  #x = 0;
  #y = 0;
  #pointers = new Map();
  #gesture = null;
  #resizeObserver;
  #activePreset = "overview";
  #pageLock = null;
  #mapRoot = null;
  #loadPromise = null;
  #manifest = null;
  #onOpenState = null;
  #screenTargets = [];
  #selectedScreen = null;
  #selectionHighlight = null;
  #dragStart = null;
  #dragMoved = false;
  #selection;

  constructor({ dialog, viewport, image, status, source }) {
    this.#dialog = dialog;
    this.#viewport = viewport;
    this.#image = image;
    this.#status = status;
    this.#source = source;
    this.#selection = {
      panel: this.#dialog.querySelector("#system-map-selection"),
      idLabel: this.#dialog.querySelector("#system-map-selection-id-label"),
      id: this.#dialog.querySelector("#system-map-selection-id"),
      status: this.#dialog.querySelector("#system-map-selection-status"),
      group: this.#dialog.querySelector("#system-map-selection-group"),
      openButton: this.#dialog.querySelector("#open-selected-map-screen"),
    };
    this.#resizeObserver = new ResizeObserver(() => {
      if (this.#dialog.open && this.#activePreset !== "custom") {
        this.showPreset(this.#activePreset);
      }
    });
    this.#bindEvents();
  }

  connectPrototype(manifest, onOpenState) {
    this.#manifest = manifest;
    this.#onOpenState = onOpenState;
    if (this.#mapRoot) this.#prepareScreenTargets();
  }

  open(preset = "overview") {
    this.#clearSelection();
    this.#lockPageScroll();
    this.#dialog.showModal();
    this.#resizeObserver.observe(this.#viewport);
    this.#ensureMap().then((map) => {
      if (map && this.#dialog.open) window.requestAnimationFrame(() => this.showPreset(preset));
    });
    this.#viewport.focus({ preventScroll: true });
  }

  close() {
    this.#resizeObserver.disconnect();
    this.#clearSelection();
    if (this.#dialog.open) this.#dialog.close();
    this.#restorePageScroll();
  }

  showPreset(preset) {
    this.#clearSelection();
    const viewport = this.#viewport.getBoundingClientRect();
    const presetName = PRESETS[preset] ? preset : "overview";
    const target = PRESETS[presetName];
    const bounds = this.#getGroupBounds(target.groupId);
    const horizontalScale = (viewport.width * 0.9) / bounds.width;
    const verticalScale = (viewport.height * 0.86) / bounds.height;
    this.#scale = clamp(Math.min(horizontalScale, verticalScale), 0.06, 2.5);
    this.#x = viewport.width / 2 - (bounds.x + bounds.width / 2) * this.#scale;
    this.#y = viewport.height / 2 - (bounds.y + bounds.height / 2) * this.#scale;
    this.#activePreset = presetName;
    this.#render(target.label);
  }

  zoomBy(factor, originX, originY) {
    const bounds = this.#viewport.getBoundingClientRect();
    const px = originX ?? bounds.width / 2;
    const py = originY ?? bounds.height / 2;
    const nextScale = clamp(this.#scale * factor, 0.06, 2.5);
    const imageX = (px - this.#x) / this.#scale;
    const imageY = (py - this.#y) / this.#scale;
    this.#x = px - imageX * nextScale;
    this.#y = py - imageY * nextScale;
    this.#scale = nextScale;
    this.#activePreset = "custom";
    this.#render();
  }

  panBy(deltaX, deltaY) {
    this.#x += deltaX;
    this.#y += deltaY;
    this.#activePreset = "custom";
    this.#render();
  }

  #getGroupBounds(groupOrId) {
    const group =
      typeof groupOrId === "string"
        ? this.#mapRoot?.querySelector(`[id="${groupOrId}"]`)
        : groupOrId;
    if (!group || typeof group.getBBox !== "function") {
      return { x: 0, y: 0, width: IMAGE_WIDTH, height: IMAGE_HEIGHT };
    }

    const box = group.getBBox();
    const matrix = group.getCTM();
    if (!matrix) return box;

    const Point = group.ownerDocument.defaultView.DOMPoint;
    const corners = [
      new Point(box.x, box.y),
      new Point(box.x + box.width, box.y),
      new Point(box.x, box.y + box.height),
      new Point(box.x + box.width, box.y + box.height),
    ].map((point) => point.matrixTransform(matrix));
    const xValues = corners.map((point) => point.x);
    const yValues = corners.map((point) => point.y);
    const x = Math.min(...xValues);
    const y = Math.min(...yValues);
    return {
      x,
      y,
      width: Math.max(...xValues) - x,
      height: Math.max(...yValues) - y,
    };
  }

  #prepareScreenTargets() {
    if (!this.#mapRoot || !this.#manifest) return;

    for (const target of this.#screenTargets) {
      target.group.removeAttribute("data-map-screen");
      target.group.removeAttribute("data-map-state-id");
      target.group.removeAttribute("role");
      target.group.removeAttribute("tabindex");
      target.group.removeAttribute("aria-label");
    }
    this.#screenTargets = [];

    const layout = this.#mapRoot.querySelector("#screen-layout-screens");
    for (const group of [...(layout?.children ?? [])].filter((element) => element.matches("g[id]"))) {
      this.#registerScreen(group, SCREEN_LAYOUT_STATE_MAP[group.id]);
    }

    const menu = this.#mapRoot.querySelector("#menu-screens");
    for (const group of [...(menu?.children ?? [])].filter((element) => element.matches("g[id]"))) {
      const stateId = MENU_GROUP_STATE_OVERRIDES[group.id] ?? `m-${group.id}`;
      this.#registerScreen(group, stateId);
    }

    const flow = this.#mapRoot.querySelector("#flowchart-screens");
    for (const group of flow?.querySelectorAll("g[id]") ?? []) {
      if (!FLOWCHART_CONTAINER_IDS.has(group.id)) this.#registerScreen(group);
    }

    if (this.#screenTargets[0]) this.#screenTargets[0].group.setAttribute("tabindex", "0");
  }

  #registerScreen(group, stateId = null) {
    const state = stateId ? this.#manifest.states[stateId] ?? null : null;
    const target = { group, groupId: group.id, state };
    group.dataset.mapScreen = "true";
    if (state) group.dataset.mapStateId = state.id;
    group.setAttribute("role", "button");
    group.setAttribute("tabindex", "-1");
    group.setAttribute(
      "aria-label",
      state
        ? `${state.id}, connected prototype state`
        : `${group.id}, design only screen`,
    );
    this.#screenTargets.push(target);
  }

  #selectScreen(group, focus = true) {
    const target = this.#screenTargets.find((screen) => screen.group === group);
    if (!target) return;

    if (this.#selectedScreen) {
      this.#selectedScreen.group.removeAttribute("data-map-selected");
      this.#selectedScreen.group.setAttribute("tabindex", "-1");
    }
    this.#selectedScreen = target;
    target.group.dataset.mapSelected = "true";
    target.group.setAttribute("tabindex", "0");
    if (focus) target.group.focus({ preventScroll: true });

    const bounds = this.#getGroupBounds(target.group);
    const padding = Math.max(6, Math.min(bounds.width, bounds.height) * 0.06);
    this.#selectionHighlight?.remove();
    this.#selectionHighlight = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    this.#selectionHighlight.setAttribute("class", "system-map-screen-highlight");
    this.#selectionHighlight.setAttribute("x", String(bounds.x - padding));
    this.#selectionHighlight.setAttribute("y", String(bounds.y - padding));
    this.#selectionHighlight.setAttribute("width", String(bounds.width + padding * 2));
    this.#selectionHighlight.setAttribute("height", String(bounds.height + padding * 2));
    this.#selectionHighlight.setAttribute("rx", String(padding));
    this.#mapRoot.append(this.#selectionHighlight);

    this.#frameScreen(bounds);
    const selectionId = target.state?.id ?? target.groupId;
    this.#selection.panel.hidden = false;
    this.#selection.idLabel.textContent = target.state ? "State ID" : "Screen ID";
    this.#selection.id.textContent = selectionId;
    this.#selection.status.textContent = target.state ? "Connected Prototype State" : "Design Only";
    this.#selection.status.dataset.kind = target.state ? "connected" : "design";
    this.#selection.group.textContent = `SVG group: ${target.groupId}`;
    this.#selection.openButton.hidden = !target.state;
    this.#selection.openButton.dataset.stateId = target.state?.id ?? "";
    this.#activePreset = "custom";
    this.#render(`Selected ${selectionId}`);
  }

  #frameScreen(bounds) {
    const viewport = this.#viewport.getBoundingClientRect();
    const wideViewport = viewport.width >= 760;
    const horizontalScale = (viewport.width * (wideViewport ? 0.56 : 0.84)) / bounds.width;
    const verticalScale = (viewport.height * (wideViewport ? 0.62 : 0.5)) / bounds.height;
    this.#scale = clamp(Math.min(horizontalScale, verticalScale), 0.12, 1.8);
    const centerX = viewport.width * (wideViewport ? 0.36 : 0.5);
    const centerY = viewport.height * (wideViewport ? 0.45 : 0.32);
    this.#x = centerX - (bounds.x + bounds.width / 2) * this.#scale;
    this.#y = centerY - (bounds.y + bounds.height / 2) * this.#scale;
  }

  #clearSelection() {
    if (this.#selectedScreen) {
      this.#selectedScreen.group.removeAttribute("data-map-selected");
      this.#selectedScreen.group.setAttribute("tabindex", "-1");
    }
    this.#selectedScreen = null;
    this.#selectionHighlight?.remove();
    this.#selectionHighlight = null;
    this.#selection.panel.hidden = true;
    this.#selection.openButton.hidden = true;
    this.#selection.openButton.removeAttribute("data-state-id");
    for (const target of this.#screenTargets) target.group.setAttribute("tabindex", "-1");
    if (this.#screenTargets[0]) this.#screenTargets[0].group.setAttribute("tabindex", "0");
  }

  #focusAdjacentScreen(group, direction) {
    const index = this.#screenTargets.findIndex((target) => target.group === group);
    if (index < 0) return;
    const nextIndex = (index + direction + this.#screenTargets.length) % this.#screenTargets.length;
    group.setAttribute("tabindex", "-1");
    this.#screenTargets[nextIndex].group.setAttribute("tabindex", "0");
    this.#screenTargets[nextIndex].group.focus({ preventScroll: true });
  }

  #ensureMap() {
    if (this.#mapRoot) return Promise.resolve(this.#mapRoot);
    if (this.#loadPromise) return this.#loadPromise;

    this.#status.textContent = "Loading interface map";
    this.#loadPromise = fetch(this.#source)
      .then((response) => {
        if (!response.ok) throw new Error(`Map request failed with ${response.status}`);
        return response.text();
      })
      .then((source) => {
        const svgStart = source.indexOf("<svg");
        if (svgStart < 0) throw new Error("Map SVG could not be parsed");
        const template = document.createElement("template");
        template.innerHTML = source.slice(svgStart);
        const map = template.content.querySelector("svg");
        if (!map) throw new Error("Map SVG could not be parsed");
        map.setAttribute("role", "group");
        map.setAttribute("aria-label", "Selectable Voyager screen groups");
        this.#image.replaceChildren(map);
        this.#mapRoot = map;
        this.#prepareScreenTargets();
        return map;
      })
      .catch(() => {
        this.#loadPromise = null;
        this.#status.textContent = "Interface map unavailable";
        return null;
      });
    return this.#loadPromise;
  }

  #lockPageScroll() {
    if (this.#pageLock) return;
    const root = document.documentElement;
    const body = document.body;
    this.#pageLock = {
      x: window.scrollX,
      y: window.scrollY,
      rootOverflow: root.style.overflow,
      rootScrollbarGutter: root.style.scrollbarGutter,
      bodyOverflow: body.style.overflow,
    };
    root.style.overflow = "hidden";
    root.style.scrollbarGutter = "stable";
    body.style.overflow = "hidden";
  }

  #restorePageScroll() {
    if (!this.#pageLock) return;
    const root = document.documentElement;
    const body = document.body;
    const lock = this.#pageLock;
    this.#pageLock = null;
    root.style.overflow = lock.rootOverflow;
    root.style.scrollbarGutter = lock.rootScrollbarGutter;
    body.style.overflow = lock.bodyOverflow;
    window.scrollTo(lock.x, lock.y);
    window.requestAnimationFrame(() => window.scrollTo(lock.x, lock.y));
  }

  #bindEvents() {
    this.#dialog.querySelector("[data-map-close]").addEventListener("click", () => this.close());
    this.#dialog.querySelector("[data-map-zoom-in]").addEventListener("click", () => this.zoomBy(1.25));
    this.#dialog.querySelector("[data-map-zoom-out]").addEventListener("click", () => this.zoomBy(0.8));
    this.#dialog.querySelector("[data-map-overview]").addEventListener("click", () => this.showPreset("overview"));
    this.#dialog
      .querySelector("[data-map-screen-layout]")
      .addEventListener("click", () => this.showPreset("screen-layout"));
    this.#dialog
      .querySelector("[data-map-menu-screens]")
      .addEventListener("click", () => this.showPreset("menu-screens"));
    this.#dialog
      .querySelector("[data-map-menu-flow]")
      .addEventListener("click", () => this.showPreset("menu-flow"));

    this.#selection.panel.addEventListener("pointerdown", (event) => event.stopPropagation());
    this.#selection.panel.addEventListener("wheel", (event) => event.stopPropagation());
    this.#selection.openButton.addEventListener("click", () => {
      const stateId = this.#selection.openButton.dataset.stateId;
      if (!stateId || !this.#onOpenState) return;
      this.close();
      window.requestAnimationFrame(() => this.#onOpenState(stateId));
    });

    this.#image.addEventListener("click", (event) => {
      if (this.#dragMoved) return;
      const group = event.target.closest?.("[data-map-screen]");
      if (group) this.#selectScreen(group);
    });
    this.#image.addEventListener("keydown", (event) => {
      const group = event.target.closest?.("[data-map-screen]");
      if (!group) return;
      if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
        event.preventDefault();
        event.stopPropagation();
        this.#selectScreen(group, false);
      } else if (["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        this.#focusAdjacentScreen(group, event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1);
      }
    });

    this.#dialog.addEventListener("click", (event) => {
      if (event.target === this.#dialog) this.close();
    });
    this.#dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      this.close();
    });
    this.#dialog.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" && event.key !== "Esc") return;
      event.preventDefault();
      this.close();
    });

    this.#viewport.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        const bounds = this.#viewport.getBoundingClientRect();
        this.zoomBy(event.deltaY < 0 ? 1.12 : 0.89, event.clientX - bounds.left, event.clientY - bounds.top);
      },
      { passive: false },
    );

    this.#viewport.addEventListener("pointerdown", (event) => {
      this.#viewport.setPointerCapture(event.pointerId);
      this.#pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      this.#gesture = this.#gestureSnapshot();
      this.#dragStart = { x: event.clientX, y: event.clientY };
      this.#dragMoved = false;
      this.#viewport.dataset.dragging = "true";
    });
    this.#viewport.addEventListener("pointermove", (event) => {
      if (!this.#pointers.has(event.pointerId)) return;
      this.#pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (
        this.#dragStart &&
        Math.hypot(event.clientX - this.#dragStart.x, event.clientY - this.#dragStart.y) > 6
      ) {
        this.#dragMoved = true;
      }
      this.#updateGesture();
    });
    for (const eventName of ["pointerup", "pointercancel"]) {
      this.#viewport.addEventListener(eventName, (event) => {
        this.#pointers.delete(event.pointerId);
        this.#gesture = this.#gestureSnapshot();
        if (!this.#pointers.size) delete this.#viewport.dataset.dragging;
      });
    }

    this.#viewport.addEventListener("keydown", (event) => {
      const keyActions = {
        ArrowUp: () => this.panBy(0, 48),
        ArrowDown: () => this.panBy(0, -48),
        ArrowLeft: () => this.panBy(48, 0),
        ArrowRight: () => this.panBy(-48, 0),
        "+": () => this.zoomBy(1.25),
        "=": () => this.zoomBy(1.25),
        "-": () => this.zoomBy(0.8),
        Home: () => this.showPreset("overview"),
        "0": () => this.showPreset("overview"),
        "1": () => this.showPreset("screen-layout"),
        "2": () => this.showPreset("menu-screens"),
        "3": () => this.showPreset("menu-flow"),
      };
      const action = keyActions[event.key];
      if (!action) return;
      event.preventDefault();
      action();
    });
  }

  #gestureSnapshot() {
    const points = [...this.#pointers.values()];
    if (!points.length) return null;
    const center = points.reduce(
      (total, point) => ({ x: total.x + point.x / points.length, y: total.y + point.y / points.length }),
      { x: 0, y: 0 },
    );
    const distance = points.length > 1 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : 0;
    return { center, distance, x: this.#x, y: this.#y, scale: this.#scale };
  }

  #updateGesture() {
    const start = this.#gesture;
    const current = this.#gestureSnapshot();
    if (!start || !current) return;

    if (this.#pointers.size === 1) {
      this.#x = start.x + current.center.x - start.center.x;
      this.#y = start.y + current.center.y - start.center.y;
      this.#activePreset = "custom";
      this.#render();
      return;
    }

    const bounds = this.#viewport.getBoundingClientRect();
    const startCenterX = start.center.x - bounds.left;
    const startCenterY = start.center.y - bounds.top;
    const currentCenterX = current.center.x - bounds.left;
    const currentCenterY = current.center.y - bounds.top;
    const nextScale = clamp(start.scale * (current.distance / start.distance), 0.06, 2.5);
    const imageX = (startCenterX - start.x) / start.scale;
    const imageY = (startCenterY - start.y) / start.scale;
    this.#scale = nextScale;
    this.#x = currentCenterX - imageX * nextScale;
    this.#y = currentCenterY - imageY * nextScale;
    this.#activePreset = "custom";
    this.#render();
  }

  #render(label = "") {
    this.#image.style.transform = `translate3d(${this.#x}px, ${this.#y}px, 0) scale(${this.#scale})`;
    const zoom = `${Math.round(this.#scale * 100)}% zoom`;
    const selectionLabel = this.#selectedScreen
      ? `Selected ${this.#selectedScreen.state?.id ?? this.#selectedScreen.groupId}`
      : "";
    const statusLabel = label || selectionLabel;
    this.#status.textContent = statusLabel ? `${statusLabel} · ${zoom}` : zoom;
  }
}
