#!/usr/bin/env python3
"""Build hardware-safe Trail Tech Voyager riding-area GPX pilots.

Pilot A/B established that Voyager counts each GPX ``trkseg`` as a track. Pilot
C nodes the complete riding-area network at every exact source coordinate,
duplicates only existing graph edges when necessary, and emits at most 300
continuous walks without inventing connector geometry. Derived output is compact
and elevation-free; the canonical trails database is read-only.

Pilot D preserves those tracks and optionally sanitizes a state-context GPX into
a route-only context file and a production-shaped combined pack. Tracks and
routes are validated against Voyager's shared 72,500-point RIDE memory.
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict, deque
from dataclasses import dataclass
from decimal import Decimal
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import uuid
import xml.etree.ElementTree as ET

from voyager_state_context import ContextBuild, ContextRoute, build_state_context


GPX_NS = "http://www.topografix.com/GPX/1/1"
XSI_NS = "http://www.w3.org/2001/XMLSchema-instance"
SCHEMA_LOCATION = f"{GPX_NS} http://www.topografix.com/GPX/1/1/gpx.xsd"
MAX_TRACKS = 300
MAX_TRACK_POINTS = 72_500
MAX_ROUTES = 300
MAX_ROUTE_POINTS = 72_500
MAX_ROUTE_NAME_LENGTH = 12

ET.register_namespace("", GPX_NS)
ET.register_namespace("xsi", XSI_NS)


def qname(name: str) -> str:
    return f"{{{GPX_NS}}}{name}"


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


@dataclass(frozen=True)
class NodePoint:
    latitude: str
    longitude: str

    @property
    def exact_key(self) -> tuple[Decimal, Decimal]:
        return (Decimal(self.longitude), Decimal(self.latitude))


@dataclass(frozen=True)
class SourceSegment:
    trail_id: str
    segment_index: int
    node_ids: tuple[int, ...]
    source_edge_ids: tuple[int, ...]
    elevation_point_count: int

    @property
    def key(self) -> tuple[str, int]:
        return (self.trail_id, self.segment_index)


@dataclass(frozen=True)
class Edge:
    edge_id: int
    left: int
    right: int
    kind: str
    source_edge_id: int | None


@dataclass(frozen=True)
class Component:
    component_id: int
    node_ids: tuple[int, ...]
    source_edge_ids: tuple[int, ...]
    odd_node_ids: tuple[int, ...]


@dataclass(frozen=True)
class Step:
    edge_id: int
    start: int
    end: int


@dataclass(frozen=True)
class Walk:
    component_id: int
    steps: tuple[Step, ...]

    @property
    def point_count(self) -> int:
        return len(self.steps) + 1


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Build compact Voyager riding-area pilots. With --state-context, "
            "Pilot D adds sanitized toggleable state routes to Pilot C tracks."
        )
    )
    parser.add_argument("database", type=Path, help="Root of the trails database.")
    parser.add_argument("--area-id", default="yacolt-burn", help="Named riding-area ID.")
    parser.add_argument("--output", type=Path, required=True, help="Pilot output directory.")
    parser.add_argument(
        "--state-context",
        type=Path,
        help="Optional state-context GPX to sanitize into Pilot D routes.",
    )
    parser.add_argument(
        "--context-tolerance-meters",
        type=float,
        default=5_000.0,
        help=(
            "Per-segment spherical Douglas-Peucker tolerance for Pilot D "
            "(default: 5000; use 0 for exact source vertices)."
        ),
    )
    return parser.parse_args()


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def rows_as_dicts(fields: list[str], rows: list[list]) -> list[dict]:
    return [dict(zip(fields, row, strict=True)) for row in rows]


def resolve_database_file(database: Path, relative_path: str) -> Path:
    normalized = Path(relative_path.replace("/", os.sep))
    candidate = (database / normalized).resolve()
    try:
        candidate.relative_to(database)
    except ValueError as error:
        raise RuntimeError(f"Unsafe database path: {relative_path}") from error
    if not candidate.is_file():
        raise RuntimeError(f"Missing database file: {relative_path}")
    return candidate


def load_area_catalog(database: Path, area_id: str) -> tuple[dict, dict, list[dict]]:
    manifest_path = database / "web-map" / "v2" / "manifest.json"
    manifest = read_json(manifest_path)
    if manifest.get("version") != 2:
        raise RuntimeError("The current web-map v2 manifest is required.")

    overview = read_json(resolve_database_file(database, manifest["overviewFile"]))
    areas = rows_as_dicts(overview["areaFields"], overview["areas"])
    area = next((row for row in areas if row["id"] == area_id), None)
    if area is None:
        raise RuntimeError(f"Unknown riding area: {area_id}")

    area_group_ids = set(area["groupIds"])
    groups = rows_as_dicts(overview["groupFields"], overview["groups"])
    catalog_by_id: dict[str, dict] = {}
    for group in groups:
        if group["id"] not in area_group_ids:
            continue
        chunk = read_json(resolve_database_file(database, group["file"]))
        for item in rows_as_dicts(chunk["catalogFields"], chunk["catalog"]):
            if item.get("area_id") != area_id:
                continue
            trail_id = item["trail_id"]
            if trail_id in catalog_by_id:
                raise RuntimeError(f"Duplicate area trail ID: {trail_id}")
            catalog_by_id[trail_id] = item

    catalog = sorted(catalog_by_id.values(), key=lambda row: row["trail_id"])
    if len(catalog) != area["count"]:
        raise RuntimeError(
            f"Area catalog drift: overview says {area['count']:,} trails, "
            f"but chunks contain {len(catalog):,}."
        )
    return manifest, area, catalog


def checked_number(value: str, source_path: Path, label: str) -> float:
    try:
        number = float(value)
    except ValueError as error:
        raise RuntimeError(f"Invalid {label} in {source_path}") from error
    if not math.isfinite(number):
        raise RuntimeError(f"Non-finite {label} in {source_path}")
    return number


def load_source_graph(
    database: Path,
    catalog: list[dict],
) -> tuple[list[NodePoint], list[Edge], list[SourceSegment]]:
    node_id_by_coordinate: dict[tuple[Decimal, Decimal], int] = {}
    nodes: list[NodePoint] = []
    edges: list[Edge] = []
    segments: list[SourceSegment] = []

    def node_id_for(point: NodePoint) -> int:
        key = point.exact_key
        node_id = node_id_by_coordinate.get(key)
        if node_id is None:
            node_id = len(nodes)
            node_id_by_coordinate[key] = node_id
            nodes.append(point)
        return node_id

    for item in catalog:
        source_path = resolve_database_file(database, item["gpx_path"])
        root = ET.parse(source_path).getroot()
        if root.tag != qname("gpx") or root.get("version") != "1.1":
            raise RuntimeError(f"Expected namespaced GPX 1.1 source: {source_path}")
        segment_index = 0
        for track in root.findall(qname("trk")):
            for segment_node in track.findall(qname("trkseg")):
                segment_nodes: list[int] = []
                elevation_count = 0
                for point_node in segment_node.findall(qname("trkpt")):
                    latitude = point_node.get("lat")
                    longitude = point_node.get("lon")
                    if latitude is None or longitude is None:
                        raise RuntimeError(f"Track point without coordinates in {source_path}")
                    latitude_value = checked_number(latitude, source_path, "latitude")
                    longitude_value = checked_number(longitude, source_path, "longitude")
                    if not -90 <= latitude_value <= 90 or not -180 <= longitude_value <= 180:
                        raise RuntimeError(f"Out-of-range coordinates in {source_path}")

                    elevation_node = point_node.find(qname("ele"))
                    if elevation_node is not None and elevation_node.text:
                        checked_number(elevation_node.text.strip(), source_path, "elevation")
                        elevation_count += 1
                    segment_nodes.append(node_id_for(NodePoint(latitude, longitude)))

                if len(segment_nodes) < 2:
                    raise RuntimeError(f"Unusable track segment in {source_path}")
                source_edge_ids: list[int] = []
                for left, right in zip(segment_nodes, segment_nodes[1:]):
                    edge_id = len(edges)
                    edges.append(Edge(edge_id, left, right, "source", edge_id))
                    source_edge_ids.append(edge_id)
                segments.append(
                    SourceSegment(
                        trail_id=item["trail_id"],
                        segment_index=segment_index,
                        node_ids=tuple(segment_nodes),
                        source_edge_ids=tuple(source_edge_ids),
                        elevation_point_count=elevation_count,
                    )
                )
                segment_index += 1
        if segment_index == 0:
            raise RuntimeError(f"No track segments in {source_path}")
    return nodes, edges, segments


def undirected_pair(left: int, right: int) -> tuple[int, int]:
    return (left, right) if left <= right else (right, left)


def graph_topology(
    node_count: int,
    source_edges: list[Edge],
) -> tuple[list[tuple[int, ...]], dict[tuple[int, int], int], list[Component]]:
    neighbor_sets: list[set[int]] = [set() for _ in range(node_count)]
    representative_edge: dict[tuple[int, int], int] = {}
    degree = [0] * node_count
    for edge in source_edges:
        neighbor_sets[edge.left].add(edge.right)
        neighbor_sets[edge.right].add(edge.left)
        degree[edge.left] += 1
        degree[edge.right] += 1
        representative_edge.setdefault(undirected_pair(edge.left, edge.right), edge.edge_id)

    adjacency = [tuple(sorted(neighbors)) for neighbors in neighbor_sets]
    component_of_node = [-1] * node_count
    component_nodes: list[list[int]] = []
    for first in range(node_count):
        if component_of_node[first] != -1:
            continue
        component_id = len(component_nodes)
        component_of_node[first] = component_id
        queue = deque([first])
        nodes: list[int] = []
        while queue:
            node_id = queue.popleft()
            nodes.append(node_id)
            for neighbor in adjacency[node_id]:
                if component_of_node[neighbor] == -1:
                    component_of_node[neighbor] = component_id
                    queue.append(neighbor)
        component_nodes.append(sorted(nodes))

    edges_by_component: list[list[int]] = [[] for _ in component_nodes]
    for edge in source_edges:
        component_id = component_of_node[edge.left]
        if component_id != component_of_node[edge.right]:
            raise RuntimeError("Source edge crosses computed graph components.")
        edges_by_component[component_id].append(edge.edge_id)

    components = [
        Component(
            component_id=index,
            node_ids=tuple(nodes),
            source_edge_ids=tuple(edges_by_component[index]),
            odd_node_ids=tuple(node for node in nodes if degree[node] % 2),
        )
        for index, nodes in enumerate(component_nodes)
    ]
    return adjacency, representative_edge, components


def odd_pair_candidates(
    adjacency: list[tuple[int, ...]],
    components: list[Component],
) -> list[tuple[int, int, int, int]]:
    candidates: list[tuple[int, int, int, int]] = []
    for component in components:
        odd_nodes = component.odd_node_ids
        if len(odd_nodes) < 4:
            continue
        for position, start in enumerate(odd_nodes[:-1]):
            targets = set(odd_nodes[position + 1 :])
            distances = {start: 0}
            queue = deque([start])
            while queue and targets:
                node_id = queue.popleft()
                distance = distances[node_id] + 1
                for neighbor in adjacency[node_id]:
                    if neighbor in distances:
                        continue
                    distances[neighbor] = distance
                    queue.append(neighbor)
                    if neighbor in targets:
                        candidates.append(
                            (distance, component.component_id, start, neighbor)
                        )
                        targets.remove(neighbor)
            if targets:
                raise RuntimeError("Odd vertices are disconnected inside a component.")
    candidates.sort()
    return candidates


def choose_duplicate_pairs(
    adjacency: list[tuple[int, ...]],
    components: list[Component],
    target_tracks: int,
) -> tuple[list[tuple[int, int, int, int]], int]:
    minimum_tracks = sum(max(1, len(component.odd_node_ids) // 2) for component in components)
    if minimum_tracks <= target_tracks:
        return [], minimum_tracks
    required_pairs = minimum_tracks - target_tracks
    maximum_reduction = sum(
        max(0, len(component.odd_node_ids) // 2 - 1)
        for component in components
    )
    if required_pairs > maximum_reduction:
        raise RuntimeError(
            f"At least {minimum_tracks - maximum_reduction:,} graph components must remain; "
            f"cannot reach {target_tracks:,} tracks without fabricated connectors."
        )

    unmatched = {
        node_id
        for component in components
        for node_id in component.odd_node_ids
    }
    selected_by_component: Counter[int] = Counter()
    maximum_by_component = {
        component.component_id: max(0, len(component.odd_node_ids) // 2 - 1)
        for component in components
    }
    selected: list[tuple[int, int, int, int]] = []
    for candidate in odd_pair_candidates(adjacency, components):
        _distance, component_id, left, right = candidate
        if left not in unmatched or right not in unmatched:
            continue
        if selected_by_component[component_id] >= maximum_by_component[component_id]:
            continue
        unmatched.remove(left)
        unmatched.remove(right)
        selected_by_component[component_id] += 1
        selected.append(candidate)
        if len(selected) == required_pairs:
            break
    if len(selected) != required_pairs:
        raise RuntimeError(
            f"Could select only {len(selected):,} of {required_pairs:,} required odd pairs."
        )
    return selected, minimum_tracks


def shortest_path(
    adjacency: list[tuple[int, ...]],
    start: int,
    target: int,
) -> list[int]:
    parents = {start: -1}
    queue = deque([start])
    while queue and target not in parents:
        node_id = queue.popleft()
        for neighbor in adjacency[node_id]:
            if neighbor in parents:
                continue
            parents[neighbor] = node_id
            queue.append(neighbor)
            if neighbor == target:
                break
    if target not in parents:
        raise RuntimeError("Selected odd pair has no graph path.")
    path = [target]
    while path[-1] != start:
        path.append(parents[path[-1]])
    path.reverse()
    return path


def add_duplicate_paths(
    source_edges: list[Edge],
    nodes: list[NodePoint],
    adjacency: list[tuple[int, ...]],
    representative_edge: dict[tuple[int, int], int],
    selected_pairs: list[tuple[int, int, int, int]],
) -> tuple[list[Edge], list[dict]]:
    real_edges = list(source_edges)
    records: list[dict] = []
    for pair_index, (distance, component_id, left, right) in enumerate(selected_pairs, start=1):
        node_path = shortest_path(adjacency, left, right)
        source_edge_ids: list[int] = []
        for start, end in zip(node_path, node_path[1:]):
            source_edge_id = representative_edge[undirected_pair(start, end)]
            edge_id = len(real_edges)
            real_edges.append(Edge(edge_id, start, end, "duplicate", source_edge_id))
            source_edge_ids.append(source_edge_id)
        if len(source_edge_ids) != distance:
            raise RuntimeError("Selected odd-pair distance changed during path reconstruction.")
        records.append(
            {
                "index": pair_index,
                "component": component_id,
                "leftNode": left,
                "rightNode": right,
                "leftCoordinate": [nodes[left].longitude, nodes[left].latitude],
                "rightCoordinate": [nodes[right].longitude, nodes[right].latitude],
                "duplicatedSourceEdgeIds": source_edge_ids,
            }
        )
    return real_edges, records


def edge_other_end(edge: Edge, node_id: int) -> int:
    if node_id == edge.left:
        return edge.right
    if node_id == edge.right:
        return edge.left
    raise RuntimeError("Edge is not incident to the traversal node.")


def split_euler_circuit(
    circuit: list[Step],
    virtual_edge_ids: set[int],
    component_id: int,
) -> list[Walk]:
    if virtual_edge_ids:
        first_virtual = next(
            index for index, step in enumerate(circuit)
            if step.edge_id in virtual_edge_ids
        )
        circuit = circuit[first_virtual + 1 :] + circuit[: first_virtual + 1]

    walks: list[Walk] = []
    real_steps: list[Step] = []
    for step in circuit:
        if step.edge_id in virtual_edge_ids:
            if not real_steps:
                raise RuntimeError("Virtual edge produced an empty output walk.")
            walks.append(Walk(component_id, tuple(real_steps)))
            real_steps = []
        else:
            real_steps.append(step)
    if real_steps:
        walks.append(Walk(component_id, tuple(real_steps)))
    return walks


def build_walks(
    source_edges: list[Edge],
    real_edges: list[Edge],
    components: list[Component],
    target_tracks: int,
) -> tuple[list[Walk], list[Edge], int]:
    all_edges = list(real_edges)
    component_of_node = {}
    for component in components:
        for node_id in component.node_ids:
            component_of_node[node_id] = component.component_id

    real_by_component: list[list[int]] = [[] for _ in components]
    for edge in real_edges:
        component_id = component_of_node[edge.left]
        if component_id != component_of_node[edge.right]:
            raise RuntimeError("Real edge crosses graph components.")
        real_by_component[component_id].append(edge.edge_id)

    all_walks: list[Walk] = []
    augmented_odd_count = 0
    for component in components:
        degree: Counter[int] = Counter()
        for edge_id in real_by_component[component.component_id]:
            edge = all_edges[edge_id]
            degree[edge.left] += 1
            degree[edge.right] += 1
        odd_nodes = sorted(node_id for node_id, value in degree.items() if value % 2)
        augmented_odd_count += len(odd_nodes)

        virtual_edge_ids: set[int] = set()
        for left, right in zip(odd_nodes[::2], odd_nodes[1::2], strict=True):
            edge_id = len(all_edges)
            all_edges.append(Edge(edge_id, left, right, "virtual", None))
            virtual_edge_ids.add(edge_id)

        component_edge_ids = real_by_component[component.component_id] + sorted(virtual_edge_ids)
        traversal_adjacency: dict[int, list[int]] = defaultdict(list)
        for edge_id in component_edge_ids:
            edge = all_edges[edge_id]
            traversal_adjacency[edge.left].append(edge_id)
            traversal_adjacency[edge.right].append(edge_id)
        for incident in traversal_adjacency.values():
            incident.sort(reverse=True)

        start_node = odd_nodes[0] if odd_nodes else component.node_ids[0]
        used: set[int] = set()
        node_stack = [start_node]
        step_stack: list[Step] = []
        reverse_circuit: list[Step] = []
        while node_stack:
            node_id = node_stack[-1]
            incident = traversal_adjacency[node_id]
            while incident and incident[-1] in used:
                incident.pop()
            if incident:
                edge_id = incident.pop()
                if edge_id in used:
                    continue
                used.add(edge_id)
                other = edge_other_end(all_edges[edge_id], node_id)
                node_stack.append(other)
                step_stack.append(Step(edge_id, node_id, other))
            else:
                node_stack.pop()
                if step_stack:
                    reverse_circuit.append(step_stack.pop())

        if used != set(component_edge_ids):
            raise RuntimeError("Hierholzer traversal missed component edges.")
        circuit = list(reversed(reverse_circuit))
        for previous, current in zip(circuit, circuit[1:]):
            if previous.end != current.start:
                raise RuntimeError("Hierholzer circuit is not continuous.")
        if circuit and circuit[-1].end != circuit[0].start:
            raise RuntimeError("Augmented Hierholzer circuit did not close.")
        all_walks.extend(
            split_euler_circuit(circuit, virtual_edge_ids, component.component_id)
        )

    all_walks.sort(
        key=lambda walk: (
            walk.component_id,
            walk.steps[0].start,
            walk.steps[0].end,
            walk.steps[0].edge_id,
        )
    )
    if len(all_walks) != target_tracks:
        raise RuntimeError(f"Expected {target_tracks:,} walks, built {len(all_walks):,}.")
    if any(not walk.steps for walk in all_walks):
        raise RuntimeError("Empty output walk generated.")

    expected_real_ids = {edge.edge_id for edge in real_edges}
    traversed_real_ids = Counter(
        step.edge_id for walk in all_walks for step in walk.steps
    )
    if traversed_real_ids != Counter({edge_id: 1 for edge_id in expected_real_ids}):
        raise RuntimeError("Real-edge traversal is not exactly once per augmented edge.")
    if any(all_edges[step.edge_id].kind == "virtual" for walk in all_walks for step in walk.steps):
        raise RuntimeError("Virtual edge escaped into output walks.")
    if any(edge.kind != "source" for edge in source_edges):
        raise RuntimeError("Source-edge identity drifted.")
    return all_walks, all_edges, augmented_odd_count


def walk_node_ids(walk: Walk) -> tuple[int, ...]:
    nodes = [walk.steps[0].start]
    for previous, current in zip(walk.steps, walk.steps[1:]):
        if previous.end != current.start:
            raise RuntimeError("Output walk contains a discontinuity.")
    nodes.extend(step.end for step in walk.steps)
    return tuple(nodes)


def bounds_for_node_ids(node_ids: tuple[int, ...], nodes: list[NodePoint]) -> list[float]:
    longitudes = [float(nodes[node_id].longitude) for node_id in node_ids]
    latitudes = [float(nodes[node_id].latitude) for node_id in node_ids]
    return [min(longitudes), min(latitudes), max(longitudes), max(latitudes)]


def coordinate_signature(node_ids: tuple[int, ...], nodes: list[NodePoint]) -> str:
    digest = hashlib.sha256()
    for node_id in node_ids:
        point = nodes[node_id]
        digest.update(point.latitude.encode("utf-8"))
        digest.update(b"\x1f")
        digest.update(point.longitude.encode("utf-8"))
        digest.update(b"\x1e")
    return digest.hexdigest()


def traversal_signature(walk: Walk, edges: list[Edge]) -> str:
    digest = hashlib.sha256()
    for step in walk.steps:
        edge = edges[step.edge_id]
        direction = b"f" if (edge.left, edge.right) == (step.start, step.end) else b"r"
        digest.update(str(step.edge_id).encode("ascii"))
        digest.update(b":")
        digest.update(direction)
        digest.update(b";")
    return digest.hexdigest()


def write_compact_gpx(
    path: Path,
    metadata_name: str,
    metadata_description: str,
    routes: tuple[ContextRoute, ...],
    walks: list[Walk],
    nodes: list[NodePoint] | None,
    area_name: str,
    route_name_suffix: str = "US State",
) -> None:
    root = ET.Element(
        qname("gpx"),
        {
            "version": "1.1",
            "creator": "Bob's Motorcycle Trails",
            f"{{{XSI_NS}}}schemaLocation": SCHEMA_LOCATION,
        },
    )
    metadata = ET.SubElement(root, qname("metadata"))
    ET.SubElement(metadata, qname("name")).text = metadata_name
    ET.SubElement(metadata, qname("desc")).text = metadata_description

    # GPX 1.1 schema order is metadata, wpt*, rte*, trk*. Pilot D deliberately
    # emits zero waypoints and places toggleable context routes before tracks.
    for index, route in enumerate(routes, start=1):
        route_node = ET.SubElement(root, qname("rte"))
        route_name = f"{index:03d} {route_name_suffix}"
        if len(route_name) > MAX_ROUTE_NAME_LENGTH:
            raise RuntimeError(
                f"Route name exceeds {MAX_ROUTE_NAME_LENGTH} characters: {route_name}"
            )
        ET.SubElement(route_node, qname("name")).text = route_name
        for point in route.points:
            ET.SubElement(
                route_node,
                qname("rtept"),
                {"lat": point.latitude, "lon": point.longitude},
            )

    if walks and nodes is None:
        raise RuntimeError("Track walks require their canonical node table.")
    for index, walk in enumerate(walks, start=1):
        track = ET.SubElement(root, qname("trk"))
        ET.SubElement(track, qname("name")).text = f"{area_name} {index:03d}"
        segment = ET.SubElement(track, qname("trkseg"))
        for node_id in walk_node_ids(walk):
            assert nodes is not None
            point = nodes[node_id]
            ET.SubElement(
                segment,
                qname("trkpt"),
                {"lat": point.latitude, "lon": point.longitude},
            )

    # Whitespace-only indentation costs device storage and has no GPX meaning.
    temporary_path = path.with_suffix(path.suffix + ".tmp")
    ET.ElementTree(root).write(
        temporary_path,
        encoding="utf-8",
        xml_declaration=True,
        short_empty_elements=False,
    )
    os.replace(temporary_path, path)


def parse_output(
    path: Path,
) -> tuple[
    dict,
    list[tuple[tuple[str, str], ...]],
    list[tuple[tuple[str, str], ...]],
]:
    root = ET.parse(path).getroot()
    if root.tag != qname("gpx") or root.get("version") != "1.1":
        raise RuntimeError(f"Expected namespaced GPX 1.1 output in {path}")

    child_order = {"metadata": 0, "wpt": 1, "rte": 2, "trk": 3}
    ranks = [child_order.get(local_name(child.tag), 99) for child in root]
    if ranks != sorted(ranks) or 99 in ranks:
        raise RuntimeError("Derived GPX children violate GPX 1.1 schema order.")

    forbidden = Counter()
    elevation_count = 0
    for element in root.iter():
        name = local_name(element.tag)
        if name in {"time", "extensions"}:
            forbidden[name] += 1
        if name == "ele":
            elevation_count += 1

    output_routes: list[tuple[tuple[str, str], ...]] = []
    route_names: list[str] = []
    for index, route in enumerate(root.findall(qname("rte")), start=1):
        name_node = route.find(qname("name"))
        route_name = name_node.text.strip() if name_node is not None and name_node.text else ""
        if not route_name.startswith(f"{index:03d} "):
            raise RuntimeError("Derived route name does not begin with its zero-padded index.")
        if len(route_name) > MAX_ROUTE_NAME_LENGTH:
            raise RuntimeError("Derived route name exceeds the conservative device-safe limit.")
        route_names.append(route_name)
        points: list[tuple[str, str]] = []
        for point in route.findall(qname("rtept")):
            latitude = point.get("lat")
            longitude = point.get("lon")
            if latitude is None or longitude is None:
                raise RuntimeError("Output route point is missing coordinates.")
            points.append((latitude, longitude))
        if len(points) < 2:
            raise RuntimeError("Output route contains fewer than two points.")
        output_routes.append(tuple(points))

    output_tracks: list[tuple[tuple[str, str], ...]] = []
    for track in root.findall(qname("trk")):
        segments = track.findall(qname("trkseg"))
        if len(segments) != 1:
            raise RuntimeError("Every Pilot C track must contain exactly one trkseg.")
        points: list[tuple[str, str]] = []
        for point in segments[0].findall(qname("trkpt")):
            latitude = point.get("lat")
            longitude = point.get("lon")
            if latitude is None or longitude is None:
                raise RuntimeError("Output point is missing coordinates.")
            points.append((latitude, longitude))
        if len(points) < 2:
            raise RuntimeError("Output track contains fewer than two points.")
        output_tracks.append(tuple(points))

    truncated_names = [name[:MAX_ROUTE_NAME_LENGTH] for name in route_names]
    if len(set(truncated_names)) != len(truncated_names):
        raise RuntimeError("Derived route names collide after conservative device truncation.")

    counts = {
        "waypointCount": sum(
            1 for element in root.iter() if local_name(element.tag) == "wpt"
        ),
        "routeCount": len(output_routes),
        "routePointCount": sum(len(points) for points in output_routes),
        "routeNameMaxLength": max((len(name) for name in route_names), default=0),
        "routeNamesUniqueAfterTruncation": True,
        "trackCount": len(output_tracks),
        "segmentCount": len(output_tracks),
        "trackPointCount": sum(len(points) for points in output_tracks),
        # Retained for the Pilot C manifest contract.
        "pointCount": sum(len(points) for points in output_tracks),
        "elevationPointCount": elevation_count,
        "forbiddenElementCount": sum(forbidden.values()),
        "schemaOrderValid": True,
    }
    return counts, output_routes, output_tracks


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def text_coordinate_signature(points: tuple[tuple[str, str], ...]) -> str:
    digest = hashlib.sha256()
    for latitude, longitude in points:
        digest.update(latitude.encode("utf-8"))
        digest.update(b"\x1f")
        digest.update(longitude.encode("utf-8"))
        digest.update(b"\x1e")
    return digest.hexdigest()


def validate_context_routes(
    expected_routes: tuple[ContextRoute, ...],
    output_routes: list[tuple[tuple[str, str], ...]],
) -> list[dict]:
    if len(output_routes) != len(expected_routes):
        raise RuntimeError("Derived context route count differs from the topology build.")
    records: list[dict] = []
    for index, (expected, output) in enumerate(
        zip(expected_routes, output_routes, strict=True),
        start=1,
    ):
        expected_points = tuple(
            (point.latitude, point.longitude) for point in expected.points
        )
        if output != expected_points:
            raise RuntimeError(f"Coordinate/order mismatch in context route {index}.")
        records.append(
            {
                "index": index,
                "pointCount": len(output),
                "coordinateSha256": text_coordinate_signature(output),
                "sourceSegments": [
                    {
                        "index": step.segment.index,
                        "direction": "reverse" if step.reversed else "forward",
                    }
                    for step in expected.steps
                ],
            }
        )
    return records


def validate_output(
    path: Path,
    walks: list[Walk],
    nodes: list[NodePoint],
    source_edges: list[Edge],
    real_edges: list[Edge],
    all_edges: list[Edge],
    context_routes: tuple[ContextRoute, ...] = (),
) -> tuple[dict, dict]:
    counts, output_routes, output_tracks = parse_output(path)
    if counts["waypointCount"]:
        raise RuntimeError("Derived Voyager output retained source waypoints.")
    route_records = validate_context_routes(context_routes, output_routes)
    if counts["routeCount"] > MAX_ROUTES:
        raise RuntimeError("Voyager route limit exceeded.")
    if counts["routePointCount"] > MAX_ROUTE_POINTS:
        raise RuntimeError("Voyager route-point limit exceeded.")
    combined_point_count = counts["pointCount"] + counts["routePointCount"]
    if combined_point_count > MAX_TRACK_POINTS:
        raise RuntimeError(
            "Derived tracks and routes exceed Voyager's shared 72,500-point RIDE memory."
        )
    if counts["trackCount"] > MAX_TRACKS:
        raise RuntimeError("Voyager track limit exceeded.")
    if counts["pointCount"] > MAX_TRACK_POINTS:
        raise RuntimeError(
            "The deterministic pairing exceeded the Voyager track-point limit. "
            "That heuristic result is not proof that no capacity-safe pairing exists."
        )
    if counts["elevationPointCount"]:
        raise RuntimeError("Derived Pilot C output retained elevation.")
    if counts["forbiddenElementCount"]:
        raise RuntimeError("Derived Pilot C output contains forbidden GPX elements.")
    if len(output_tracks) != len(walks):
        raise RuntimeError("Output track count differs from generated walks.")

    track_records: list[dict] = []
    for index, (walk, output_points) in enumerate(
        zip(walks, output_tracks, strict=True),
        start=1,
    ):
        node_ids = walk_node_ids(walk)
        expected_points = tuple(
            (nodes[node_id].latitude, nodes[node_id].longitude)
            for node_id in node_ids
        )
        if output_points != expected_points:
            raise RuntimeError(f"Coordinate/order mismatch in output track {index}.")
        kinds = Counter(all_edges[step.edge_id].kind for step in walk.steps)
        track_records.append(
            {
                "index": index,
                "component": walk.component_id,
                "pointCount": len(node_ids),
                "sourceEdgeTraversals": kinds["source"],
                "duplicateEdgeTraversals": kinds["duplicate"],
                "bounds": bounds_for_node_ids(node_ids, nodes),
                "coordinateSha256": coordinate_signature(node_ids, nodes),
                "edgeTraversalSha256": traversal_signature(walk, all_edges),
            }
        )

    source_ids = {edge.edge_id for edge in source_edges}
    duplicate_ids = {
        edge.edge_id for edge in real_edges if edge.kind == "duplicate"
    }
    traversed_ids = Counter(step.edge_id for walk in walks for step in walk.steps)
    if any(traversed_ids[edge_id] != 1 for edge_id in source_ids | duplicate_ids):
        raise RuntimeError("Source/duplicate edge traversal accounting failed.")
    if set(traversed_ids) != source_ids | duplicate_ids:
        raise RuntimeError("Output traversed a virtual or unknown edge.")

    for edge in real_edges:
        if edge.kind != "duplicate":
            continue
        if edge.source_edge_id not in source_ids:
            raise RuntimeError("Duplicate edge does not reference a source edge.")
        source = source_edges[edge.source_edge_id]
        if undirected_pair(edge.left, edge.right) != undirected_pair(source.left, source.right):
            raise RuntimeError("Duplicate edge changed source geometry.")

    variant = {
        **counts,
        "file": path.name,
        "bytes": path.stat().st_size,
        "sha256": sha256_file(path),
        "bounds": bounds_for_node_ids(tuple(range(len(nodes))), nodes),
        "sourceEdgeTraversalCount": len(source_edges),
        "duplicateEdgeTraversalCount": len(duplicate_ids),
        "headroom": {
            "tracks": MAX_TRACKS - counts["trackCount"],
            "trackPoints": MAX_TRACK_POINTS - counts["pointCount"],
            "routes": MAX_ROUTES - counts["routeCount"],
            "routePoints": MAX_ROUTE_POINTS - counts["routePointCount"],
        },
        "tracks": track_records,
        "routes": route_records,
        "combinedNavigationPointCount": combined_point_count,
        "sharedRidePointHeadroom": MAX_TRACK_POINTS - combined_point_count,
    }
    invariants = {
        "everySourceAtomicEdgeTraversedExactlyOnce": True,
        "everyDuplicateAtomicEdgeTraversedExactlyOnce": True,
        "duplicateTraversalsReferenceExistingSourceEdges": True,
        "coordinatesChanged": 0,
        "fabricatedConnectorEdges": 0,
        "sourceGeometryOmitted": False,
        "elevationStrippedFromDerivedFile": True,
        "compactGpxSerialization": True,
        "oneSegmentPerTrack": True,
        "withinVoyagerTrackLimit": True,
        "withinVoyagerPointLimit": True,
        "waypointCountIsZero": True,
        "routesBeforeTracks": True,
        "withinVoyagerRouteLimit": True,
        "withinVoyagerRoutePointLimit": True,
        "withinSharedRidePointLimit": True,
    }
    return variant, invariants


def context_bounds(routes: tuple[ContextRoute, ...]) -> list[float]:
    points = [point for route in routes for point in route.points]
    longitudes = [float(point.longitude) for point in points]
    latitudes = [float(point.latitude) for point in points]
    return [min(longitudes), min(latitudes), max(longitudes), max(latitudes)]


def validate_route_only_output(
    path: Path,
    context: ContextBuild,
) -> tuple[dict, dict]:
    counts, output_routes, output_tracks = parse_output(path)
    if counts["waypointCount"]:
        raise RuntimeError("Route-only context output retained source waypoints.")
    if output_tracks or counts["trackCount"] or counts["trackPointCount"]:
        raise RuntimeError("Route-only context output unexpectedly contains tracks.")
    if counts["routeCount"] > MAX_ROUTES:
        raise RuntimeError("Voyager route limit exceeded in route-only context output.")
    if counts["routePointCount"] > MAX_ROUTE_POINTS:
        raise RuntimeError("Voyager route-point limit exceeded in route-only context output.")
    if counts["elevationPointCount"] or counts["forbiddenElementCount"]:
        raise RuntimeError("Route-only context output retained forbidden telemetry.")
    route_records = validate_context_routes(context.routes, output_routes)
    variant = {
        **counts,
        "file": path.name,
        "bytes": path.stat().st_size,
        "sha256": sha256_file(path),
        "bounds": context_bounds(context.routes),
        "headroom": {
            "routes": MAX_ROUTES - counts["routeCount"],
            "routePoints": MAX_ROUTE_POINTS - counts["routePointCount"],
        },
        "routes": route_records,
    }
    invariants = {
        "sourceWaypointsRemoved": context.source_counts["waypointCount"],
        "waypointCountIsZero": True,
        "routesBeforeTracks": True,
        "sourceTopologySegmentsRepresentedExactlyOnce": True,
        "doubledOrReversedContextEdges": context.duplicate_atomic_edge_count,
        "fabricatedContextConnectors": 0,
        "coordinatesMoved": 0,
        "properCrossings": context.proper_crossing_count,
        "elevationTimeAndExtensionsRemoved": True,
        "withinVoyagerRouteLimit": True,
        "withinVoyagerRoutePointLimit": True,
    }
    return variant, invariants


def write_json_atomic(path: Path, value: dict) -> None:
    temporary_path = path.with_suffix(path.suffix + ".tmp")
    temporary_path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary_path, path)


def write_readme(path: Path, area_name: str, variant: dict, source_point_count: int) -> None:
    text = f"""{area_name.upper()} - VOYAGER PILOT C

The physical A/B test proved that Voyager counts every GPX <trkseg> as a
track. Pilot C turns the complete riding-area network into continuous graph
walks and writes each walk as one <trk> containing one <trkseg>.

FILE

{variant['file']}
{variant['trackCount']} tracks / {variant['pointCount']:,} track points
Voyager headroom: {variant['headroom']['tracks']} tracks / {variant['headroom']['trackPoints']:,} points

HOW THE COMPLETE AREA FITS

- Every consecutive pair of canonical source points becomes an atomic graph
  edge. Shared exact coordinates are junctions.
- Every source edge is traversed at least once. Selected shortest paths are
  retraced only along those existing edges to reduce the number of disconnected
  walks to the Voyager limit.
- No endpoints are snapped, no coordinates are changed, no connector geometry
  is invented, and no source geometry is omitted.
- The {source_point_count:,} canonical source points become
  {variant['pointCount']:,} device points because continuous joins collapse
  shared junction occurrences while the necessary existing-edge retracing adds
  points.
- Elevation is omitted from this derived device file to reduce its size. The
  canonical trails database remains unchanged and retains its elevation.
- GPX is serialized compactly because formatting whitespace has no device value.

PHYSICAL CHECK

Import into an otherwise empty Voyager and confirm it reports {variant['trackCount']}
tracks and approximately {variant['pointCount'] / MAX_TRACK_POINTS:.0%} of track-point
capacity. Pan and zoom through the complete area, look for unexpected straight
connectors, restart the device, and confirm the imported tracks persist.

This is a local QA artifact, not yet a publication download.
"""
    temporary_path = path.with_suffix(path.suffix + ".tmp")
    temporary_path.write_text(text, encoding="utf-8")
    os.replace(temporary_path, path)


def write_pilot_d_readme(
    path: Path,
    area_name: str,
    context: ContextBuild,
    track_baseline: dict,
    route_only: dict,
    combined: dict,
) -> None:
    text = f"""{area_name.upper()} + US STATE CONTEXT - VOYAGER PILOT D

Physical testing confirmed tracks and routes share Voyager's 72,500-point RIDE
memory. Pilot D includes three compact GPX files:

1. {track_baseline['file']}
   {track_baseline['trackCount']} tracks / {track_baseline['trackPointCount']:,} track points
2. {route_only['file']}
   {route_only['routeCount']} routes / {route_only['routePointCount']:,} route points
3. {combined['file']}
   {combined['trackCount']} tracks / {combined['trackPointCount']:,} track points
   {combined['routeCount']} routes / {combined['routePointCount']:,} route points

The combined file uses {combined['combinedNavigationPointCount']:,} points in the
shared RIDE memory and leaves {combined['sharedRidePointHeadroom']:,} points of
validated headroom.

STATE CONTEXT SANITIZATION

- All {context.source_counts['waypointCount']} source waypoints are removed.
- All {context.source_counts['segmentCount']:,} source topology segments are
  represented exactly once as {len(context.routes):,} routes.
- A spherical cross-track Douglas-Peucker tolerance of
  {context.tolerance_meters:g} meters reduces
  {context.source_counts['pointCount']:,} source track points to
  {context.simplified_point_count:,} segment-stage points and
  {context.route_point_count:,} route points after exact endpoint joining.
- Maximum measured source-to-route deviation is
  {context.maximum_deviation_meters:,.3f} meters.
- No border is doubled or retraced; no connector is fabricated; no coordinate
  is moved; and the simplified topology has no proper crossings.
- Route points contain latitude/longitude only. Elevation, time, extensions,
  formatting whitespace, and the source city waypoints are absent.

PHYSICAL TEST ORDER

The track-only baseline is the exact Pilot C construction included here so the
bundle is self-contained. Test each file from an empty RIDE memory. Use the
route-only file to verify route visibility and toggling. Then import the combined
file and confirm all tracks and routes appear, remain independently toggleable,
survive restart, and report no truncation.

These are local QA artifacts, not publication-ready downloads.
"""
    temporary_path = path.with_suffix(path.suffix + ".tmp")
    temporary_path.write_text(text, encoding="utf-8")
    os.replace(temporary_path, path)


def validate_output_destination(database: Path, output: Path) -> None:
    if output == database or output in database.parents or database in output.parents:
        raise RuntimeError("Pilot output must be separate from the canonical trails database.")
    if output.parent == output:
        raise RuntimeError("Pilot output cannot be a filesystem root.")


def publish_staged_bundle(
    staging: Path,
    output: Path,
    manifest_name: str,
    area_id: str,
    purpose: str,
) -> None:
    backup: Path | None = None
    if output.exists():
        if not output.is_dir():
            raise RuntimeError(f"Pilot output exists and is not a directory: {output}")
        existing_files = list(output.iterdir())
        if existing_files:
            existing_manifest = output / manifest_name
            if not existing_manifest.is_file():
                raise RuntimeError(
                    "Refusing to replace a nonempty directory that is not this area's pilot bundle."
                )
            document = read_json(existing_manifest)
            if (
                document.get("purpose") != purpose
                or document.get("area", {}).get("id") != area_id
            ):
                raise RuntimeError(
                    "Refusing to replace an unrelated or earlier-generation pilot directory."
                )
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


def main() -> int:
    args = parse_args()
    database = args.database.resolve()
    output = args.output.resolve()
    validate_output_destination(database, output)
    if args.state_context is None and args.context_tolerance_meters != 5_000.0:
        raise RuntimeError("--context-tolerance-meters requires --state-context.")
    output.parent.mkdir(parents=True, exist_ok=True)

    source_manifest, area, catalog = load_area_catalog(database, args.area_id)
    nodes, source_edges, source_segments = load_source_graph(database, catalog)
    source_point_count = sum(len(segment.node_ids) for segment in source_segments)
    source_elevation_count = sum(
        segment.elevation_point_count for segment in source_segments
    )
    if source_point_count != area["pointCount"]:
        raise RuntimeError(
            f"Area point-count drift: overview says {area['pointCount']:,}, "
            f"but exact GPX files contain {source_point_count:,}."
        )

    adjacency, representative_edge, components = graph_topology(len(nodes), source_edges)
    selected_pairs, minimum_tracks = choose_duplicate_pairs(
        adjacency,
        components,
        MAX_TRACKS,
    )
    real_edges, duplicate_records = add_duplicate_paths(
        source_edges,
        nodes,
        adjacency,
        representative_edge,
        selected_pairs,
    )
    target_tracks = min(minimum_tracks, MAX_TRACKS)
    walks, all_edges, augmented_odd_count = build_walks(
        source_edges,
        real_edges,
        components,
        target_tracks,
    )

    slug = area["id"]
    area_document = {
        "id": area["id"],
        "name": area["name"],
        "sourceTrailCount": len(catalog),
        "sourceSegmentCount": len(source_segments),
        "sourcePointCount": source_point_count,
        "sourceElevationPointCount": source_elevation_count,
        "bounds": bounds_for_node_ids(tuple(range(len(nodes))), nodes),
    }
    duplicate_count = len(real_edges) - len(source_edges)
    track_topology = {
        "nodeKey": "exact decimal longitude/latitude from canonical source points",
        "nodeCount": len(nodes),
        "sourceAtomicEdgeCount": len(source_edges),
        "endpointConnectedComponentCount": len(components),
        "sourceOddNodeCount": sum(
            len(component.odd_node_ids) for component in components
        ),
        "minimumWalkCountWithoutRetracing": minimum_tracks,
        "pairedOddNodePairCount": len(selected_pairs),
        "duplicatedExistingEdgeTraversalCount": duplicate_count,
        "augmentedRealEdgeCount": len(real_edges),
        "augmentedOddNodeCount": augmented_odd_count,
        "outputWalkCount": len(walks),
    }
    source_segment_records = [
        {
            "trailId": segment.trail_id,
            "segmentIndex": segment.segment_index,
            "pointCount": len(segment.node_ids),
            "sourceEdgeIdRangeInclusive": [
                segment.source_edge_ids[0],
                segment.source_edge_ids[-1],
            ],
            "sourceEdgeCount": len(segment.source_edge_ids),
            "elevationPointCount": segment.elevation_point_count,
            "coordinateSha256": coordinate_signature(segment.node_ids, nodes),
        }
        for segment in source_segments
    ]
    voyager_limits = {
        "maxWaypoints": 300,
        "maxTracks": MAX_TRACKS,
        "maxTrackPoints": MAX_TRACK_POINTS,
        "maxRoutes": MAX_ROUTES,
        "maxRoutePoints": MAX_ROUTE_POINTS,
    }
    is_pilot_d = args.state_context is not None
    purpose = (
        "physical-voyager-shared-ride-memory-combined-pack-test"
        if is_pilot_d
        else "physical-voyager-exact-coordinate-single-pack-test"
    )
    manifest_name = (
        f"{slug}-voyager-pilot-d-manifest.json"
        if is_pilot_d
        else f"{slug}-voyager-pilot-manifest.json"
    )
    staging = output.with_name(f".{output.name}.staging-{uuid.uuid4().hex}")
    staging.mkdir()
    try:
        if not is_pilot_d:
            gpx_path = staging / f"{slug}-voyager-pilot-c-single-device-pack.gpx"
            write_compact_gpx(
                gpx_path,
                f"{area['name']} - Voyager",
                "Complete exact-coordinate riding-area network; elevation omitted.",
                (),
                walks,
                nodes,
                area["name"],
            )
            variant, invariants = validate_output(
                gpx_path,
                walks,
                nodes,
                source_edges,
                real_edges,
                all_edges,
            )
            manifest_document = {
                "schemaVersion": 3,
                "purpose": purpose,
                "sourceWebMapBuildKey": source_manifest.get("buildKey"),
                "area": area_document,
                "voyagerLimits": voyager_limits,
                "topology": track_topology,
                "policies": {
                    "join": "exact-coordinate graph junctions only",
                    "retracing": "shortest paths over existing source atomic edges only",
                    "pairing": "deterministic shortest-first greedy pairing; output must pass capacity validation",
                    "elevation": "stripped from derived GPX; retained in canonical database",
                    "serialization": "compact XML without formatting whitespace",
                },
                "invariants": invariants,
                "variant": variant,
                "sourceTrailIds": [item["trail_id"] for item in catalog],
                "sourceSegments": source_segment_records,
                "duplicatedPaths": duplicate_records,
            }
            write_readme(
                staging / f"{slug}-voyager-pilot-README.txt",
                area["name"],
                variant,
                source_point_count,
            )
        else:
            assert args.state_context is not None
            context = build_state_context(
                args.state_context,
                args.context_tolerance_meters,
            )
            track_baseline_path = staging / f"{slug}-voyager-pilot-d-track-baseline.gpx"
            route_only_path = staging / "usa-lower-48-state-context-voyager-pilot-d-routes.gpx"
            combined_path = staging / f"{slug}-voyager-pilot-d-tracks-and-state-routes.gpx"
            write_compact_gpx(
                track_baseline_path,
                f"{area['name']} - Voyager",
                "Complete exact-coordinate riding-area network; elevation omitted.",
                (),
                walks,
                nodes,
                area["name"],
            )
            write_compact_gpx(
                route_only_path,
                "US State Context - Voyager Route Test",
                "Sanitized state-border routes; source city waypoints removed.",
                context.routes,
                [],
                None,
                area["name"],
            )
            write_compact_gpx(
                combined_path,
                f"{area['name']} + US State Context - Voyager",
                "State-border routes followed by the complete riding-area track network.",
                context.routes,
                walks,
                nodes,
                area["name"],
            )
            track_baseline, baseline_invariants = validate_output(
                track_baseline_path,
                walks,
                nodes,
                source_edges,
                real_edges,
                all_edges,
            )
            route_only, context_invariants = validate_route_only_output(
                route_only_path,
                context,
            )
            combined, track_invariants = validate_output(
                combined_path,
                walks,
                nodes,
                source_edges,
                real_edges,
                all_edges,
                context.routes,
            )
            if track_baseline["trackPointCount"] != combined["trackPointCount"]:
                raise RuntimeError("Pilot D changed the validated Pilot C track payload.")
            simplified_segments = sorted(
                {
                    step.segment.index: step.segment
                    for route in context.routes
                    for step in route.steps
                }.values(),
                key=lambda segment: segment.index,
            )
            segment_stage_json = json.dumps(
                [
                    [
                        [point.latitude, point.longitude]
                        for point in segment.points
                    ]
                    for segment in simplified_segments
                ],
                separators=(",", ":"),
            ).encode("utf-8")
            manifest_document = {
                "schemaVersion": 4,
                "purpose": purpose,
                "sourceWebMapBuildKey": source_manifest.get("buildKey"),
                "area": area_document,
                "voyagerLimits": voyager_limits,
                "trackTopology": track_topology,
                "stateContext": {
                    "sourceFile": context.source_path.name,
                    "sourceSha256": context.source_sha256,
                    "sourceCounts": context.source_counts,
                    "sourceWaypointsRemoved": context.source_counts["waypointCount"],
                    "toleranceMeters": context.tolerance_meters,
                    "simplificationMetric": context.simplification_metric,
                    "maximumDeviationMeters": context.maximum_deviation_meters,
                    "simplifiedSegmentPointCount": context.simplified_point_count,
                    "removedSourcePointCount": context.removed_point_count,
                    "simplifiedSegmentStageSha256": hashlib.sha256(segment_stage_json).hexdigest(),
                    "componentCount": context.component_count,
                    "oddEndpointCount": context.odd_endpoint_count,
                    "minimumRouteCount": len(context.routes),
                    "routePointCount": context.route_point_count,
                    "doubledOrReversedEdgeCount": context.duplicate_atomic_edge_count,
                    "properCrossingCount": context.proper_crossing_count,
                },
                "policies": {
                    "context": "routes, never waypoints or tracks",
                    "contextSimplification": "per-source-segment spherical cross-track Douglas-Peucker",
                    "contextJoin": "exact source segment endpoints only",
                    "contextRetracing": "none",
                    "trackConstruction": "unchanged Pilot C exact-coordinate walks",
                    "telemetry": "elevation, time, and extensions omitted",
                    "serialization": "compact XML; GPX routes precede tracks",
                    "rideMemory": "tracks and routes share the validated 72,500-point RIDE memory",
                },
                "invariants": {
                    "context": context_invariants,
                    "trackBaseline": baseline_invariants,
                    "tracks": track_invariants,
                    "combinedWaypointCountIsZero": combined["waypointCount"] == 0,
                    "combinedRoutesBeforeTracks": combined["schemaOrderValid"],
                    "combinedWithinSharedRidePointLimit": (
                        combined["combinedNavigationPointCount"] <= MAX_TRACK_POINTS
                    ),
                },
                "variants": {
                    "trackBaseline": track_baseline,
                    "routeOnly": route_only,
                    "combined": combined,
                },
                "sharedRideMemory": {
                    "limit": MAX_TRACK_POINTS,
                    "trackPoints": combined["trackPointCount"],
                    "routePoints": combined["routePointCount"],
                    "combinedPoints": combined["combinedNavigationPointCount"],
                    "headroom": combined["sharedRidePointHeadroom"],
                },
                "sourceTrailIds": [item["trail_id"] for item in catalog],
                "sourceSegments": source_segment_records,
                "duplicatedTrackPaths": duplicate_records,
            }
            write_pilot_d_readme(
                staging / f"{slug}-voyager-pilot-d-README.txt",
                area["name"],
                context,
                track_baseline,
                route_only,
                combined,
            )
            variant = combined

        write_json_atomic(staging / manifest_name, manifest_document)
        publish_staged_bundle(
            staging,
            output,
            manifest_name,
            area["id"],
            purpose,
        )
    finally:
        if staging.exists():
            shutil.rmtree(staging)

    print(json.dumps(manifest_document["area"], indent=2))
    print(json.dumps(track_topology, indent=2))
    if is_pilot_d:
        print(json.dumps(manifest_document["stateContext"], indent=2))
        print(
            f"{track_baseline['file']}: {track_baseline['trackCount']} tracks, "
            f"{track_baseline['trackPointCount']:,} track points"
        )
        print(
            f"{route_only['file']}: {route_only['routeCount']} routes, "
            f"{route_only['routePointCount']:,} route points"
        )
        print(
            f"{variant['file']}: {variant['trackCount']} tracks / "
            f"{variant['trackPointCount']:,} track points + "
            f"{variant['routeCount']} routes / {variant['routePointCount']:,} route points"
        )
    else:
        print(
            f"{variant['file']}: {variant['trackCount']} tracks, "
            f"{variant['pointCount']:,} points, {variant['bytes'] / (1024 * 1024):.2f} MiB"
        )
    print(f"Wrote {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
