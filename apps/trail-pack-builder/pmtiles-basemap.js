const TILE_SIZE = 256;
const CONTEXT_MAX_ZOOM = 7;

const RASTER_MIME_TYPES = new Map([
  [2, "image/png"],
  [3, "image/jpeg"],
  [4, "image/webp"],
  [5, "image/avif"],
]);

function wrapTileX(value, tileCount) {
  return ((value % tileCount) + tileCount) % tileCount;
}

function archiveError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function verifyByteRangeSupport(url) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Range: "bytes=0-0" },
  });
  if (response.status === 404) {
    await response.body?.cancel();
    throw archiveError("The pirate-map archive has not arrived yet.", "ARCHIVE_MISSING");
  }
  const contentRange = response.headers.get("Content-Range") || "";
  if (response.status !== 206 || !/^bytes 0-0\/\d+$/.test(contentRange)) {
    await response.body?.cancel();
    throw archiveError(
      "The local server must support HTTP byte-range requests before it can read PMTiles.",
      "RANGE_REQUIRED",
    );
  }
  await response.arrayBuffer();
}

async function decodeRasterTile(data, mimeType) {
  const blob = new Blob([data], { type: mimeType });
  if (typeof createImageBitmap === "function") return createImageBitmap(blob);

  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise((resolve, reject) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", () => reject(new Error("Unable to decode a pirate-map tile.")), {
        once: true,
      });
      image.src = objectUrl;
    });
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function disposeEntry(entry) {
  entry.disposed = true;
  entry.controller?.abort();
  entry.image?.close?.();
}

export class PmtilesBasemap {
  constructor(options = {}) {
    this.cacheLimit = options.cacheLimit ?? 128;
    this.onChange = options.onChange;
    this.onAvailabilityChange = options.onAvailabilityChange;
    this.archive = null;
    this.header = null;
    this.mimeType = "";
    this.cache = new Map();
    this.visibleKeys = new Set();
    this.availability = "paper";
  }

  async open(url) {
    this.reset();
    this.setAvailability("loading");
    try {
      await verifyByteRangeSupport(url);

      const Pmtiles = globalThis.pmtiles?.PMTiles;
      if (!Pmtiles) throw archiveError("The PMTiles reader did not load.", "READER_MISSING");

      const archive = new Pmtiles(String(url));
      const header = await archive.getHeader();
      const mimeType = RASTER_MIME_TYPES.get(header.tileType);
      if (!mimeType) {
        throw archiveError("The pirate-map archive does not contain supported raster tiles.", "BAD_TILE_TYPE");
      }

      this.archive = archive;
      this.header = header;
      this.mimeType = mimeType;
      this.setAvailability("loading");
      this.onChange?.();
      return header;
    } catch (error) {
      this.reset();
      this.setAvailability(error?.code || "unavailable");
      throw error;
    }
  }

  reset() {
    for (const entry of this.cache.values()) disposeEntry(entry);
    this.cache.clear();
    this.visibleKeys.clear();
    this.archive = null;
    this.header = null;
    this.mimeType = "";
    this.setAvailability("paper");
    this.onChange?.();
  }

  draw(context, camera) {
    if (!this.archive || !this.header || camera.width < 32 || camera.height < 32) return 0;
    if (camera.zoom < this.header.minZoom) {
      this.visibleKeys.clear();
      this.setAvailability("paper");
      return 0;
    }

    const cameraZoom = Math.floor(camera.zoom);
    const sourceZooms = [];
    const contextZoom = Math.min(CONTEXT_MAX_ZOOM, this.header.maxZoom);
    if (this.header.minZoom <= contextZoom) {
      sourceZooms.push(Math.min(contextZoom, Math.max(this.header.minZoom, cameraZoom)));
    }
    const detailMinZoom = Math.max(CONTEXT_MAX_ZOOM + 1, this.header.minZoom);
    if (camera.zoom >= detailMinZoom && this.header.maxZoom >= detailMinZoom) {
      sourceZooms.push(Math.min(this.header.maxZoom, Math.max(detailMinZoom, cameraZoom)));
    }

    if (!sourceZooms.length) {
      this.visibleKeys.clear();
      this.setAvailability("paper");
      return 0;
    }

    const visibleKeys = new Set();
    this.visibleKeys = visibleKeys;
    let drawn = 0;

    context.save();
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    for (const sourceZoom of sourceZooms) {
      drawn += this.drawZoom(context, camera, sourceZoom, visibleKeys);
    }
    context.restore();
    this.updateAvailabilityFromVisible();
    this.trimCache(visibleKeys);
    return drawn;
  }

  drawZoom(context, camera, tileZoom, visibleKeys) {
    const tileCount = 2 ** tileZoom;
    const tileScreenSize = TILE_SIZE * 2 ** (camera.zoom - tileZoom);
    const halfWorldWidth = camera.width / 2 / camera.scale;
    const halfWorldHeight = camera.height / 2 / camera.scale;
    const firstX = Math.floor((camera.center.x - halfWorldWidth) * tileCount) - 1;
    const lastX = Math.floor((camera.center.x + halfWorldWidth) * tileCount) + 1;
    const firstY = Math.max(0, Math.floor((camera.center.y - halfWorldHeight) * tileCount) - 1);
    const lastY = Math.min(tileCount - 1, Math.floor((camera.center.y + halfWorldHeight) * tileCount) + 1);
    let drawn = 0;

    for (let y = firstY; y <= lastY; y += 1) {
      for (let rawX = firstX; rawX <= lastX; rawX += 1) {
        const x = wrapTileX(rawX, tileCount);
        const key = `${tileZoom}/${x}/${y}`;
        visibleKeys.add(key);
        const entry = this.getTile(key, tileZoom, x, y);
        if (entry.status !== "loaded") continue;

        entry.lastUsed = Date.now();
        const screenX = (rawX / tileCount - camera.center.x) * camera.scale + camera.width / 2;
        const screenY = (y / tileCount - camera.center.y) * camera.scale + camera.height / 2;
        context.drawImage(
          entry.image,
          screenX,
          screenY,
          tileScreenSize + 0.75,
          tileScreenSize + 0.75,
        );
        drawn += 1;
      }
    }
    return drawn;
  }

  getTile(key, zoom, x, y) {
    const cached = this.cache.get(key);
    if (cached) {
      cached.lastUsed = Date.now();
      return cached;
    }

    const controller = new AbortController();
    const entry = {
      controller,
      disposed: false,
      image: null,
      lastUsed: Date.now(),
      status: "loading",
    };
    this.cache.set(key, entry);
    this.archive.getZxy(zoom, x, y, controller.signal)
      .then(async (result) => {
        if (entry.disposed || this.cache.get(key) !== entry) return;
        if (!result) {
          entry.status = "empty";
          return;
        }
        const image = await decodeRasterTile(result.data, this.mimeType);
        if (entry.disposed || this.cache.get(key) !== entry) {
          image.close?.();
          return;
        }
        entry.image = image;
        entry.status = "loaded";
      })
      .catch((error) => {
        if (entry.disposed || error?.name === "AbortError" || this.cache.get(key) !== entry) return;
        entry.error = error;
        entry.status = "error";
      })
      .finally(() => {
        if (entry.disposed || this.cache.get(key) !== entry || !this.visibleKeys.has(key)) return;
        this.updateAvailabilityFromVisible();
        this.onChange?.();
      });
    return entry;
  }

  updateAvailabilityFromVisible() {
    const entries = [...this.visibleKeys].map((key) => this.cache.get(key)).filter(Boolean);
    if (entries.some((entry) => entry.status === "loaded")) {
      this.setAvailability("available");
    } else if (entries.some((entry) => entry.status === "loading")) {
      this.setAvailability("loading");
    } else if (entries.some((entry) => entry.status === "error")) {
      this.setAvailability("unavailable");
    } else {
      this.setAvailability("paper");
    }
  }

  setAvailability(status) {
    if (this.availability === status) return;
    this.availability = status;
    this.onAvailabilityChange?.(status);
  }

  trimCache(visibleKeys) {
    if (this.cache.size <= this.cacheLimit) return;
    const candidates = [...this.cache.entries()]
      .filter(([key]) => !visibleKeys.has(key))
      .sort((left, right) => left[1].lastUsed - right[1].lastUsed);
    while (this.cache.size > this.cacheLimit && candidates.length) {
      const [key, entry] = candidates.shift();
      disposeEntry(entry);
      this.cache.delete(key);
    }
  }
}
