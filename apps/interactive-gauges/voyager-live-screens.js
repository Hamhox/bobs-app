export const VOYAGER_TAB_ORDER = [
  { id: "main", label: "MAIN" },
  { id: "map", label: "MAP" },
  { id: "temp", label: "TEMP", icon: "temperature" },
  { id: "alt", label: "ALT" },
  { id: "user", label: "USER" },
  { id: "nav", label: "NAV" },
  { id: "sat", label: "SAT" },
];

export const VOYAGER_SCREEN_REGISTRY = {
  startup: {
    id: "startup",
    tabLabel: "STARTUP",
    renderer: "startup",
    showSideArrows: false,
    variants: {
      startup: { view: "logo", tabsVisible: false, sideArrows: false },
    },
  },
  main: {
    id: "main",
    tabLabel: "MAIN",
    renderer: "main",
    showSideArrows: true,
    variants: {
      index: { view: "primary", tabsVisible: true, sideArrows: true },
      "index1-2": { view: "primary", tabsVisible: false, sideArrows: true },
      index2: { view: "secondary", tabsVisible: true, sideArrows: true },
      "index2-2": { view: "secondary", tabsVisible: false, sideArrows: true },
    },
  },
  map: {
    id: "map",
    tabLabel: "MAP",
    renderer: "map",
    showSideArrows: true,
    secondaryInteraction: "map",
    variants: {
      map: { view: "primary", tabsVisible: true, sideArrows: true, screenIndicator: 1 },
      "map1-2": { view: "primary", tabsVisible: false, sideArrows: true, screenIndicator: 1 },
      map2: { view: "secondary", tabsVisible: false, sideArrows: false, interaction: "pan" },
      "map2-2": { view: "secondary", tabsVisible: false, sideArrows: true, screenIndicator: 2 },
      map3: { view: "secondary", tabsVisible: false, sideArrows: false, interaction: "zoom" },
      "map3-2": { view: "secondary", tabsVisible: false, sideArrows: false, interaction: "zoom" },
    },
  },
  temp: {
    id: "temp",
    tabLabel: "TEMP",
    renderer: "graph",
    graphMetric: "temperature",
    showSideArrows: true,
    secondaryInteraction: "graph",
    variants: {
      eng: { view: "primary", tabsVisible: true, sideArrows: true },
      "eng1-2": { view: "primary", tabsVisible: false, sideArrows: true },
      eng2: { view: "secondary", tabsVisible: false, sideArrows: true, interaction: "graph" },
      eng3: { view: "secondary", tabsVisible: false, sideArrows: true, interaction: "graph" },
    },
  },
  alt: {
    id: "alt",
    tabLabel: "ALT",
    renderer: "graph",
    graphMetric: "altitude",
    showSideArrows: true,
    secondaryInteraction: "graph",
    variants: {
      alt: { view: "primary", tabsVisible: true, sideArrows: true },
      "alt1-2": { view: "primary", tabsVisible: false, sideArrows: true },
      alt2: { view: "secondary", tabsVisible: false, sideArrows: true, interaction: "graph" },
      alt3: { view: "secondary", tabsVisible: false, sideArrows: true, interaction: "graph" },
    },
  },
  user: {
    id: "user",
    tabLabel: "USER",
    renderer: "user",
    showSideArrows: false,
    variants: {
      cstm: { view: "primary", tabsVisible: true, sideArrows: false },
      "cstm1-2": { view: "primary", tabsVisible: false, sideArrows: false },
      cstm2: { view: "secondary", tabsVisible: true, sideArrows: false },
      "cstm2-2": { view: "secondary", tabsVisible: false, sideArrows: false },
    },
  },
  nav: {
    id: "nav",
    tabLabel: "NAV",
    renderer: "navigation",
    showSideArrows: false,
    variants: {
      dir: { view: "primary", tabsVisible: true, sideArrows: false },
      "dir1-2": { view: "primary", tabsVisible: false, sideArrows: false },
      dir2: { view: "secondary", tabsVisible: true, sideArrows: false },
      dir3: { view: "secondary", tabsVisible: false, sideArrows: false },
    },
  },
  sat: {
    id: "sat",
    tabLabel: "SAT",
    renderer: "satellite",
    showSideArrows: false,
    variants: {
      sat: { view: "primary", tabsVisible: true, sideArrows: false },
      "sat1-2": { view: "primary", tabsVisible: false, sideArrows: false },
    },
  },
};

export const VOYAGER_LIVE_STATE_INDEX = Object.fromEntries(
  Object.values(VOYAGER_SCREEN_REGISTRY).flatMap((screen) =>
    Object.entries(screen.variants).map(([stateId, variant]) => [stateId, { screen, variant }]),
  ),
);

export const VOYAGER_LIVE_STATE_IDS = new Set(Object.keys(VOYAGER_LIVE_STATE_INDEX));

export const VOYAGER_INPUT_POLICY_ALIASES = {
  "index1-2": "index",
  "index2-2": "index2",
  "map1-2": "map",
  "map3-2": "map3",
  "eng1-2": "eng",
  "alt1-2": "alt",
  "cstm1-2": "cstm",
  "cstm2-2": "cstm2",
  "dir1-2": "dir",
  dir3: "dir2",
  "sat1-2": "sat",
};

export const VOYAGER_STABLE_STATE_ALIASES = {
  "gauge.startup": "startup",
  "gauge.main.primary": "index",
  "gauge.main.primary.tabs-hidden": "index1-2",
  "gauge.main.secondary": "index2",
  "gauge.map.overview": "map",
  "gauge.map.overview.tabs-hidden": "map1-2",
  "gauge.map.detail": "map2-2",
  "gauge.map.control.pan": "map2",
  "gauge.map.control.zoom": "map3",
  "gauge.temperature.primary": "eng",
  "gauge.temperature.graph": "eng2",
  "gauge.altitude.primary": "alt",
  "gauge.altitude.graph": "alt2",
  "gauge.user.primary": "cstm",
  "gauge.user.secondary": "cstm2",
  "gauge.navigation.primary": "dir",
  "gauge.navigation.stopwatch": "dir2",
  "gauge.satellite.primary": "sat",
};

export const VOYAGER_CANONICAL_STATE_IDS = Object.entries(VOYAGER_STABLE_STATE_ALIASES).reduce(
  (canonicalIds, [stableId, stateId]) => {
    canonicalIds[stateId] ??= stableId;
    return canonicalIds;
  },
  {},
);

export function voyagerScreenState(stateId) {
  return VOYAGER_LIVE_STATE_INDEX[stateId] ?? null;
}
