#!/usr/bin/env python3
"""Build the deterministic Bob's Motorcycle Trails Voyager download release.

The release contains one mutually exclusive GPX per current riding area, one
remainder GPX for each semantic collection that has unassigned-area trails,
and a separate optional USA outline add-on.
Canonical database files are read-only. The complete release is staged and
validated before one atomic directory rename publishes the requested output.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import uuid
import xml.etree.ElementTree as ET

from voyager_packaging import (
    AREA_MAX_ROUTES,
    AREA_MAX_TRACKS,
    AREA_TRACK_SLOT_HEADROOM,
    MAX_DEVICE_NAME_LENGTH,
    MAX_ROUTE_POINTS,
    MAX_ROUTES,
    MAX_TRACK_POINTS,
    MAX_TRACKS,
    build_area_pack,
    local_name,
    resolve_database_file,
    sha256_file,
    validate_context_track_output,
    write_context_track_gpx,
    write_json_atomic,
)
from voyager_state_context import build_state_context


CONTEXT_TOLERANCE_METERS = 5_000.0
RELEASE_MANIFEST = "voyager-production-manifest.json"


@dataclass(frozen=True)
class Target:
    target_id: str
    name: str
    kind: str
    catalog: tuple[dict, ...]
    expected_point_count: int


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build all semantic Voyager riding-area packs and the USA add-on."
    )
    parser.add_argument("database", type=Path, help="Canonical trails-database root.")
    parser.add_argument(
        "--state-context",
        type=Path,
        required=True,
        help="Validated USA lower-48 state-context GPX source.",
    )
    parser.add_argument("--output", type=Path, required=True, help="New release directory.")
    return parser.parse_args()


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def rows_as_dicts(fields: list[str], rows: list[list]) -> list[dict]:
    return [dict(zip(fields, row, strict=True)) for row in rows]


def validate_output_destination(database: Path, output: Path) -> None:
    database = database.resolve()
    output = output.resolve()
    try:
        output.relative_to(database)
    except ValueError:
        pass
    else:
        raise RuntimeError("Release output must not be inside the canonical database.")
    if output == output.anchor or output == output.parent:
        raise RuntimeError("Refusing a broad release output path.")
    if output.exists():
        raise RuntimeError(f"Release output already exists: {output}")


class CatalogIndex:
    def __init__(self, database: Path, manifest: dict, overview: dict) -> None:
        self.database = database
        self.manifest = manifest
        self.overview = overview
        self.group_fields = {
            name: index for index, name in enumerate(overview["groupFields"])
        }
        self.groups = {
            row[self.group_fields["id"]]: row for row in overview["groups"]
        }
        self.cache: dict[str, list[dict]] = {}

    def group_catalog(self, group_id: str) -> list[dict]:
        cached = self.cache.get(group_id)
        if cached is not None:
            return cached
        row = self.groups.get(group_id)
        if row is None:
            raise RuntimeError(f"Unknown source group: {group_id}")
        document = read_json(
            resolve_database_file(self.database, row[self.group_fields["file"]])
        )
        catalog = rows_as_dicts(document["catalogFields"], document["catalog"])
        self.cache[group_id] = catalog
        return catalog


def unique_catalog(rows: list[dict], owner: str) -> tuple[dict, ...]:
    result: dict[str, dict] = {}
    for row in rows:
        trail_id = row["trail_id"]
        if trail_id in result:
            raise RuntimeError(f"Duplicate trail {trail_id} in target {owner}")
        result[trail_id] = row
    return tuple(result[trail_id] for trail_id in sorted(result))


def load_targets(database: Path) -> tuple[dict, dict, list[Target]]:
    manifest_path = database / "web-map" / "v2" / "manifest.json"
    manifest = read_json(manifest_path)
    if manifest.get("version") != 2:
        raise RuntimeError("Current web-map v2 manifest is required.")
    overview = read_json(resolve_database_file(database, manifest["overviewFile"]))
    index = CatalogIndex(database, manifest, overview)

    area_fields = {name: position for position, name in enumerate(overview["areaFields"])}
    targets: list[Target] = []
    for area in sorted(overview["areas"], key=lambda row: row[area_fields["id"]]):
        target_id = area[area_fields["id"]]
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", target_id):
            raise RuntimeError(f"Unsafe target ID: {target_id}")
        rows = [
            item
            for group_id in area[area_fields["groupIds"]]
            for item in index.group_catalog(group_id)
            if item.get("area_id") == target_id
        ]
        catalog = unique_catalog(rows, target_id)
        if len(catalog) != area[area_fields["count"]]:
            raise RuntimeError(f"Area catalog count drift: {target_id}")
        point_count = sum(int(row["point_count"]) for row in catalog)
        if point_count != area[area_fields["pointCount"]]:
            raise RuntimeError(f"Area catalog point-count drift: {target_id}")
        targets.append(
            Target(target_id, area[area_fields["name"]], "riding-area", catalog, point_count)
        )

    collection_fields = {
        name: position for position, name in enumerate(overview["collectionFields"])
    }
    collection_ids: set[str] = set()
    for collection in sorted(
        overview["collections"], key=lambda row: row[collection_fields["id"]]
    ):
        collection_id = collection[collection_fields["id"]]
        if collection_id in collection_ids:
            raise RuntimeError(f"Duplicate semantic collection ID: {collection_id}")
        collection_ids.add(collection_id)
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", collection_id):
            raise RuntimeError(f"Unsafe semantic collection ID: {collection_id}")

        target_id = f"{collection_id}-other"
        other_rows = [
            item
            for group_id in collection[collection_fields["groupIds"]]
            for item in index.group_catalog(group_id)
            if item.get("collection_id") == collection_id
            and item.get("area_id") is None
        ]
        other_catalog = unique_catalog(other_rows, target_id)
        if not other_catalog:
            continue
        collection_name = collection[collection_fields["name"]]
        if not isinstance(collection_name, str) or not collection_name.strip():
            raise RuntimeError(f"Semantic collection {collection_id} has no name.")
        targets.append(
            Target(
                target_id,
                f"{collection_name} - Other",
                "collection-remainder",
                other_catalog,
                sum(int(row["point_count"]) for row in other_catalog),
            )
        )
    targets.sort(key=lambda target: target.target_id)

    target_ids: set[str] = set()
    seen: dict[str, str] = {}
    for target in targets:
        if target.target_id in target_ids:
            raise RuntimeError(f"Duplicate semantic target ID: {target.target_id}")
        target_ids.add(target.target_id)
        for row in target.catalog:
            trail_id = row["trail_id"]
            previous = seen.get(trail_id)
            if previous is not None:
                raise RuntimeError(
                    f"Trail {trail_id} appears in both {previous} and {target.target_id}."
                )
            seen[trail_id] = target.target_id
    named_catalog: dict[str, str] = {}
    for group_id in sorted(index.groups):
        for row in index.group_catalog(group_id):
            if row.get("area_id") is None and row.get("collection_id") is None:
                continue
            trail_id = row["trail_id"]
            previous_group = named_catalog.get(trail_id)
            if previous_group is not None:
                raise RuntimeError(
                    f"Named-assigned trail {trail_id} appears in both "
                    f"{previous_group} and {group_id}."
                )
            named_catalog[trail_id] = group_id

    expected_named_count = int(manifest["counts"]["namedAssignedTrails"])
    if len(named_catalog) != expected_named_count:
        raise RuntimeError(
            "Manifest namedAssignedTrails does not match the semantic catalogs: "
            f"expected {expected_named_count}, found {len(named_catalog)}."
        )
    missing = sorted(set(named_catalog) - set(seen))
    unexpected = sorted(set(seen) - set(named_catalog))
    if missing or unexpected:
        raise RuntimeError(
            "Target release does not exactly cover the manifest's named-assigned "
            f"trails; missing={missing[:5]}, unexpected={unexpected[:5]}."
        )
    return manifest, overview, targets


def assign_device_codes(targets: list[Target]) -> dict[str, str]:
    """Assign stable globally unique seven-character codes from immutable IDs."""

    codes: dict[str, str] = {}
    used: set[str] = set()
    for target in sorted(targets, key=lambda item: item.target_id):
        readable = "".join(re.findall(r"[A-Z0-9]", target.target_id.upper())) or "AR"
        digest = hashlib.sha256(target.target_id.encode("utf-8")).hexdigest().upper()
        candidate = (readable + "XX")[:2] + digest[:5]
        if candidate in used:
            raise RuntimeError(
                f"Stable device-code collision for target {target.target_id}: {candidate}"
            )
        codes[target.target_id] = candidate
        used.add(candidate)
    if len(codes) != len(targets):
        raise RuntimeError("Device-code allocation is incomplete.")
    return codes


def relative_posix(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def release_path_record(path: Path, root: Path) -> dict:
    return {
        "file": relative_posix(path, root),
        "bytes": path.stat().st_size,
        "sha256": sha256_file(path),
    }


def path_names(path: Path) -> list[str]:
    root = ET.parse(path).getroot()
    names: list[str] = []
    for element in root.iter():
        if local_name(element.tag) not in {"rte", "trk"}:
            continue
        name_node = next(
            (child for child in element if local_name(child.tag) == "name"), None
        )
        name = name_node.text.strip() if name_node is not None and name_node.text else ""
        if not name:
            raise RuntimeError(f"Unnamed device path in {path}")
        names.append(name[:MAX_DEVICE_NAME_LENGTH])
    return names


def validate_global_names(gpx_paths: list[Path]) -> int:
    owners: dict[str, Path] = {}
    count = 0
    for path in gpx_paths:
        for name in path_names(path):
            previous = owners.get(name)
            if previous is not None:
                raise RuntimeError(
                    f"Device path name {name!r} collides in {previous.name} and {path.name}."
                )
            owners[name] = path
            count += 1
    return count


def validate_source_file_snapshots(database: Path, snapshots: dict[str, dict]) -> None:
    """Prove every GPX still matches the exact bytes parsed during this build."""

    for trail_id in sorted(snapshots):
        snapshot = snapshots[trail_id]
        source_path = resolve_database_file(database, snapshot["path"])
        actual = sha256_file(source_path)
        if actual != snapshot["sha256"]:
            raise RuntimeError(
                f"Canonical source GPX changed during generation: {trail_id} "
                f"({snapshot['path']})"
            )


def write_readme(path: Path, target_count: int, addon: dict, pack_records: list[dict]) -> None:
    total_routes = sum(record["routeCount"] for record in pack_records)
    total_tracks = sum(record["trackCount"] for record in pack_records)
    text = f"""BOB'S MOTORCYCLE TRAILS - VOYAGER PRODUCTION PACKS

Semantic trail packs: {target_count}
Area tracks: {total_tracks:,}
Area routes: {total_routes:,}
Optional USA add-on: {addon['trackCount']} tracks / {addon['trackPointCount']:,} points

Each riding-area GPX is complete and stands alone. It uses ordinary tracks first,
while routes absorb path-count or track-point-capacity overflow.
Enable the Voyager setting that displays routes as tracks for those dense packs.

The optional USA outline is deliberately separate because loading nationwide
geometry changes the device's Fit Map behavior. Area packs use the full device
capacity when necessary, so install the outline only when the selected area has
enough track headroom and nationwide context is more useful than local Fit Map.

All derived files contain zero waypoints, elevation, timestamps, and extensions.
Exact numeric coordinates are preserved. Equivalent decimal spellings may be
normalized to the first canonical occurrence. Paths join only at exact numeric
source junctions; any required retracing follows existing source edges and is
recorded in the per-pack manifest. No connector geometry is invented.

The release manifest records SHA-256 hashes, capacity headroom, source coverage,
and the {target_count} mutually exclusive target catalogs. Trails not assigned to
a named target remain in the canonical research database and are not silently
claimed as part of this release.
"""
    path.write_text(text, encoding="utf-8", newline="\n")


def build_release(database: Path, state_context: Path, output: Path) -> dict:
    database = database.resolve()
    state_context = state_context.resolve()
    output = output.resolve()
    validate_output_destination(database, output)
    if not state_context.is_file():
        raise RuntimeError(f"Missing state context: {state_context}")
    output.parent.mkdir(parents=True, exist_ok=True)

    source_manifest_path = database / "web-map" / "v2" / "manifest.json"
    source_manifest_sha = sha256_file(source_manifest_path)
    generator_dir = Path(__file__).resolve().parent
    generator_files = {
        "driverSha256": Path(__file__).resolve(),
        "packagingModuleSha256": generator_dir / "voyager_packaging.py",
        "contextModuleSha256": generator_dir / "voyager_state_context.py",
    }
    generator_shas = {
        label: sha256_file(path) for label, path in generator_files.items()
    }
    source_manifest, _overview, targets = load_targets(database)
    device_codes = assign_device_codes(targets)
    staging = output.with_name(f".{output.name}.staging-{uuid.uuid4().hex}")
    staging.mkdir()
    try:
        packs_dir = staging / "packs"
        manifests_dir = staging / "manifests"
        addons_dir = staging / "addons"
        packs_dir.mkdir()
        manifests_dir.mkdir()
        addons_dir.mkdir()

        pack_catalog: list[dict] = []
        all_gpx_paths: list[Path] = []
        all_target_trail_ids: set[str] = set()
        source_file_snapshots: dict[str, dict] = {}
        for index, target in enumerate(targets, start=1):
            print(
                f"[{index:03d}/{len(targets):03d}] {target.target_id} "
                f"({len(target.catalog):,} source trails)",
                flush=True,
            )
            gpx_path = packs_dir / f"{target.target_id}-voyager.gpx"
            pack_manifest = build_area_pack(
                database=database,
                target_id=target.target_id,
                target_name=target.name,
                target_kind=target.kind,
                device_code=device_codes[target.target_id],
                catalog=list(target.catalog),
                output_path=gpx_path,
            )
            if pack_manifest["source"]["pointCount"] != target.expected_point_count:
                raise RuntimeError(f"Parsed source point-count drift: {target.target_id}")
            manifest_path = manifests_dir / f"{target.target_id}.json"
            write_json_atomic(manifest_path, pack_manifest)
            all_gpx_paths.append(gpx_path)
            all_target_trail_ids.update(pack_manifest["source"]["trailIds"])
            for snapshot in pack_manifest["source"]["files"]:
                previous = source_file_snapshots.get(snapshot["trailId"])
                if previous is not None and previous != snapshot:
                    raise RuntimeError(
                        f"Conflicting source snapshots for {snapshot['trailId']}"
                    )
                source_file_snapshots[snapshot["trailId"]] = snapshot
            output_stats = pack_manifest["output"]
            pack_catalog.append(
                {
                    "id": target.target_id,
                    "name": target.name,
                    "kind": target.kind,
                    "deviceCode": device_codes[target.target_id],
                    "gpx": release_path_record(gpx_path, staging),
                    "manifest": release_path_record(manifest_path, staging),
                    "sourceTrailCount": pack_manifest["source"]["trailCount"],
                    "sourcePointCount": pack_manifest["source"]["pointCount"],
                    "minimumWalkCount": pack_manifest["topology"]["minimumWalkCountWithoutRetracing"],
                    "retraceEdgeCount": pack_manifest["topology"]["duplicatedExistingEdgeTraversalCount"],
                    "trackCount": output_stats["trackCount"],
                    "trackPointCount": output_stats["trackPointCount"],
                    "routeCount": output_stats["routeCount"],
                    "routePointCount": output_stats["routePointCount"],
                    "bounds": output_stats["bounds"],
                }
            )

        if len(all_target_trail_ids) != int(source_manifest["counts"]["namedAssignedTrails"]):
            raise RuntimeError("Release trail coverage changed during pack construction.")

        context = build_state_context(state_context, CONTEXT_TOLERANCE_METERS)
        context_path = addons_dir / "usa-lower-48-state-context-voyager.gpx"
        write_context_track_gpx(context_path, context.routes)
        context_output = validate_context_track_output(context_path, context)
        all_gpx_paths.append(context_path)
        context_manifest = {
            "schemaVersion": 1,
            "purpose": "optional-voyager-map-context-addon",
            "source": {
                "file": state_context.name,
                "sha256": context.source_sha256,
                "counts": context.source_counts,
            },
            "simplification": {
                "toleranceMeters": context.tolerance_meters,
                "metric": context.simplification_metric,
                "maximumDeviationMeters": context.maximum_deviation_meters,
                "sourcePointsRemoved": context.removed_point_count,
                "simplifiedSegmentPointCount": context.simplified_point_count,
                "joinedTrackPointCount": context.route_point_count,
                "componentCount": context.component_count,
                "oddEndpointCount": context.odd_endpoint_count,
                "doubledOrReversedEdges": context.duplicate_atomic_edge_count,
                "properCrossings": context.proper_crossing_count,
            },
            "output": {
                **context_output,
                "file": relative_posix(context_path, staging),
            },
            "invariants": {
                "tracksOnly": True,
                "sourceWaypointsRemoved": context.source_counts["waypointCount"],
                "waypointCount": 0,
                "telemetryElements": 0,
                "sourceTopologySegmentsRepresentedExactlyOnce": True,
                "fabricatedConnectors": 0,
            },
        }
        context_manifest_path = manifests_dir / "usa-lower-48-state-context.json"
        write_json_atomic(context_manifest_path, context_manifest)

        global_path_count = validate_global_names(all_gpx_paths)
        pack_catalog.sort(key=lambda record: record["id"])
        addon_catalog = {
            "id": "usa-lower-48-state-context",
            "name": "USA Lower 48 State Context",
            "kind": "optional-map-context",
            "gpx": release_path_record(context_path, staging),
            "manifest": release_path_record(context_manifest_path, staging),
            "trackCount": context_output["trackCount"],
            "trackPointCount": context_output["trackPointCount"],
            "routeCount": 0,
            "routePointCount": 0,
        }
        write_json_atomic(
            staging / "catalog.json",
            {"packs": pack_catalog, "addons": [addon_catalog]},
        )
        write_readme(
            staging / "README.txt",
            len(pack_catalog),
            context_output,
            pack_catalog,
        )

        root_manifest = {
            "schemaVersion": 1,
            "purpose": "voyager-production-semantic-riding-area-release",
            "source": {
                "webMapBuildKey": source_manifest.get("buildKey"),
                "webMapManifestSha256": source_manifest_sha,
                "sourceCatalogSha256": source_manifest.get("sourceCatalogSha256"),
                "ridingAreasSha256": source_manifest.get("ridingAreasSha256"),
                "databaseTrailCount": source_manifest["counts"]["trails"],
                "namedAssignedTrailCount": source_manifest["counts"]["namedAssignedTrails"],
                "unassignedTrailCount": (
                    source_manifest["counts"]["trails"]
                    - source_manifest["counts"]["namedAssignedTrails"]
                ),
                "sourceFileSnapshotCount": len(source_file_snapshots),
            },
            "generator": generator_shas,
            "voyagerLimits": {
                "tracks": MAX_TRACKS,
                "trackPoints": MAX_TRACK_POINTS,
                "routes": MAX_ROUTES,
                "routePoints": MAX_ROUTE_POINTS,
                "independentTrackAndRoutePointPools": True,
            },
            "releasePolicy": {
                "semanticTargetCount": len(pack_catalog),
                "mutuallyExclusiveTargetTrailCatalogs": True,
                "areaTrackLimit": AREA_MAX_TRACKS,
                "areaRouteLimit": AREA_MAX_ROUTES,
                "reservedTrackSlotHeadroom": AREA_TRACK_SLOT_HEADROOM,
                "areaPacksAreStandalone": True,
                "contextBakedIntoAreaPacks": False,
                "optionalContextRequiresAvailableTrackCapacity": True,
                "waypoints": 0,
                "telemetry": "elevation, time, and extensions omitted",
                "joins": "exact coordinate only",
                "inventedConnectors": 0,
            },
            "validation": {
                "globalDevicePathNameCount": global_path_count,
                "globalNamesUniqueAfter12Characters": True,
                "allPackOutputsReparsed": True,
                "allSourceGeometryCoveredPerTarget": True,
                "allRetracedEdgesReferenceExistingSourceEdges": True,
                "allPacksWithinDeviceLimits": True,
                "allCanonicalSourceFilesRehashedAfterBuild": True,
                "stateContextRehashedAfterBuild": True,
            },
            "packs": pack_catalog,
            "addon": addon_catalog,
            "catalog": release_path_record(staging / "catalog.json", staging),
            "readme": release_path_record(staging / "README.txt", staging),
        }
        write_json_atomic(staging / RELEASE_MANIFEST, root_manifest)

        if len(source_file_snapshots) != len(all_target_trail_ids):
            raise RuntimeError("Canonical source snapshot coverage is incomplete.")
        validate_source_file_snapshots(database, source_file_snapshots)
        if sha256_file(state_context) != context.source_sha256:
            raise RuntimeError("State-context source changed during generation.")
        if sha256_file(source_manifest_path) != source_manifest_sha:
            raise RuntimeError("Canonical source manifest changed during generation.")
        for label, path in generator_files.items():
            if sha256_file(path) != generator_shas[label]:
                raise RuntimeError(f"Generator source changed during generation: {path}")
        os.replace(staging, output)
        return root_manifest
    finally:
        if staging.exists():
            shutil.rmtree(staging)


def main() -> int:
    args = parse_args()
    manifest = build_release(args.database, args.state_context, args.output)
    print(
        json.dumps(
            {
                "output": str(args.output.resolve()),
                "packs": len(manifest["packs"]),
                "addonTracks": manifest["addon"]["trackCount"],
                "addonTrackPoints": manifest["addon"]["trackPointCount"],
                "globalDevicePaths": manifest["validation"]["globalDevicePathNameCount"],
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
