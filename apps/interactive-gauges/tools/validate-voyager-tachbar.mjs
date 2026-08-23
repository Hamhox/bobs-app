#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const assetPath = path.resolve(toolDirectory, "..", "assets", "ui", "voyager-tachbar.svg");
const source = await readFile(assetPath, "utf8");
const expectedChecksum = "B3B632D96A19FBD257457555A78FFAC8B406FBE3EFB90E80571FC16ED906DA48";

if (!source.includes(`Source SHA-256: ${expectedChecksum}`)) {
  throw new Error("The tachbar derivative does not identify the reviewed v2 source.");
}
if (!/viewBox="0 0 504 303"/.test(source)) {
  throw new Error("The tachbar derivative does not use the Voyager screen coordinate system.");
}
if (/<(?:script|image|foreignObject|text)\b/i.test(source) || /\son[a-z]+\s*=/i.test(source)) {
  throw new Error("The tachbar derivative contains unsupported content.");
}

for (const width of ["wide", "thin"]) {
  for (const state of ["off", "on"]) {
    for (let index = 0; index < 15; index += 1) {
      const id = `tachbar-${width}-${state}-${index}`;
      if (!source.includes(`id="${id}"`)) throw new Error(`Missing ${id}.`);
    }
  }
  if (!source.includes(`id="tachbar-${width}-labels"`)) {
    throw new Error(`Missing tachbar-${width}-labels.`);
  }
}

const fills = [...source.matchAll(/\bfill="([^"]+)"/g)].map((match) => match[1].toUpperCase());
if (fills.some((fill) => !["#242021", "#7F7F7F"].includes(fill))) {
  throw new Error("The tachbar derivative contains an unexpected fill color.");
}

console.log("Voyager tachbar asset validation passed: 60 segments, 2 curved-label groups, reviewed v2 checksum.");
