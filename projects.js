export const projects = [
  {
    id: "voyager",
    number: "001",
    title: "Voyager",
    eyebrow: "Featured field file",
    classification: "Field file + demo",
    signal: "product-interface",
    indexSummary: "Rugged navigation before hardware lock",
    viewerSummary:
      "A rugged mapping interface designed in the browser before firmware and tooling were locked.",
    tags: ["Product design", "Embedded UI", "Prototyping", "Launch"],
    facts: [
      "Browser prototype",
      "Glove-friendly interaction",
      "Offline mapping",
      "Pre-firmware validation",
    ],
    evidence: [
      ["Artifact", "Interactive browser prototype"],
      ["Environment", "Rugged / gloves"],
      ["System", "Offline field navigation"],
      ["Purpose", "Pre-firmware validation"],
    ],
    artifacts: ["Route + mapping screen", "Control model", "Field validation"],
    fieldNote:
      "Navigation and control size had to be testable while changes were still cheap enough to make in the browser.",
    primaryAction: {
      label: "Read the field file",
      href: "/projects/voyager",
    },
    secondaryAction: {
      label: "View interactive prototype",
      href: "/apps/voyager",
    },
    visual: "voyager",
    visualStatus: "Prototype ready",
    caption: "Interaction prototype / field navigation",
    accent: "#f25a38",
  },
  {
    id: "buildbooks",
    number: "002",
    title: "Buildbooks",
    eyebrow: "Operational system",
    classification: "Live system",
    signal: "interface-data",
    indexSummary: "Made 8,892 products visually navigable",
    viewerSummary:
      "A long-lived product and production system connecting SKU data, BOM relationships, imagery, labels, and the people who need reliable answers.",
    tags: ["Internal tools", "Product data", "Workflow systems"],
    facts: [
      "8,892 SKUs",
      "22,245 BOM relationships",
      "Visual product lookup",
      "Configurable label output",
    ],
    evidence: [
      ["Catalog", "8,892 SKUs"],
      ["Relations", "22,245 BOM links"],
      ["Use", "Visual product lookup"],
      ["Output", "Configurable labels"],
    ],
    artifacts: ["Product lookup", "BOM relationship view", "Label output"],
    fieldNote:
      "The useful unit was never just an SKU. People needed the product, its BOM relationships, imagery, and label output in one place.",
    primaryAction: {
      label: "Read the field file",
      href: "/projects/buildbooks",
    },
    secondaryAction: {
      label: "Open live system",
      href: "/apps/buildbooks",
    },
    visual: "buildbooks",
    visualStatus: "System online",
    caption: "Product lookup / operational system",
    accent: "#a855f7",
  },
  {
    id: "fitapp",
    number: "003",
    title: "FitApp",
    eyebrow: "Data workflow",
    classification: "Live system",
    signal: "interface-data",
    indexSummary: "Turned fitment cleanup into a repeatable flow",
    viewerSummary:
      "A focused workflow for turning complex fitment spreadsheets into editable comparisons and import-ready structured output.",
    tags: ["Data workflow", "Internal tools", "Automation"],
    facts: [
      "Source workbook input",
      "Tall and wide editable views",
      "Addition / removal review",
      "Import-ready output",
    ],
    evidence: [
      ["Input", "Source workbook"],
      ["Transform", "Tall + wide views"],
      ["Review", "Adds and removals"],
      ["Output", "Import-ready data"],
    ],
    artifacts: ["Source matrix", "Editable comparison", "Import output"],
    fieldNote:
      "The source workbook remains visible as the data is cleaned, compared, edited, and prepared for import.",
    primaryAction: {
      label: "Read the working note",
      href: "/projects/fitapp",
    },
    secondaryAction: {
      label: "Open live system",
      href: "/apps/fitapp",
    },
    visual: "fitapp",
    visualStatus: "Workflow online",
    caption: "Data transformation / review workflow",
    accent: "#a855f7",
  },
  {
    id: "gauge-evolution",
    number: "004",
    title: "Gauge evolution",
    eyebrow: "Product lineage",
    classification: "Field file",
    signal: "product",
    indexSummary: "Twenty years of product development",
    viewerSummary:
      "A product story tracing how interfaces, features, market feedback, and new use cases shaped a family of rugged instruments over time.",
    tags: ["Product design", "Interface systems", "Industrial design"],
    facts: [
      "Endurance through Voyager Pro4",
      "Interface evolution",
      "OEM and aftermarket adaptation",
      "Decisions across generations",
    ],
    evidence: [
      ["Span", "Twenty years"],
      ["Lineage", "Endurance to Pro4"],
      ["Markets", "OEM + aftermarket"],
      ["Focus", "Interface evolution"],
    ],
    artifacts: ["Product timeline", "Gauge generations", "Interface changes"],
    fieldNote:
      "Each generation carried earlier interface decisions into new hardware, use cases, and markets.",
    primaryAction: {
      label: "Read the field file",
      href: "/projects/gauge-evolution",
    },
    secondaryAction: null,
    visual: "gauge",
    visualStatus: "Field file ready",
    caption: "Product lineage / interface evolution",
    accent: "#f25a38",
  },
  {
    id: "voyager-pro4",
    number: "005",
    title: "Voyager Pro4",
    eyebrow: "Launch system",
    classification: "Field file",
    signal: "product",
    indexSummary: "One product across every launch surface",
    viewerSummary:
      "A launch system spanning device interface, product imagery, packaging, technical content, kit positioning, and the public product surface.",
    tags: ["Product launch", "Art direction", "Interface", "Content systems"],
    facts: [
      "Product interface",
      "MOTO / UTV / SNOW kits",
      "Product imagery and content",
      "Launch and evergreen surfaces",
    ],
    evidence: [
      ["Interface", "Device UI"],
      ["Kits", "MOTO / UTV / SNOW"],
      ["Launch", "Imagery + packaging"],
      ["Surface", "Product pages"],
    ],
    artifacts: ["Device interface", "Kit system", "Launch surfaces"],
    fieldNote:
      "The launch had to stay coherent across the device, kits, packaging, imagery, technical content, and product page.",
    primaryAction: {
      label: "Read the field file",
      href: "/projects/voyager-pro4",
    },
    secondaryAction: null,
    visual: "pro4",
    visualStatus: "Field file ready",
    caption: "Launch system / connected product surfaces",
    accent: "#f25a38",
  },
  {
    id: "product-surface",
    number: "006",
    title: "Product surface",
    eyebrow: "Artifact collection",
    classification: "Collection",
    signal: "product",
    indexSummary: "The systems surrounding the product",
    viewerSummary:
      "Photography, packaging, product pages, technical content, product data, documentation, and launch materials working as one connected product system.",
    tags: ["Photography", "Packaging", "Product pages", "Documentation"],
    facts: [
      "Photography",
      "Packaging",
      "Product pages",
      "Data and documentation",
    ],
    evidence: [
      ["Identity", "Product photography"],
      ["Physical", "Packaging + labels"],
      ["Public", "Product pages"],
      ["Support", "Data + documents"],
    ],
    artifacts: ["Product photography", "Packaging + labels", "Technical content"],
    fieldNote:
      "The product experience continues through the page, photo, package, label, diagram, specification, and support document.",
    primaryAction: {
      label: "Explore the collection",
      href: "/projects/product-surface",
    },
    secondaryAction: null,
    visual: "surface",
    visualStatus: "Collection ready",
    caption: "Visual systems / product communication",
    accent: "#f25a38",
  },
];

export const projectsById = new Map(
  projects.map((project) => [project.id, project]),
);

export function getProject(id) {
  return projectsById.get(id) || projects[0];
}
