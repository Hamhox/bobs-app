import { getProject } from "./projects.js";

const params = new URLSearchParams(window.location.search);
const pathId = window.location.pathname.split("/").filter(Boolean).at(-1);
const id = params.get("project") || pathId || "voyager";
const project = getProject(id);
const isDemo = document.body.dataset.destinationType === "demo";

document.querySelector("[data-destination-number]").textContent = project.number;
document.querySelector("[data-destination-title]").textContent = project.title;
document.querySelector("[data-destination-thesis]").textContent =
  project.viewerSummary;
document.querySelector("[data-destination-label]").textContent =
  `${isDemo ? "Interactive route" : "Field file"} / selected work ${project.number.slice(-2)}`;
document.title = `${project.title} | Bob's App`;
