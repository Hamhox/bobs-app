import { getProject } from "./projects.js";

const params = new URLSearchParams(window.location.search);
const pathId = window.location.pathname.split("/").filter(Boolean).at(-1);
const id = params.get("project") || pathId || "voyager";
const project = getProject(id);
const isDemo = document.body.dataset.destinationType === "demo";
const destinationGrid = document.querySelector(".destination-grid");
const destinationCopy = document.querySelector("[data-destination-copy]");
const destinationLede = document.querySelector("[data-destination-lede]");
const destinationVideo = document.querySelector("[data-destination-video]");

document.querySelector("[data-destination-number]").textContent = project.number;
document.querySelector("[data-destination-title]").textContent = project.title;
document.querySelector("[data-destination-thesis]").textContent =
  project.viewerSummary;
document.querySelector("[data-destination-label]").textContent =
  `${isDemo ? "Interactive route" : "Field file"} / selected work ${project.number.slice(-2)}`;
document.title = `${project.title} | Bob's App`;
document.querySelector('meta[name="description"]').content = project.viewerSummary;

if (!isDemo && project.video?.provider === "youtube" && destinationLede && destinationVideo) {
  const iframe = document.createElement("iframe");
  iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(project.video.id)}?rel=0`;
  iframe.title = project.video.title;
  iframe.loading = "lazy";
  iframe.referrerPolicy = "strict-origin-when-cross-origin";
  iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
  iframe.allowFullscreen = true;

  document.body.classList.add("destination-body--video-story");
  destinationGrid.classList.add("destination-grid--video");
  destinationCopy.hidden = true;
  destinationLede.textContent = project.viewerSummary;
  destinationLede.hidden = false;
  destinationVideo.append(iframe);
  destinationVideo.hidden = false;
}
