#!/usr/bin/env python3
"""Build the compact, local-only map index used by Trail Pack Builder."""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import os
import re
import shutil
import sys
import zipfile
from collections import Counter, deque
from pathlib import Path
from typing import Iterable, Sequence
from xml.etree import ElementTree as ET


QUALITY_SCOPE = "internal-canonical"
PREVIEW_PRECISION = 5
V2_SCHEMA_VERSION = 2
CHUNK_CATALOG_FIELDS = [
    "trail_id",
    "display_name",
    "bbox",
    "length_m",
    "point_count",
    "elevation_coverage",
    "area_id",
    "collection_id",
]
OVERVIEW_GROUP_FIELDS = [
    "id",
    "count",
    "bounds",
    "center",
    "file",
    "unassignedCount",
    "unassignedBounds",
    "unassignedCenter",
]
OVERVIEW_AREA_FIELDS = [
    "id",
    "name",
    "count",
    "pointCount",
    "viewBounds",
    "labelPoint",
    "groupIds",
]
OVERVIEW_COLLECTION_FIELDS = [
    "id",
    "name",
    "count",
    "pointCount",
    "viewBounds",
    "labelPoint",
    "groupIds",
    "memberAreaIds",
]
EARTH_RADIUS_METERS = 6_371_008.8
GENERATED_AREA_PREFIX = "auto-"
GENERATED_AREA_GIANT_TRAIL_COUNT = 250
GENERATED_ASSIGNMENT_MAX_OPEN_DIAGONAL_METERS = 25_000
GENERATED_ASSIGNMENT_STRICT_DOMINANCE = 0.7
GENERATED_ASSIGNMENT_STRICT_MAX_OPEN_DIAGONAL_METERS = 20_000
GENERATED_ASSIGNMENT_MAX_COMPETING_SHARE = 0.1
GENERATED_ASSIGNMENT_CLOSED_TOLERANCE_METERS = 50
GENERATED_ASSIGNMENT_VOTE_SAMPLE_METERS = 500
CURATION_PROJECT_KIND = "bobs-trail-pack-curation"
CURATION_PROJECT_SCHEMA_VERSION = 1
CURATION_DELETE_PACK_NAME = re.compile(r"^DELETE\d*$", re.IGNORECASE)
CURATION_PACK_ID = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
CURATION_VIEW_PADDING_METERS = 5_000.0
GEONAMES_FIELDS = [
    "geoname_id",
    "name",
    "ascii_name",
    "alternate_names",
    "latitude",
    "longitude",
    "feature_class",
    "feature_code",
    "country_code",
    "alternate_country_codes",
    "admin1_code",
    "admin2_code",
    "admin3_code",
    "admin4_code",
    "population",
    "elevation",
    "dem",
    "timezone",
    "modification_date",
]
GEONAMES_ACTIVE_PLACE_CODES = {"PPL", "PPLA", "PPLA2", "PPLA3", "PPLA4", "PPLC"}
LOWER_48_ADMIN1_CODES = {
    "AL", "AR", "AZ", "CA", "CO", "CT", "DC", "DE", "FL", "GA", "IA", "ID",
    "IL", "IN", "KS", "KY", "LA", "MA", "MD", "ME", "MI", "MN", "MO", "MS",
    "MT", "NC", "ND", "NE", "NH", "NJ", "NM", "NV", "NY", "OH", "OK", "OR",
    "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VA", "VT", "WA", "WI", "WV",
    "WY",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate the local web-map index without copying canonical GPX files."
    )
    parser.add_argument(
        "--database",
        type=Path,
        required=True,
        help="Path to the normalized trails-database folder.",
    )
    parser.add_argument(
        "--context",
        type=Path,
        required=True,
        help="Path to the lower-48 state/city context GeoJSON.",
    )
    parser.add_argument(
        "--simplify-m",
        type=float,
        default=30.0,
        help="Douglas-Peucker tolerance for display geometry in meters (default: 30).",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Optional development-only trail limit; zero builds the full internal set.",
    )
    parser.add_argument(
        "--riding-areas",
        type=Path,
        default=Path(__file__).with_name("riding-areas.json"),
        help="Semantic riding-area curation file (default: tools/riding-areas.json).",
    )
    parser.add_argument(
        "--curation-project",
        type=Path,
        default=None,
        help=(
            "Optional exact grouping-board export. It replaces automatic riding-area "
            "assignment and is validated against the complete source catalog."
        ),
    )
    parser.add_argument(
        "--gazetteer",
        type=Path,
        default=None,
        help=(
            "Optional local GeoNames cities1000.zip or cities1000.txt used only to name "
            "generated riding areas. When omitted, "
            "<database>/web-map/gazetteer/cities1000.zip is used if present."
        ),
    )
    return parser.parse_args()


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_float(value: str, fallback: float = 0.0) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return fallback
    return parsed if math.isfinite(parsed) else fallback


def parse_int(value: str, fallback: int = 0) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return fallback


def resolve_gazetteer_path(database: Path, requested: Path | None) -> Path | None:
    if requested is not None:
        resolved = requested.resolve()
        if not resolved.is_file():
            raise FileNotFoundError(f"Missing local gazetteer: {resolved}")
        return resolved

    gazetteer_root = database / "web-map" / "gazetteer"
    for filename in ("cities1000.zip", "cities1000.txt"):
        candidate = gazetteer_root / filename
        if candidate.is_file():
            return candidate.resolve()
    return None


def read_geonames_gazetteer(
    path: Path | None, data_bounds: Sequence[float]
) -> list[dict[str, object]]:
    if path is None:
        return []

    if path.suffix.casefold() == ".zip":
        archive = zipfile.ZipFile(path)
        members = sorted(
            name for name in archive.namelist() if name.casefold().endswith(".txt")
        )
        if not members:
            archive.close()
            raise RuntimeError(f"GeoNames archive contains no text file: {path}")
        binary_handle = archive.open(members[0], "r")
        text_handle = io.TextIOWrapper(binary_handle, encoding="utf-8")
    else:
        archive = None
        binary_handle = None
        text_handle = path.open("r", encoding="utf-8", newline="")

    longitude_margin = 10.0
    latitude_margin = 8.0
    places: list[dict[str, object]] = []
    try:
        for values in csv.reader(text_handle, delimiter="\t"):
            if len(values) < len(GEONAMES_FIELDS):
                continue
            row = dict(zip(GEONAMES_FIELDS, values))
            if (
                row["feature_class"] != "P"
                or row["feature_code"] not in GEONAMES_ACTIVE_PLACE_CODES
                or row["country_code"] != "US"
                or row["admin1_code"] not in LOWER_48_ADMIN1_CODES
            ):
                continue
            longitude = parse_float(row["longitude"], math.nan)
            latitude = parse_float(row["latitude"], math.nan)
            if not math.isfinite(longitude) or not math.isfinite(latitude):
                continue
            if not (
                data_bounds[0] - longitude_margin
                <= longitude
                <= data_bounds[2] + longitude_margin
                and data_bounds[1] - latitude_margin
                <= latitude
                <= data_bounds[3] + latitude_margin
            ):
                continue
            name = (row["name"] or row["ascii_name"]).strip()
            if not name:
                continue
            places.append(
                {
                    "id": row["geoname_id"],
                    "name": name,
                    "point": [longitude, latitude],
                    "countryCode": row["country_code"],
                    "admin1Code": row["admin1_code"],
                    "population": max(0, parse_int(row["population"])),
                }
            )
    finally:
        text_handle.close()
        if binary_handle is not None:
            binary_handle.close()
        if archive is not None:
            archive.close()

    if not places:
        raise RuntimeError(f"No usable populated places were found in {path}")
    places.sort(key=lambda place: (str(place["name"]).casefold(), str(place["id"])))
    return places


SOURCE_HINT_ACRONYMS = {
    "atv": "ATV",
    "bdr": "BDR",
    "gpx": "GPX",
    "ohv": "OHV",
    "orv": "ORV",
    "tsf": "TSF",
}
GENERIC_SOURCE_HINTS = {
    "all",
    "atv",
    "data",
    "gpx",
    "gpx data",
    "imported",
    "kelly",
    "map",
    "motorcycle",
    "ohv",
    "orv",
    "ride",
    "route",
    "temp",
    "track",
    "tracks",
    "trail",
    "trailpack",
    "trails",
    "unknown",
    "wa",
}


def humanize_source_hint(value: str) -> str | None:
    text = re.sub(r"(?i)features\s*to\s*gpx", "", value)
    text = re.sub(r"(?i)\.(?:gpx|xml)$", "", text)
    text = re.sub(r"-(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{8,}$", "", text)
    text = re.sub(r"(?i)(?:[-_ ](?:copy|edit|filtered|final|tracks?))?[-_ ]?r\d+$", "", text)
    text = re.sub(r"[-_ ]\d{3}$", "", text)
    text = re.sub(r"[_-]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip(" ._-#")
    folded = text.casefold()
    if (
        not text
        or folded in GENERIC_SOURCE_HINTS
        or re.fullmatch(r"(?:[ns]\d{1,2}[ -]?[ew]\d{1,3}|gpx data \d+)", folded)
    ):
        return None
    words = []
    for word in text.split():
        acronym = SOURCE_HINT_ACRONYMS.get(word.casefold())
        if acronym is not None:
            words.append(acronym)
        elif any(character.isupper() for character in word[1:]):
            words.append(word)
        else:
            words.append(word.capitalize())
    return " ".join(words)


def source_hint_candidates(
    trails: Sequence[dict[str, object]],
) -> list[dict[str, object]]:
    support: dict[str, set[str]] = {}
    kinds: dict[str, set[str]] = {}
    display: dict[str, str] = {}
    for trail in trails:
        trail_id = str(trail["trail_id"])
        trail_candidates: set[tuple[str, str]] = set()
        display_name = humanize_source_hint(str(trail["catalog_entry"][1]))
        if display_name is not None:
            trail_candidates.add((display_name, "display-name"))
        for source_path in re.split(r"\s*[|;]\s*", str(trail["source_paths"])):
            parts = [part for part in re.split(r"[\\/]", source_path) if part]
            if not parts:
                continue
            filename_hint = humanize_source_hint(parts[-1])
            if filename_hint is not None:
                trail_candidates.add((filename_hint, "source-file"))
            for parent in parts[:-1]:
                parent_hint = humanize_source_hint(parent)
                if parent_hint is not None:
                    trail_candidates.add((parent_hint, "source-folder"))
        for candidate, kind in trail_candidates:
            key = candidate.casefold()
            support.setdefault(key, set()).add(trail_id)
            kinds.setdefault(key, set()).add(kind)
            display.setdefault(key, candidate)

    kind_priority = {"source-folder": 3, "source-file": 2, "display-name": 1}
    ranked = [
        {
            "name": display[key],
            "support": len(trail_ids),
            "coverage": round(len(trail_ids) / len(trails), 4),
            "inputs": sorted(kinds[key]),
            "_priority": max(kind_priority[kind] for kind in kinds[key]),
        }
        for key, trail_ids in support.items()
    ]
    ranked.sort(
        key=lambda candidate: (
            -float(candidate["coverage"]),
            -int(candidate["_priority"]),
            -len(str(candidate["name"])),
            str(candidate["name"]).casefold(),
        )
    )
    for candidate in ranked:
        candidate.pop("_priority")
    return ranked[:8]


def source_hint_matches_place(
    source_hint: dict[str, object] | None,
    nearest_place: dict[str, object] | None,
) -> bool:
    if source_hint is None or nearest_place is None:
        return False
    source_tokens = set(re.findall(r"[a-z0-9]{3,}", str(source_hint["name"]).casefold()))
    place_tokens = set(re.findall(r"[a-z0-9]{3,}", str(nearest_place["name"]).casefold()))
    return bool(source_tokens & place_tokens)


def safe_display_name(row: dict[str, str]) -> str:
    value = (row.get("display_name") or "").strip()
    if value.lower() not in {"", "<null>", "null", "none", "untitled"}:
        return value
    tile = (row.get("location_tile") or "unknown area").upper()
    suffix = (row.get("trail_id") or "trail-unknown").removeprefix("trail-")[:6].upper()
    return f"{tile} trail {suffix}"


def read_catalog(catalog_path: Path, limit: int) -> list[dict[str, str]]:
    with catalog_path.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = [row for row in csv.DictReader(handle) if row["quality_status"] == QUALITY_SCOPE]
    rows.sort(key=lambda row: row["trail_id"])
    if limit > 0:
        rows = rows[:limit]
    if not rows:
        raise RuntimeError("No internal-canonical trails were found in catalog/trails.csv.")
    return rows


def read_segments(gpx_path: Path) -> list[list[tuple[float, float]]]:
    root = ET.parse(gpx_path).getroot()
    segments: list[list[tuple[float, float]]] = []
    for segment_node in (node for node in root.iter() if local_name(node.tag) == "trkseg"):
        points: list[tuple[float, float]] = []
        for point_node in (node for node in segment_node if local_name(node.tag) == "trkpt"):
            try:
                lat = float(point_node.attrib["lat"])
                lon = float(point_node.attrib["lon"])
            except (KeyError, TypeError, ValueError):
                continue
            if math.isfinite(lat) and math.isfinite(lon):
                points.append((lon, lat))
        if len(points) >= 2:
            segments.append(points)
    if not segments:
        raise RuntimeError(f"No usable track segments in {gpx_path}")
    return segments


def project_local(points: Sequence[tuple[float, float]]) -> list[tuple[float, float]]:
    reference_lat = sum(point[1] for point in points) / len(points)
    cos_lat = max(0.01, math.cos(math.radians(reference_lat)))
    origin_lon, origin_lat = points[0]
    return [
        ((lon - origin_lon) * 111_320.0 * cos_lat, (lat - origin_lat) * 110_540.0)
        for lon, lat in points
    ]


def squared_point_segment_distance(
    point: tuple[float, float], start: tuple[float, float], end: tuple[float, float]
) -> float:
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    if dx == 0 and dy == 0:
        return (point[0] - start[0]) ** 2 + (point[1] - start[1]) ** 2
    ratio = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)
    ratio = min(1.0, max(0.0, ratio))
    nearest_x = start[0] + ratio * dx
    nearest_y = start[1] + ratio * dy
    return (point[0] - nearest_x) ** 2 + (point[1] - nearest_y) ** 2


def douglas_peucker_indices(projected: Sequence[tuple[float, float]], tolerance_m: float) -> list[int]:
    if len(projected) <= 2:
        return list(range(len(projected)))
    keep = {0, len(projected) - 1}
    stack = [(0, len(projected) - 1)]
    tolerance_squared = tolerance_m * tolerance_m
    while stack:
        start_index, end_index = stack.pop()
        farthest_index = -1
        farthest_distance = tolerance_squared
        start = projected[start_index]
        end = projected[end_index]
        for index in range(start_index + 1, end_index):
            distance = squared_point_segment_distance(projected[index], start, end)
            if distance > farthest_distance:
                farthest_distance = distance
                farthest_index = index
        if farthest_index >= 0:
            keep.add(farthest_index)
            stack.append((start_index, farthest_index))
            stack.append((farthest_index, end_index))
    return sorted(keep)


def nearly_closed(points: Sequence[tuple[float, float]]) -> bool:
    if len(points) < 4:
        return False
    projected = project_local([points[0], points[-1]])
    return math.hypot(projected[1][0], projected[1][1]) <= 3.0


def simplify_open(points: Sequence[tuple[float, float]], tolerance_m: float) -> list[tuple[float, float]]:
    projected = project_local(points)
    return [points[index] for index in douglas_peucker_indices(projected, tolerance_m)]


def simplify_segment(points: Sequence[tuple[float, float]], tolerance_m: float) -> list[tuple[float, float]]:
    if len(points) <= 3:
        return list(points)
    if not nearly_closed(points):
        return simplify_open(points, tolerance_m)

    ring = list(points[:-1]) if points[0] == points[-1] else list(points)
    projected = project_local(ring)
    split_index = max(
        range(1, len(ring)),
        key=lambda index: (projected[index][0] - projected[0][0]) ** 2
        + (projected[index][1] - projected[0][1]) ** 2,
    )
    first_half = simplify_open(ring[: split_index + 1], tolerance_m)
    second_half = simplify_open(ring[split_index:] + [ring[0]], tolerance_m)
    simplified = first_half + second_half[1:]
    if simplified[-1] != simplified[0]:
        simplified.append(simplified[0])
    return simplified


def encode_polyline(points: Iterable[tuple[float, float]], precision: int = PREVIEW_PRECISION) -> str:
    factor = 10**precision
    last_lat = 0
    last_lon = 0
    encoded: list[str] = []
    for lon, lat in points:
        current_lat = int(round(lat * factor))
        current_lon = int(round(lon * factor))
        encoded.append(encode_signed_value(current_lat - last_lat))
        encoded.append(encode_signed_value(current_lon - last_lon))
        last_lat = current_lat
        last_lon = current_lon
    return "".join(encoded)


def encode_signed_value(value: int) -> str:
    shifted = ~(value << 1) if value < 0 else value << 1
    characters = []
    while shifted >= 0x20:
        characters.append(chr((0x20 | (shifted & 0x1F)) + 63))
        shifted >>= 5
    characters.append(chr(shifted + 63))
    return "".join(characters)


def parse_tile_center(tile: str) -> tuple[float, float] | None:
    match = re.fullmatch(r"([ns])(\d+)-([ew])(\d+)", tile.lower())
    if not match:
        return None
    lat = float(match.group(2)) * (1 if match.group(1) == "n" else -1)
    lon = float(match.group(4)) * (1 if match.group(3) == "e" else -1)
    return lon + 0.5, lat + 0.5


def safe_chunk_filename(group_id: str) -> str:
    normalized = group_id.strip().lower()
    if re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", normalized):
        return f"{normalized}.json"
    stem = re.sub(r"[^a-z0-9]+", "-", normalized).strip("-")[:48] or "unknown"
    digest = hashlib.sha256(group_id.encode("utf-8")).hexdigest()[:10]
    return f"{stem}-{digest}.json"


def extend_bounds(target: list[float], source: Sequence[float]) -> None:
    target[0] = min(target[0], source[0])
    target[1] = min(target[1], source[1])
    target[2] = max(target[2], source[2])
    target[3] = max(target[3], source[3])


def rounded_bounds(bounds: Sequence[float]) -> list[float]:
    if len(bounds) != 4 or any(not math.isfinite(value) for value in bounds):
        raise RuntimeError("Unable to derive finite bounds for the web-map output.")
    return [round(value, 7) for value in bounds]


def distance_meters(first: Sequence[float], second: Sequence[float]) -> float:
    """Return a stable local-distance approximation for longitude/latitude pairs."""
    longitude_delta = math.radians(second[0] - first[0])
    latitude_delta = math.radians(second[1] - first[1])
    mean_latitude = math.radians((first[1] + second[1]) / 2)
    x = longitude_delta * math.cos(mean_latitude)
    return EARTH_RADIUS_METERS * math.hypot(x, latitude_delta)


def bbox_diagonal_meters(bounds: Sequence[float]) -> float:
    return distance_meters((bounds[0], bounds[1]), (bounds[2], bounds[3]))


def bbox_center(bounds: Sequence[float]) -> list[float]:
    return [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2]


def padded_bounds(bounds: Sequence[float], padding_meters: float) -> list[float]:
    mean_latitude = math.radians((bounds[1] + bounds[3]) / 2)
    latitude_padding = math.degrees(padding_meters / EARTH_RADIUS_METERS)
    longitude_padding = math.degrees(
        padding_meters / (EARTH_RADIUS_METERS * max(0.01, math.cos(mean_latitude)))
    )
    return rounded_bounds(
        [
            max(-180.0, bounds[0] - longitude_padding),
            max(-90.0, bounds[1] - latitude_padding),
            min(180.0, bounds[2] + longitude_padding),
            min(90.0, bounds[3] + latitude_padding),
        ]
    )


def is_finite_point(value: object) -> bool:
    return (
        isinstance(value, list)
        and len(value) == 2
        and all(isinstance(coordinate, (int, float)) and math.isfinite(coordinate) for coordinate in value)
    )


def curation_string(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def curation_point(value: object, owner: str) -> list[float]:
    if not is_finite_point(value):
        raise RuntimeError(f"{owner} has an invalid labelPoint.")
    point = [float(value[0]), float(value[1])]
    if not (-180 <= point[0] <= 180 and -90 <= point[1] <= 90):
        raise RuntimeError(f"{owner} has an invalid labelPoint.")
    return [round(coordinate, 7) for coordinate in point]


def curation_public_provenance(curation: dict[str, object]) -> dict[str, object]:
    return {
        "kind": curation["kind"],
        "schemaVersion": curation["schemaVersion"],
        "fileName": curation["fileName"],
        "sha256": curation["sha256"],
        "sourceCatalogSha256": curation["sourceCatalogSha256"],
        "sourceTrailCount": curation["sourceTrailCount"],
        "productPackCount": len(curation["productPacks"]),
        "productCollectionCount": len(curation["collections"]),
        "collectionRemainderPackCount": len(curation["remainderPackIds"]),
        "collectionRemainderTrailCount": len(curation["remainderTrailIds"]),
        "productTrailCount": len(curation["productTrailIds"]),
        "discardPackCount": len(curation["discardPacks"]),
        "discardedTrailCount": len(curation["discardedTrailIds"]),
        "discardedTrailIdsSha256": curation["discardedTrailIdsSha256"],
        "discardPackNamePattern": r"^DELETE\d*$",
        "discardPacks": [
            {
                "id": pack["id"],
                "name": pack["name"],
                "trailCount": len(pack["trailIds"]),
            }
            for pack in curation["discardPacks"]
        ],
    }


def validate_curation_project(
    project: object,
    source_rows: Sequence[dict[str, str]],
    source_catalog_sha256: str,
    *,
    file_name: str = "<memory>",
    project_sha256: str | None = None,
) -> dict[str, object]:
    """Validate and compile an exact grouping-board project.

    Validation is deliberately against the complete quality-scoped source catalog,
    before DELETE packs are removed from the product map.
    """

    if not isinstance(project, dict):
        raise RuntimeError("The curation project must be a JSON object.")
    if project.get("kind") != CURATION_PROJECT_KIND:
        raise RuntimeError(f"The curation project kind must be {CURATION_PROJECT_KIND!r}.")
    if project.get("schemaVersion") != CURATION_PROJECT_SCHEMA_VERSION:
        raise RuntimeError("The curation project must use schemaVersion 1.")

    source_ids: list[str] = []
    for row_index, row in enumerate(source_rows, start=1):
        trail_id = curation_string(row.get("trail_id"))
        if not trail_id:
            raise RuntimeError(f"Source catalog row {row_index} has an empty trail ID.")
        source_ids.append(trail_id)
    source_universe = set(source_ids)
    if len(source_universe) != len(source_ids):
        raise RuntimeError("The source catalog contains duplicate trail IDs.")

    source = project.get("source")
    if not isinstance(source, dict):
        raise RuntimeError("The curation project is missing its source object.")
    if source.get("qualityScope") != QUALITY_SCOPE:
        raise RuntimeError(
            f"The curation quality scope must be {QUALITY_SCOPE!r}."
        )
    if source.get("sourceCatalogSha256") != source_catalog_sha256:
        raise RuntimeError("The curation source catalog SHA-256 does not match trails.csv.")
    source_trail_count = source.get("trailCount")
    if (
        not isinstance(source_trail_count, int)
        or isinstance(source_trail_count, bool)
        or source_trail_count != len(source_ids)
    ):
        raise RuntimeError(
            "The curation source trail count does not match the complete quality-scoped catalog."
        )

    raw_packs = project.get("packs")
    raw_unassigned = project.get("unassignedTrailIds")
    if not isinstance(raw_packs, list) or not raw_packs:
        raise RuntimeError("The curation project must contain a non-empty packs array.")
    if not isinstance(raw_unassigned, list):
        raise RuntimeError("The curation project must contain an unassignedTrailIds array.")

    accounted: dict[str, str] = {}
    pack_ids: set[str] = set()
    pack_names: set[str] = set()
    normalized_packs: list[dict[str, object]] = []

    def account_trail(raw_trail_id: object, owner: str) -> str:
        trail_id = curation_string(raw_trail_id)
        if not trail_id:
            raise RuntimeError(f"{owner} contains an invalid trail ID.")
        if trail_id not in source_universe:
            raise RuntimeError(f"{owner} contains unknown trail ID {trail_id}.")
        prior_owner = accounted.get(trail_id)
        if prior_owner is not None:
            raise RuntimeError(
                f"Trail {trail_id} appears in both {prior_owner} and {owner}."
            )
        accounted[trail_id] = owner
        return trail_id

    for pack_index, raw_pack in enumerate(raw_packs, start=1):
        if not isinstance(raw_pack, dict):
            raise RuntimeError(f"Curation pack {pack_index} must be an object.")
        pack_id = curation_string(raw_pack.get("id"))
        pack_name = curation_string(raw_pack.get("name"))
        if not CURATION_PACK_ID.fullmatch(pack_id):
            raise RuntimeError(f"Curation pack {pack_index} has an invalid ID: {pack_id!r}.")
        if pack_id in pack_ids:
            raise RuntimeError(f"Duplicate curation pack ID: {pack_id}.")
        if not pack_name or len(pack_name) > 80:
            raise RuntimeError(f"Curation pack {pack_id!r} has an invalid name.")
        folded_name = pack_name.casefold()
        if folded_name in pack_names:
            raise RuntimeError(f"Duplicate curation pack name: {pack_name}.")
        raw_trail_ids = raw_pack.get("trailIds")
        if not isinstance(raw_trail_ids, list) or not raw_trail_ids:
            raise RuntimeError(f"Curation pack {pack_id!r} must contain trailIds.")
        trail_ids = [
            account_trail(raw_trail_id, f"curation pack {pack_id!r}")
            for raw_trail_id in raw_trail_ids
        ]
        normalized_packs.append(
            {
                "id": pack_id,
                "name": pack_name,
                "labelPoint": curation_point(
                    raw_pack.get("labelPoint"), f"Curation pack {pack_id!r}"
                ),
                "trailIds": trail_ids,
            }
        )
        pack_ids.add(pack_id)
        pack_names.add(folded_name)

    unassigned_trail_ids = [
        account_trail(raw_trail_id, "unassignedTrailIds")
        for raw_trail_id in raw_unassigned
    ]
    if len(accounted) != len(source_universe):
        missing = sorted(source_universe - accounted.keys())
        preview = ", ".join(missing[:5])
        suffix = ", …" if len(missing) > 5 else ""
        raise RuntimeError(
            f"The curation project is missing {len(missing)} source trail IDs"
            f"{f' ({preview}{suffix})' if preview else ''}."
        )
    if unassigned_trail_ids:
        raise RuntimeError(
            "Production curation cannot contain unassigned trails "
            f"({len(unassigned_trail_ids)} found)."
        )

    discarded_packs = [
        pack
        for pack in normalized_packs
        if CURATION_DELETE_PACK_NAME.fullmatch(str(pack["name"]))
    ]
    product_packs = [
        pack
        for pack in normalized_packs
        if not CURATION_DELETE_PACK_NAME.fullmatch(str(pack["name"]))
    ]
    if not product_packs:
        raise RuntimeError("The curation project contains no retained product packs.")
    discarded_trail_ids = {
        str(trail_id)
        for pack in discarded_packs
        for trail_id in pack["trailIds"]
    }
    product_trail_ids = source_universe - discarded_trail_ids
    assignment_by_trail_id = {
        str(trail_id): str(pack["id"])
        for pack in product_packs
        for trail_id in pack["trailIds"]
    }
    if set(assignment_by_trail_id) != product_trail_ids:
        raise RuntimeError("The retained curation packs do not exactly cover product trails.")

    raw_collections = project.get("collections", [])
    if not isinstance(raw_collections, list):
        raise RuntimeError("Curation collections must be an array when present.")
    product_pack_ids = {str(pack["id"]) for pack in product_packs}
    used_ids = set(pack_ids)
    used_names = set(pack_names)
    pack_collection_owner: dict[str, str] = {}
    collections: list[dict[str, object]] = []
    for collection_index, raw_collection in enumerate(raw_collections, start=1):
        if not isinstance(raw_collection, dict):
            raise RuntimeError(f"Curation collection {collection_index} must be an object.")
        collection_id = curation_string(raw_collection.get("id"))
        collection_name = curation_string(raw_collection.get("name"))
        if not CURATION_PACK_ID.fullmatch(collection_id):
            raise RuntimeError(
                f"Curation collection {collection_index} has an invalid ID: {collection_id!r}."
            )
        if collection_id in used_ids:
            raise RuntimeError(f"Duplicate curation area or collection ID: {collection_id}.")
        if not collection_name or len(collection_name) > 80:
            raise RuntimeError(f"Curation collection {collection_id!r} has an invalid name.")
        folded_name = collection_name.casefold()
        if folded_name in used_names:
            raise RuntimeError(f"Duplicate curation area or collection name: {collection_name}.")
        has_pack_ids = "memberPackIds" in raw_collection
        has_area_ids = "memberAreaIds" in raw_collection
        if has_pack_ids and has_area_ids:
            raise RuntimeError(
                f"Curation collection {collection_id!r} must use only memberPackIds."
            )
        raw_member_ids = raw_collection.get(
            "memberPackIds", raw_collection.get("memberAreaIds")
        )
        if not isinstance(raw_member_ids, list) or len(raw_member_ids) < 2:
            raise RuntimeError(
                f"Curation collection {collection_id!r} needs at least two memberPackIds."
            )
        member_pack_ids: list[str] = []
        for raw_member_id in raw_member_ids:
            member_id = curation_string(raw_member_id)
            if member_id not in product_pack_ids:
                raise RuntimeError(
                    f"Curation collection {collection_id!r} references unknown product pack "
                    f"{member_id!r}."
                )
            if member_id in member_pack_ids:
                raise RuntimeError(
                    f"Curation collection {collection_id!r} repeats member pack {member_id!r}."
                )
            prior_collection = pack_collection_owner.get(member_id)
            if prior_collection is not None:
                raise RuntimeError(
                    f"Curation pack {member_id!r} belongs to both collections "
                    f"{prior_collection!r} and {collection_id!r}."
                )
            pack_collection_owner[member_id] = collection_id
            member_pack_ids.append(member_id)
        raw_remainder_pack_id = raw_collection.get("remainderPackId")
        remainder_pack_id = (
            curation_string(raw_remainder_pack_id)
            if raw_remainder_pack_id is not None
            else None
        )
        if remainder_pack_id is not None:
            if remainder_pack_id != f"{collection_id}-other":
                raise RuntimeError(
                    f"Curation collection {collection_id!r} remainderPackId must be "
                    f"{collection_id + '-other'!r} for the runtime collection contract."
                )
            if remainder_pack_id not in product_pack_ids:
                raise RuntimeError(
                    f"Curation collection {collection_id!r} references unknown remainder "
                    f"pack {remainder_pack_id!r}."
                )
            if remainder_pack_id in member_pack_ids:
                raise RuntimeError(
                    f"Curation collection {collection_id!r} cannot use pack "
                    f"{remainder_pack_id!r} as both a member and its remainder."
                )
            prior_collection = pack_collection_owner.get(remainder_pack_id)
            if prior_collection is not None:
                raise RuntimeError(
                    f"Curation pack {remainder_pack_id!r} belongs to both collections "
                    f"{prior_collection!r} and {collection_id!r}."
                )
            pack_collection_owner[remainder_pack_id] = collection_id
        collections.append(
            {
                "id": collection_id,
                "name": collection_name,
                "labelPoint": curation_point(
                    raw_collection.get("labelPoint"),
                    f"Curation collection {collection_id!r}",
                ),
                "memberPackIds": member_pack_ids,
                "remainderPackId": remainder_pack_id,
            }
        )
        used_ids.add(collection_id)
        used_names.add(folded_name)

    product_pack_by_id = {
        str(pack["id"]): pack for pack in product_packs
    }
    remainder_pack_ids = {
        str(collection["remainderPackId"])
        for collection in collections
        if collection["remainderPackId"] is not None
    }
    remainder_trail_ids = {
        str(trail_id)
        for pack_id in remainder_pack_ids
        for trail_id in product_pack_by_id[pack_id]["trailIds"]
    }
    discarded_ids_sorted = sorted(discarded_trail_ids)
    return {
        "kind": CURATION_PROJECT_KIND,
        "schemaVersion": CURATION_PROJECT_SCHEMA_VERSION,
        "fileName": file_name,
        "sha256": project_sha256,
        "sourceCatalogSha256": source_catalog_sha256,
        "sourceTrailCount": len(source_ids),
        "productPacks": sorted(product_packs, key=lambda pack: str(pack["id"])),
        "discardPacks": sorted(discarded_packs, key=lambda pack: str(pack["id"])),
        "collections": sorted(collections, key=lambda item: str(item["id"])),
        "remainderPackIds": remainder_pack_ids,
        "remainderTrailIds": remainder_trail_ids,
        "productTrailIds": product_trail_ids,
        "discardedTrailIds": discarded_trail_ids,
        "discardedTrailIdsSha256": hashlib.sha256(
            "\n".join(discarded_ids_sorted).encode("utf-8")
        ).hexdigest(),
        "assignmentByTrailId": assignment_by_trail_id,
    }


def read_curation_project(
    path: Path,
    source_rows: Sequence[dict[str, str]],
    source_catalog_sha256: str,
) -> dict[str, object]:
    resolved = path.resolve()
    if not resolved.is_file():
        raise FileNotFoundError(f"Missing curation project: {resolved}")
    try:
        with resolved.open("r", encoding="utf-8") as handle:
            project = json.load(handle)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"Unable to parse curation project {resolved}: {error}") from error
    return validate_curation_project(
        project,
        source_rows,
        source_catalog_sha256,
        file_name=resolved.name,
        project_sha256=sha256_file(resolved),
    )


def validate_cluster_selector(selector: object, owner_id: str, selector_index: int) -> None:
    if not isinstance(selector, dict):
        raise RuntimeError(
            f"Cluster selector {selector_index + 1} for {owner_id!r} must be an object."
        )
    if not is_finite_point(selector.get("seed")):
        raise RuntimeError(
            f"Cluster selector {selector_index + 1} for {owner_id!r} needs a finite "
            "[longitude, latitude] seed."
        )
    aliases = selector.get("sourceAliases")
    if not isinstance(aliases, list) or not aliases or any(
        not isinstance(alias, str) or not alias.strip() for alias in aliases
    ):
        raise RuntimeError(
            f"Cluster selector {selector_index + 1} for {owner_id!r} needs at least one "
            "source alias."
        )


def cluster_selectors(definition: dict[str, object]) -> list[dict[str, object]]:
    selectors = definition.get("clusterSelectors")
    if isinstance(selectors, list):
        return selectors
    return [
        {
            "seed": definition["seed"],
            "sourceAliases": definition["sourceAliases"],
        }
    ]


def validate_definition_id(value: object, label: str, used_ids: set[str]) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", value):
        raise RuntimeError(f"Invalid {label} id: {value!r}")
    if value in used_ids:
        raise RuntimeError(f"Duplicate riding-area or collection id: {value}")
    used_ids.add(value)
    return value


def read_riding_area_config(path: Path) -> dict[str, object]:
    if not path.is_file():
        raise FileNotFoundError(f"Missing riding-area curation file: {path}")
    with path.open("r", encoding="utf-8") as handle:
        config = json.load(handle)
    if config.get("version") != 1:
        raise RuntimeError("The riding-area curation file must use version 1.")

    algorithm = config.get("algorithm")
    if not isinstance(algorithm, dict):
        raise RuntimeError("The riding-area curation file is missing its algorithm object.")
    numeric_settings = [
        "compactBboxDiagonalMeters",
        "clusterEpsilonMeters",
        "clusterMinSamples",
        "assignmentRadiusMeters",
        "assignmentDominance",
        "maxAssignedBboxDiagonalMeters",
        "viewPaddingMeters",
        "seedMaxDistanceMeters",
    ]
    for key in numeric_settings:
        value = algorithm.get(key)
        if not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
            raise RuntimeError(f"Riding-area algorithm setting {key!r} must be positive.")
    for key in ("clusterMinSamples",):
        if algorithm[key] != int(algorithm[key]):
            raise RuntimeError(f"{key} must be an integer.")
    if algorithm["assignmentDominance"] > 1:
        raise RuntimeError("assignmentDominance cannot exceed 1.")

    areas = config.get("areas")
    if not isinstance(areas, list) or not areas:
        raise RuntimeError("The riding-area curation file must define at least one area.")
    definition_ids: set[str] = set()
    for area in areas:
        if not isinstance(area, dict):
            raise RuntimeError("Every riding-area definition must be an object.")
        area_id = validate_definition_id(area.get("id"), "riding-area", definition_ids)
        name = area.get("name")
        if not isinstance(name, str) or not name.strip():
            raise RuntimeError(f"Riding area {area_id!r} needs a display name.")
        has_selectors = "clusterSelectors" in area
        has_seed = "seed" in area
        has_aliases = "sourceAliases" in area
        if (has_selectors and (has_seed or has_aliases)) or (
            not has_selectors and not (has_seed and has_aliases)
        ):
            raise RuntimeError(
                f"Riding area {area_id!r} must use either seed/sourceAliases or "
                "clusterSelectors."
            )
        selectors = cluster_selectors(area)
        if not selectors:
            raise RuntimeError(f"Riding area {area_id!r} needs at least one cluster selector.")
        for selector_index, selector in enumerate(selectors):
            validate_cluster_selector(selector, area_id, selector_index)
        label_point = area.get("labelPoint", selectors[0]["seed"])
        if not is_finite_point(label_point):
            raise RuntimeError(f"Riding area {area_id!r} has an invalid labelPoint.")

    collections = config.get("collections", [])
    if not isinstance(collections, list):
        raise RuntimeError("collections must be an array when present.")
    for collection in collections:
        if not isinstance(collection, dict):
            raise RuntimeError("Every riding-area collection must be an object.")
        collection_id = validate_definition_id(
            collection.get("id"), "riding-area collection", definition_ids
        )
        name = collection.get("name")
        if not isinstance(name, str) or not name.strip():
            raise RuntimeError(f"Riding-area collection {collection_id!r} needs a display name.")
        if "seed" in collection or "sourceAliases" in collection:
            raise RuntimeError(
                f"Riding-area collection {collection_id!r} must use clusterSelectors."
            )
        selectors = collection.get("clusterSelectors")
        if not isinstance(selectors, list) or not selectors:
            raise RuntimeError(
                f"Riding-area collection {collection_id!r} needs clusterSelectors."
            )
        for selector_index, selector in enumerate(selectors):
            validate_cluster_selector(selector, collection_id, selector_index)
        parent_only_trail_ids = collection.get("parentOnlyTrailIds", [])
        if not isinstance(parent_only_trail_ids, list) or any(
            not isinstance(trail_id, str) or not trail_id.startswith("trail-")
            for trail_id in parent_only_trail_ids
        ):
            raise RuntimeError(
                f"Riding-area collection {collection_id!r} has invalid parentOnlyTrailIds."
            )
        if len(parent_only_trail_ids) != len(set(parent_only_trail_ids)):
            raise RuntimeError(
                f"Riding-area collection {collection_id!r} repeats a parentOnlyTrailId."
            )
        if not is_finite_point(collection.get("labelPoint", selectors[0]["seed"])):
            raise RuntimeError(
                f"Riding-area collection {collection_id!r} has an invalid labelPoint."
            )
        dominance = collection.get("partitionDominance", algorithm["assignmentDominance"])
        if (
            not isinstance(dominance, (int, float))
            or not math.isfinite(dominance)
            or dominance <= 0
            or dominance > 1
        ):
            raise RuntimeError(
                f"Riding-area collection {collection_id!r} has an invalid partitionDominance."
            )
        members = collection.get("members")
        if not isinstance(members, list) or len(members) < 2:
            raise RuntimeError(
                f"Riding-area collection {collection_id!r} needs at least two member areas."
            )
        member_ids: set[str] = set()
        partition_member_count = 0
        for member in members:
            if not isinstance(member, dict):
                raise RuntimeError(
                    f"Every member of riding-area collection {collection_id!r} must be an object."
                )
            member_id = validate_definition_id(
                member.get("id"), "collection member", definition_ids
            )
            member_ids.add(member_id)
            member_name = member.get("name")
            if not isinstance(member_name, str) or not member_name.strip():
                raise RuntimeError(f"Collection member {member_id!r} needs a display name.")
            if not is_finite_point(member.get("seed")):
                raise RuntimeError(
                    f"Collection member {member_id!r} needs a finite [longitude, latitude] seed."
                )
            if not is_finite_point(member.get("labelPoint", member["seed"])):
                raise RuntimeError(f"Collection member {member_id!r} has an invalid labelPoint.")
            participates = member.get("partition", True)
            if not isinstance(participates, bool):
                raise RuntimeError(
                    f"Collection member {member_id!r} has an invalid partition flag."
                )
            partition_member_count += int(participates)
            aliases = member.get("nameAliases", [])
            if not isinstance(aliases, list) or any(
                not isinstance(alias, str) or not alias.strip() for alias in aliases
            ):
                raise RuntimeError(
                    f"Collection member {member_id!r} has invalid nameAliases."
                )
        if partition_member_count < 2:
            raise RuntimeError(
                f"Riding-area collection {collection_id!r} needs at least two partition members."
            )
        for selector_index, selector in enumerate(selectors):
            member_id = selector.get("memberId")
            if member_id is not None and member_id not in member_ids:
                raise RuntimeError(
                    f"Cluster selector {selector_index + 1} for {collection_id!r} "
                    f"references unknown member {member_id!r}."
                )

    generated_overrides = config.get("generatedAreaOverrides", {})
    if not isinstance(generated_overrides, dict):
        raise RuntimeError("generatedAreaOverrides must be an object when present.")
    for generated_id, override in generated_overrides.items():
        if not isinstance(generated_id, str) or not re.fullmatch(
            rf"{GENERATED_AREA_PREFIX}[0-9a-f]{{16}}", generated_id
        ):
            raise RuntimeError(f"Invalid generated-area override id: {generated_id!r}")
        if isinstance(override, str):
            name = override
            label_point = None
            disabled = False
        elif isinstance(override, dict):
            name = override.get("name")
            label_point = override.get("labelPoint")
            disabled = override.get("disabled", False)
        else:
            raise RuntimeError(
                f"Generated-area override {generated_id!r} must be a name or object."
            )
        if not isinstance(disabled, bool):
            raise RuntimeError(
                f"Generated-area override {generated_id!r} has an invalid disabled flag."
            )
        if (not isinstance(name, str) or not name.strip()) and not disabled:
            raise RuntimeError(
                f"Generated-area override {generated_id!r} needs a display name."
            )
        if label_point is not None and not is_finite_point(label_point):
            raise RuntimeError(
                f"Generated-area override {generated_id!r} has an invalid labelPoint."
            )
        include_trail_ids = override.get("includeTrailIds", []) if isinstance(override, dict) else []
        if not isinstance(include_trail_ids, list) or any(
            not isinstance(trail_id, str) or not trail_id.startswith("trail-")
            for trail_id in include_trail_ids
        ):
            raise RuntimeError(
                f"Generated-area override {generated_id!r} has invalid includeTrailIds."
            )
        if len(include_trail_ids) != len(set(include_trail_ids)):
            raise RuntimeError(
                f"Generated-area override {generated_id!r} repeats an includeTrailId."
            )

    semantic_regions = config.get("semanticRegions", [])
    if not isinstance(semantic_regions, list):
        raise RuntimeError("semanticRegions must be an array when present.")
    claimed_source_area_ids: set[str] = set()
    claimed_source_prefixes: dict[str, str] = {}
    claimed_semantic_trail_ids: dict[str, str] = {}
    for region in semantic_regions:
        if not isinstance(region, dict):
            raise RuntimeError("Every semantic-region definition must be an object.")
        region_id = validate_definition_id(
            region.get("id"), "semantic region", definition_ids
        )
        name = region.get("name")
        if not isinstance(name, str) or not name.strip():
            raise RuntimeError(f"Semantic region {region_id!r} needs a display name.")
        source_area_ids = region.get("sourceAreaIds", [])
        if not isinstance(source_area_ids, list) or any(
            not isinstance(area_id, str)
            or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", area_id)
            for area_id in source_area_ids
        ):
            raise RuntimeError(
                f"Semantic region {region_id!r} has invalid sourceAreaIds."
            )
        if len(source_area_ids) != len(set(source_area_ids)):
            raise RuntimeError(
                f"Semantic region {region_id!r} repeats a sourceAreaId."
            )
        repeated_source_ids = claimed_source_area_ids & set(source_area_ids)
        if repeated_source_ids:
            raise RuntimeError(
                f"Semantic region {region_id!r} repeats source areas claimed by another "
                "region: " + ", ".join(sorted(repeated_source_ids))
            )
        claimed_source_area_ids.update(source_area_ids)
        source_prefixes = region.get("claimSourcePathPrefixes", [])
        if not isinstance(source_prefixes, list) or any(
            not isinstance(prefix, str) or not prefix.strip()
            for prefix in source_prefixes
        ):
            raise RuntimeError(
                f"Semantic region {region_id!r} has invalid claimSourcePathPrefixes."
            )
        for source_prefix in source_prefixes:
            normalized_prefix = normalize_source_paths(source_prefix).strip("/")
            if not normalized_prefix:
                raise RuntimeError(
                    f"Semantic region {region_id!r} has an empty source-path prefix."
                )
            conflict = next(
                (
                    (existing_prefix, existing_region)
                    for existing_prefix, existing_region in claimed_source_prefixes.items()
                    if source_path_selector_matches(normalized_prefix, existing_prefix)
                    or source_path_selector_matches(existing_prefix, normalized_prefix)
                ),
                None,
            )
            if conflict is not None:
                raise RuntimeError(
                    f"Semantic region {region_id!r} has source-path prefix "
                    f"{normalized_prefix!r} overlapping {conflict[0]!r} from "
                    f"{conflict[1]!r}."
                )
            claimed_source_prefixes[normalized_prefix] = region_id
        include_trail_ids = region.get("includeTrailIds", [])
        if not isinstance(include_trail_ids, list) or any(
            not isinstance(trail_id, str) or not trail_id.startswith("trail-")
            for trail_id in include_trail_ids
        ):
            raise RuntimeError(
                f"Semantic region {region_id!r} has invalid includeTrailIds."
            )
        if len(include_trail_ids) != len(set(include_trail_ids)):
            raise RuntimeError(
                f"Semantic region {region_id!r} repeats an includeTrailId."
            )
        reassign_trail_ids = region.get("reassignTrailIds", [])
        if not isinstance(reassign_trail_ids, list) or any(
            not isinstance(trail_id, str) or not trail_id.startswith("trail-")
            for trail_id in reassign_trail_ids
        ):
            raise RuntimeError(
                f"Semantic region {region_id!r} has invalid reassignTrailIds."
            )
        if len(reassign_trail_ids) != len(set(reassign_trail_ids)):
            raise RuntimeError(
                f"Semantic region {region_id!r} repeats a reassignTrailId."
            )
        if set(include_trail_ids) & set(reassign_trail_ids):
            raise RuntimeError(
                f"Semantic region {region_id!r} repeats a trail across includeTrailIds "
                "and reassignTrailIds."
            )
        retain_assigned_trail_ids = region.get("retainAssignedTrailIds", [])
        if not isinstance(retain_assigned_trail_ids, list) or any(
            not isinstance(trail_id, str) or not trail_id.startswith("trail-")
            for trail_id in retain_assigned_trail_ids
        ):
            raise RuntimeError(
                f"Semantic region {region_id!r} has invalid retainAssignedTrailIds."
            )
        if len(retain_assigned_trail_ids) != len(set(retain_assigned_trail_ids)):
            raise RuntimeError(
                f"Semantic region {region_id!r} repeats a retainAssignedTrailId."
            )
        conflicting_retains = set(retain_assigned_trail_ids) & (
            set(include_trail_ids) | set(reassign_trail_ids)
        )
        if conflicting_retains:
            raise RuntimeError(
                f"Semantic region {region_id!r} cannot both retain and claim trails: "
                + ", ".join(sorted(conflicting_retains))
            )
        if retain_assigned_trail_ids and not source_prefixes:
            raise RuntimeError(
                f"Semantic region {region_id!r} uses retainAssignedTrailIds without "
                "a claimSourcePathPrefix."
            )
        for trail_id in [*include_trail_ids, *reassign_trail_ids]:
            previous_region = claimed_semantic_trail_ids.get(trail_id)
            if previous_region is not None:
                raise RuntimeError(
                    f"Semantic regions {previous_region!r} and {region_id!r} both claim "
                    f"trail {trail_id!r}."
                )
            claimed_semantic_trail_ids[trail_id] = region_id
        if (
            not source_area_ids
            and not source_prefixes
            and not include_trail_ids
            and not reassign_trail_ids
        ):
            raise RuntimeError(
                f"Semantic region {region_id!r} needs source areas, source prefixes, "
                "or explicit trail IDs."
            )
        if region.get("labelPoint") is not None and not is_finite_point(
            region["labelPoint"]
        ):
            raise RuntimeError(
                f"Semantic region {region_id!r} has an invalid labelPoint."
            )
    excluded = config.get("excludeTrailIds", [])
    if not isinstance(excluded, list) or any(
        not isinstance(trail_id, str) or not trail_id.startswith("trail-")
        for trail_id in excluded
    ):
        raise RuntimeError("excludeTrailIds must be an array of trail IDs.")
    if len(excluded) != len(set(excluded)):
        raise RuntimeError("excludeTrailIds contains duplicates.")
    return config


def normalize_source_paths(value: object) -> str:
    return str(value or "").replace("\\", "/").casefold()


def source_path_selector_matches(path: str, selector: str) -> bool:
    """Match one exact source file or a source-directory subtree."""
    normalized_path = normalize_source_paths(path).strip("/")
    normalized_selector = normalize_source_paths(selector).strip("/")
    return normalized_path == normalized_selector or normalized_path.startswith(
        normalized_selector + "/"
    )


def generated_area_identity(core_trails: Sequence[dict[str, object]]) -> tuple[str, str]:
    core_ids = sorted(str(trail["trail_id"]) for trail in core_trails)
    membership_sha256 = hashlib.sha256("\n".join(core_ids).encode("utf-8")).hexdigest()
    return f"{GENERATED_AREA_PREFIX}{membership_sha256[:16]}", membership_sha256


def generated_core_grid(
    generated: Sequence[dict[str, object]], radius_meters: float
) -> tuple[
    dict[tuple[int, int], list[tuple[dict[str, object], str]]],
    float,
]:
    cell_degrees = math.degrees(radius_meters / EARTH_RADIUS_METERS)
    grid: dict[tuple[int, int], list[tuple[dict[str, object], str]]] = {}
    for draft in generated:
        if draft["disabled"]:
            continue
        area_id = str(draft["id"])
        for trail in draft["coreTrails"]:
            longitude, latitude = trail["center"]
            cell = (
                math.floor(longitude / cell_degrees),
                math.floor(latitude / cell_degrees),
            )
            grid.setdefault(cell, []).append((trail, area_id))
    return grid, cell_degrees


def nearest_generated_area(
    point: Sequence[float],
    grid: dict[tuple[int, int], list[tuple[dict[str, object], str]]],
    cell_degrees: float,
    radius_meters: float,
) -> str | None:
    longitude, latitude = point
    center_x = math.floor(longitude / cell_degrees)
    center_y = math.floor(latitude / cell_degrees)
    latitude_radius = math.degrees(radius_meters / EARTH_RADIUS_METERS)
    longitude_radius = latitude_radius / max(0.01, math.cos(math.radians(latitude)))
    cell_radius_x = math.ceil(longitude_radius / cell_degrees)
    cell_radius_y = math.ceil(latitude_radius / cell_degrees)
    nearest: tuple[float, str] | None = None
    for cell_y in range(center_y - cell_radius_y, center_y + cell_radius_y + 1):
        for cell_x in range(center_x - cell_radius_x, center_x + cell_radius_x + 1):
            for core_trail, area_id in grid.get((cell_x, cell_y), []):
                separation = distance_meters(point, core_trail["center"])
                candidate = (separation, area_id)
                if separation <= radius_meters and (nearest is None or candidate < nearest):
                    nearest = candidate
    return nearest[1] if nearest is not None else None


def trail_length_votes(
    trail: dict[str, object],
    nearest_area,
) -> tuple[Counter[str], float]:
    votes: Counter[str] = Counter()
    total_length = 0.0
    for segment in trail["preview_segments"]:
        for start, end in zip(segment, segment[1:]):
            length = distance_meters(start, end)
            if length <= 0:
                continue
            total_length += length
            sample_count = max(
                1, math.ceil(length / GENERATED_ASSIGNMENT_VOTE_SAMPLE_METERS)
            )
            sample_length = length / sample_count
            for sample_index in range(sample_count):
                progress = (sample_index + 0.5) / sample_count
                sample = [
                    float(start[0]) + (float(end[0]) - float(start[0])) * progress,
                    float(start[1]) + (float(end[1]) - float(start[1])) * progress,
                ]
                area_id = nearest_area(sample)
                if area_id is not None:
                    votes[area_id] += sample_length
    return votes, total_length


def trail_segments_are_closed(trail: dict[str, object]) -> bool:
    segments = trail["preview_segments"]
    return bool(segments) and all(
        len(segment) >= 2
        and distance_meters(segment[0], segment[-1])
        <= GENERATED_ASSIGNMENT_CLOSED_TOLERANCE_METERS
        for segment in segments
    )


def generated_assignment_target(
    trail: dict[str, object],
    nearest_area,
    dominance: float,
    max_open_diagonal_meters: float,
    max_competing_share: float,
) -> str | None:
    if (
        float(trail["bbox_diagonal_m"]) > max_open_diagonal_meters
        and not trail_segments_are_closed(trail)
    ):
        return None
    center_area_id = nearest_area(trail["center"])
    if center_area_id is None:
        return None
    votes, total_length = trail_length_votes(trail, nearest_area)
    if not votes or total_length <= 0:
        return None
    area_id, winning_length = sorted(
        votes.items(), key=lambda item: (-item[1], item[0])
    )[0]
    competing_length = sum(votes.values()) - winning_length
    if (
        area_id != center_area_id
        or winning_length / total_length < dominance
        or competing_length / total_length > max_competing_share
    ):
        return None
    return area_id


def representative_cluster_point(trails: Sequence[dict[str, object]]) -> list[float]:
    mean_point = [
        sum(float(trail["center"][0]) for trail in trails) / len(trails),
        sum(float(trail["center"][1]) for trail in trails) / len(trails),
    ]
    representative = min(
        trails,
        key=lambda trail: (
            distance_meters(mean_point, trail["center"]),
            str(trail["trail_id"]),
        ),
    )
    return [round(float(value), 7) for value in representative["center"]]


def nearest_populated_place(
    point: Sequence[float], places: Sequence[dict[str, object]]
) -> dict[str, object] | None:
    if not places:
        return None
    distance, _population, _name, _place_id, place = min(
        (
            distance_meters(point, candidate["point"]),
            -int(candidate["population"]),
            str(candidate["name"]).casefold(),
            str(candidate["id"]),
            candidate,
        )
        for candidate in places
    )
    return {
        "id": place["id"],
        "name": place["name"],
        "countryCode": place["countryCode"],
        "admin1Code": place["admin1Code"],
        "population": place["population"],
        "distanceKm": round(distance / 1000.0, 2),
        "point": [round(float(value), 7) for value in place["point"]],
    }


def populated_place_area_name(
    place: dict[str, object], area_point: Sequence[float]
) -> str:
    place_point = place["point"]
    separation = distance_meters(place_point, area_point)
    if separation < 1_500:
        return str(place["name"])
    mean_latitude = math.radians((float(place_point[1]) + float(area_point[1])) / 2)
    east = (float(area_point[0]) - float(place_point[0])) * math.cos(mean_latitude)
    north = float(area_point[1]) - float(place_point[1])
    bearing = (math.degrees(math.atan2(east, north)) + 360.0) % 360.0
    directions = [
        "North",
        "Northeast",
        "East",
        "Southeast",
        "South",
        "Southwest",
        "West",
        "Northwest",
    ]
    direction = directions[int((bearing + 22.5) // 45) % len(directions)]
    return f"{place['name']} {direction}"


def normalized_generated_override(
    override: object,
) -> dict[str, object] | None:
    if override is None:
        return None
    if isinstance(override, str):
        return {"name": override.strip(), "disabled": False}
    normalized = {"disabled": bool(override.get("disabled", False))}
    if isinstance(override.get("name"), str) and override["name"].strip():
        normalized["name"] = override["name"].strip()
    if override.get("labelPoint") is not None:
        normalized["labelPoint"] = [float(value) for value in override["labelPoint"]]
    if override.get("includeTrailIds"):
        normalized["includeTrailIds"] = [str(value) for value in override["includeTrailIds"]]
    return normalized


def combined_bounds(items: Sequence[Sequence[float]]) -> list[float]:
    bounds = [math.inf, math.inf, -math.inf, -math.inf]
    for item in items:
        extend_bounds(bounds, item)
    return rounded_bounds(bounds)


def trail_matches_source_prefixes(
    trail: dict[str, object], prefixes: Sequence[str]
) -> bool:
    for raw_path in re.split(r"\s*[|;]\s*", str(trail["source_paths"])):
        if any(source_path_selector_matches(raw_path, prefix) for prefix in prefixes):
            return True
    return False


def apply_semantic_regions(
    trails: Sequence[dict[str, object]],
    area_assignments: dict[str, str],
    collection_assignments: dict[str, str],
    excluded_ids: set[str],
    config: dict[str, object],
    generated: Sequence[dict[str, object]],
    allow_missing: bool,
) -> tuple[list[dict[str, object]], set[str]]:
    """Replace reviewed source areas with stable rider-scale semantic regions.

    Resolution is two-phase: every claim is checked against the pre-semantic
    assignment ledger before any assignment changes. Source selectors claim only
    otherwise-unassigned trails. Intentional moves require exact trail IDs.
    """
    definitions = config.get("semanticRegions", [])
    if not definitions:
        return [], set()

    generated_ids = {
        str(draft["id"]) for draft in generated if not draft["disabled"]
    }
    curated_ids = {str(area["id"]) for area in config["areas"]}
    collection_member_ids = {
        str(member["id"])
        for collection in config.get("collections", [])
        for member in collection["members"]
    }
    known_source_ids = curated_ids | generated_ids
    all_trails = {str(trail["trail_id"]): trail for trail in trails}
    initial_area_assignments = dict(area_assignments)
    claimed_source_ids: set[str] = set()
    claims: dict[str, tuple[str, str]] = {}
    resolved_definitions: list[
        tuple[dict[str, object], set[str], dict[str, object]]
    ] = []
    reason_priority = {
        "reviewed-source-area": 1,
        "reviewed-source-path": 2,
        "reviewed-trail-include": 3,
        "reviewed-trail-reassignment": 4,
    }

    def claim(trail_id: str, region_id: str, reason: str) -> None:
        existing = claims.get(trail_id)
        if existing is not None and existing[0] != region_id:
            raise RuntimeError(
                f"Semantic regions {existing[0]!r} and {region_id!r} both resolve "
                f"trail {trail_id!r}; refine their selectors."
            )
        if (
            existing is None
            or reason_priority[reason] > reason_priority[existing[1]]
        ):
            claims[trail_id] = (region_id, reason)

    for definition in definitions:
        region_id = str(definition["id"])
        source_ids = {
            str(area_id) for area_id in definition.get("sourceAreaIds", [])
        }
        forbidden_members = source_ids & collection_member_ids
        if forbidden_members:
            raise RuntimeError(
                f"Semantic region {region_id!r} cannot absorb collection members: "
                + ", ".join(sorted(forbidden_members))
            )
        missing_sources = source_ids - known_source_ids
        if missing_sources and not allow_missing:
            raise RuntimeError(
                f"Semantic region {region_id!r} references missing source areas: "
                + ", ".join(sorted(missing_sources))
            )
        source_ids &= known_source_ids
        if region_id in known_source_ids and region_id not in source_ids:
            raise RuntimeError(
                f"Semantic region {region_id!r} conflicts with an existing source area."
            )
        repeated_sources = source_ids & claimed_source_ids
        if repeated_sources:
            raise RuntimeError(
                f"Semantic region {region_id!r} repeats source areas claimed by another "
                "region: " + ", ".join(sorted(repeated_sources))
            )
        claimed_source_ids.update(source_ids)
        for trail_id, assigned_area_id in initial_area_assignments.items():
            if assigned_area_id in source_ids:
                claim(trail_id, region_id, "reviewed-source-area")

        prefixes = [
            str(value) for value in definition.get("claimSourcePathPrefixes", [])
        ]
        retain_ids = {
            str(value) for value in definition.get("retainAssignedTrailIds", [])
        }
        matched_source_ids: set[str] = set()
        retained_assignments: dict[str, str] = {}
        quarantined_source_matches: set[str] = set()
        if prefixes:
            for trail in trails:
                trail_id = str(trail["trail_id"])
                if not trail_matches_source_prefixes(trail, prefixes):
                    continue
                matched_source_ids.add(trail_id)
                if trail_id in excluded_ids:
                    quarantined_source_matches.add(trail_id)
                    continue
                assigned_area_id = initial_area_assignments.get(trail_id)
                assigned_collection_id = collection_assignments.get(trail_id)
                if assigned_area_id in source_ids:
                    continue
                if assigned_area_id is not None or assigned_collection_id is not None:
                    if trail_id in retain_ids:
                        retained_assignments[trail_id] = (
                            assigned_area_id
                            if assigned_area_id is not None
                            else f"collection:{assigned_collection_id}"
                        )
                        continue
                    if trail_id in definition.get("reassignTrailIds", []):
                        continue
                    current_target = (
                        assigned_area_id
                        if assigned_area_id is not None
                        else f"collection:{assigned_collection_id}"
                    )
                    raise RuntimeError(
                        f"Semantic region {region_id!r} source selector matches assigned "
                        f"trail {trail_id!r} in {current_target!r}; list it under "
                        "reassignTrailIds or retainAssignedTrailIds."
                    )
                claim(trail_id, region_id, "reviewed-source-path")

        unresolved_retains = retain_ids - set(retained_assignments)
        if unresolved_retains and not allow_missing:
            raise RuntimeError(
                f"Semantic region {region_id!r} has retainAssignedTrailIds that do not "
                "describe an assigned source-path conflict: "
                + ", ".join(sorted(unresolved_retains))
            )

        include_ids = {
            str(value) for value in definition.get("includeTrailIds", [])
        }
        reassign_ids = {
            str(value) for value in definition.get("reassignTrailIds", [])
        }
        missing_trails = (include_ids | reassign_ids) - set(all_trails)
        if missing_trails and not allow_missing:
            raise RuntimeError(
                f"Semantic region {region_id!r} references missing trails: "
                + ", ".join(sorted(missing_trails))
            )
        for trail_id in sorted((include_ids | reassign_ids) & set(all_trails)):
            if trail_id in excluded_ids:
                raise RuntimeError(
                    f"Semantic region {region_id!r} includes quarantined trail "
                    f"{trail_id!r}."
                )
            if trail_id in collection_assignments:
                raise RuntimeError(
                    f"Semantic region {region_id!r} cannot move collection trail "
                    f"{trail_id!r}."
                )
            initial_area_id = initial_area_assignments.get(trail_id)
            if (
                trail_id not in reassign_ids
                and initial_area_id is not None
                and initial_area_id not in source_ids
            ):
                raise RuntimeError(
                    f"Semantic region {region_id!r} must list assigned trail "
                    f"{trail_id!r} under reassignTrailIds."
                )
            claim(
                trail_id,
                region_id,
                (
                    "reviewed-trail-reassignment"
                    if trail_id in reassign_ids
                    else "reviewed-trail-include"
                ),
            )
        resolved_definitions.append(
            (
                definition,
                source_ids,
                {
                    "matchedSourceTrailCount": len(matched_source_ids),
                    "initialRetainedAssignments": dict(
                        sorted(retained_assignments.items())
                    ),
                    "quarantinedSourceTrailIds": sorted(quarantined_source_matches),
                },
            )
        )

    for trail_id, (region_id, _reason) in claims.items():
        area_assignments[trail_id] = region_id

    records: list[dict[str, object]] = []
    for definition, source_ids, source_path_audit in resolved_definitions:
        region_id = str(definition["id"])
        members = [
            trail
            for trail in trails
            if area_assignments.get(str(trail["trail_id"])) == region_id
        ]
        if not members:
            if allow_missing:
                continue
            raise RuntimeError(f"Semantic region {region_id!r} has no assigned trails.")
        member_ids = sorted(str(trail["trail_id"]) for trail in members)
        membership_sha256 = hashlib.sha256(
            "\n".join(member_ids).encode("utf-8")
        ).hexdigest()
        label_point = (
            [round(float(value), 7) for value in definition["labelPoint"]]
            if definition.get("labelPoint") is not None
            else representative_cluster_point(members)
        )
        assignment_reasons = Counter(
            reason
            for trail_id, (target_id, reason) in claims.items()
            if target_id == region_id
        )
        records.append(
            {
                "id": region_id,
                "name": str(definition["name"]),
                "sourceAreaIds": sorted(source_ids),
                "claimSourcePathPrefixes": [
                    str(value)
                    for value in definition.get("claimSourcePathPrefixes", [])
                ],
                "includeTrailIds": sorted(
                    str(value) for value in definition.get("includeTrailIds", [])
                ),
                "reassignTrailIds": sorted(
                    str(value) for value in definition.get("reassignTrailIds", [])
                ),
                "retainAssignedTrailIds": sorted(
                    str(value)
                    for value in definition.get("retainAssignedTrailIds", [])
                ),
                "sourcePathAudit": source_path_audit,
                "membershipSha256": membership_sha256,
                "members": members,
                "labelPoint": label_point,
                "assignmentBreakdown": dict(sorted(assignment_reasons.items())),
                "nameNeedsReview": bool(
                    definition.get("nameNeedsReview", False)
                ),
            }
        )

    return records, claimed_source_ids

def generated_area_cores(
    compact_trails: Sequence[dict[str, object]],
    cluster_labels: dict[str, int],
    curated_cluster_ids: set[int],
    assignments: dict[str, str],
    collection_assignments: dict[str, str],
    excluded_ids: set[str],
    config: dict[str, object],
    gazetteer: Sequence[dict[str, object]],
) -> tuple[list[dict[str, object]], set[str], list[dict[str, object]]]:
    clusters: dict[int, list[dict[str, object]]] = {}
    for trail in compact_trails:
        trail_id = str(trail["trail_id"])
        cluster_id = cluster_labels[trail_id]
        if cluster_id < 0 or cluster_id in curated_cluster_ids:
            continue
        clusters.setdefault(cluster_id, []).append(trail)

    generated_overrides = config.get("generatedAreaOverrides", {})
    generated: list[dict[str, object]] = []
    reserved_clusters: list[dict[str, object]] = []
    reserved_definition_ids = {
        str(area["id"]) for area in config["areas"]
    } | {
        str(collection["id"]) for collection in config.get("collections", [])
    } | {
        str(member["id"])
        for collection in config.get("collections", [])
        for member in collection["members"]
    }
    seen_ids: dict[str, str] = {}
    used_override_ids: set[str] = set()
    minimum_samples = int(config["algorithm"]["clusterMinSamples"])
    for cluster_id, core_trails in sorted(clusters.items()):
        core_trails.sort(key=lambda trail: str(trail["trail_id"]))
        reserved_reasons = sorted(
            {
                reason
                for trail in core_trails
                for trail_id in [str(trail["trail_id"])]
                for reason, matches in (
                    ("curated-area-member", trail_id in assignments),
                    ("curated-collection-member", trail_id in collection_assignments),
                    ("quarantined-trail", trail_id in excluded_ids),
                )
                if matches
            }
        )
        if len(core_trails) < minimum_samples:
            reserved_reasons.append("below-configured-cluster-minimum")
        if reserved_reasons:
            reserved_clusters.append(
                {
                    "dbscanClusterId": cluster_id,
                    "trailCount": len(core_trails),
                    "reasons": reserved_reasons,
                }
            )
            continue
        generated_id, membership_sha256 = generated_area_identity(core_trails)
        if generated_id in reserved_definition_ids:
            raise RuntimeError(
                f"Generated riding-area id conflicts with curated definition: {generated_id}"
            )
        previous_membership = seen_ids.setdefault(generated_id, membership_sha256)
        if previous_membership != membership_sha256:
            raise RuntimeError(f"Generated riding-area id collision: {generated_id}")

        override = normalized_generated_override(generated_overrides.get(generated_id))
        if override is not None:
            used_override_ids.add(generated_id)
        default_label_point = representative_cluster_point(core_trails)
        label_point = (
            [round(float(value), 7) for value in override["labelPoint"]]
            if override is not None and "labelPoint" in override
            else default_label_point
        )
        source_candidates = source_hint_candidates(core_trails)
        strong_source_hint = next(
            (
                candidate
                for candidate in source_candidates
                if int(candidate["support"]) >= 3
                and float(candidate["coverage"]) >= 0.6
            ),
            None,
        )
        nearest_place = nearest_populated_place(label_point, gazetteer)
        source_hint_confirmed = source_hint_matches_place(
            strong_source_hint, nearest_place
        )
        if override is not None and "name" in override:
            base_name = str(override["name"])
            naming_source = "manual-override"
        elif strong_source_hint is not None and source_hint_confirmed:
            base_name = str(strong_source_hint["name"])
            naming_source = "source-hint"
        elif nearest_place is not None:
            base_name = populated_place_area_name(nearest_place, label_point)
            naming_source = "nearest-populated-place"
        else:
            base_name = "Unmapped Riding Area"
            naming_source = "unnamed-review-required"

        core_bounds = [math.inf, math.inf, -math.inf, -math.inf]
        for trail in core_trails:
            extend_bounds(core_bounds, trail["bbox"])
        generated.append(
            {
                "id": generated_id,
                "clusterId": cluster_id,
                "membershipSha256": membership_sha256,
                "baseName": base_name,
                "name": base_name,
                "namingSource": naming_source,
                "labelPoint": label_point,
                "coreBounds": rounded_bounds(core_bounds),
                "coreTrails": core_trails,
                "sourceCandidates": source_candidates,
                "nearestPlace": nearest_place,
                "sourceHintGeographicallyConfirmed": source_hint_confirmed,
                "manualOverride": override is not None and "name" in override,
                "includeTrailIds": (
                    override.get("includeTrailIds", []) if override is not None else []
                ),
                "disabled": bool(override and override.get("disabled", False)),
            }
        )

    reserved_names = {
        str(area["name"]).casefold() for area in config["areas"]
    } | {
        str(member["name"]).casefold()
        for collection in config.get("collections", [])
        for member in collection["members"]
    } | {
        str(collection["name"]).casefold()
        for collection in config.get("collections", [])
    }
    for draft in sorted(
        generated,
        key=lambda item: (not bool(item["manualOverride"]), str(item["id"])),
    ):
        candidate = str(draft["baseName"])
        candidate_key = candidate.casefold()
        if draft["manualOverride"] and not draft["disabled"] and candidate_key in reserved_names:
            raise RuntimeError(
                f"Generated-area override {draft['id']!r} repeats display name {candidate!r}."
            )
        if not draft["manualOverride"] and candidate_key in reserved_names:
            nearest_place = draft["nearestPlace"]
            if nearest_place is not None:
                place_hint = populated_place_area_name(
                    nearest_place, draft["labelPoint"]
                )
                if place_hint.casefold() not in candidate_key:
                    candidate = f"{candidate} — {place_hint}"
            base_candidate = candidate
            suffix = 2
            while candidate.casefold() in reserved_names:
                candidate = f"{base_candidate} {suffix}"
                suffix += 1
        draft["name"] = candidate
        if not draft["disabled"]:
            reserved_names.add(candidate.casefold())

    return generated, set(generated_overrides) - used_override_ids, reserved_clusters


def cluster_compact_trails(
    trails: Sequence[dict[str, object]], epsilon_meters: float, minimum_samples: int
) -> dict[str, int]:
    """DBSCAN compact trail centers without respecting transport-chunk boundaries."""
    if not trails:
        return {}
    cell_degrees = math.degrees(epsilon_meters / EARTH_RADIUS_METERS)
    grid: dict[tuple[int, int], list[int]] = {}
    for index, trail in enumerate(trails):
        longitude, latitude = trail["center"]
        cell = (math.floor(longitude / cell_degrees), math.floor(latitude / cell_degrees))
        grid.setdefault(cell, []).append(index)

    def neighbors(index: int) -> list[int]:
        longitude, latitude = trails[index]["center"]
        center_x = math.floor(longitude / cell_degrees)
        center_y = math.floor(latitude / cell_degrees)
        latitude_radius = math.degrees(epsilon_meters / EARTH_RADIUS_METERS)
        longitude_radius = latitude_radius / max(0.01, math.cos(math.radians(latitude)))
        cell_radius_x = math.ceil(longitude_radius / cell_degrees)
        cell_radius_y = math.ceil(latitude_radius / cell_degrees)
        matches: list[int] = []
        for cell_y in range(center_y - cell_radius_y, center_y + cell_radius_y + 1):
            for cell_x in range(center_x - cell_radius_x, center_x + cell_radius_x + 1):
                for candidate in grid.get((cell_x, cell_y), []):
                    if distance_meters(trails[index]["center"], trails[candidate]["center"]) <= epsilon_meters:
                        matches.append(candidate)
        return sorted(matches)

    unvisited = -2
    noise = -1
    labels = [unvisited] * len(trails)
    cluster_id = 0
    for index in range(len(trails)):
        if labels[index] != unvisited:
            continue
        nearby = neighbors(index)
        if len(nearby) < minimum_samples:
            labels[index] = noise
            continue
        labels[index] = cluster_id
        pending = deque(nearby)
        queued = set(nearby)
        while pending:
            candidate = pending.popleft()
            if labels[candidate] == noise:
                labels[candidate] = cluster_id
            if labels[candidate] != unvisited:
                continue
            labels[candidate] = cluster_id
            candidate_neighbors = neighbors(candidate)
            if len(candidate_neighbors) >= minimum_samples:
                for neighbor in candidate_neighbors:
                    if neighbor not in queued:
                        queued.add(neighbor)
                        pending.append(neighbor)
        cluster_id += 1
    return {trail["trail_id"]: labels[index] for index, trail in enumerate(trails)}


def resolve_curated_clusters(
    compact_trails: Sequence[dict[str, object]],
    cluster_labels: dict[str, int],
    config: dict[str, object],
    allow_missing: bool,
) -> dict[int, dict[str, object]]:
    clusters: dict[int, list[dict[str, object]]] = {}
    for trail in compact_trails:
        cluster_id = cluster_labels[trail["trail_id"]]
        if cluster_id >= 0:
            clusters.setdefault(cluster_id, []).append(trail)

    claimed: dict[int, dict[str, object]] = {}
    seed_limit = float(config["algorithm"]["seedMaxDistanceMeters"])
    targets = [
        {**area, "_kind": "area"} for area in config["areas"]
    ] + [
        {**collection, "_kind": "collection"}
        for collection in config.get("collections", [])
    ]
    for target in targets:
        for selector_index, selector in enumerate(cluster_selectors(target)):
            seed_distances = sorted(
                (
                    min(distance_meters(selector["seed"], trail["center"]) for trail in members),
                    cluster_id,
                )
                for cluster_id, members in clusters.items()
            )
            selected_cluster = (
                seed_distances[0][1]
                if seed_distances and seed_distances[0][0] <= seed_limit
                else None
            )
            if selected_cluster is None:
                if allow_missing:
                    print(
                        f"  Skipping absent cluster selector {selector_index + 1} for "
                        f"{target['id']} in limited build"
                    )
                    continue
                raise RuntimeError(
                    f"Unable to identify cluster selector {selector_index + 1} for "
                    f"{target['id']!r}."
                )

            aliases = [normalize_source_paths(alias) for alias in selector["sourceAliases"]]
            alias_matches = sum(
                1
                for trail in clusters[selected_cluster]
                if any(alias in normalize_source_paths(trail["source_paths"]) for alias in aliases)
            )
            if alias_matches == 0:
                raise RuntimeError(
                    f"Seed and source aliases disagree for cluster selector "
                    f"{selector_index + 1} of {target['id']!r}."
                )
            if selected_cluster in claimed:
                raise RuntimeError(
                    f"Riding-area targets {claimed[selected_cluster]['id']!r} and "
                    f"{target['id']!r} resolve to the same geometry cluster."
                )
            claimed[selected_cluster] = {
                **target,
                "_memberId": selector.get("memberId"),
            }
    return claimed


def build_semantic_areas(
    trails: Sequence[dict[str, object]],
    config: dict[str, object],
    allow_missing: bool,
    gazetteer: Sequence[dict[str, object]] = (),
) -> tuple[
    dict[str, str],
    dict[str, str],
    list[list[object]],
    list[list[object]],
    dict[str, int],
    dict[str, object],
]:
    algorithm = config["algorithm"]
    compact_limit = float(algorithm["compactBboxDiagonalMeters"])
    compact_trails = [trail for trail in trails if trail["bbox_diagonal_m"] <= compact_limit]
    cluster_labels = cluster_compact_trails(
        compact_trails,
        float(algorithm["clusterEpsilonMeters"]),
        int(algorithm["clusterMinSamples"]),
    )
    curated_clusters = resolve_curated_clusters(
        compact_trails, cluster_labels, config, allow_missing
    )
    excluded_ids = set(config.get("excludeTrailIds", []))
    available_ids = {trail["trail_id"] for trail in trails}
    if not allow_missing:
        missing_exclusions = sorted(excluded_ids - available_ids)
        if missing_exclusions:
            raise RuntimeError(
                "Riding-area exclusions are missing from the source catalog: "
                + ", ".join(missing_exclusions)
            )

    area_assignments: dict[str, str] = {}
    collection_assignments: dict[str, str] = {}
    core_by_target: dict[tuple[str, str], list[dict[str, object]]] = {}
    forced_member_by_trail: dict[str, str] = {}
    for trail in compact_trails:
        cluster_id = cluster_labels[trail["trail_id"]]
        target = curated_clusters.get(cluster_id)
        if target is None or trail["trail_id"] in excluded_ids:
            continue
        target_key = (target["_kind"], target["id"])
        core_by_target.setdefault(target_key, []).append(trail)
        if target["_kind"] == "area":
            area_assignments[trail["trail_id"]] = target["id"]
        else:
            collection_assignments[trail["trail_id"]] = target["id"]
            if target.get("_memberId"):
                forced_member_by_trail[trail["trail_id"]] = target["_memberId"]

    for collection in config.get("collections", []):
        parent_only_ids = set(collection.get("parentOnlyTrailIds", []))
        if not parent_only_ids:
            continue
        if parent_only_ids & excluded_ids:
            raise RuntimeError(
                f"Riding-area collection {collection['id']!r} explicitly includes a "
                "quarantined trail."
            )
        missing_parent_only_ids = parent_only_ids - available_ids
        if missing_parent_only_ids and not allow_missing:
            raise RuntimeError(
                f"Riding-area collection {collection['id']!r} is missing parent-only trails: "
                + ", ".join(sorted(missing_parent_only_ids))
            )
        for trail_id in sorted(parent_only_ids & available_ids):
            existing_area = area_assignments.get(trail_id)
            existing_collection = collection_assignments.get(trail_id)
            if existing_area is not None or existing_collection not in (
                None,
                collection["id"],
            ):
                raise RuntimeError(
                    f"Parent-only trail {trail_id!r} conflicts with another "
                    "riding-area target."
                )
            collection_assignments[trail_id] = collection["id"]

    assignment_radius = float(algorithm["assignmentRadiusMeters"])
    assignment_cell_degrees = math.degrees(assignment_radius / EARTH_RADIUS_METERS)
    core_grid: dict[
        tuple[int, int], list[tuple[dict[str, object], tuple[str, str]]]
    ] = {}
    for target_key, target_trails in core_by_target.items():
        for trail in target_trails:
            longitude, latitude = trail["center"]
            cell = (
                math.floor(longitude / assignment_cell_degrees),
                math.floor(latitude / assignment_cell_degrees),
            )
            core_grid.setdefault(cell, []).append((trail, target_key))

    def nearest_target(point: Sequence[float]) -> tuple[str, str] | None:
        longitude, latitude = point
        center_x = math.floor(longitude / assignment_cell_degrees)
        center_y = math.floor(latitude / assignment_cell_degrees)
        latitude_radius = math.degrees(assignment_radius / EARTH_RADIUS_METERS)
        longitude_radius = latitude_radius / max(0.01, math.cos(math.radians(latitude)))
        cell_radius_x = math.ceil(longitude_radius / assignment_cell_degrees)
        cell_radius_y = math.ceil(latitude_radius / assignment_cell_degrees)
        nearest: tuple[float, str, str] | None = None
        for cell_y in range(center_y - cell_radius_y, center_y + cell_radius_y + 1):
            for cell_x in range(center_x - cell_radius_x, center_x + cell_radius_x + 1):
                for core_trail, target_key in core_grid.get((cell_x, cell_y), []):
                    separation = distance_meters(point, core_trail["center"])
                    candidate = (separation, target_key[0], target_key[1])
                    if separation <= assignment_radius and (nearest is None or candidate < nearest):
                        nearest = candidate
        return (nearest[1], nearest[2]) if nearest is not None else None

    max_assigned_diagonal = float(algorithm["maxAssignedBboxDiagonalMeters"])
    required_dominance = float(algorithm["assignmentDominance"])
    for trail in trails:
        trail_id = trail["trail_id"]
        if (
            trail_id in area_assignments
            or trail_id in collection_assignments
            or trail_id in excluded_ids
        ):
            continue
        cluster_id = cluster_labels.get(trail_id, -1)
        if cluster_id >= 0:
            # A complete uncurated cluster is another area, not noise belonging to a nearby one.
            continue
        if trail["bbox_diagonal_m"] > max_assigned_diagonal:
            continue
        votes: Counter[tuple[str, str]] = Counter()
        total_vertices = 0
        for segment in trail["preview_segments"]:
            for point in segment:
                total_vertices += 1
                target_key = nearest_target(point)
                if target_key is not None:
                    votes[target_key] += 1
        if not votes or total_vertices == 0:
            continue
        target_key, vote_count = sorted(
            votes.items(), key=lambda item: (-item[1], item[0])
        )[0]
        if vote_count / total_vertices >= required_dominance:
            if target_key[0] == "area":
                area_assignments[trail_id] = target_key[1]
            else:
                collection_assignments[trail_id] = target_key[1]

    member_trails: dict[str, list[dict[str, object]]] = {}
    for collection in config.get("collections", []):
        collection_id = collection["id"]
        partition_members = [
            member for member in collection["members"] if member.get("partition", True)
        ]
        dominance = float(
            collection.get("partitionDominance", algorithm["assignmentDominance"])
        )
        for trail in core_by_target.get(("collection", collection_id), []):
            trail_id = trail["trail_id"]
            forced_member_id = forced_member_by_trail.get(trail_id)
            if forced_member_id:
                area_assignments[trail_id] = forced_member_id
                member_trails.setdefault(forced_member_id, []).append(trail)
                continue

            display_name = str(trail["catalog_entry"][1]).casefold()
            alias_matches = [
                member
                for member in partition_members
                if any(
                    alias.casefold() in display_name
                    for alias in member.get("nameAliases", [])
                )
            ]
            if len(alias_matches) > 1:
                raise RuntimeError(
                    f"Trail {trail_id!r} matches multiple member-name overrides in "
                    f"collection {collection_id!r}."
                )
            if alias_matches:
                member_id = alias_matches[0]["id"]
                area_assignments[trail_id] = member_id
                member_trails.setdefault(member_id, []).append(trail)
                continue

            votes: Counter[str] = Counter()
            total_vertices = 0
            for segment in trail["preview_segments"]:
                for point in segment:
                    total_vertices += 1
                    member = min(
                        partition_members,
                        key=lambda candidate: (
                            distance_meters(point, candidate["seed"]),
                            candidate["id"],
                        ),
                    )
                    votes[member["id"]] += 1
            if not votes or total_vertices == 0:
                continue
            member_id, vote_count = sorted(
                votes.items(), key=lambda item: (-item[1], item[0])
            )[0]
            if vote_count / total_vertices >= dominance:
                area_assignments[trail_id] = member_id
                member_trails.setdefault(member_id, []).append(trail)

    generated, unused_generated_overrides, reserved_generated_clusters = generated_area_cores(
        compact_trails,
        cluster_labels,
        set(curated_clusters),
        area_assignments,
        collection_assignments,
        excluded_ids,
        config,
        gazetteer,
    )
    generated_attachment_reasons: dict[str, str] = {}
    for draft in generated:
        if draft["disabled"]:
            continue
        for trail in draft["coreTrails"]:
            trail_id = str(trail["trail_id"])
            if trail_id in area_assignments or trail_id in collection_assignments:
                raise RuntimeError(
                    f"Generated riding area {draft['id']!r} overlaps a curated assignment."
                )
            area_assignments[trail_id] = str(draft["id"])
            generated_attachment_reasons[trail_id] = "dbscan-core"

    def assign_generated_includes(drafts: Sequence[dict[str, object]]) -> None:
        for draft in drafts:
            if draft["disabled"]:
                continue
            area_id = str(draft["id"])
            include_ids = set(draft["includeTrailIds"])
            missing_ids = include_ids - available_ids
            if missing_ids and not allow_missing:
                raise RuntimeError(
                    f"Generated riding area {area_id!r} is missing included trails: "
                    + ", ".join(sorted(missing_ids))
                )
            if include_ids & excluded_ids:
                raise RuntimeError(
                    f"Generated riding area {area_id!r} explicitly includes a quarantined trail."
                )
            for trail_id in sorted(include_ids & available_ids):
                existing_area_id = area_assignments.get(trail_id)
                existing_collection_id = collection_assignments.get(trail_id)
                if (
                    existing_area_id not in (None, area_id)
                    or existing_collection_id is not None
                ):
                    raise RuntimeError(
                        f"Generated riding area {area_id!r} included trail {trail_id!r} "
                        "that belongs to another curated target."
                    )
                if existing_area_id is None:
                    area_assignments[trail_id] = area_id
                    generated_attachment_reasons[trail_id] = "manual-include"

    assign_generated_includes(generated)

    generated_grid, generated_cell_degrees = generated_core_grid(
        generated, assignment_radius
    )

    def nearest_generated(point: Sequence[float]) -> str | None:
        return nearest_generated_area(
            point,
            generated_grid,
            generated_cell_degrees,
            assignment_radius,
        )

    generated_max_open_diagonal = min(
        float(algorithm["maxAssignedBboxDiagonalMeters"]),
        GENERATED_ASSIGNMENT_MAX_OPEN_DIAGONAL_METERS,
    )

    def resolve_generated_residual(
        trail: dict[str, object],
    ) -> tuple[str, str] | None:
        primary = generated_assignment_target(
            trail,
            nearest_generated,
            required_dominance,
            generated_max_open_diagonal,
            GENERATED_ASSIGNMENT_MAX_COMPETING_SHARE,
        )
        if primary is not None:
            return primary, "nearby-primary"
        strict = generated_assignment_target(
            trail,
            nearest_generated,
            GENERATED_ASSIGNMENT_STRICT_DOMINANCE,
            GENERATED_ASSIGNMENT_STRICT_MAX_OPEN_DIAGONAL_METERS,
            1e-12,
        )
        return (strict, "nearby-strict") if strict is not None else None

    reserved_cluster_ids = {
        int(row["dbscanClusterId"])
        for row in reserved_generated_clusters
        if row["reasons"] == ["below-configured-cluster-minimum"]
    }
    residual_clusters: dict[int, list[dict[str, object]]] = {}
    for trail in compact_trails:
        trail_id = str(trail["trail_id"])
        cluster_id = cluster_labels[trail_id]
        if (
            cluster_id not in reserved_cluster_ids
            or trail_id in area_assignments
            or trail_id in collection_assignments
            or trail_id in excluded_ids
        ):
            continue
        residual_clusters.setdefault(cluster_id, []).append(trail)

    for cluster_id, cluster_trails in sorted(residual_clusters.items()):
        resolutions = [resolve_generated_residual(trail) for trail in cluster_trails]
        resolved_area_ids = {
            resolution[0] for resolution in resolutions if resolution is not None
        }
        if None in resolutions or len(resolved_area_ids) != 1:
            continue
        area_id = next(iter(resolved_area_ids))
        for trail in cluster_trails:
            trail_id = str(trail["trail_id"])
            area_assignments[trail_id] = area_id
            generated_attachment_reasons[trail_id] = "nearby-residual-cluster"

    for trail in trails:
        trail_id = str(trail["trail_id"])
        if (
            trail_id in area_assignments
            or trail_id in collection_assignments
            or trail_id in excluded_ids
            or cluster_labels.get(trail_id, -1) >= 0
        ):
            continue
        resolution = resolve_generated_residual(trail)
        if resolution is None:
            continue
        area_id, reason = resolution
        area_assignments[trail_id] = area_id
        generated_attachment_reasons[trail_id] = reason

    for draft in generated:
        if draft["disabled"]:
            continue
        area_id = str(draft["id"])
        expected_core_ids = {
            str(trail["trail_id"]) for trail in draft["coreTrails"]
        }
        assigned_ids = {
            trail_id
            for trail_id, assigned_area_id in area_assignments.items()
            if assigned_area_id == area_id
        }
        if not expected_core_ids <= assigned_ids:
            raise RuntimeError(
                f"Generated riding area {area_id!r} lost part of its immutable DBSCAN core."
            )

    semantic_regions, semantic_source_ids = apply_semantic_regions(
        trails,
        area_assignments,
        collection_assignments,
        excluded_ids,
        config,
        generated,
        allow_missing,
    )

    overview_areas: list[list[object]] = []
    for area in config["areas"]:
        area_id = area["id"]
        if area_id in semantic_source_ids:
            continue
        core_trails = core_by_target.get(("area", area_id), [])
        if not core_trails:
            if allow_missing:
                continue
            raise RuntimeError(f"Riding area {area_id!r} has no core trails.")
        members = [
            trail for trail in trails if area_assignments.get(trail["trail_id"]) == area_id
        ]
        view_bounds = [math.inf, math.inf, -math.inf, -math.inf]
        for trail in core_trails:
            extend_bounds(view_bounds, trail["bbox"])
        group_ids = sorted({trail["group_id"] for trail in members})
        overview_areas.append(
            [
                area_id,
                area["name"],
                len(members),
                sum(int(trail["point_count"]) for trail in members),
                padded_bounds(view_bounds, float(algorithm["viewPaddingMeters"])),
                [
                    round(float(value), 7)
                    for value in area.get(
                        "labelPoint", cluster_selectors(area)[0]["seed"]
                    )
                ],
                group_ids,
            ]
        )

    for collection in config.get("collections", []):
        for member in collection["members"]:
            area_id = member["id"]
            members = member_trails.get(area_id, [])
            if not members:
                if allow_missing:
                    continue
                raise RuntimeError(f"Collection member {area_id!r} has no assigned trails.")
            member_bounds = [math.inf, math.inf, -math.inf, -math.inf]
            for trail in members:
                extend_bounds(member_bounds, trail["bbox"])
            group_ids = sorted({trail["group_id"] for trail in members})
            overview_areas.append(
                [
                    area_id,
                    member["name"],
                    len(members),
                    sum(int(trail["point_count"]) for trail in members),
                    padded_bounds(member_bounds, float(algorithm["viewPaddingMeters"])),
                    [
                        round(float(value), 7)
                        for value in member.get("labelPoint", member["seed"])
                    ],
                    group_ids,
                ]
            )

    curated_area_count = len(overview_areas)
    semantic_parent_by_source = {
        source_id: str(region["id"])
        for region in semantic_regions
        for source_id in region["sourceAreaIds"]
    }
    generated_review_rows: list[dict[str, object]] = []
    for draft in sorted(generated, key=lambda item: str(item["id"])):
        area_id = str(draft["id"])
        semantic_parent_id = semantic_parent_by_source.get(area_id)
        core_trails = draft["coreTrails"]
        members = [
            trail
            for trail in trails
            if area_assignments.get(str(trail["trail_id"])) == area_id
        ]
        group_source = members if members else core_trails
        group_ids = sorted({str(trail["group_id"]) for trail in group_source})
        member_bounds = [math.inf, math.inf, -math.inf, -math.inf]
        for trail in group_source:
            extend_bounds(member_bounds, trail["bbox"])
        view_bounds = padded_bounds(member_bounds, float(algorithm["viewPaddingMeters"]))
        assigned_trail_ids = sorted(str(trail["trail_id"]) for trail in members)
        assigned_membership_sha256 = hashlib.sha256(
            "\n".join(assigned_trail_ids).encode("utf-8")
        ).hexdigest()
        attachment_counts = Counter(
            generated_attachment_reasons[str(trail["trail_id"])]
            for trail in members
        )
        if not draft["disabled"] and semantic_parent_id is None:
            overview_areas.append(
                [
                    area_id,
                    draft["name"],
                    len(members),
                    sum(int(trail["point_count"]) for trail in members),
                    view_bounds,
                    draft["labelPoint"],
                    group_ids,
                ]
            )
        generated_review_rows.append(
            {
                "id": area_id,
                "name": draft["name"],
                "status": (
                    "disabled"
                    if draft["disabled"]
                    else "merged"
                    if semantic_parent_id is not None
                    else "active"
                ),
                "semanticParentId": semantic_parent_id,
                "namingSource": draft["namingSource"],
                "manualOverride": draft["manualOverride"],
                "includeTrailIds": draft["includeTrailIds"],
                "nameNeedsReview": draft["namingSource"] == "unnamed-review-required"
                or (
                    draft["namingSource"] == "source-hint"
                    and not draft["sourceHintGeographicallyConfirmed"]
                ),
                "sourceHintGeographicallyConfirmed": draft[
                    "sourceHintGeographicallyConfirmed"
                ],
                "dbscanClusterId": draft["clusterId"],
                "membershipSha256": draft["membershipSha256"],
                "assignedMembershipSha256": assigned_membership_sha256,
                "coreTrailCount": len(core_trails),
                "assignedTrailCount": len(members),
                "attachedTrailCount": (
                    0 if semantic_parent_id is not None else len(members) - len(core_trails)
                ),
                "assignmentBreakdown": dict(sorted(attachment_counts.items())),
                "pointCount": sum(int(trail["point_count"]) for trail in members),
                "viewBounds": view_bounds,
                "labelPoint": draft["labelPoint"],
                "groupIds": group_ids,
                "requiresSubdivisionReview": max(len(core_trails), len(members))
                > GENERATED_AREA_GIANT_TRAIL_COUNT,
                "sourceCandidates": draft["sourceCandidates"],
                "nearestPlace": draft["nearestPlace"],
                "coreTrailIds": [str(trail["trail_id"]) for trail in core_trails],
            }
        )

    semantic_review_rows: list[dict[str, object]] = []
    for region in sorted(semantic_regions, key=lambda item: str(item["id"])):
        members = region["members"]
        member_bounds = combined_bounds([trail["bbox"] for trail in members])
        view_bounds = padded_bounds(
            member_bounds, float(algorithm["viewPaddingMeters"])
        )
        group_ids = sorted({str(trail["group_id"]) for trail in members})
        overview_areas.append(
            [
                region["id"],
                region["name"],
                len(members),
                sum(int(trail["point_count"]) for trail in members),
                view_bounds,
                region["labelPoint"],
                group_ids,
            ]
        )
        semantic_review_rows.append(
            {
                "id": region["id"],
                "name": region["name"],
                "status": "active",
                "namingSource": "reviewed-semantic-region",
                "nameNeedsReview": region["nameNeedsReview"],
                "sourceAreaIds": region["sourceAreaIds"],
                "claimSourcePathPrefixes": region["claimSourcePathPrefixes"],
                "includeTrailIds": region["includeTrailIds"],
                "reassignTrailIds": region["reassignTrailIds"],
                "retainAssignedTrailIds": region["retainAssignedTrailIds"],
                "sourcePathAudit": region["sourcePathAudit"],
                "membershipSha256": region["membershipSha256"],
                "assignedTrailCount": len(members),
                "pointCount": sum(int(trail["point_count"]) for trail in members),
                "assignmentBreakdown": region["assignmentBreakdown"],
                "viewBounds": view_bounds,
                "labelPoint": region["labelPoint"],
                "groupIds": group_ids,
                "requiresSubdivisionReview": len(members)
                > GENERATED_AREA_GIANT_TRAIL_COUNT,
            }
        )

    overview_collections: list[list[object]] = []
    available_area_ids = {row[0] for row in overview_areas}
    for collection in config.get("collections", []):
        collection_id = collection["id"]
        core_trails = core_by_target.get(("collection", collection_id), [])
        if not core_trails:
            if allow_missing:
                continue
            raise RuntimeError(f"Riding-area collection {collection_id!r} has no core trails.")
        members = [
            trail
            for trail in trails
            if collection_assignments.get(trail["trail_id"]) == collection_id
        ]
        view_bounds = [math.inf, math.inf, -math.inf, -math.inf]
        for trail in members:
            extend_bounds(view_bounds, trail["bbox"])
        group_ids = sorted({trail["group_id"] for trail in members})
        member_area_ids = [
            member["id"]
            for member in collection["members"]
            if member["id"] in available_area_ids
        ]
        if not member_area_ids:
            if allow_missing:
                continue
            raise RuntimeError(
                f"Riding-area collection {collection_id!r} has no available member areas."
            )
        overview_collections.append(
            [
                collection_id,
                collection["name"],
                len(members),
                sum(int(trail["point_count"]) for trail in members),
                padded_bounds(view_bounds, float(algorithm["viewPaddingMeters"])),
                [
                    round(float(value), 7)
                    for value in collection.get(
                        "labelPoint", cluster_selectors(collection)[0]["seed"]
                    )
                ],
                group_ids,
                member_area_ids,
            ]
        )

    if any(
        trail_id in area_assignments or trail_id in collection_assignments
        for trail_id in excluded_ids
    ):
        raise RuntimeError("A quarantined riding-area trail was assigned unexpectedly.")
    named_assignments = set(area_assignments) | set(collection_assignments)
    stats = {
        "clusters": len({cluster_id for cluster_id in cluster_labels.values() if cluster_id >= 0}),
        "areas": len(overview_areas),
        "curatedAreas": curated_area_count,
        "automaticGeneratedAreas": sum(
            not draft["disabled"] and str(draft["id"]) not in semantic_source_ids
            for draft in generated
        ),
        "semanticRegions": len(semantic_regions),
        "disabledGeneratedAreas": sum(bool(draft["disabled"]) for draft in generated),
        "generatedCoreTrails": sum(
            len(draft["coreTrails"]) for draft in generated if not draft["disabled"]
        ),
        "generatedAttachedTrails": sum(
            reason != "dbscan-core"
            for reason in generated_attachment_reasons.values()
        ),
        "collections": len(overview_collections),
        "areaAssignedTrails": len(area_assignments),
        "collectionAssignedTrails": len(collection_assignments),
        "namedAssignedTrails": len(named_assignments),
        "quarantinedTrails": len(excluded_ids & available_ids),
    }
    generated_review = {
        "version": 1,
        "summary": {
            "dbscanClusters": stats["clusters"],
            "curatedClaimedClusters": len(curated_clusters),
            "activeGeneratedAreas": stats["automaticGeneratedAreas"],
            "disabledGeneratedAreas": stats["disabledGeneratedAreas"],
            "generatedCoreTrails": stats["generatedCoreTrails"],
            "generatedAttachedTrails": stats["generatedAttachedTrails"],
            "semanticRegions": stats["semanticRegions"],
            "subdivisionReviewAreas": sum(
                bool(row["requiresSubdivisionReview"])
                for row in generated_review_rows
                if row["status"] == "active"
            )
            + sum(
                bool(row["requiresSubdivisionReview"])
                for row in semantic_review_rows
            ),
            "reservedUnpromotedClusters": len(reserved_generated_clusters),
        },
        "rules": {
            "stableId": "auto- plus the first 16 hex characters of SHA-256(sorted core trail IDs)",
            "manualCurationWins": True,
            "manualTrailIncludes": (
                "A generated-area override may explicitly include reviewed trail IDs; "
                "missing, conflicting, or quarantined IDs fail the build."
            ),
            "sourceHintMinimumCoverage": 0.6,
            "sourceHintRequiresNearestPlaceTokenMatch": True,
            "subdivisionReviewTrailCount": GENERATED_AREA_GIANT_TRAIL_COUNT,
            "membership": (
                "DBSCAN areas remain immutable microclusters. Reviewed semantic regions "
                "explicitly replace named source areas; source-path selectors claim only "
                "otherwise-unassigned trails, and intentional moves require exact trail IDs."
            ),
            "nearbyAssignmentRadiusMeters": assignment_radius,
            "nearbyAssignmentDominance": required_dominance,
            "nearbyAssignmentMaxCompetingShare": GENERATED_ASSIGNMENT_MAX_COMPETING_SHARE,
            "nearbyAssignmentMaxOpenDiagonalMeters": generated_max_open_diagonal,
            "nearbyAssignmentVoteSampleMeters": GENERATED_ASSIGNMENT_VOTE_SAMPLE_METERS,
            "strictNearbyAssignmentDominance": GENERATED_ASSIGNMENT_STRICT_DOMINANCE,
            "strictNearbyAssignmentMaxOpenDiagonalMeters": (
                GENERATED_ASSIGNMENT_STRICT_MAX_OPEN_DIAGONAL_METERS
            ),
        },
        "unusedGeneratedAreaOverrides": sorted(unused_generated_overrides),
        "reservedUnpromotedClusters": reserved_generated_clusters,
        "generatedAreas": generated_review_rows,
        "semanticRegions": semantic_review_rows,
    }
    return (
        area_assignments,
        collection_assignments,
        overview_areas,
        overview_collections,
        stats,
        generated_review,
    )


def build_exact_curation_areas(
    trails: Sequence[dict[str, object]],
    curation: dict[str, object],
) -> tuple[
    dict[str, str],
    dict[str, str],
    list[list[object]],
    list[list[object]],
    dict[str, object],
    dict[str, object],
]:
    """Compile exact editor membership without invoking semantic auto-grouping."""

    trails_by_id = {str(trail["trail_id"]): trail for trail in trails}
    if len(trails_by_id) != len(trails):
        raise RuntimeError("Exact curation received duplicate product trail IDs.")
    expected_ids = set(curation["productTrailIds"])
    actual_ids = set(trails_by_id)
    if actual_ids != expected_ids:
        missing = sorted(expected_ids - actual_ids)
        unexpected = sorted(actual_ids - expected_ids)
        raise RuntimeError(
            "Exact curation and product geometry disagree: "
            f"{len(missing)} missing and {len(unexpected)} unexpected trail IDs."
        )

    collections = list(curation["collections"])
    collection_by_member_pack = {
        str(member_pack_id): str(collection["id"])
        for collection in collections
        for member_pack_id in collection["memberPackIds"]
    }
    collection_by_remainder_pack = {
        str(collection["remainderPackId"]): str(collection["id"])
        for collection in collections
        if collection["remainderPackId"] is not None
    }
    area_assignments: dict[str, str] = {}
    collection_assignments: dict[str, str] = {}
    overview_areas: list[list[object]] = []
    pack_review_rows: list[dict[str, object]] = []
    pack_members: dict[str, list[dict[str, object]]] = {}

    for pack in curation["productPacks"]:
        pack_id = str(pack["id"])
        members = [trails_by_id[str(trail_id)] for trail_id in pack["trailIds"]]
        if not members:
            raise RuntimeError(f"Exact curation pack {pack_id!r} has no product trails.")
        pack_members[pack_id] = members
        member_bounds = combined_bounds([trail["bbox"] for trail in members])
        view_bounds = padded_bounds(member_bounds, CURATION_VIEW_PADDING_METERS)
        group_ids = sorted({str(trail["group_id"]) for trail in members})
        point_count = sum(int(trail["point_count"]) for trail in members)
        collection_id = collection_by_member_pack.get(pack_id)
        remainder_collection_id = collection_by_remainder_pack.get(pack_id)
        if collection_id is not None and remainder_collection_id is not None:
            raise RuntimeError(
                f"Exact curation pack {pack_id!r} cannot be both a collection member "
                "and remainder."
            )
        for trail in members:
            trail_id = str(trail["trail_id"])
            if remainder_collection_id is None:
                area_assignments[trail_id] = pack_id
            if collection_id is not None:
                collection_assignments[trail_id] = collection_id
            elif remainder_collection_id is not None:
                collection_assignments[trail_id] = remainder_collection_id
        if remainder_collection_id is None:
            overview_areas.append(
                [
                    pack_id,
                    pack["name"],
                    len(members),
                    point_count,
                    view_bounds,
                    pack["labelPoint"],
                    group_ids,
                ]
            )
        membership_ids = sorted(str(trail["trail_id"]) for trail in members)
        pack_review_rows.append(
            {
                "id": pack_id,
                "name": pack["name"],
                "status": (
                    "collection-remainder"
                    if remainder_collection_id is not None
                    else "active"
                ),
                "namingSource": "exact-curation-project",
                "collectionId": collection_id or remainder_collection_id,
                "assignedTrailCount": len(members),
                "pointCount": point_count,
                "membershipSha256": hashlib.sha256(
                    "\n".join(membership_ids).encode("utf-8")
                ).hexdigest(),
                "viewBounds": view_bounds,
                "labelPoint": pack["labelPoint"],
                "groupIds": group_ids,
            }
        )

    named_assignments = set(area_assignments) | set(collection_assignments)
    if named_assignments != expected_ids:
        raise RuntimeError("Exact curation failed to assign every retained trail once.")

    overview_collections: list[list[object]] = []
    collection_review_rows: list[dict[str, object]] = []
    for collection in collections:
        collection_id = str(collection["id"])
        member_pack_ids = [str(value) for value in collection["memberPackIds"]]
        remainder_pack_id = (
            str(collection["remainderPackId"])
            if collection["remainderPackId"] is not None
            else None
        )
        source_pack_ids = member_pack_ids + (
            [remainder_pack_id] if remainder_pack_id is not None else []
        )
        members = [
            trail
            for source_pack_id in source_pack_ids
            for trail in pack_members[source_pack_id]
        ]
        member_bounds = combined_bounds([trail["bbox"] for trail in members])
        view_bounds = padded_bounds(member_bounds, CURATION_VIEW_PADDING_METERS)
        group_ids = sorted({str(trail["group_id"]) for trail in members})
        point_count = sum(int(trail["point_count"]) for trail in members)
        overview_collections.append(
            [
                collection_id,
                collection["name"],
                len(members),
                point_count,
                view_bounds,
                collection["labelPoint"],
                group_ids,
                member_pack_ids,
            ]
        )
        collection_review_rows.append(
            {
                "id": collection_id,
                "name": collection["name"],
                "status": "active",
                "namingSource": "exact-curation-project",
                "memberPackIds": member_pack_ids,
                "remainderPackId": remainder_pack_id,
                "assignedTrailCount": len(members),
                "pointCount": point_count,
                "viewBounds": view_bounds,
                "labelPoint": collection["labelPoint"],
                "groupIds": group_ids,
            }
        )

    member_pack_count = len(collection_by_member_pack)
    remainder_pack_count = len(collection_by_remainder_pack)
    logical_area_count = (
        len(curation["productPacks"])
        - member_pack_count
        - remainder_pack_count
        + len(collections)
    )
    stats: dict[str, object] = {
        "clusters": 0,
        "areas": len(overview_areas),
        "curatedAreas": len(overview_areas),
        "automaticGeneratedAreas": 0,
        "semanticRegions": 0,
        "disabledGeneratedAreas": 0,
        "generatedCoreTrails": 0,
        "generatedAttachedTrails": 0,
        "collections": len(overview_collections),
        "logicalAreas": logical_area_count,
        "areaAssignedTrails": len(area_assignments),
        "collectionAssignedTrails": len(collection_assignments),
        "namedAssignedTrails": len(named_assignments),
        "quarantinedTrails": 0,
        "curationSourceTrails": int(curation["sourceTrailCount"]),
        "curationProductTrails": len(expected_ids),
        "curationProductPacks": len(curation["productPacks"]),
        "curationProductCollections": len(collections),
        "curationCollectionRemainderPacks": remainder_pack_count,
        "curationCollectionRemainderTrails": len(curation["remainderTrailIds"]),
        "curationDiscardPacks": len(curation["discardPacks"]),
        "curationDiscardedTrails": len(curation["discardedTrailIds"]),
    }
    provenance = curation_public_provenance(curation)
    review: dict[str, object] = {
        "version": 1,
        "summary": {
            "assignmentMode": "exact-curation-project",
            "sourceTrails": stats["curationSourceTrails"],
            "productTrails": stats["curationProductTrails"],
            "productPacks": stats["curationProductPacks"],
            "productCollections": stats["curationProductCollections"],
            "collectionRemainderPacks": stats[
                "curationCollectionRemainderPacks"
            ],
            "collectionRemainderTrails": stats[
                "curationCollectionRemainderTrails"
            ],
            "logicalRidingAreas": stats["logicalAreas"],
            "discardPacks": stats["curationDiscardPacks"],
            "discardedTrails": stats["curationDiscardedTrails"],
            "unassignedTrails": 0,
        },
        "rules": {
            "assignment": (
                "Every retained trail belongs to exactly one physical pack from the "
                "validated curation project; automatic semantic grouping is disabled."
            ),
            "collections": (
                "Optional logical collections reference exact member packs. An explicit "
                "<collection-id>-other remainder pack remains collection-owned geometry "
                "with no area assignment."
            ),
            "discardPackNamePattern": r"^DELETE\d*$",
        },
        "curation": provenance,
        "stats": stats,
        "packs": pack_review_rows,
        "collections": collection_review_rows,
        "generatedAreas": [],
        "semanticRegions": [],
    }
    return (
        area_assignments,
        collection_assignments,
        overview_areas,
        overview_collections,
        stats,
        review,
    )


def atomic_write_json(path: Path, payload: object) -> None:
    temporary = path.with_suffix(path.suffix + f".{os.getpid()}.tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
        handle.write("\n")
    os.replace(temporary, path)


def atomic_write_text(path: Path, text: str) -> None:
    temporary = path.with_suffix(path.suffix + f".{os.getpid()}.tmp")
    temporary.write_text(text, encoding="utf-8", newline="\n")
    os.replace(temporary, path)


def atomic_copy(source: Path, destination: Path) -> None:
    temporary = destination.with_suffix(destination.suffix + f".{os.getpid()}.tmp")
    shutil.copyfile(source, temporary)
    os.replace(temporary, destination)


def build(
    database: Path,
    context_path: Path,
    tolerance_m: float,
    limit: int,
    riding_areas_path: Path,
    gazetteer_path: Path | None = None,
    curation_project_path: Path | None = None,
) -> None:
    database = database.resolve()
    context_path = context_path.resolve()
    riding_areas_path = riding_areas_path.resolve()
    catalog_path = database / "catalog" / "trails.csv"
    v2_root = database / "web-map" / "v2"
    if not catalog_path.is_file():
        raise FileNotFoundError(f"Missing trail catalog: {catalog_path}")
    if not context_path.is_file():
        raise FileNotFoundError(f"Missing context GeoJSON: {context_path}")
    if tolerance_m <= 0:
        raise ValueError("--simplify-m must be greater than zero.")
    if curation_project_path is not None and limit > 0:
        raise ValueError(
            "--limit cannot be combined with --curation-project; exact curation must "
            "validate the full source universe."
        )

    builder_sha256 = sha256_file(Path(__file__).resolve())
    source_catalog_sha256 = sha256_file(catalog_path)
    source_rows = read_catalog(catalog_path, 0 if curation_project_path is not None else limit)
    curation = (
        read_curation_project(
            curation_project_path,
            source_rows,
            source_catalog_sha256,
        )
        if curation_project_path is not None
        else None
    )
    if curation is None:
        rows = source_rows
        riding_area_config = read_riding_area_config(riding_areas_path)
        riding_areas_sha256: str | None = sha256_file(riding_areas_path)
        gazetteer_path = resolve_gazetteer_path(database, gazetteer_path)
    else:
        discarded_trail_ids = set(curation["discardedTrailIds"])
        rows = [row for row in source_rows if row["trail_id"] not in discarded_trail_ids]
        riding_area_config = None
        riding_areas_sha256 = None
        gazetteer_path = None
    context_sha256 = sha256_file(context_path)
    gazetteer_sha256 = sha256_file(gazetteer_path) if gazetteer_path is not None else None
    build_key_parts = [
        f"v{V2_SCHEMA_VERSION}",
        QUALITY_SCOPE,
        builder_sha256,
        source_catalog_sha256,
        context_sha256,
        riding_areas_sha256 or "no-riding-areas",
        gazetteer_sha256 or "no-gazetteer",
        f"{tolerance_m:.12g}",
        str(limit),
    ]
    if curation is not None:
        build_key_parts.extend(
            [
                "exact-curation-project",
                str(curation["sha256"]),
                str(curation["discardedTrailIdsSha256"]),
            ]
        )
    build_key_source = "\0".join(build_key_parts)
    build_key = hashlib.sha256(build_key_source.encode("utf-8")).hexdigest()[:16]
    generation_relative = f"web-map/v2/generations/{build_key}"
    generation_output = v2_root / "generations" / build_key
    chunks_output = generation_output / "chunks"
    chunks_output.mkdir(parents=True, exist_ok=True)

    chunks: dict[str, dict[str, object]] = {}
    tile_counts: Counter[str] = Counter()
    preview_vertex_count = 0
    exact_segment_count = 0
    exact_point_count = 0
    bounds = [math.inf, math.inf, -math.inf, -math.inf]
    semantic_trails: list[dict[str, object]] = []

    if curation is None:
        print(
            f"Building {len(rows):,} {QUALITY_SCOPE} trails at "
            f"{tolerance_m:g} m display tolerance…"
        )
    else:
        print(
            f"Building {len(rows):,} retained trails from "
            f"{curation['sourceTrailCount']:,} curated source trails at "
            f"{tolerance_m:g} m display tolerance…"
        )
    for row_index, row in enumerate(rows, start=1):
        relative_gpx = row["canonical_gpx_path"].replace("\\", "/").lstrip("/")
        if not relative_gpx.startswith("gpx/") or ".." in Path(relative_gpx).parts:
            raise RuntimeError(f"Unexpected internal GPX path: {relative_gpx}")
        gpx_path = database / Path(relative_gpx)
        segments = read_segments(gpx_path)
        simplified_segments = [simplify_segment(segment, tolerance_m) for segment in segments]
        encoded_segments = [encode_polyline(segment) for segment in simplified_segments]
        trail_id = row["trail_id"]
        group_id = (row.get("location_tile") or "unknown").strip().lower() or "unknown"
        group = chunks.setdefault(
            group_id,
            {
                "bounds": [math.inf, math.inf, -math.inf, -math.inf],
                "catalog": [],
                "trails": [],
                "preview_vertices": 0,
            },
        )
        group_preview_vertices = sum(len(segment) for segment in simplified_segments)
        preview_vertex_count += group_preview_vertices
        group["preview_vertices"] += group_preview_vertices
        exact_segment_count += len(segments)
        exact_point_count += sum(len(segment) for segment in segments)

        bbox = [
            parse_float(row["min_lon"]),
            parse_float(row["min_lat"]),
            parse_float(row["max_lon"]),
            parse_float(row["max_lat"]),
        ]
        extend_bounds(bounds, bbox)
        extend_bounds(group["bounds"], bbox)
        tile_counts[group_id] += 1
        catalog_entry = [
            trail_id,
            safe_display_name(row),
            bbox,
            round(parse_float(row["length_m"]), 3),
            parse_int(row["point_count"]),
            round(parse_float(row["elevation_coverage"]), 4),
        ]
        group["catalog"].append(catalog_entry)
        group["trails"].append([trail_id, encoded_segments])
        semantic_trails.append(
            {
                "trail_id": trail_id,
                "group_id": group_id,
                "bbox": bbox,
                "center": bbox_center(bbox),
                "bbox_diagonal_m": bbox_diagonal_meters(bbox),
                "point_count": parse_int(row["point_count"]),
                "source_paths": row.get("source_paths") or "",
                "preview_segments": simplified_segments,
                "catalog_entry": catalog_entry,
            }
        )
        if row_index % 1000 == 0 or row_index == len(rows):
            print(f"  {row_index:>6,}/{len(rows):,} trails")

    expected_ids = [row["trail_id"] for row in rows]
    if len(expected_ids) != len(set(expected_ids)):
        raise RuntimeError("The internal-canonical catalog contains duplicate trail IDs.")

    if curation is None:
        gazetteer = read_geonames_gazetteer(gazetteer_path, bounds)
        if gazetteer_path is None:
            print("  generated-area names: source hints only (no local gazetteer found)")
        else:
            print(
                f"  generated-area names: {len(gazetteer):,} local populated places from "
                f"{gazetteer_path.name}"
            )
        (
            area_assignments,
            collection_assignments,
            overview_areas,
            overview_collections,
            area_stats,
            generated_review,
        ) = build_semantic_areas(
            semantic_trails,
            riding_area_config,
            allow_missing=limit > 0,
            gazetteer=gazetteer,
        )
    else:
        gazetteer = []
        (
            area_assignments,
            collection_assignments,
            overview_areas,
            overview_collections,
            area_stats,
            generated_review,
        ) = build_exact_curation_areas(semantic_trails, curation)
    generated_review["gazetteer"] = {
        "enabled": gazetteer_path is not None,
        "fileName": gazetteer_path.name if gazetteer_path is not None else None,
        "sha256": gazetteer_sha256,
        "populatedPlaceCount": len(gazetteer),
    }
    assigned_ids_by_group: dict[str, set[str]] = {}
    for trail in semantic_trails:
        trail_id = trail["trail_id"]
        area_id = area_assignments.get(trail_id)
        collection_id = collection_assignments.get(trail_id)
        trail["catalog_entry"].append(area_id)
        trail["catalog_entry"].append(collection_id)
        if area_id is not None or collection_id is not None:
            assigned_ids_by_group.setdefault(trail["group_id"], set()).add(trail_id)
    if curation is None:
        print(
            "  semantic areas: "
            f"{area_stats['areas']:,} areas + {area_stats['collections']:,} collections / "
            f"{area_stats['automaticGeneratedAreas']:,} generated from "
            f"{area_stats['clusters']:,} DBSCAN clusters; "
            f"{area_stats['namedAssignedTrails']:,} named trails; "
            f"{area_stats['quarantinedTrails']:,} quarantined"
        )
    else:
        print(
            "  exact curation: "
            f"{area_stats['curationProductPacks']:,} physical packs / "
            f"{area_stats['logicalAreas']:,} logical riding areas; "
            f"{area_stats['curationDiscardedTrails']:,} source outliers discarded"
        )

    chunk_catalog_ids: list[str] = []
    chunk_preview_ids: list[str] = []
    chunk_preview_vertex_count = 0
    overview_unassigned_count = 0
    used_filenames: dict[str, str] = {}
    overview_groups = []
    for group_id in sorted(chunks):
        group = chunks[group_id]
        catalog_rows = group["catalog"]
        trail_rows = group["trails"]
        catalog_ids = [row[0] for row in catalog_rows]
        preview_ids = [row[0] for row in trail_rows]
        if catalog_ids != preview_ids:
            raise RuntimeError(f"Catalog and preview ordering differ for group {group_id!r}.")

        filename = safe_chunk_filename(group_id)
        previous_group = used_filenames.setdefault(filename, group_id)
        if previous_group != group_id:
            raise RuntimeError(
                f"Location tiles {previous_group!r} and {group_id!r} map to the same chunk filename."
            )

        group_bounds = rounded_bounds(group["bounds"])
        center = [
            round((group_bounds[0] + group_bounds[2]) / 2, 7),
            round((group_bounds[1] + group_bounds[3]) / 2, 7),
        ]
        unassigned_rows = [
            row for row in catalog_rows if row[-2] is None and row[-1] is None
        ]
        unassigned_count = len(unassigned_rows)
        assigned_ids = {
            row[0] for row in catalog_rows if row[-2] is not None or row[-1] is not None
        }
        if assigned_ids != assigned_ids_by_group.get(group_id, set()):
            raise RuntimeError(f"Area assignments disagree for group {group_id!r}.")
        unassigned_bounds = None
        unassigned_center = None
        if unassigned_rows:
            remainder_bounds = [math.inf, math.inf, -math.inf, -math.inf]
            for row in unassigned_rows:
                extend_bounds(remainder_bounds, row[2])
            unassigned_bounds = rounded_bounds(remainder_bounds)
            unassigned_center = [
                round((unassigned_bounds[0] + unassigned_bounds[2]) / 2, 7),
                round((unassigned_bounds[1] + unassigned_bounds[3]) / 2, 7),
            ]
        overview_unassigned_count += unassigned_count
        chunk_relative = f"{generation_relative}/chunks/{filename}"
        chunk_document = {
            "version": 2,
            "id": group_id,
            "precision": PREVIEW_PRECISION,
            "coordinateOrder": (
                "encoded latitude then longitude; runtime arrays are longitude, latitude"
            ),
            "catalogFields": CHUNK_CATALOG_FIELDS,
            "catalog": catalog_rows,
            "trails": trail_rows,
            "counts": {
                "trails": len(catalog_rows),
                "previewVertices": group["preview_vertices"],
            },
        }
        atomic_write_json(chunks_output / filename, chunk_document)
        overview_groups.append(
            [
                group_id,
                len(catalog_rows),
                group_bounds,
                center,
                chunk_relative,
                unassigned_count,
                unassigned_bounds,
                unassigned_center,
            ]
        )
        chunk_catalog_ids.extend(catalog_ids)
        chunk_preview_ids.extend(preview_ids)
        chunk_preview_vertex_count += group["preview_vertices"]

    if sorted(chunk_catalog_ids) != expected_ids or sorted(chunk_preview_ids) != expected_ids:
        raise RuntimeError("The v2 chunks do not contain the expected deterministic trail ID set.")
    if chunk_preview_vertex_count != preview_vertex_count:
        raise RuntimeError("The v2 chunk preview-vertex total does not match the source build.")
    if len(overview_groups) != len(tile_counts):
        raise RuntimeError("The v2 overview group count does not match the location-tile count.")
    if overview_unassigned_count + area_stats["namedAssignedTrails"] != len(rows):
        raise RuntimeError("The v2 overview assigned and unassigned trail totals do not balance.")

    densest_tile = tile_counts.most_common(1)[0][0]
    initial_center = parse_tile_center(densest_tile) or [
        (bounds[0] + bounds[2]) / 2,
        (bounds[1] + bounds[3]) / 2,
    ]
    overview_document = {
        "version": 2,
        "groupFields": OVERVIEW_GROUP_FIELDS,
        "groups": overview_groups,
        "areaFields": OVERVIEW_AREA_FIELDS,
        "areas": overview_areas,
        "collectionFields": OVERVIEW_COLLECTION_FIELDS,
        "collections": overview_collections,
    }
    manifest_counts = {
        "trails": len(rows),
        "segments": exact_segment_count,
        "exactPoints": exact_point_count,
        "previewVertices": preview_vertex_count,
        "coordinateTiles": len(tile_counts),
        "ridingAreas": len(overview_areas),
        "curatedRidingAreas": area_stats["curatedAreas"],
        "generatedRidingAreas": area_stats["automaticGeneratedAreas"],
        "semanticRidingAreas": area_stats["semanticRegions"],
        "disabledGeneratedRidingAreas": area_stats["disabledGeneratedAreas"],
        "generatedCoreTrails": area_stats["generatedCoreTrails"],
        "generatedAttachedTrails": area_stats["generatedAttachedTrails"],
        "ridingAreaCollections": len(overview_collections),
        "areaAssignedTrails": len(area_assignments),
        "collectionAssignedTrails": len(collection_assignments),
        "namedAssignedTrails": area_stats["namedAssignedTrails"],
    }
    if curation is not None:
        manifest_counts.update(
            {
                "curationSourceTrails": area_stats["curationSourceTrails"],
                "curationProductTrails": area_stats["curationProductTrails"],
                "curationProductPacks": area_stats["curationProductPacks"],
                "curationProductCollections": area_stats[
                    "curationProductCollections"
                ],
                "curationCollectionRemainderPacks": area_stats[
                    "curationCollectionRemainderPacks"
                ],
                "curationCollectionRemainderTrails": area_stats[
                    "curationCollectionRemainderTrails"
                ],
                "curationLogicalRidingAreas": area_stats["logicalAreas"],
                "curationDiscardPacks": area_stats["curationDiscardPacks"],
                "curationDiscardedTrails": area_stats["curationDiscardedTrails"],
            }
        )
    manifest = {
        "version": V2_SCHEMA_VERSION,
        "scope": QUALITY_SCOPE,
        "bounds": rounded_bounds(bounds),
        "initialView": {
            "center": [round(value, 7) for value in initial_center],
            "zoom": 9.5,
        },
        "overviewFile": f"{generation_relative}/overview.json",
        "ridingAreaReviewFile": f"{generation_relative}/riding-area-review.json",
        "contextFile": f"{generation_relative}/context.geojson",
        "counts": manifest_counts,
        "displayToleranceMeters": tolerance_m,
        "builderSha256": builder_sha256,
        "sourceCatalogSha256": source_catalog_sha256,
        "contextSha256": context_sha256,
        "ridingAreasSha256": riding_areas_sha256,
        "gazetteerSha256": gazetteer_sha256,
        "buildKey": build_key,
    }
    if curation is not None:
        manifest["curation"] = curation_public_provenance(curation)
    notice = f"""BOB'S TRAIL PACK BUILDER - LOCAL WEB MAP V2\n\nBuild key: {build_key}\nScope: {QUALITY_SCOPE}\nTrails: {len(rows):,}\nChunks: {len(overview_groups):,}\nRiding areas: {len(overview_areas):,}\nCurated riding areas: {area_stats['curatedAreas']:,}\nAutomatic generated riding areas: {area_stats['automaticGeneratedAreas']:,}\nReviewed semantic riding areas: {area_stats['semanticRegions']:,}\nRiding-area collections: {len(overview_collections):,}\nArea-assigned trails: {len(area_assignments):,}\nCollection-assigned trails: {len(collection_assignments):,}\nNamed trails: {area_stats['namedAssignedTrails']:,}\nQuarantined connector trails: {area_stats['quarantinedTrails']:,}\nExact points: {exact_point_count:,}\nPreview vertices: {preview_vertex_count:,}\nDisplay tolerance: {tolerance_m:g} meters\n\nThis versioned directory contains a derived local map index only. Canonical GPX\nfiles remain in their existing trails-database paths and were not copied or modified.\nThe sibling v1 manifest and prior immutable generations remain untouched.\n"""
    if curation is not None:
        notice += (
            "\nExact curation project: "
            f"{curation['fileName']} ({curation['sha256']})\n"
            f"Source trails before product filtering: {curation['sourceTrailCount']:,}\n"
            f"Discard packs: {len(curation['discardPacks']):,}\n"
            f"Discarded source trails: {len(curation['discardedTrailIds']):,}\n"
            "Assignment mode: exact curated membership; automatic semantic grouping disabled.\n"
        )

    atomic_write_json(generation_output / "overview.json", overview_document)
    atomic_write_json(generation_output / "riding-area-review.json", generated_review)
    atomic_copy(context_path, generation_output / "context.geojson")
    atomic_write_text(generation_output / "README.txt", notice)
    v2_root.mkdir(parents=True, exist_ok=True)
    atomic_write_json(v2_root / "manifest.json", manifest)
    print(f"Wrote {generation_output}")
    print(f"  manifest.json: {(v2_root / 'manifest.json').stat().st_size:,} bytes")
    print(f"  overview.json: {(generation_output / 'overview.json').stat().st_size:,} bytes")
    print(f"  chunks:        {len(overview_groups):,}")
    print(f"  context:       {(generation_output / 'context.geojson').stat().st_size:,} bytes")


def main() -> int:
    arguments = parse_args()
    try:
        build(
            arguments.database,
            arguments.context,
            arguments.simplify_m,
            arguments.limit,
            arguments.riding_areas,
            arguments.gazetteer,
            arguments.curation_project,
        )
    except Exception as error:  # noqa: BLE001 - CLI should report a concise failure.
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
