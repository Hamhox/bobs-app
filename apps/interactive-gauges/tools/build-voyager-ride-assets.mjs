import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const appDirectory = path.resolve(toolDirectory, "..");
const sourceDirectory = process.argv[2];

if (!sourceDirectory) {
  throw new Error("Pass the reviewed GPX library directory as the first argument.");
}

const escapeXml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

function elementText(fragment, name) {
  return fragment.match(new RegExp(`<${name}[^>]*>([^<]*)</${name}>`, "i"))?.[1]?.trim() ?? "";
}

function attribute(fragment, name) {
  return fragment.match(new RegExp(`\\b${name}="([^"]*)"`, "i"))?.[1] ?? "";
}

function parsePoints(fragment, pointTag) {
  const pointPattern = new RegExp(`<${pointTag}\\b([^>]*)>([\\s\\S]*?)</${pointTag}>`, "gi");
  return [...fragment.matchAll(pointPattern)].map((match) => {
    const body = match[2];
    const rideData = body.match(/<TT:RideData\b([^>]*)\/?\s*>/i)?.[1] ?? "";
    return {
      latitude: Number(attribute(match[1], "lat")),
      longitude: Number(attribute(match[1], "lon")),
      elevation: Number(elementText(body, "ele")),
      timestamp: Date.parse(elementText(body, "time")),
      engineC: Number(attribute(rideData, "eng")),
      airC: Number(attribute(rideData, "air")),
      speedKph: Number(attribute(rideData, "spd")),
      rpm: Number(attribute(rideData, "rpm")),
    };
  }).filter((point) => [
    point.latitude,
    point.longitude,
    point.elevation,
    point.timestamp,
    point.engineC,
    point.airC,
    point.speedKph,
    point.rpm,
  ].every(Number.isFinite));
}

function namedRoute(source, routeName) {
  const route = [...source.matchAll(/<rte\b[^>]*>([\s\S]*?)<\/rte>/gi)]
    .map((match) => match[1])
    .find((fragment) => elementText(fragment, "name") === routeName);
  if (!route) throw new Error(`Could not find route ${routeName}.`);
  return parsePoints(route, "rtept");
}

function firstTrack(source) {
  const track = source.match(/<trk\b[^>]*>([\s\S]*?)<\/trk>/i)?.[1];
  if (!track) throw new Error("Could not find a track in the reviewed GPX source.");
  return parsePoints(track, "trkpt");
}

function chronological(points) {
  if (points.length > 1 && points[0].timestamp > points.at(-1).timestamp) return [...points].reverse();
  return points;
}

function sample(points, stride) {
  const sampled = points.filter((_, index) => index % stride === 0);
  if (sampled.at(-1) !== points.at(-1)) sampled.push(points.at(-1));
  return sampled;
}

function serializeRide(label, sourceLabel, points, startTime) {
  const originalStart = points[0].timestamp;
  const trackPoints = points.map((point) => {
    const timestamp = new Date(startTime + Math.max(0, point.timestamp - originalStart)).toISOString();
    return `      <trkpt lat="${point.latitude.toFixed(6)}" lon="${point.longitude.toFixed(6)}"><ele>${point.elevation.toFixed(1)}</ele><time>${timestamp}</time><extensions><TT:RideData eng="${point.engineC.toFixed(1)}" air="${point.airC.toFixed(1)}" spd="${point.speedKph.toFixed(1)}" rpm="${point.rpm.toFixed(0)}"/></extensions></trkpt>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Bob's App reviewed Voyager ride export" xmlns="http://www.topografix.com/GPX/1/1" xmlns:TT="http://www.trailtech.net/xml">
  <metadata><name>${escapeXml(label)}</name><desc>Performance-reduced ride data derived from approved ${escapeXml(sourceLabel)}.</desc></metadata>
  <trk><name>${escapeXml(label)}</name><trkseg>
${trackPoints}
  </trkseg></trk>
</gpx>
`;
}

const cmraSource = await readFile(path.join(sourceDirectory, "CMRA (1).gpx"), "utf8");
const blackdogSource = await readFile(path.join(sourceDirectory, "2016 Blackdog.gpx"), "utf8");
const cmraPoints = sample(chronological(namedRoute(cmraSource, "Trail 2")), 2);
const blackdogPoints = sample(chronological(firstTrack(blackdogSource)), 4);
const outputDirectory = path.join(appDirectory, "assets", "rides");

await Promise.all([
  writeFile(
    path.join(outputDirectory, "cmra-trail-2.gpx"),
    serializeRide("CMRA TRAIL 2", "CMRA Trail 2", cmraPoints, Date.UTC(2026, 7, 18, 12, 30)),
  ),
  writeFile(
    path.join(outputDirectory, "blackdog-2016.gpx"),
    serializeRide("2016 BLACKDOG", "2016 Blackdog", blackdogPoints, Date.UTC(2026, 7, 18, 14, 0)),
  ),
]);

console.log(JSON.stringify({
  cmra: { points: cmraPoints.length, sourcePoints: 6242 },
  blackdog: { points: blackdogPoints.length, sourcePoints: 10801 },
}, null, 2));
