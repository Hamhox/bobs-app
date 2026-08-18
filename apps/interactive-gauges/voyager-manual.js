const APP_BASE = "/apps/interactive-gauges";

const MANUAL_PAGES = [
  {
    id: "controls",
    label: "Controls",
    pageNumber: 3,
    title: "Hardware, before software.",
    summary: "The quick-start diagram explains every physical input in one frame, including the five-position navigation switch.",
    source: "manual-controls.svg",
    stateId: "gauge.main.primary",
    gaugeLabel: "Open Main Gauge",
  },
  {
    id: "main",
    label: "Main",
    pageNumber: 20,
    title: "Seven screens, one operating model.",
    summary: "The Main tab establishes the primary and secondary screen pattern used throughout Voyager.",
    source: "manual-main.svg",
    stateId: "gauge.main.primary",
    gaugeLabel: "Open Main Gauge",
  },
  {
    id: "map",
    label: "Map",
    pageNumber: 21,
    title: "A track, not a basemap.",
    summary: "Voyager draws the current recording and loaded GPX routes as simple lines, with no terrain tiles or road layer.",
    source: "manual-map.svg",
    stateId: "gauge.map.overview",
    gaugeLabel: "Open Track Map",
  },
  {
    id: "graphs",
    label: "Graphs",
    pageNumber: 23,
    title: "Ride history becomes a control.",
    summary: "Temperature and altitude share one review pattern: enter the graph, scrub the ride timeline, then Back out.",
    source: "manual-graphs.svg",
    stateId: "gauge.altitude.graph",
    gaugeLabel: "Open Altitude Graph",
  },
  {
    id: "navigation",
    label: "Navigation",
    pageNumber: 26,
    title: "Waypoint direction at a glance.",
    summary: "The navigation screen reduces the ride to heading, speed, distance, destination and stopwatch.",
    source: "manual-navigation.svg",
    stateId: "gauge.navigation.primary",
    gaugeLabel: "Open Navigation",
  },
  {
    id: "quick-menu",
    label: "Quick Menu",
    pageNumber: 27,
    title: "Frequent actions stay shallow.",
    summary: "Logging, ride resets, waypoints and destination selection remain one MENU press away.",
    source: "manual-quick-menu.svg",
    stateId: "menu.main",
    gaugeLabel: "Open Quick Menu",
  },
  {
    id: "waypoints",
    label: "Waypoints",
    pageNumber: 30,
    title: "Three ways to place a point.",
    summary: "Current position, latitude and longitude, or crosshairs: all three authored waypoint paths are live in the prototype.",
    source: "manual-waypoints.svg",
    stateId: "menu.ride.add-waypoint",
    gaugeLabel: "Open Add Waypoint",
  },
  {
    id: "settings",
    label: "Settings",
    pageNumber: 33,
    title: "A deep system made testable.",
    summary: "Units, vehicle sensors, GPS, maps, power and user screens all branch from the same Settings menu.",
    source: "manual-settings.svg",
    stateId: "menu.settings",
    gaugeLabel: "Open Settings",
  },
];

function pageForVoyagerState(stateId) {
  if (/^m-set/.test(stateId)) return "settings";
  if (/^m-ride2-[2-5]/.test(stateId) || /^m-main1-5/.test(stateId)) return "waypoints";
  if (/^m-main/.test(stateId)) return "quick-menu";
  if (/^(map|map[123]-2|map[23])$/.test(stateId)) return "map";
  if (/^(eng|eng[123]|eng1-2|alt|alt[123]|alt1-2)$/.test(stateId)) return "graphs";
  if (/^(dir|dir[123]|dir1-2|sat|sat1-2)$/.test(stateId)) return "navigation";
  if (/^(index|index2|index1-2|index2-2)$/.test(stateId)) return "main";
  return null;
}

function pageUrl(page) {
  return `${APP_BASE}/assets/manual/${page.source}`;
}

function preloadPage(page) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = async () => {
      try {
        await image.decode();
      } catch {
        // A completed SVG remains safe to swap when decode() is unavailable.
      }
      resolve(page);
    };
    image.onerror = () => reject(new Error(`Manual page ${page.pageNumber} could not be loaded.`));
    image.src = pageUrl(page);
  });
}

export function initializeVoyagerManual(root) {
  if (!root) return;

  const tabs = [...root.querySelectorAll("[data-manual-page]")];
  const panel = root.querySelector("#manual-page-panel");
  const image = root.querySelector("#manual-page-image");
  const frame = root.querySelector("[data-manual-frame]");
  const pageNumber = root.querySelector("#manual-page-number");
  const title = root.querySelector("#manual-page-title");
  const summary = root.querySelector("#manual-page-summary");
  const source = root.querySelector("#manual-page-source");
  const openGauge = root.querySelector("#manual-open-gauge");
  const openGaugeLabel = root.querySelector("#manual-open-gauge-label");
  const syncStatus = root.querySelector("#manual-sync-status");
  const live = root.querySelector("#manual-live");
  const previous = root.querySelector("[data-manual-previous]");
  const next = root.querySelector("[data-manual-next]");
  const preloadCache = new Map();
  let currentIndex = 0;
  let latestVoyagerState = null;
  let latestStableState = null;
  let requestId = 0;

  function cachedPreload(page) {
    if (!preloadCache.has(page.id)) preloadCache.set(page.id, preloadPage(page));
    return preloadCache.get(page.id);
  }

  function preloadNeighbors(index) {
    const neighborIndexes = [
      (index - 1 + MANUAL_PAGES.length) % MANUAL_PAGES.length,
      (index + 1) % MANUAL_PAGES.length,
    ];
    const scheduleIdle = window.requestIdleCallback ?? ((callback) => window.setTimeout(callback, 0));
    scheduleIdle(() => {
      for (const neighborIndex of neighborIndexes) {
        cachedPreload(MANUAL_PAGES[neighborIndex]).catch(() => {});
      }
    });
  }

  function updateSyncState(page) {
    const synchronized = page.stateId === latestStableState || pageForVoyagerState(latestVoyagerState) === page.id;
    root.toggleAttribute("data-manual-synced", synchronized);
    openGauge.toggleAttribute("data-voyager-active", synchronized);
    if (synchronized) openGauge.setAttribute("aria-current", "true");
    else openGauge.removeAttribute("aria-current");
    syncStatus.textContent = synchronized
      ? "Live gauge is on this page"
      : "Open the matching live state";
  }

  async function selectPage(index, { announce = true, focusTab = false } = {}) {
    const normalizedIndex = (index + MANUAL_PAGES.length) % MANUAL_PAGES.length;
    const page = MANUAL_PAGES[normalizedIndex];
    const selectionRequest = ++requestId;
    root.setAttribute("aria-busy", "true");

    try {
      await cachedPreload(page);
      if (selectionRequest !== requestId) return;
      currentIndex = normalizedIndex;
      root.dataset.manualPage = page.id;
      image.src = pageUrl(page);
      image.alt = `Original Voyager user's manual, page ${page.pageNumber}: ${page.label}`;
      pageNumber.textContent = `Page ${page.pageNumber} / 41`;
      title.textContent = page.title;
      summary.textContent = page.summary;
      source.textContent = `Original manual · ${page.label}`;
      openGauge.dataset.voyagerState = page.stateId;
      openGauge.disabled = false;
      openGauge.setAttribute("aria-label", `${page.gaugeLabel} from manual page ${page.pageNumber}`);
      openGaugeLabel.textContent = page.gaugeLabel;
      updateSyncState(page);
      preloadNeighbors(currentIndex);

      for (const [tabIndex, tab] of tabs.entries()) {
        const selected = tabIndex === currentIndex;
        tab.setAttribute("aria-selected", String(selected));
        tab.setAttribute("tabindex", selected ? "0" : "-1");
        if (selected) panel.setAttribute("aria-labelledby", tab.id);
        if (selected && focusTab) tab.focus({ preventScroll: true });
      }

      frame.removeAttribute("data-manual-enter");
      window.requestAnimationFrame(() => frame.setAttribute("data-manual-enter", "true"));
      if (announce) live.textContent = `${page.label}, manual page ${page.pageNumber}. ${page.title}`;
    } catch (error) {
      live.textContent = error.message;
    } finally {
      if (selectionRequest === requestId) root.removeAttribute("aria-busy");
    }
  }

  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener("click", () => selectPage(index));
    tab.addEventListener("keydown", (event) => {
      const commands = {
        ArrowLeft: index - 1,
        ArrowRight: index + 1,
        Home: 0,
        End: MANUAL_PAGES.length - 1,
      };
      if (!Object.hasOwn(commands, event.key)) return;
      event.preventDefault();
      selectPage(commands[event.key], { focusTab: true });
    });
  }

  previous.addEventListener("click", () => selectPage(currentIndex - 1));
  next.addEventListener("click", () => selectPage(currentIndex + 1));

  document.addEventListener("voyager:statechange", (event) => {
    latestVoyagerState = event.detail.archiveStateId;
    latestStableState = event.detail.screenId;
    if (MANUAL_PAGES[currentIndex].stateId === latestStableState) {
      updateSyncState(MANUAL_PAGES[currentIndex]);
      return;
    }
    const pageId = pageForVoyagerState(latestVoyagerState);
    const index = MANUAL_PAGES.findIndex((page) => page.id === pageId);
    if (index >= 0) selectPage(index, { announce: false });
    else updateSyncState(MANUAL_PAGES[currentIndex]);
  });

  selectPage(0, { announce: false });
}
