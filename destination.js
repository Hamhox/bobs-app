const projectDetails = {
  voyager: {
    number: "001",
    selected: "01",
    title: "Voyager",
    thesis: "A rugged mapping interface designed in the browser before firmware and tooling were locked.",
  },
  buildbooks: {
    number: "002",
    selected: "02",
    title: "Buildbooks",
    thesis: "A long-lived product system connecting product data, BOMs, production labels, imagery, and operational lookup.",
  },
  fitapp: {
    number: "003",
    selected: "03",
    title: "FitApp",
    thesis: "A workflow for cleaning, comparing, editing, and preparing fitment data for import.",
  },
  "gauge-evolution": {
    number: "004",
    selected: "04",
    title: "Gauge evolution",
    thesis: "Twenty years of interface, product, and market decisions across Trail Tech's gauge product line.",
  },
  "voyager-pro4": {
    number: "005",
    selected: "05",
    title: "Voyager Pro4",
    thesis: "A connected launch system spanning the device, product story, packaging, imagery, and retail materials.",
  },
  "product-surface": {
    number: "006",
    selected: "06",
    title: "Product surface",
    thesis: "The public and operational systems surrounding the product: photography, packaging, pages, data, documentation, and launch.",
  },
};

const params = new URLSearchParams(window.location.search);
const pathId = window.location.pathname.split("/").filter(Boolean).at(-1);
const id = params.get("project") || pathId || "voyager";
const project = projectDetails[id] || projectDetails.voyager;
const isDemo = document.body.dataset.destinationType === "demo";

document.querySelector("[data-destination-number]").textContent = project.number;
document.querySelector("[data-destination-title]").textContent = project.title;
document.querySelector("[data-destination-thesis]").textContent = project.thesis;
document.querySelector("[data-destination-label]").textContent = `${isDemo ? "Interactive route" : "Field file"} / selected work ${project.selected}`;
document.title = `${project.title} | Bob's App`;
