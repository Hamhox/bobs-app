#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseVoyagerRideArea } from "../voyager-live-runtime.js";

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const appDirectory = path.resolve(toolDirectory, "..");
const expectations = Object.freeze([
  {
    file: "baker-west-desert.voyager.json",
    networkSegments: 15,
    rides: 5,
    sourceSha256: "bc54fc305e2e61879a7f390c94e4df3f9f923bbe954631dc7e1eda93715ce7eb",
  },
  {
    file: "jordan-creek.voyager.json",
    networkSegments: 6,
    rides: 3,
    sourceSha256: "e4afe97890ae47cf58ed7fcf2cfe9ab6fd363ebf6257d1debf74815c736b24d3",
  },
]);

const report = [];
for (const expectation of expectations) {
  const filePath = path.join(appDirectory, "assets", "rides", expectation.file);
  const raw = JSON.parse(await readFile(filePath, "utf8"));
  const parsed = parseVoyagerRideArea(raw);
  if (raw.source?.sha256 !== expectation.sourceSha256) {
    throw new Error(`${expectation.file} does not match its reviewed source hash.`);
  }
  if (parsed.networkSegments.length !== expectation.networkSegments) {
    throw new Error(`${expectation.file} has ${parsed.networkSegments.length} network segments; expected ${expectation.networkSegments}.`);
  }
  if (parsed.rides.length !== expectation.rides) {
    throw new Error(`${expectation.file} has ${parsed.rides.length} rides; expected ${expectation.rides}.`);
  }
  if (parsed.rides.some((ride) => ride.points.length > 1600)) {
    throw new Error(`${expectation.file} exceeds the 1,600-point playback budget.`);
  }
  if (parsed.rides.some((ride) => !ride.points.some((point) => Number.isFinite(point.speedKph)))) {
    throw new Error(`${expectation.file} has a playback ride without recorded speed telemetry.`);
  }
  if (parsed.rides.some((ride) => !ride.points.some((point) => Number.isFinite(point.engineTemperatureC)))) {
    throw new Error(`${expectation.file} has a playback ride without engine-temperature telemetry.`);
  }
  report.push({
    file: expectation.file,
    networkPoints: parsed.networkSegments.reduce((sum, segment) => sum + segment.length, 0),
    networkSegments: parsed.networkSegments.length,
    ridePoints: parsed.rides.map((ride) => ride.points.length),
    rides: parsed.rides.map((ride) => ride.label),
  });
}

console.log(JSON.stringify(report, null, 2));
