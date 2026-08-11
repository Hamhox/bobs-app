import { projects, projectsById } from "./projects.js";

const consoleElement = document.querySelector(".project-console");
const projectList = document.querySelector("[data-project-list]");
const viewerHeading = document.querySelector("#active-title");
const announcer = document.querySelector("#project-announcer");
const primaryAction = document.querySelector("[data-primary-action]");
const secondaryAction = document.querySelector("[data-secondary-action]");
const phoneViewport = window.matchMedia("(max-width: 819px)");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

let activeProjectId = null;
let updateTimer;

function createProjectRow(project) {
  const item = document.createElement("li");
  item.dataset.projectItem = project.id;

  const button = document.createElement("button");
  button.className = "project-row";
  button.type = "button";
  button.dataset.project = project.id;
  button.setAttribute("aria-pressed", "false");
  button.setAttribute(
    "aria-label",
    `${project.number}, ${project.title}. ${project.indexSummary}. ${project.classification}.`,
  );

  const number = document.createElement("span");
  number.className = "row-number";
  number.textContent = project.number;

  const copy = document.createElement("span");
  copy.className = "row-copy";

  const title = document.createElement("strong");
  title.textContent = project.title;

  const outcome = document.createElement("span");
  outcome.className = "row-outcome";
  outcome.textContent = project.indexSummary;
  copy.append(title, outcome);

  const type = document.createElement("span");
  type.className = "row-type";
  type.textContent = project.classification;

  const marker = document.createElement("span");
  marker.className = "row-marker";
  marker.setAttribute("aria-hidden", "true");
  marker.textContent = "+";

  button.append(number, copy, type, marker);
  item.append(button);
  return item;
}

projectList.replaceChildren(...projects.map(createProjectRow));

const rowButtons = [...document.querySelectorAll("[data-project]")];

function replaceList(selector, items) {
  const list = document.querySelector(selector);
  list.replaceChildren(
    ...items.map((item) => {
      const listItem = document.createElement("li");
      listItem.textContent = item;
      return listItem;
    }),
  );
}

function replaceEvidence(entries) {
  const evidence = document.querySelector("[data-project-evidence]");
  const rows = entries.flatMap(([label, value]) => {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    return [term, description];
  });
  evidence.replaceChildren(...rows);
}

function setAction(element, action) {
  if (!action) {
    element.hidden = true;
    element.removeAttribute("href");
    return;
  }

  element.hidden = false;
  element.href = action.href;
  element.querySelector("[data-action-label]").textContent = action.label;
}

function animateUpdate() {
  window.clearTimeout(updateTimer);
  consoleElement.classList.remove("is-updating");
  void consoleElement.offsetWidth;
  consoleElement.classList.add("is-updating");
  updateTimer = window.setTimeout(
    () => consoleElement.classList.remove("is-updating"),
    260,
  );
}

function renderProject(project, { announce = false } = {}) {
  activeProjectId = project.id;

  document.querySelector("[data-project-number]").textContent = project.number;
  document.querySelector("[data-note-number]").textContent = project.number;
  document.querySelector("[data-index-label]").textContent = project.number;
  document.querySelector("[data-footer-number]").textContent = project.number;
  document.querySelector("[data-project-eyebrow]").textContent = project.eyebrow;
  document.querySelector("[data-project-type]").textContent = project.classification;
  document.querySelector("[data-project-outcome]").textContent = project.indexSummary;
  document.querySelector("[data-project-title]").textContent = project.title;
  document.querySelector("[data-project-thesis]").textContent = project.viewerSummary;
  document.querySelector("[data-visual-caption]").textContent = project.caption;
  document.querySelector("[data-visual-status]").textContent = project.visualStatus;
  document.querySelector("[data-selected-work]").textContent =
    `Selected work ${project.number}`;
  document.querySelector("[data-field-note]").textContent = project.fieldNote;

  replaceList("[data-project-facts]", project.facts);
  replaceList("[data-project-tags]", project.tags);
  replaceList("[data-project-artifacts]", project.artifacts);
  replaceEvidence(project.evidence);
  setAction(primaryAction, project.primaryAction);
  setAction(secondaryAction, project.secondaryAction);

  consoleElement.style.setProperty("--project-accent", project.accent);
  consoleElement.dataset.projectSignal = project.signal;
  document.querySelector("[data-project-visual]").dataset.projectVisual =
    project.visual;

  document.querySelectorAll("[data-visual-layer]").forEach((layer) => {
    const isCurrent = layer.dataset.visualLayer === project.visual;
    layer.hidden = !isCurrent;
    layer.classList.toggle("is-active", isCurrent);
  });

  rowButtons.forEach((button) => {
    const isCurrent = button.dataset.project === project.id;
    button.classList.toggle("is-selected", isCurrent);
    button.setAttribute("aria-pressed", String(isCurrent));
    if (isCurrent) button.setAttribute("aria-current", "true");
    else button.removeAttribute("aria-current");
  });

  document.title = `${project.title} | Bob's App`;
  animateUpdate();

  if (announce) announcer.textContent = `${project.title} selected.`;
}

function projectFromLocation() {
  const requestedId = decodeURIComponent(window.location.hash.slice(1));
  return projectsById.get(requestedId) || projects[0];
}

function updateLocation(project, mode) {
  const nextHash = `#${project.id}`;
  if (window.location.hash === nextHash) return;

  const method = mode === "replace" ? "replaceState" : "pushState";
  history[method]({ projectId: project.id }, "", nextHash);
}

function focusViewerOnPhone() {
  if (!phoneViewport.matches) return;

  window.requestAnimationFrame(() => {
    viewerHeading.focus({ preventScroll: true });
    document.querySelector("[data-project-visual]").scrollIntoView({
      behavior: reducedMotion.matches ? "auto" : "smooth",
      block: "start",
    });
  });
}

function selectProject(
  id,
  { historyMode = "push", announce = true, returnToViewer = false } = {},
) {
  const project = projectsById.get(id) || projects[0];

  if (project.id !== activeProjectId) {
    renderProject(project, { announce });
  }

  updateLocation(project, historyMode);
  if (returnToViewer) focusViewerOnPhone();
}

rowButtons.forEach((button) => {
  button.addEventListener("click", () => {
    selectProject(button.dataset.project, {
      historyMode: "push",
      announce: true,
      returnToViewer: true,
    });
  });

  button.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    button.click();
  });
});

function syncFromHistory() {
  const project = projectFromLocation();
  if (project.id === activeProjectId) return;
  renderProject(project, { announce: true });
}

window.addEventListener("popstate", syncFromHistory);
window.addEventListener("hashchange", syncFromHistory);

const initialProject = projectFromLocation();
renderProject(initialProject);
updateLocation(initialProject, "replace");
