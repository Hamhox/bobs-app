#!/usr/bin/env python3
"""Build an isolated Voyager route/track memory stress-test bundle.

The input must be the validated Yacolt Burn Pilot C payload. Every source track
is mirrored to one route without changing point order or coordinates. The
route-only file tests the documented route pool; the combined file deliberately
exceeds a hypothetical shared 72,500-point pool while keeping the documented
track, route, and per-pool point counts within their individual limits.

This is QA-only tooling. It does not modify Pilot C, Pilot D, or canonical data.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
import hashlib
import json
import os
from pathlib import Path
import shutil
import uuid
import xml.etree.ElementTree as ET


GPX_NS = "http://www.topografix.com/GPX/1/1"
XSI_NS = "http://www.w3.org/2001/XMLSchema-instance"
SCHEMA_LOCATION = f"{GPX_NS} http://www.topografix.com/GPX/1/1/gpx.xsd"

EXPECTED_PILOT_C_SHA256 = (
    "9041914bc35eedc545c88c4fe5f910eacab1c818b5d2c9570ae44039cfae29b2"
)
EXPECTED_TRACK_COUNT = 300
EXPECTED_TRACK_POINT_COUNT = 69_420
MAX_TRACKS = 300
MAX_ROUTES = 300
MAX_TRACK_POINTS = 72_500
MAX_ROUTE_POINTS = 72_500
MAX_ROUTE_NAME_LENGTH = 12

PURPOSE = "qa-only-voyager-route-track-pool-stress-test"
MANIFEST_NAME = "voyager-route-pool-stress-manifest.json"
ROUTE_ONLY_NAME = "voyager-route-pool-stress-route-only.gpx"
COMBINED_NAME = "voyager-route-pool-stress-combined.gpx"
README_NAME = "voyager-route-pool-stress-README.txt"

ET.register_namespace("", GPX_NS)
ET.register_namespace("xsi", XSI_NS)


def qname(name: str) -> str:
    return f"{{{GPX_NS}}}{name}"


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


@dataclass(frozen=True)
class Point:
    latitude: str
    longitude: str


@dataclass(frozen=True)
class Track:
    name: str
    points: tuple[Point, ...]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Mirror validated Pilot C tracks into a QA-only route stress test."
    )
    parser.add_argument("pilot_c_gpx", type=Path, help="Validated Pilot C GPX file.")
    parser.add_argument("--output", type=Path, required=True, help="QA bundle directory.")
    return parser.parse_args()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def checked_coordinate(value: str | None, label: str) -> str:
    if value is None:
        raise RuntimeError(f"Pilot C point is missing {label}.")
    try:
        number = Decimal(value)
    except InvalidOperation as error:
        raise RuntimeError(f"Pilot C point has invalid {label}.") from error
    if not number.is_finite():
        raise RuntimeError(f"Pilot C point has non-finite {label}.")
    if label == "latitude" and not (Decimal("-90") <= number <= Decimal("90")):
        raise RuntimeError("Pilot C latitude is out of range.")
    if label == "longitude" and not (Decimal("-180") <= number <= Decimal("180")):
        raise RuntimeError("Pilot C longitude is out of range.")
    return value


def validate_source(path: Path) -> tuple[Track, ...]:
    if not path.is_file():
        raise RuntimeError(f"Pilot C GPX does not exist: {path}")
    source_hash = sha256_file(path)
    if source_hash != EXPECTED_PILOT_C_SHA256:
        raise RuntimeError(
            "Pilot C SHA-256 does not match the physically validated payload: "
            f"{source_hash}"
        )

    root = ET.parse(path).getroot()
    if root.tag != qname("gpx") or root.get("version") != "1.1":
        raise RuntimeError("Pilot C input is not namespaced GPX 1.1.")

    ranks = {"metadata": 0, "wpt": 1, "rte": 2, "trk": 3}
    child_ranks = [ranks.get(local_name(child.tag), 99) for child in root]
    if child_ranks != sorted(child_ranks) or 99 in child_ranks:
        raise RuntimeError("Pilot C input violates GPX 1.1 child order.")

    local_counts: dict[str, int] = {}
    for element in root.iter():
        name = local_name(element.tag)
        local_counts[name] = local_counts.get(name, 0) + 1
    for forbidden in ("wpt", "rte", "ele", "time", "extensions"):
        if local_counts.get(forbidden, 0):
            raise RuntimeError(f"Pilot C input contains forbidden {forbidden} elements.")

    tracks: list[Track] = []
    for index, track_node in enumerate(root.findall(qname("trk")), start=1):
        name_node = track_node.find(qname("name"))
        name = (
            name_node.text.strip()
            if name_node is not None and name_node.text
            else f"Pilot C {index:03d}"
        )
        segments = track_node.findall(qname("trkseg"))
        if len(segments) != 1:
            raise RuntimeError("Every Pilot C track must contain exactly one trkseg.")
        points = tuple(
            Point(
                checked_coordinate(point.get("lat"), "latitude"),
                checked_coordinate(point.get("lon"), "longitude"),
            )
            for point in segments[0].findall(qname("trkpt"))
        )
        if len(points) < 2:
            raise RuntimeError("Pilot C input contains a track with fewer than two points.")
        tracks.append(Track(name, points))

    point_count = sum(len(track.points) for track in tracks)
    if len(tracks) != EXPECTED_TRACK_COUNT or point_count != EXPECTED_TRACK_POINT_COUNT:
        raise RuntimeError(
            "Pilot C input count mismatch: expected "
            f"{EXPECTED_TRACK_COUNT} tracks / {EXPECTED_TRACK_POINT_COUNT:,} points; "
            f"found {len(tracks)} / {point_count:,}."
        )
    return tuple(tracks)


def root_node(metadata_name: str, description: str) -> ET.Element:
    root = ET.Element(
        qname("gpx"),
        {
            "version": "1.1",
            "creator": "Bob's App Voyager QA",
            qname_for_xsi("schemaLocation"): SCHEMA_LOCATION,
        },
    )
    metadata = ET.SubElement(root, qname("metadata"))
    ET.SubElement(metadata, qname("name")).text = metadata_name
    ET.SubElement(metadata, qname("desc")).text = description
    return root


def qname_for_xsi(name: str) -> str:
    return f"{{{XSI_NS}}}{name}"


def add_routes(root: ET.Element, tracks: tuple[Track, ...]) -> None:
    for index, track in enumerate(tracks, start=1):
        route = ET.SubElement(root, qname("rte"))
        route_name = f"{index:03d} QA Route"
        if len(route_name) > MAX_ROUTE_NAME_LENGTH:
            raise RuntimeError("QA route name exceeds the device-safe limit.")
        ET.SubElement(route, qname("name")).text = route_name
        for point in track.points:
            ET.SubElement(
                route,
                qname("rtept"),
                {"lat": point.latitude, "lon": point.longitude},
            )


def add_tracks(root: ET.Element, tracks: tuple[Track, ...]) -> None:
    for track in tracks:
        track_node = ET.SubElement(root, qname("trk"))
        ET.SubElement(track_node, qname("name")).text = track.name
        segment = ET.SubElement(track_node, qname("trkseg"))
        for point in track.points:
            ET.SubElement(
                segment,
                qname("trkpt"),
                {"lat": point.latitude, "lon": point.longitude},
            )


def write_compact_gpx(
    path: Path,
    metadata_name: str,
    description: str,
    tracks: tuple[Track, ...],
    include_routes: bool,
    include_tracks: bool,
) -> None:
    root = root_node(metadata_name, description)
    # GPX 1.1 order: metadata, wpt*, rte*, trk*. This QA output has zero wpt.
    if include_routes:
        add_routes(root, tracks)
    if include_tracks:
        add_tracks(root, tracks)
    temporary = path.with_suffix(path.suffix + ".tmp")
    ET.ElementTree(root).write(
        temporary,
        encoding="utf-8",
        xml_declaration=True,
        short_empty_elements=False,
    )
    os.replace(temporary, path)


def point_signature(points: tuple[Point, ...]) -> str:
    digest = hashlib.sha256()
    for point in points:
        digest.update(point.latitude.encode("utf-8"))
        digest.update(b"\x1f")
        digest.update(point.longitude.encode("utf-8"))
        digest.update(b"\x1e")
    return digest.hexdigest()


def validate_output(
    path: Path,
    expected_tracks: tuple[Track, ...],
    expected_route_count: int,
    expected_track_count: int,
) -> dict:
    root = ET.parse(path).getroot()
    if root.tag != qname("gpx") or root.get("version") != "1.1":
        raise RuntimeError(f"Derived output is not namespaced GPX 1.1: {path}")

    ranks = {"metadata": 0, "wpt": 1, "rte": 2, "trk": 3}
    child_ranks = [ranks.get(local_name(child.tag), 99) for child in root]
    if child_ranks != sorted(child_ranks) or 99 in child_ranks:
        raise RuntimeError("Derived output violates GPX 1.1 child order.")

    local_counts: dict[str, int] = {}
    for element in root.iter():
        name = local_name(element.tag)
        local_counts[name] = local_counts.get(name, 0) + 1
    for forbidden in ("wpt", "ele", "time", "extensions"):
        if local_counts.get(forbidden, 0):
            raise RuntimeError(f"Derived output contains forbidden {forbidden} elements.")

    route_nodes = root.findall(qname("rte"))
    track_nodes = root.findall(qname("trk"))
    if len(route_nodes) != expected_route_count or len(track_nodes) != expected_track_count:
        raise RuntimeError("Derived route/track count mismatch.")

    route_names: list[str] = []
    route_points: list[tuple[Point, ...]] = []
    for index, route in enumerate(route_nodes, start=1):
        name_node = route.find(qname("name"))
        name = name_node.text.strip() if name_node is not None and name_node.text else ""
        if name != f"{index:03d} QA Route" or len(name) > MAX_ROUTE_NAME_LENGTH:
            raise RuntimeError("Derived QA route name is missing, long, or out of order.")
        route_names.append(name)
        route_points.append(
            tuple(
                Point(
                    checked_coordinate(point.get("lat"), "latitude"),
                    checked_coordinate(point.get("lon"), "longitude"),
                )
                for point in route.findall(qname("rtept"))
            )
        )
    if len({name[:MAX_ROUTE_NAME_LENGTH] for name in route_names}) != len(route_names):
        raise RuntimeError("QA route names collide after conservative truncation.")

    track_points: list[tuple[Point, ...]] = []
    for track in track_nodes:
        segments = track.findall(qname("trkseg"))
        if len(segments) != 1:
            raise RuntimeError("Derived track does not contain exactly one trkseg.")
        track_points.append(
            tuple(
                Point(
                    checked_coordinate(point.get("lat"), "latitude"),
                    checked_coordinate(point.get("lon"), "longitude"),
                )
                for point in segments[0].findall(qname("trkpt"))
            )
        )

    expected_points = [track.points for track in expected_tracks]
    if route_points and route_points != expected_points:
        raise RuntimeError("Derived routes differ from Pilot C coordinates or point order.")
    if track_points and track_points != expected_points:
        raise RuntimeError("Derived tracks differ from Pilot C coordinates or point order.")

    route_point_count = sum(len(points) for points in route_points)
    track_point_count = sum(len(points) for points in track_points)
    combined_point_count = route_point_count + track_point_count
    if len(route_nodes) > MAX_ROUTES or route_point_count > MAX_ROUTE_POINTS:
        raise RuntimeError("Derived route payload exceeds an individual Voyager limit.")
    if len(track_nodes) > MAX_TRACKS or track_point_count > MAX_TRACK_POINTS:
        raise RuntimeError("Derived track payload exceeds an individual Voyager limit.")

    return {
        "file": path.name,
        "bytes": path.stat().st_size,
        "sha256": sha256_file(path),
        "waypointCount": local_counts.get("wpt", 0),
        "routeCount": len(route_nodes),
        "routePointCount": route_point_count,
        "trackCount": len(track_nodes),
        "trackPointCount": track_point_count,
        "combinedNavigationPointCount": combined_point_count,
        "routeNameMaxLength": max((len(name) for name in route_names), default=0),
        "routeNamesUniqueAfterTruncation": True,
        "schemaOrderValid": True,
        "telemetryElementCount": sum(
            local_counts.get(name, 0) for name in ("ele", "time", "extensions")
        ),
        "compactSerialization": path.read_text(encoding="utf-8").count("\n") == 1,
    }


def write_json(path: Path, value: dict) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def write_readme(path: Path, source_name: str, route_only: dict, combined: dict) -> None:
    shared_overage = combined["combinedNavigationPointCount"] - MAX_TRACK_POINTS
    text = f"""VOYAGER ROUTE + TRACK POOL STRESS TEST - QA ONLY

Source: {source_name}
Source SHA-256: {EXPECTED_PILOT_C_SHA256}

1. {route_only['file']}
   {route_only['routeCount']} routes / {route_only['routePointCount']:,} route points

2. {combined['file']}
   {combined['trackCount']} tracks / {combined['trackPointCount']:,} track points
   {combined['routeCount']} routes / {combined['routePointCount']:,} route points

The combined file deliberately contains
{combined['combinedNavigationPointCount']:,} total navigation points, which is
{shared_overage:,} above a hypothetical shared 72,500-point limit. Each track,
route, and individual point-pool count remains within the published limits.

TEST ORDER

1. Clear RIDE memory. Import the route-only file and confirm 300 routes load.
2. Clear RIDE memory again. Import the combined file.
3. Record reported track and route counts, any rejection or truncation, route
   visibility/toggling, and behavior after restart.

Every route mirrors one physically validated Pilot C track exactly. Coordinates
and point order are unchanged. Output contains no waypoints, elevation, time, or
extensions. The combined file is intentionally over-capacity for a shared-pool
device and must never be offered as a production download.
"""
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(text, encoding="utf-8")
    os.replace(temporary, path)


def publish(staging: Path, output: Path) -> None:
    backup: Path | None = None
    if output.exists():
        if not output.is_dir():
            raise RuntimeError(f"Output exists and is not a directory: {output}")
        entries = list(output.iterdir())
        if entries:
            manifest = output / MANIFEST_NAME
            if not manifest.is_file():
                raise RuntimeError("Refusing to replace a nonempty unrelated directory.")
            document = json.loads(manifest.read_text(encoding="utf-8"))
            if document.get("purpose") != PURPOSE:
                raise RuntimeError("Refusing to replace an unrelated QA bundle.")
        backup = output.with_name(f".{output.name}.previous-{uuid.uuid4().hex}")
        os.replace(output, backup)
    try:
        os.replace(staging, output)
    except Exception:
        if backup is not None and backup.exists() and not output.exists():
            os.replace(backup, output)
        raise
    if backup is not None:
        shutil.rmtree(backup)


def main() -> None:
    args = parse_args()
    source = args.pilot_c_gpx.resolve()
    output = args.output.resolve()
    if output == source or output in source.parents or source in output.parents:
        raise RuntimeError("QA output must be separate from the Pilot C source.")
    if output.parent == output:
        raise RuntimeError("QA output cannot be a filesystem root.")
    output.parent.mkdir(parents=True, exist_ok=True)

    tracks = validate_source(source)
    route_track_mappings = [
        {
            "index": index,
            "routeName": f"{index:03d} QA Route",
            "trackName": track.name,
            "pointCount": len(track.points),
            "coordinateSha256": point_signature(track.points),
        }
        for index, track in enumerate(tracks, start=1)
    ]
    staging = output.with_name(f".{output.name}.staging-{uuid.uuid4().hex}")
    staging.mkdir()
    try:
        route_only_path = staging / ROUTE_ONLY_NAME
        combined_path = staging / COMBINED_NAME
        write_compact_gpx(
            route_only_path,
            "Voyager Route Pool Stress Test",
            "QA-only routes mirrored from validated Pilot C tracks.",
            tracks,
            include_routes=True,
            include_tracks=False,
        )
        write_compact_gpx(
            combined_path,
            "Voyager Route + Track Pool Stress Test",
            "QA-only independent-pool stress file; not production-safe.",
            tracks,
            include_routes=True,
            include_tracks=True,
        )
        route_only = validate_output(
            route_only_path,
            tracks,
            EXPECTED_TRACK_COUNT,
            0,
        )
        combined = validate_output(
            combined_path,
            tracks,
            EXPECTED_TRACK_COUNT,
            EXPECTED_TRACK_COUNT,
        )
        if route_only["routePointCount"] != EXPECTED_TRACK_POINT_COUNT:
            raise RuntimeError("Route-only point count does not match Pilot C.")
        if combined["trackPointCount"] != EXPECTED_TRACK_POINT_COUNT:
            raise RuntimeError("Combined track point count does not match Pilot C.")
        if combined["routePointCount"] != EXPECTED_TRACK_POINT_COUNT:
            raise RuntimeError("Combined route point count does not match Pilot C.")
        if combined["combinedNavigationPointCount"] <= MAX_TRACK_POINTS:
            raise RuntimeError("Combined file does not exceed the hypothetical shared pool.")

        manifest = {
            "schemaVersion": 1,
            "purpose": PURPOSE,
            "qaOnly": True,
            "productionSafe": False,
            "source": {
                "file": source.name,
                "sha256": sha256_file(source),
                "trackCount": len(tracks),
                "trackPointCount": sum(len(track.points) for track in tracks),
                "routeTrackMappings": route_track_mappings,
            },
            "voyagerLimits": {
                "maxTracks": MAX_TRACKS,
                "maxRoutes": MAX_ROUTES,
                "maxTrackPoints": MAX_TRACK_POINTS,
                "maxRoutePoints": MAX_ROUTE_POINTS,
            },
            "variants": {
                "routeOnly": route_only,
                "combined": combined,
            },
            "stressArithmetic": {
                "trackPoints": combined["trackPointCount"],
                "routePoints": combined["routePointCount"],
                "combinedPoints": combined["combinedNavigationPointCount"],
                "hypotheticalSharedLimit": MAX_TRACK_POINTS,
                "overage": combined["combinedNavigationPointCount"] - MAX_TRACK_POINTS,
                "hypotheticalSharedPoolSafe": False,
            },
            "invariants": {
                "everyRouteMirrorsOnePilotCTrack": True,
                "combinedTracksMatchPilotC": True,
                "coordinatesChanged": 0,
                "pointOrderChanged": False,
                "waypointCountIsZero": True,
                "elevationTimeAndExtensionsRemoved": True,
                "routesBeforeTracks": True,
                "routeNamesShortAndUnique": True,
                "withinIndividualTrackLimits": True,
                "withinIndividualRouteLimits": True,
                "intentionallyExceedsHypotheticalSharedPointLimit": True,
            },
        }
        write_json(staging / MANIFEST_NAME, manifest)
        write_readme(staging / README_NAME, source.name, route_only, combined)
        publish(staging, output)
    finally:
        if staging.exists():
            shutil.rmtree(staging)

    print(
        f"{route_only['file']}: {route_only['routeCount']} routes / "
        f"{route_only['routePointCount']:,} route points"
    )
    print(
        f"{combined['file']}: {combined['trackCount']} tracks / "
        f"{combined['trackPointCount']:,} track points + "
        f"{combined['routeCount']} routes / {combined['routePointCount']:,} route points"
    )
    print(f"Combined navigation points: {combined['combinedNavigationPointCount']:,}")
    print(f"Wrote {output}")


if __name__ == "__main__":
    main()
