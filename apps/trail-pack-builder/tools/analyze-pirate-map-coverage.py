#!/usr/bin/env python3
"""Measure a sparse raster-basemap footprint around the local trail catalog.

The analysis intentionally uses catalog trail bounds rather than rendering map
tiles. It produces reproducible tile counts, size bands, a compact coverage map,
and the recommended tile coordinate seed list for later PMTiles work.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Sequence


EARTH_RADIUS_KM = 6371.0088
MAX_MERCATOR_LAT = 85.05112878
DEFAULT_ZOOMS = (8, 9, 10)
DEFAULT_PADDING_KM = (0.0, 2.0, 5.0, 10.0, 15.0, 20.0)
DEFAULT_SIZE_KIB = (25.0, 35.0, 50.0)
RECOMMENDED_PADDING_KM = 5.0
PMTILES_OVERHEAD_FACTOR = 1.03


def parse_number_list(value: str, cast=float) -> tuple:
    return tuple(cast(part.strip()) for part in value.split(",") if part.strip())


def mercator_y(lat: float) -> float:
    bounded = max(-MAX_MERCATOR_LAT, min(MAX_MERCATOR_LAT, lat))
    radians = math.radians(bounded)
    return (1.0 - math.asinh(math.tan(radians)) / math.pi) / 2.0


def tile_x(lon: float, zoom: int, *, upper_edge: bool = False) -> int:
    count = 1 << zoom
    coordinate = math.nextafter(lon, -math.inf) if upper_edge else lon
    return max(0, min(count - 1, math.floor((coordinate + 180.0) / 360.0 * count)))


def tile_y(lat: float, zoom: int, *, lower_edge: bool = False) -> int:
    count = 1 << zoom
    coordinate = math.nextafter(lat, math.inf) if lower_edge else lat
    return max(0, min(count - 1, math.floor(mercator_y(coordinate) * count)))


def expand_bbox(bbox: Sequence[float], padding_km: float) -> tuple[float, float, float, float]:
    west, south, east, north = map(float, bbox)
    if padding_km <= 0:
        return west, south, east, north

    latitude_delta = math.degrees(padding_km / EARTH_RADIUS_KM)
    furthest_latitude = max(abs(south), abs(north))
    longitude_scale = max(0.05, math.cos(math.radians(furthest_latitude)))
    longitude_delta = math.degrees(padding_km / (EARTH_RADIUS_KM * longitude_scale))
    return (
        max(-180.0, west - longitude_delta),
        max(-MAX_MERCATOR_LAT, south - latitude_delta),
        min(180.0, east + longitude_delta),
        min(MAX_MERCATOR_LAT, north + latitude_delta),
    )


def tiles_for_bbox(bbox: Sequence[float], zoom: int) -> Iterable[tuple[int, int]]:
    west, south, east, north = bbox
    first_x = tile_x(west, zoom)
    last_x = tile_x(east, zoom, upper_edge=True)
    first_y = tile_y(north, zoom)
    last_y = tile_y(south, zoom, lower_edge=True)
    for x in range(first_x, last_x + 1):
        for y in range(first_y, last_y + 1):
            yield x, y


def tile_latitude(y: int, zoom: int) -> float:
    count = 1 << zoom
    return math.degrees(math.atan(math.sinh(math.pi * (1.0 - 2.0 * y / count))))


def tile_bounds(x: int, y: int, zoom: int) -> tuple[float, float, float, float]:
    count = 1 << zoom
    west = x / count * 360.0 - 180.0
    east = (x + 1) / count * 360.0 - 180.0
    north = tile_latitude(y, zoom)
    south = tile_latitude(y + 1, zoom)
    return west, south, east, north


def tile_area_km2(y: int, zoom: int) -> float:
    north = math.radians(tile_latitude(y, zoom))
    south = math.radians(tile_latitude(y + 1, zoom))
    longitude_width = 2.0 * math.pi / (1 << zoom)
    return EARTH_RADIUS_KM**2 * longitude_width * (math.sin(north) - math.sin(south))


def component_sizes(tiles: set[tuple[int, int]]) -> list[int]:
    pending = set(tiles)
    sizes: list[int] = []
    while pending:
        start = pending.pop()
        queue = deque([start])
        size = 0
        while queue:
            x, y = queue.popleft()
            size += 1
            for neighbor in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if neighbor in pending:
                    pending.remove(neighbor)
                    queue.append(neighbor)
        sizes.append(size)
    return sorted(sizes, reverse=True)


def compact_number(value: float) -> str:
    if abs(value - round(value)) < 1e-9:
        return str(int(round(value)))
    return f"{value:g}"


def xml_escape(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def load_state_lines(context_path: Path) -> list[list[list[float]]]:
    if not context_path.exists():
        return []
    context = json.loads(context_path.read_text(encoding="utf-8"))
    lines: list[list[list[float]]] = []
    for feature in context.get("features", []):
        if feature.get("properties", {}).get("feature_type") != "state_boundary":
            continue
        geometry = feature.get("geometry", {})
        if geometry.get("type") == "LineString":
            lines.append(geometry.get("coordinates", []))
        elif geometry.get("type") == "MultiLineString":
            lines.extend(geometry.get("coordinates", []))
    return lines


def make_coverage_svg(
    path: Path,
    tile_sets: dict[int, set[tuple[int, int]]],
    core_tile_sets: dict[int, set[tuple[int, int]]],
    state_lines: list[list[list[float]]],
    padding_km: float,
) -> None:
    width = 1260
    height = 470
    panel_width = 400
    panel_height = 360
    panel_top = 62
    gap = 20
    footprint_tiles = next(iter(tile_sets.values()), set())
    footprint_zoom = next(iter(tile_sets), 0)
    footprint_bounds = [tile_bounds(x, y, footprint_zoom) for x, y in footprint_tiles]
    footprint_west = min(bounds[0] for bounds in footprint_bounds)
    footprint_south = min(bounds[1] for bounds in footprint_bounds)
    footprint_east = max(bounds[2] for bounds in footprint_bounds)
    footprint_north = max(bounds[3] for bounds in footprint_bounds)
    world_west = (footprint_west + 180.0) / 360.0
    world_east = (footprint_east + 180.0) / 360.0
    world_north = mercator_y(footprint_north)
    world_south = mercator_y(footprint_south)
    world_width = world_east - world_west
    world_height = world_south - world_north
    world_west -= world_width * 0.015
    world_east += world_width * 0.015
    world_north -= world_height * 0.015
    world_south += world_height * 0.015
    world_width = world_east - world_west
    world_height = world_south - world_north

    def project(lon: float, lat: float, left: float) -> tuple[float, float]:
        world_x = (lon + 180.0) / 360.0
        world_y = mercator_y(lat)
        x = left + (world_x - world_west) / world_width * panel_width
        y = panel_top + (world_y - world_north) / world_height * panel_height
        return x, y

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-labelledby="title desc">',
        '<title id="title">Pirate basemap trail coverage at Web Mercator zooms 8, 9, and 10</title>',
        f'<desc id="desc">Sparse tile footprint for {len(next(iter(tile_sets.values()), [])) if tile_sets else 0} tiles in the first panel, using {padding_km:g} kilometers of trail-bound padding.</desc>',
        '<rect width="1260" height="470" fill="#efe0b8"/>',
        '<text x="20" y="30" font-family="system-ui, sans-serif" font-size="20" font-weight="700" fill="#302416">Pirate basemap detail footprint</text>',
        f'<text x="1240" y="30" text-anchor="end" font-family="system-ui, sans-serif" font-size="13" fill="#65533b">{padding_km:g} km padding · bounds-based coverage</text>',
    ]

    for panel_index, zoom in enumerate(sorted(tile_sets)):
        left = panel_index * (panel_width + gap)
        clip_id = f"panel-{zoom}"
        parts.extend(
            [
                f'<defs><clipPath id="{clip_id}"><rect x="{left}" y="{panel_top}" width="{panel_width}" height="{panel_height}"/></clipPath></defs>',
                f'<rect x="{left}" y="{panel_top}" width="{panel_width}" height="{panel_height}" fill="#dbc795" stroke="#6f5837"/>',
                f'<g clip-path="url(#{clip_id})">',
            ]
        )
        core_tiles = core_tile_sets[zoom]
        for x, y in sorted(tile_sets[zoom], key=lambda tile: (tile[1], tile[0])):
            west, south, east, north = tile_bounds(x, y, zoom)
            x0, y0 = project(west, north, left)
            x1, y1 = project(east, south, left)
            is_core = (x, y) in core_tiles
            fill = "#3f3325" if is_core else "#c47c33"
            stroke = "#2d251c" if is_core else "#80501f"
            opacity = "0.66" if is_core else "0.72"
            parts.append(
                f'<rect x="{x0:.2f}" y="{y0:.2f}" width="{max(0.35, x1 - x0):.2f}" height="{max(0.35, y1 - y0):.2f}" fill="{fill}" fill-opacity="{opacity}" stroke="{stroke}" stroke-width="0.25"/>'
            )
        for line in state_lines:
            if len(line) < 2:
                continue
            coordinates = [project(float(lon), float(lat), left) for lon, lat in line]
            path_data = "M" + " L".join(f"{x:.2f},{y:.2f}" for x, y in coordinates)
            parts.append(
                f'<path d="{path_data}" fill="none" stroke="#3d3020" stroke-opacity="0.72" stroke-width="0.65" vector-effect="non-scaling-stroke"/>'
            )
        parts.extend(
            [
                "</g>",
                f'<text x="{left + 14}" y="{panel_top + 25}" font-family="ui-monospace, monospace" font-size="16" font-weight="700" fill="#2f2417">z{zoom}</text>',
                f'<text x="{left + panel_width - 14}" y="{panel_top + 25}" text-anchor="end" font-family="ui-monospace, monospace" font-size="14" fill="#2f2417">{len(tile_sets[zoom]):,} tiles</text>',
            ]
        )
    parts.extend(
        [
            '<rect x="20" y="444" width="16" height="10" fill="#3f3325" fill-opacity="0.7" stroke="#2d251c"/>',
            '<text x="43" y="453" font-family="system-ui, sans-serif" font-size="12" fill="#3d3020">unpadded trail-bound tiles</text>',
            '<rect x="205" y="444" width="16" height="10" fill="#c47c33" fill-opacity="0.76" stroke="#80501f"/>',
            f'<text x="228" y="453" font-family="system-ui, sans-serif" font-size="12" fill="#3d3020">tiles added by {padding_km:g} km context padding</text>',
            '<text x="1240" y="453" text-anchor="end" font-family="system-ui, sans-serif" font-size="12" fill="#65533b">State context: local Census-derived boundary mesh</text>',
            "</svg>",
        ]
    )
    path.write_text("\n".join(parts), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--context", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--zooms", default=",".join(map(str, DEFAULT_ZOOMS)))
    parser.add_argument("--padding-km", default=",".join(compact_number(v) for v in DEFAULT_PADDING_KM))
    parser.add_argument("--size-kib", default=",".join(compact_number(v) for v in DEFAULT_SIZE_KIB))
    parser.add_argument("--recommended-padding-km", type=float, default=RECOMMENDED_PADDING_KM)
    args = parser.parse_args()

    zooms = parse_number_list(args.zooms, int)
    padding_values = parse_number_list(args.padding_km, float)
    size_values = parse_number_list(args.size_kib, float)
    if args.recommended_padding_km not in padding_values:
        raise SystemExit("Recommended padding must be present in --padding-km")

    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    fields = {name: index for index, name in enumerate(manifest["catalogFields"])}
    bboxes = [row[fields["bbox"]] for row in manifest["catalog"]]
    args.output.mkdir(parents=True, exist_ok=True)

    tile_sets: dict[tuple[float, int], set[tuple[int, int]]] = {}
    rows: list[dict] = []
    for padding_km in padding_values:
        for zoom in zooms:
            tiles: set[tuple[int, int]] = set()
            for bbox in bboxes:
                tiles.update(tiles_for_bbox(expand_bbox(bbox, padding_km), zoom))
            tile_sets[(padding_km, zoom)] = tiles
            components = component_sizes(tiles)
            area_km2 = sum(tile_area_km2(y, zoom) for _, y in tiles)
            row = {
                "padding_km": padding_km,
                "zoom": zoom,
                "tile_count": len(tiles),
                "coverage_area_km2": round(area_km2, 1),
                "connected_components": len(components),
                "largest_component_tiles": components[0] if components else 0,
                "isolated_tiles": sum(size == 1 for size in components),
            }
            for size_kib in size_values:
                label = f"estimate_{compact_number(size_kib).replace('.', '_')}kib_mib"
                row[label] = round(len(tiles) * size_kib * PMTILES_OVERHEAD_FACTOR / 1024.0, 2)
            rows.append(row)

    zero_counts = {row["zoom"]: row["tile_count"] for row in rows if row["padding_km"] == 0}
    for row in rows:
        baseline = zero_counts[row["zoom"]]
        row["growth_vs_zero_pct"] = round((row["tile_count"] / baseline - 1.0) * 100.0, 1)

    recommended_sets = {
        zoom: tile_sets[(args.recommended_padding_km, zoom)] for zoom in zooms
    }
    core_sets = {zoom: tile_sets[(0.0, zoom)] for zoom in zooms}
    detail_tile_count = sum(len(tiles) for tiles in recommended_sets.values())

    full_pyramid_sets: dict[int, set[tuple[int, int]]] = {}
    for zoom in range(0, max(zooms) + 1):
        tiles: set[tuple[int, int]] = set()
        for bbox in bboxes:
            tiles.update(tiles_for_bbox(expand_bbox(bbox, args.recommended_padding_km), zoom))
        full_pyramid_sets[zoom] = tiles
    full_pyramid_count = sum(len(tiles) for tiles in full_pyramid_sets.values())

    coarse_extent_sets = {
        zoom: set(tiles_for_bbox(manifest["bounds"], zoom)) for zoom in range(0, min(zooms))
    }
    coarse_extent_tile_count = sum(len(tiles) for tiles in coarse_extent_sets.values())
    two_tier_tile_count = coarse_extent_tile_count + detail_tile_count

    summary = {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_manifest": str(args.manifest.resolve()),
        "source_catalog_sha256": manifest.get("sourceCatalogSha256"),
        "scope": manifest.get("scope"),
        "trail_count": len(bboxes),
        "dataset_bounds": manifest.get("bounds"),
        "method": "Union of Web Mercator tiles intersecting each trail catalog bbox after a latitude-adjusted geodesic padding approximation.",
        "zooms": list(zooms),
        "padding_values_km": list(padding_values),
        "recommended_padding_km": args.recommended_padding_km,
        "recommended_detail_tiles_z8_z10": detail_tile_count,
        "recommended_sparse_pyramid_tiles_z0_z10": full_pyramid_count,
        "size_scenarios_kib_per_tile": list(size_values),
        "pmtiles_overhead_factor": PMTILES_OVERHEAD_FACTOR,
        "results": rows,
        "recommended_tiles": {
            str(zoom): [list(tile) for tile in sorted(tiles, key=lambda item: (item[1], item[0]))]
            for zoom, tiles in recommended_sets.items()
        },
        "sparse_pyramid_counts": {
            str(zoom): len(tiles) for zoom, tiles in full_pyramid_sets.items()
        },
        "full_extent_coarse_counts": {
            str(zoom): len(tiles) for zoom, tiles in coarse_extent_sets.items()
        },
        "full_extent_coarse_tiles_z0_z7": coarse_extent_tile_count,
        "recommended_two_tier_tiles": two_tier_tile_count,
    }
    (args.output / "coverage-report.json").write_text(
        json.dumps(summary, indent=2) + "\n", encoding="utf-8"
    )

    with (args.output / "coverage-counts.csv").open("w", encoding="utf-8", newline="") as output_file:
        writer = csv.DictWriter(output_file, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)

    state_lines = load_state_lines(args.context) if args.context else []
    make_coverage_svg(
        args.output / "coverage-map.svg",
        recommended_sets,
        core_sets,
        state_lines,
        args.recommended_padding_km,
    )

    recommended_rows = [row for row in rows if row["padding_km"] == args.recommended_padding_km]
    middle_size = size_values[len(size_values) // 2]
    detail_middle_mib = detail_tile_count * middle_size * PMTILES_OVERHEAD_FACTOR / 1024.0
    pyramid_middle_mib = full_pyramid_count * middle_size * PMTILES_OVERHEAD_FACTOR / 1024.0
    two_tier_middle_mib = two_tier_tile_count * middle_size * PMTILES_OVERHEAD_FACTOR / 1024.0
    report_lines = [
        "# Pirate basemap coverage report",
        "",
        f"Analyzed **{len(bboxes):,}** `{manifest.get('scope', 'unknown')}` trail bounds from the current local manifest.",
        "No map tiles were rendered or downloaded.",
        "",
        "## Recommendation",
        "",
        f"Start with **{args.recommended_padding_km:g} km of padding** around each trail bound.",
        "It is the cost-conscious first bake: whole z10 tiles already provide substantial implicit context, while the explicit buffer protects trails that sit near tile edges.",
        "Keep 10 km as the visual-QA fallback if labels or landform context feel clipped.",
        "Retain whole intersecting tiles; do not crop imagery inside a tile.",
        "",
        "## Detail footprint",
        "",
        "| Zoom | Tiles | Growth vs 0 km | Covered tile area | Components |",
        "|---:|---:|---:|---:|---:|",
    ]
    for row in recommended_rows:
        report_lines.append(
            f"| z{row['zoom']} | {row['tile_count']:,} | {row['growth_vs_zero_pct']:.1f}% | {row['coverage_area_km2']:,.0f} km² | {row['connected_components']:,} |"
        )
    report_lines.extend(
        [
            "",
            f"The requested z8–z10 detail set is **{detail_tile_count:,} tiles**.",
            f"At the middle planning assumption of {middle_size:g} KiB per rendered tile plus 3% PMTiles overhead, that is **{detail_middle_mib:.1f} MiB**.",
            f"A sparse ancestor pyramid through z10 would contain **{full_pyramid_count:,} tiles** and estimate to **{pyramid_middle_mib:.1f} MiB** at the same tile weight.",
            f"The recommended product shape is **{coarse_extent_tile_count:,} full-extent coarse tiles at z0–z7 plus the sparse z8–z10 detail**, or **{two_tier_tile_count:,} tiles / {two_tier_middle_mib:.1f} MiB** at the middle estimate.",
            "",
            "## Size band",
            "",
            "These are planning estimates for 256 px raster tiles, not measured output. Pirate linework, labels, texture, and codec settings will determine the real mean.",
            "",
            "| Average rendered tile | z8–z10 detail | Sparse z0–z10 | Full coarse z0–z7 + sparse detail |",
            "|---:|---:|---:|---:|",
        ]
    )
    for size_kib in size_values:
        detail_mib = detail_tile_count * size_kib * PMTILES_OVERHEAD_FACTOR / 1024.0
        pyramid_mib = full_pyramid_count * size_kib * PMTILES_OVERHEAD_FACTOR / 1024.0
        two_tier_mib = two_tier_tile_count * size_kib * PMTILES_OVERHEAD_FACTOR / 1024.0
        report_lines.append(
            f"| {size_kib:g} KiB | {detail_mib:.1f} MiB | {pyramid_mib:.1f} MiB | {two_tier_mib:.1f} MiB |"
        )
    report_lines.extend(
        [
            "",
            "## Boundaries of this report",
            "",
            "- Coverage is conservative because it tiles trail bounding boxes, as requested; a later geometry-buffer pass can quantify the savings from following actual trail lines.",
            "- The current pack-ready manifest has 15,375 trails. The larger database contains review and excluded records that are intentionally not part of this footprint.",
            "- The two-tier estimate includes a coarse rectangular shell across the current catalog extent, not a worldwide layer.",
            "- Render a representative 100–200 tile sample before choosing the final codec and archive budget.",
            "",
        ]
    )
    (args.output / "README.md").write_text("\n".join(report_lines), encoding="utf-8")

    print(json.dumps({
        "trail_count": len(bboxes),
        "recommended_padding_km": args.recommended_padding_km,
        "detail_tiles": {str(zoom): len(tiles) for zoom, tiles in recommended_sets.items()},
        "detail_tile_total": detail_tile_count,
        "sparse_pyramid_tile_total": full_pyramid_count,
        "full_extent_coarse_tile_total": coarse_extent_tile_count,
        "two_tier_tile_total": two_tier_tile_count,
        "output": str(args.output.resolve()),
    }, indent=2))


if __name__ == "__main__":
    main()
