export const projects = [
  {
    id: "voyager",
    number: "001",
    title: "Voyager",
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
    primaryAction: {
      label: "Read the field file",
      href: "/projects/voyager",
    },
    secondaryAction: {
      label: "View interactive prototype",
      href: "/apps/voyager",
    },
    visual: "voyager",
    caption: "Interaction prototype / field navigation",
    accent: "#f25a38",
  },
  {
    id: "buildbooks",
    number: "002",
    title: "Buildbooks",
    classification: "Live system",
    signal: "interface-data",
    indexSummary: "Made 8,892 products visually navigable",
    viewerSummary:
      "A long-lived product system connecting product data, BOMs, production labels, imagery, and operational lookup.",
    tags: ["Internal tools", "Product data", "Workflow systems"],
    facts: [
      "8,892 SKUs",
      "22,245 BOM relationships",
      "20+ users",
      "15+ years in production",
    ],
    primaryAction: {
      label: "Open live system",
      href: "/apps/buildbooks",
    },
    secondaryAction: {
      label: "Read the project file",
      href: "/projects/buildbooks",
    },
    visual: "buildbooks",
    caption: "Product lookup / operational system",
    accent: "#a855f7",
  },
  {
    id: "fitapp",
    number: "003",
    title: "FitApp",
    classification: "Live system",
    signal: "interface-data",
    indexSummary: "Turned fitment cleanup into a repeatable flow",
    viewerSummary:
      "A workflow for cleaning, comparing, editing, and preparing fitment data for import.",
    tags: ["Data workflow", "Internal tools", "Automation"],
    facts: [
      "Wide and tall inputs",
      "Editable transformation",
      "Import-ready output",
      "Change comparison",
    ],
    primaryAction: {
      label: "Open live system",
      href: "/apps/fitapp",
    },
    secondaryAction: {
      label: "Read the project file",
      href: "/projects/fitapp",
    },
    visual: "fitapp",
    caption: "Data transformation / review workflow",
    accent: "#57c7a7",
  },
  {
    id: "gauge-evolution",
    number: "004",
    title: "Gauge evolution",
    classification: "Field file",
    signal: "product",
    indexSummary: "Twenty years of product development",
    viewerSummary:
      "Twenty years of interface, product, and market decisions across Trail Tech's gauge product line.",
    tags: ["Product design", "Interface systems", "Industrial design"],
    facts: [
      "Multiple product generations",
      "Shared interaction language",
      "Field-tested controls",
      "Long-term product view",
    ],
    primaryAction: {
      label: "Read the field file",
      href: "/projects/gauge-evolution",
    },
    secondaryAction: null,
    visual: "gauge",
    caption: "Product lineage / interface evolution",
    accent: "#ffbb45",
  },
  {
    id: "voyager-pro4",
    number: "005",
    title: "Voyager Pro4",
    classification: "Field file",
    signal: "product",
    indexSummary: "One product across every launch surface",
    viewerSummary:
      "A connected launch system spanning the device, product story, packaging, imagery, and retail materials.",
    tags: ["Product launch", "Art direction", "Interface", "Content systems"],
    facts: [
      "Device interface",
      "Launch photography",
      "Product pages",
      "Retail and packaging",
    ],
    primaryAction: {
      label: "Read the field file",
      href: "/projects/voyager-pro4",
    },
    secondaryAction: null,
    visual: "pro4",
    caption: "Launch system / connected product surfaces",
    accent: "#5f8cff",
  },
  {
    id: "product-surface",
    number: "006",
    title: "Product surface",
    classification: "Collection",
    signal: "product",
    indexSummary: "The systems surrounding the product",
    viewerSummary:
      "The public and operational systems surrounding the product: photography, packaging, pages, data, documentation, and launch.",
    tags: ["Photography", "Packaging", "Product pages", "Documentation"],
    facts: [
      "Product identity",
      "Technical illustration",
      "Launch graphics",
      "Operational content",
    ],
    primaryAction: {
      label: "Open the collection",
      href: "/projects/product-surface",
    },
    secondaryAction: null,
    visual: "surface",
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
