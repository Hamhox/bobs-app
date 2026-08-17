const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const IMAGE_WIDTH = 4195.24;
const IMAGE_HEIGHT = 6483.58;
const PRESETS = {
  overview: { groupId: "regions", label: "Overview" },
  "screen-layout": { groupId: "screen-layout-screens", label: "Screen layout" },
  "menu-screens": { groupId: "menu-screens", label: "Menu screens" },
  "menu-flow": { groupId: "flowchart-screens", label: "Menu flow" },
};

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

  constructor({ dialog, viewport, image, status, source }) {
    this.#dialog = dialog;
    this.#viewport = viewport;
    this.#image = image;
    this.#status = status;
    this.#source = source;
    this.#resizeObserver = new ResizeObserver(() => {
      if (this.#dialog.open && this.#activePreset !== "custom") {
        this.showPreset(this.#activePreset);
      }
    });
    this.#bindEvents();
  }

  open(preset = "overview") {
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
    if (this.#dialog.open) this.#dialog.close();
    this.#restorePageScroll();
  }

  showPreset(preset) {
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

  #getGroupBounds(groupId) {
    const group = this.#mapRoot?.querySelector(`[id="${groupId}"]`);
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
        map.setAttribute("aria-hidden", "true");
        this.#image.replaceChildren(map);
        this.#mapRoot = map;
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
      this.#viewport.dataset.dragging = "true";
    });
    this.#viewport.addEventListener("pointermove", (event) => {
      if (!this.#pointers.has(event.pointerId)) return;
      this.#pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
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
    this.#status.textContent = label ? `${label} · ${zoom}` : zoom;
  }
}
