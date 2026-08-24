#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const appDirectory = path.resolve(toolDirectory, "..");
const outputPath = path.join(appDirectory, "assets", "ui", "voyager-ui-icons.svg");
const screenInk = "currentColor";
const screenStroke = "var(--voyager-ink, #242021)";
const screenSurface = "var(--voyager-screen, #f5f3ee)";

function parseArguments(argv) {
  const sourceIndex = argv.indexOf("--source");
  if (sourceIndex === -1 || !argv[sourceIndex + 1]) {
    throw new Error("Usage: node tools/build-voyager-ui-kit.mjs --source <voyager-ui-kit.svg>");
  }
  return { source: path.resolve(argv[sourceIndex + 1]) };
}

function extractGroup(source, id) {
  const opening = new RegExp(`<g\\b[^>]*\\bid=["']${id}["'][^>]*>`, "i").exec(source);
  if (!opening) throw new Error(`Could not find the ${id} group.`);

  const start = opening.index;
  const tags = /<\/?g\b[^>]*>/gi;
  tags.lastIndex = start;
  let depth = 0;
  let match;

  while ((match = tags.exec(source))) {
    depth += match[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return source.slice(start, tags.lastIndex);
  }

  throw new Error(`The ${id} group is not balanced.`);
}

function assertSafe(source) {
  const blocked = [
    /<script\b/i,
    /\son[a-z]+\s*=/i,
    /\b(?:href|xlink:href)\s*=/i,
    /<image\b/i,
    /<foreignObject\b/i,
  ];
  if (blocked.some((expression) => expression.test(source))) {
    throw new Error("The source contains executable or externally referenced content.");
  }
}

function normalizeRuntimeArtwork(icons) {
  const inkNormalized = icons.replace(
    /<g\b([^>]*\bid=["']ICONS["'][^>]*)>/i,
    `<g$1 fill="${screenInk}">`,
  );
  const weakPill = /<path id="circle-digit-white" d="([\s\S]*?)"\/>/.exec(inkNormalized);
  if (!weakPill) throw new Error("Could not find the authored weak satellite pill path.");

  const faceStart = weakPill[1].indexOf(" M80.657,78.24");
  if (faceStart === -1) throw new Error("Could not split the weak satellite pill shell and face.");
  const shell = weakPill[1].slice(0, faceStart);
  const face = weakPill[1].slice(faceStart + 1);
  const reconstructedPill = `<g id="circle-digit-white">
		<path d="${shell}" stroke="${screenStroke}" stroke-width="6" vector-effect="non-scaling-stroke"/>
		<path d="${face}" fill="${screenSurface}"/>
	</g>`;

  return inkNormalized.replace(weakPill[0], reconstructedPill);
}

const { source } = parseArguments(process.argv.slice(2));
const input = await readFile(source, "utf8");
assertSafe(input);

const icons = extractGroup(input, "ICONS").replace(
  /<g>\s*(?=<rect x="61\.939" y="54\.646")/,
  '<g id="panzoom-pill">',
);
if (!icons.includes('id="panzoom-pill"')) {
  throw new Error("Could not name the authored pan/zoom pill group.");
}
const normalizedIcons = normalizeRuntimeArtwork(icons)
  .split(/\r?\n/)
  .map((line) => line.trimEnd())
  .join("\n");
const output = `<?xml version="1.0" encoding="utf-8"?>
<!-- Publication-approved Voyager UI icon artwork. Generated from the reviewed source kit. -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 120">
${normalizedIcons}
</svg>
`;

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, output, "utf8");
console.log(`Wrote ${path.relative(appDirectory, outputPath)} (${Buffer.byteLength(output)} bytes).`);
