const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const IMAGE_WIDTH = 4195.24;
const IMAGE_HEIGHT = 6495.11;
const PRESETS = {
  reading: { x: 1560, y: 2250, scale: 0.7, label: "Reading view" },
  "screen-layout": { x: 720, y: 650, scale: 0.72, label: "Screen layout" },
  "menu-flow": { x: 3520, y: 630, scale: 0.7, label: "Menu flow" },
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
    if (!this.#image.hasAttribute("src")) this.#image.src = this.#source;
    this.#dialog.showModal();
    this.#resizeObserver.observe(this.#viewport);
    const applyPreset = () => window.requestAnimationFrame(() => this.showPreset(preset));
    if (this.#image.complete) applyPreset();
    else this.#image.addEventListener("load", applyPreset, { once: true });
    this.#viewport.focus({ preventScroll: true });
  }

  close() {
    this.#resizeObserver.disconnect();
    this.#dialog.close();
  }

  fit() {
    const viewport = this.#viewport.getBoundingClientRect();
    this.#scale = Math.min(viewport.width / IMAGE_WIDTH, viewport.height / IMAGE_HEIGHT) * 0.94;
    this.#x = (viewport.width - IMAGE_WIDTH * this.#scale) / 2;
    this.#y = (viewport.height - IMAGE_HEIGHT * this.#scale) / 2;
    this.#activePreset = "overview";
    this.#render("Overview");
  }

  showPreset(preset) {
    if (preset === "overview" || !PRESETS[preset]) {
      this.fit();
      return;
    }

    const viewport = this.#viewport.getBoundingClientRect();
    const target = PRESETS[preset];
    this.#scale = target.scale;
    this.#x = viewport.width / 2 - target.x * this.#scale;
    this.#y = viewport.height / 2 - target.y * this.#scale;
    this.#activePreset = preset;
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

  #bindEvents() {
    this.#dialog.querySelector("[data-map-close]").addEventListener("click", () => this.close());
    this.#dialog.querySelector("[data-map-zoom-in]").addEventListener("click", () => this.zoomBy(1.25));
    this.#dialog.querySelector("[data-map-zoom-out]").addEventListener("click", () => this.zoomBy(0.8));
    this.#dialog.querySelector("[data-map-overview]").addEventListener("click", () => this.showPreset("overview"));
    this.#dialog.querySelector("[data-map-reading]").addEventListener("click", () => this.showPreset("reading"));

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
        "1": () => this.showPreset("reading"),
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
