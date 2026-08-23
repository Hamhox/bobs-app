#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const appDirectory = path.resolve(toolDirectory, "..");
const outputPath = path.join(appDirectory, "assets", "ui", "voyager-tachbar.svg");
const requiredGroups = [
  "tachbar-wide-off",
  "tachbar-wide-on",
  "tachbar-wide-labels",
  "tachbar-thin-off",
  "tachbar-thin-on",
  "tachbar-thin-labels",
];

function parseArguments(argv) {
  const sourceIndex = argv.indexOf("--source");
  if (sourceIndex === -1 || !argv[sourceIndex + 1]) {
    throw new Error("Usage: node tools/build-voyager-tachbar.mjs --source <voyager-tachbar.svg>");
  }
  return { source: path.resolve(argv[sourceIndex + 1]) };
}

function extractGroup(source, id) {
  const opening = new RegExp(`<g\\b[^>]*\\bid=["']${id}["'][^>]*>`, "i").exec(source);
  if (!opening) throw new Error(`Could not find the ${id} group.`);
  const tags = /<\/?g\b[^>]*>/gi;
  tags.lastIndex = opening.index;
  let depth = 0;
  let match;
  while ((match = tags.exec(source))) {
    depth += match[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return source.slice(opening.index, tags.lastIndex);
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
    /<text\b/i,
  ];
  if (blocked.some((expression) => expression.test(source))) {
    throw new Error("The tachbar source contains unsupported, executable, or externally referenced content.");
  }
  if (!/viewBox=["']0 0 504 303["']/i.test(source)) {
    throw new Error("The tachbar source must use the Voyager 504 by 303 coordinate system.");
  }
  const fills = [...source.matchAll(/\bfill=["']([^"']+)["']/gi)].map((match) => match[1].toUpperCase());
  if (fills.some((fill) => !["#242021", "#7F7F7F"].includes(fill))) {
    throw new Error("The tachbar source contains an unexpected fill color.");
  }
  for (const width of ["wide", "thin"]) {
    for (const state of ["off", "on"]) {
      for (let index = 0; index < 15; index += 1) {
        if (!new RegExp(`\\bid=["']tachbar-${width}-${state}-${index}["']`).test(source)) {
          throw new Error(`Missing tachbar-${width}-${state}-${index}.`);
        }
      }
    }
  }
}

const { source } = parseArguments(process.argv.slice(2));
const input = await readFile(source, "utf8");
assertSafe(input);
const checksum = createHash("sha256").update(input).digest("hex").toUpperCase();
const artwork = requiredGroups.map((id) => extractGroup(input, id))
  .join("\n")
  .replace(/\sdisplay=["'][^"']*["']/gi, "")
  .split(/\r?\n/)
  .map((line) => line.trimEnd())
  .join("\n");
const output = `<?xml version="1.0" encoding="utf-8"?>
<!-- Publication-approved Voyager tachbar artwork. Source SHA-256: ${checksum} -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 504 303">
${artwork}
</svg>
`;

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, output, "utf8");
console.log(`Wrote ${path.relative(appDirectory, outputPath)} (${Buffer.byteLength(output)} bytes).`);
