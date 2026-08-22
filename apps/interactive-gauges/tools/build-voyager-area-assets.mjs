import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const appDirectory = path.resolve(toolDirectory, "..");
const sourceDirectory = process.argv[2];

if (!sourceDirectory) {
  throw new Error("Pass the reviewed ai-working GPX directory as the first argument.");
}

const AREA_CONFIGS = Object.freeze([
  {
    id: "baker-west-desert",
    label: "BAKER WEST",
    outputFile: "baker-west-desert.voyager.json",
    sourceFile: path.join("contained-areas", "ut-baker-west-desert-trail-network.gpx"),
    networkGroups: ({ tracks }) => tracks.slice(0, 11),
    rides: ({ tracks }) => tracks.slice(11).map((track, index) => ({
      group: track,
      id: ["mh1-am", "mh2-mid", "mh3-pm", "mh4", "mh5-am"][index],
      label: ["MH1 AM", "MH2 MID", "MH3 PM", "MH4", "MH5 AM"][index],
    })),
  },
  {
    id: "jordan-creek",
    label: "JORDAN CREEK",
    outputFile: "jordan-creek.voyager.json",
    sourceFile: path.join("contained-areas", "or-jordan-creek-ohv-loop-network.gpx"),
    networkGroups: ({ routes }) => routes,
    rides: ({ routes }) => [
      { group: routes[1], id: "long-loop", label: "LONG LOOP" },
      { group: routes[3], id: "short-loop", label: "SHORT LOOP" },
      { group: routes[5], id: "ridge-loop", label: "RIDGE LOOP" },
    ],
  },
]);

function fragments(source, tagName) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)</${tagName}>`, "gi");
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

function elementText(fragment, name) {
  return fragment.match(new RegExp(`<${name}[^>]*>([^<]*)</${name}>`, "i"))?.[1]?.trim() ?? "";
}

function attribute(fragment, name) {
  return fragment.match(new RegExp(`\\b${name}="([^"]*)"`, "i"))?.[1] ?? "";
}

function numericAttribute(fragment, name) {
  const value = attribute(fragment, name);
  if (!value) return Number.NaN;
  return Number(value);
}

function parsePoints(fragment, pointTag) {
  const pattern = new RegExp(`<${pointTag}\\b([^>]*)>([\\s\\S]*?)</${pointTag}>`, "gi");
  return [...fragment.matchAll(pattern)].map((match) => {
    const body = match[2];
    const rideData = body.match(/<TT:RideData\b([^>]*)\/?\s*>/i)?.[1] ?? "";
    return {
      latitude: Number(attribute(match[1], "lat")),
      longitude: Number(attribute(match[1], "lon")),
      elevation: Number(elementText(body, "ele")),
      time: Date.parse(elementText(body, "time")),
      engineTemperatureC: numericAttribute(rideData, "eng"),
      airTemperatureC: numericAttribute(rideData, "air"),
      speedKph: numericAttribute(rideData, "spd"),
      rpm: numericAttribute(rideData, "rpm"),
    };
  }).filter((point) => Number.isFinite(point.latitude + point.longitude));
}

function parseGroups(source, groupTag, segmentTag, pointTag) {
  return fragments(source, groupTag).map((body, index) => {
    const segmentBodies = segmentTag ? fragments(body, segmentTag) : [body];
    return {
      name: elementText(body, "name") || `${groupTag.toUpperCase()} ${index + 1}`,
      segments: segmentBodies
        .map((segment) => parsePoints(segment, pointTag))
        .filter((points) => points.length > 1),
    };
  }).filter((group) => group.segments.length);
}

function parseWaypoints(source) {
  const pattern = /<wpt\b([^>]*)>([\s\S]*?)<\/wpt>/gi;
  return [...source.matchAll(pattern)].map((match) => ({
    latitude: Number(attribute(match[1], "lat")),
    longitude: Number(attribute(match[1], "lon")),
    name: elementText(match[2], "name"),
  })).filter((waypoint) => waypoint.name && Number.isFinite(waypoint.latitude + waypoint.longitude));
}

function sampleToMaximum(points, maximumPoints) {
  if (points.length <= maximumPoints) return points;
  return Array.from({ length: maximumPoints }, (_, index) => (
    points[Math.round(index * (points.length - 1) / (maximumPoints - 1))]
  ));
}

function fixed(value, precision) {
  return Number.isFinite(value) ? Number(value.toFixed(precision)) : null;
}

function encodeNetworkPoint(point) {
  return [fixed(point.latitude, 6), fixed(point.longitude, 6)];
}

function encodeRidePoint(point, timestamp) {
  return [
    fixed(point.latitude, 6),
    fixed(point.longitude, 6),
    fixed(point.elevation, 1),
    timestamp,
    fixed(point.engineTemperatureC, 1),
    fixed(point.airTemperatureC, 1),
    fixed(point.speedKph, 1),
    fixed(point.rpm, 0),
  ];
}

function encodeRide(ride, rideIndex) {
  const sourcePoints = ride.group.segments.flat();
  const points = sampleToMaximum(sourcePoints, 1600);
  const firstTime = points.find((point) => Number.isFinite(point.time))?.time;
  const startTime = Date.UTC(2026, 7, 20, 15 + rideIndex * 2, 0, 0);
  return {
    id: ride.id,
    label: ride.label,
    sourcePoints: sourcePoints.length,
    points: points.map((point, index) => {
      const elapsed = Number.isFinite(point.time) && Number.isFinite(firstTime)
        ? Math.max(0, point.time - firstTime)
        : index * 2000;
      return encodeRidePoint(point, startTime + elapsed);
    }),
  };
}

async function buildArea(config) {
  const sourcePath = path.join(sourceDirectory, config.sourceFile);
  const source = await readFile(sourcePath, "utf8");
  const groups = {
    routes: parseGroups(source, "rte", null, "rtept"),
    tracks: parseGroups(source, "trk", "trkseg", "trkpt"),
  };
  const network = config.networkGroups(groups)
    .flatMap((group) => group.segments)
    .map((segment) => sampleToMaximum(segment, 240).map(encodeNetworkPoint));
  const rides = config.rides(groups).map(encodeRide);
  if (!network.length || !rides.length || rides.some((ride) => ride.points.length < 2)) {
    throw new Error(`Could not build usable Voyager area ${config.id}.`);
  }
  const pack = {
    version: 1,
    kind: "voyager-ride-area",
    id: config.id,
    label: config.label,
    source: {
      file: config.sourceFile.replaceAll("\\", "/"),
      sha256: createHash("sha256").update(source).digest("hex"),
    },
    network,
    rides,
    waypoints: parseWaypoints(source).map((waypoint) => ({
      name: waypoint.name,
      latitude: fixed(waypoint.latitude, 6),
      longitude: fixed(waypoint.longitude, 6),
    })),
  };
  const outputDirectory = path.join(appDirectory, "assets", "rides");
  await mkdir(outputDirectory, { recursive: true });
  const outputPath = path.join(outputDirectory, config.outputFile);
  await writeFile(outputPath, `${JSON.stringify(pack)}\n`);
  return {
    id: pack.id,
    networkSegments: pack.network.length,
    networkPoints: pack.network.reduce((sum, segment) => sum + segment.length, 0),
    outputFile: config.outputFile,
    ridePoints: pack.rides.map((ride) => ride.points.length),
    rides: pack.rides.map((ride) => ride.label),
    sourcePoints: pack.rides.map((ride) => ride.sourcePoints),
    waypoints: pack.waypoints.length,
  };
}

const results = [];
for (const config of AREA_CONFIGS) results.push(await buildArea(config));
console.log(JSON.stringify(results, null, 2));
