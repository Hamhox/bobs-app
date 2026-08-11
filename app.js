import { projects, projectsById } from "./projects.js";

const projectList = document.querySelector("[data-project-list]");

function createProjectRow(project) {
  const item = document.createElement("li");
  item.dataset.projectItem = project.id;

  const button = document.createElement("button");
  button.className = "project-row";
  button.type = "button";
  button.dataset.project = project.id;
  button.setAttribute("aria-pressed", "false");

  const number = document.createElement("span");
  number.className = "row-number";
  number.textContent = project.number.slice(-2);

  const title = document.createElement("strong");
  title.textContent = project.title;

  const outcome = document.createElement("span");
  outcome.className = "row-outcome";
  outcome.textContent = project.indexSummary;

  const type = document.createElement("span");
  type.className = "row-type";
  type.textContent = project.classification;

  const arrow = document.createElement("span");
  arrow.className = "row-arrow";
  arrow.setAttribute("aria-hidden", "true");
  arrow.textContent = "↗";

  button.append(number, title, outcome, type, arrow);

  const mobilePreview = document.createElement("div");
  mobilePreview.className = "mobile-project-preview";
  mobilePreview.dataset.mobilePreview = "";
  mobilePreview.hidden = true;

  item.append(button, mobilePreview);
  return item;
}

projectList.replaceChildren(...projects.map(createProjectRow));

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
    thesis.textContent = project.viewerSummary;

    const action = document.createElement("a");
    action.href = project.primaryAction.href;
    action.textContent = `${project.primaryAction.label} ↗`;

    preview.append(thesis, action);
  });
}

function selectProject(id, announce = false) {
  const project = projectsById.get(id);
  if (!project) return;

  document.querySelector("[data-project-number]").textContent =
    project.number.slice(-2);
  document.querySelector("[data-index-label]").textContent = project.number;
  document.querySelector("[data-project-type]").textContent =
    project.classification;
  document.querySelector("[data-project-outcome]").textContent =
    project.indexSummary;
  document.querySelector("[data-project-title]").textContent = project.title;
  document.querySelector("[data-project-thesis]").textContent =
    project.viewerSummary;
  document.querySelector("[data-visual-caption]").textContent = project.caption;
  document.querySelector(".project-visual figcaption span:last-child").textContent =
    `Selected work ${project.number.slice(-2)}`;

  setList("[data-project-facts]", project.facts);
  setList("[data-project-tags]", project.tags);
  setAction(primaryAction, project.primaryAction);
  setAction(secondaryAction, project.secondaryAction);

  viewer.style.setProperty("--project-accent", project.accent);
  document.querySelector("[data-project-visual]").dataset.projectVisual =
    project.visual;

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
selectProject(projectsById.has(requestedProject) ? requestedProject : projects[0].id);
