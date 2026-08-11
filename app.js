const projects = {
  voyager: {
    number: "01",
    index: "001",
    title: "Voyager",
    type: "Field file + demo",
    outcome: "Rugged navigation before hardware lock",
    thesis:
      "A rugged mapping interface designed in the browser before firmware and tooling were locked.",
    tags: ["Product design", "Embedded UI", "Prototyping", "Launch"],
    facts: [
      "Browser prototype",
      "Glove-friendly interaction",
      "Offline mapping",
      "Pre-firmware validation",
    ],
    primary: { label: "Read the field file", href: "/projects/voyager" },
    secondary: {
      label: "View interactive prototype",
      href: "/apps/voyager",
    },
    visual: "voyager",
    caption: "Interaction prototype / field navigation",
    accent: "#f25a38",
  },
  buildbooks: {
    number: "02",
    index: "002",
    title: "Buildbooks",
    type: "Live system",
    outcome: "Made 8,892 products visually navigable",
    thesis:
      "A long-lived product system connecting product data, BOMs, production labels, imagery, and operational lookup.",
    tags: ["Internal tools", "Product data", "Workflow systems"],
    facts: ["8,892 SKUs", "22,245 BOM relationships", "20+ users", "15+ years in production"],
    primary: { label: "Open live system", href: "/apps/buildbooks" },
    secondary: {
      label: "Read the project file",
      href: "/projects/buildbooks",
    },
    visual: "buildbooks",
    caption: "Product lookup / operational system",
    accent: "#a855f7",
  },
  fitapp: {
    number: "03",
    index: "003",
    title: "FitApp",
    type: "Live system",
    outcome: "Turned fitment cleanup into a repeatable flow",
    thesis:
      "A workflow for cleaning, comparing, editing, and preparing fitment data for import.",
    tags: ["Data workflow", "Internal tools", "Automation"],
    facts: ["Wide and tall inputs", "Editable transformation", "Import-ready output", "Change comparison"],
    primary: { label: "Open live system", href: "/apps/fitapp" },
    secondary: {
      label: "Read the project file",
      href: "/projects/fitapp",
    },
    visual: "fitapp",
    caption: "Data transformation / review workflow",
    accent: "#57c7a7",
  },
  "gauge-evolution": {
    number: "04",
    index: "004",
    title: "Gauge evolution",
    type: "Field file",
    outcome: "Twenty years of product development",
    thesis:
      "Twenty years of interface, product, and market decisions across Trail Tech's gauge product line.",
    tags: ["Product design", "Interface systems", "Industrial design"],
    facts: ["Multiple product generations", "Shared interaction language", "Field-tested controls", "Long-term product view"],
    primary: {
      label: "Read the field file",
      href: "/projects/gauge-evolution",
    },
    secondary: null,
    visual: "gauge",
    caption: "Product lineage / interface evolution",
    accent: "#ffbb45",
  },
  "voyager-pro4": {
    number: "05",
    index: "005",
    title: "Voyager Pro4",
    type: "Field file",
    outcome: "One product across every launch surface",
    thesis:
      "A connected launch system spanning the device, product story, packaging, imagery, and retail materials.",
    tags: ["Product launch", "Art direction", "Interface", "Content systems"],
    facts: ["Device interface", "Launch photography", "Product pages", "Retail and packaging"],
    primary: {
      label: "Read the field file",
      href: "/projects/voyager-pro4",
    },
    secondary: null,
    visual: "pro4",
    caption: "Launch system / connected product surfaces",
    accent: "#5f8cff",
  },
  "product-surface": {
    number: "06",
    index: "006",
    title: "Product surface",
    type: "Collection",
    outcome: "The systems surrounding the product",
    thesis:
      "The public and operational systems surrounding the product: photography, packaging, pages, data, documentation, and launch.",
    tags: ["Photography", "Packaging", "Product pages", "Documentation"],
    facts: ["Product identity", "Technical illustration", "Launch graphics", "Operational content"],
    primary: {
      label: "Open the collection",
      href: "/projects/product-surface",
    },
    secondary: null,
    visual: "surface",
    caption: "Visual systems / product communication",
    accent: "#f25a38",
  },
};

const viewer = document.querySelector(".project-viewer");
const rowButtons = [...document.querySelectorAll("[data-project]")];
const mobilePreviews = [...document.querySelectorAll("[data-mobile-preview]")];
const primaryAction = document.querySelector("[data-primary-action]");
const secondaryAction = document.querySelector("[data-secondary-action]");
const announcer = document.querySelector("#project-announcer");

function setList(selector, items) {
  const list = document.querySelector(selector);
  list.replaceChildren(
    ...items.map((item) => {
      const listItem = document.createElement("li");
      listItem.textContent = item;
      return listItem;
    }),
  );
}

function setAction(element, action) {
  if (!action) {
    element.hidden = true;
    element.removeAttribute("href");
    return;
  }

  element.hidden = false;
  element.href = action.href;
  element.firstChild.textContent = `${action.label} `;
}

function populateMobilePreview(id, project) {
  mobilePreviews.forEach((preview) => {
    const isCurrent = preview.closest("li").dataset.projectItem === id;
    preview.hidden = !isCurrent;
    preview.replaceChildren();

    if (!isCurrent) return;

    const thesis = document.createElement("p");
    thesis.textContent = project.thesis;

    const action = document.createElement("a");
    action.href = project.primary.href;
    action.textContent = `${project.primary.label} ↗`;

    preview.append(thesis, action);
  });
}

function selectProject(id, announce = false) {
  const project = projects[id];
  if (!project) return;

  document.querySelector("[data-project-number]").textContent = project.number;
  document.querySelector("[data-index-label]").textContent = project.index;
  document.querySelector("[data-project-type]").textContent = project.type;
  document.querySelector("[data-project-outcome]").textContent = project.outcome;
  document.querySelector("[data-project-title]").textContent = project.title;
  document.querySelector("[data-project-thesis]").textContent = project.thesis;
  document.querySelector("[data-visual-caption]").textContent = project.caption;
  document.querySelector(".project-visual figcaption span:last-child").textContent =
    `Selected work ${project.number}`;

  setList("[data-project-facts]", project.facts);
  setList("[data-project-tags]", project.tags);
  setAction(primaryAction, project.primary);
  setAction(secondaryAction, project.secondary);

  viewer.style.setProperty("--project-accent", project.accent);
  document.querySelector("[data-project-visual]").dataset.projectVisual = project.visual;

  document.querySelectorAll("[data-visual-layer]").forEach((layer) => {
    const isCurrent = layer.dataset.visualLayer === project.visual;
    layer.hidden = !isCurrent;
    layer.classList.toggle("is-active", isCurrent);
  });

  rowButtons.forEach((button) => {
    const isCurrent = button.dataset.project === id;
    button.classList.toggle("is-selected", isCurrent);
    button.setAttribute("aria-pressed", String(isCurrent));
  });

  populateMobilePreview(id, project);
  history.replaceState(null, "", `#${id}`);
  document.title = `${project.title} | Bob's App`;

  if (announce) announcer.textContent = `${project.title} selected.`;
}

rowButtons.forEach((button) => {
  const id = button.dataset.project;
  button.addEventListener("click", () => selectProject(id, true));
  button.addEventListener("focus", () => selectProject(id));

  if (window.matchMedia("(hover: hover)").matches) {
    button.addEventListener("pointerenter", () => selectProject(id));
  }
});

const requestedProject = window.location.hash.slice(1);
selectProject(projects[requestedProject] ? requestedProject : "voyager");
