#!/usr/bin/env python3
"""Deterministic Trail Tech Voyager GPX packaging primitives.

The production packager treats each canonical GPX segment as source geometry,
nodes only exact decimal-coordinate junctions, and emits continuous graph walks.
When a graph has more walks than the configured device budget, the only added
geometry is a recorded retraversal of existing atomic edges.  This module never
writes to the canonical trails database.
"""

from __future__ import annotations

from collections import Counter, defaultdict, deque
from dataclasses import dataclass
from decimal import Decimal
import hashlib
import json
import math
import os
from pathlib import Path
import re
import xml.etree.ElementTree as ET


GPX_NS = "http://www.topografix.com/GPX/1/1"
XSI_NS = "http://www.w3.org/2001/XMLSchema-instance"
SCHEMA_LOCATION = f"{GPX_NS} http://www.topografix.com/GPX/1/1/gpx.xsd"

MAX_TRACKS = 300
MAX_TRACK_POINTS = 72_500
MAX_ROUTES = 300
MAX_ROUTE_POINTS = 72_500
CONTEXT_TRACK_RESERVE = 70
CONTEXT_TRACK_POINT_RESERVE = 1_260
AREA_TRACK_SLOT_HEADROOM = 10
AREA_MAX_TRACKS = MAX_TRACKS - AREA_TRACK_SLOT_HEADROOM
AREA_MAX_ROUTES = MAX_ROUTES
AREA_MAX_PATHS = AREA_MAX_TRACKS + AREA_MAX_ROUTES
AREA_MAX_TRACK_POINTS = MAX_TRACK_POINTS
MAX_DEVICE_NAME_LENGTH = 12

ET.register_namespace("", GPX_NS)
ET.register_namespace("xsi", XSI_NS)


class CapacityError(RuntimeError):
    """The geometry is valid but does not fit the requested pool/path budget."""


class PermanentCapacityError(CapacityError):
    """Lowering the graph-walk target cannot improve this capacity failure."""


def qname(name: str) -> str:
    return f"{{{GPX_NS}}}{name}"


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_database_file(database: Path, relative_path: str) -> Path:
    database = database.resolve()
    candidate = (database / Path(relative_path.replace("/", os.sep))).resolve()
    try:
        candidate.relative_to(database)
    except ValueError as error:
        raise RuntimeError(f"Unsafe database path: {relative_path}") from error
    if not candidate.is_file():
        raise RuntimeError(f"Missing database file: {relative_path}")
    return candidate


@dataclass(frozen=True)
class Point:
    latitude: str
    longitude: str

    @property
    def key(self) -> tuple[Decimal, Decimal]:
        return (Decimal(self.longitude), Decimal(self.latitude))


@dataclass(frozen=True)
class SourceSegment:
    trail_id: str
    segment_index: int
    node_ids: tuple[int, ...]
    source_edge_ids: tuple[int, ...]


@dataclass(frozen=True)
class SourceFileSnapshot:
    trail_id: str
    relative_path: str
    sha256: str


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


@dataclass(frozen=True)
class SourceGraph:
    nodes: tuple[Point, ...]
    source_edges: tuple[Edge, ...]
    source_segments: tuple[SourceSegment, ...]
    source_files: tuple[SourceFileSnapshot, ...]
    adjacency: tuple[tuple[int, ...], ...]
    representative_edge: dict[tuple[int, int], int]
    components: tuple[Component, ...]

    @property
    def minimum_walk_count(self) -> int:
        return sum(max(1, len(component.odd_node_ids) // 2) for component in self.components)


@dataclass(frozen=True)
class PoolAllocation:
    routes: tuple[Walk, ...]
    tracks: tuple[Walk, ...]
    route_point_count: int
    track_point_count: int


def checked_coordinate(value: str | None, source: Path, label: str) -> str:
    if value is None:
        raise RuntimeError(f"Missing {label} in {source}")
    try:
        number = float(value)
    except ValueError as error:
        raise RuntimeError(f"Invalid {label} in {source}") from error
    if not math.isfinite(number):
        raise RuntimeError(f"Non-finite {label} in {source}")
    if label == "latitude" and not -90 <= number <= 90:
        raise RuntimeError(f"Out-of-range latitude in {source}")
    if label == "longitude" and not -180 <= number <= 180:
        raise RuntimeError(f"Out-of-range longitude in {source}")
    return value


def undirected_pair(left: int, right: int) -> tuple[int, int]:
    return (left, right) if left <= right else (right, left)


def load_source_graph(database: Path, catalog: list[dict]) -> SourceGraph:
    """Load one semantic target into an exact-coordinate multigraph."""

    node_id_by_coordinate: dict[tuple[Decimal, Decimal], int] = {}
    nodes: list[Point] = []
    edges: list[Edge] = []
    segments: list[SourceSegment] = []
    source_files: list[SourceFileSnapshot] = []

    def node_id_for(point: Point) -> int:
        node_id = node_id_by_coordinate.get(point.key)
        if node_id is None:
            node_id = len(nodes)
            node_id_by_coordinate[point.key] = node_id
            nodes.append(point)
        return node_id

    seen_trail_ids: set[str] = set()
    for item in sorted(catalog, key=lambda row: row["trail_id"]):
        trail_id = item["trail_id"]
        if trail_id in seen_trail_ids:
            raise RuntimeError(f"Duplicate target trail ID: {trail_id}")
        seen_trail_ids.add(trail_id)
        relative_path = item["gpx_path"].replace("\\", "/")
        source_path = resolve_database_file(database, relative_path)
        source_bytes = source_path.read_bytes()
        try:
            root = ET.fromstring(source_bytes)
        except ET.ParseError as error:
            raise RuntimeError(f"Invalid canonical GPX: {source_path}") from error
        source_files.append(
            SourceFileSnapshot(
                trail_id=trail_id,
                relative_path=relative_path,
                sha256=hashlib.sha256(source_bytes).hexdigest(),
            )
        )
        if root.tag != qname("gpx") or root.get("version") != "1.1":
            raise RuntimeError(f"Expected namespaced GPX 1.1 source: {source_path}")

        segment_index = 0
        for track in root.findall(qname("trk")):
            for segment_node in track.findall(qname("trkseg")):
                node_ids: list[int] = []
                for point_node in segment_node.findall(qname("trkpt")):
                    latitude = checked_coordinate(
                        point_node.get("lat"), source_path, "latitude"
                    )
                    longitude = checked_coordinate(
                        point_node.get("lon"), source_path, "longitude"
                    )
                    node_ids.append(node_id_for(Point(latitude, longitude)))
                if len(node_ids) < 2:
                    raise RuntimeError(f"Unusable track segment in {source_path}")

                source_edge_ids: list[int] = []
                for left, right in zip(node_ids, node_ids[1:]):
                    if left == right:
                        raise RuntimeError(f"Zero-length source edge in {source_path}")
                    edge_id = len(edges)
                    edges.append(Edge(edge_id, left, right, "source", edge_id))
                    source_edge_ids.append(edge_id)
                segments.append(
                    SourceSegment(
                        trail_id=trail_id,
                        segment_index=segment_index,
                        node_ids=tuple(node_ids),
                        source_edge_ids=tuple(source_edge_ids),
                    )
                )
                segment_index += 1
        if segment_index == 0:
            raise RuntimeError(f"No track segments in {source_path}")

    if not segments:
        raise RuntimeError("Target catalog contains no source segments.")
    adjacency, representative_edge, components = graph_topology(len(nodes), edges)
    return SourceGraph(
        nodes=tuple(nodes),
        source_edges=tuple(edges),
        source_segments=tuple(segments),
        source_files=tuple(source_files),
        adjacency=tuple(adjacency),
        representative_edge=representative_edge,
        components=tuple(components),
    )


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
        members: list[int] = []
        while queue:
            node_id = queue.popleft()
            members.append(node_id)
            for neighbor in adjacency[node_id]:
                if component_of_node[neighbor] == -1:
                    component_of_node[neighbor] = component_id
                    queue.append(neighbor)
        component_nodes.append(sorted(members))

    edges_by_component: list[list[int]] = [[] for _ in component_nodes]
    for edge in source_edges:
        component_id = component_of_node[edge.left]
        if component_id != component_of_node[edge.right]:
            raise RuntimeError("Source edge crosses computed graph components.")
        edges_by_component[component_id].append(edge.edge_id)

    components = [
        Component(
            component_id=index,
            node_ids=tuple(members),
            source_edge_ids=tuple(edges_by_component[index]),
            odd_node_ids=tuple(node for node in members if degree[node] % 2),
        )
        for index, members in enumerate(component_nodes)
        if edges_by_component[index]
    ]
    return adjacency, representative_edge, components


def odd_pair_candidates(
    adjacency: tuple[tuple[int, ...], ...],
    components: tuple[Component, ...],
) -> list[tuple[int, int, int, int]]:
    """Return deterministic shortest-path candidates measured in device points."""

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
    graph: SourceGraph,
    target_walks: int,
) -> tuple[list[tuple[int, int, int, int]], int]:
    minimum_walks = graph.minimum_walk_count
    if minimum_walks <= target_walks:
        return [], minimum_walks
    if len(graph.components) > target_walks:
        raise RuntimeError(
            f"Target has {len(graph.components):,} disconnected components and cannot "
            f"fit {target_walks:,} paths without fabricated connectors."
        )

    required_pairs = minimum_walks - target_walks
    maximum_reduction = sum(
        max(0, len(component.odd_node_ids) // 2 - 1)
        for component in graph.components
    )
    if required_pairs > maximum_reduction:
        raise RuntimeError(
            f"Cannot reduce {minimum_walks:,} walks to {target_walks:,} without "
            "fabricated connectors."
        )

    unmatched = {
        node_id
        for component in graph.components
        for node_id in component.odd_node_ids
    }
    selected_by_component: Counter[int] = Counter()
    maximum_by_component = {
        component.component_id: max(0, len(component.odd_node_ids) // 2 - 1)
        for component in graph.components
    }
    selected: list[tuple[int, int, int, int]] = []
    for candidate in odd_pair_candidates(graph.adjacency, graph.components):
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
            f"Selected only {len(selected):,} of {required_pairs:,} required odd pairs."
        )
    return selected, minimum_walks


def shortest_path(
    adjacency: tuple[tuple[int, ...], ...],
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
    result = [target]
    while result[-1] != start:
        result.append(parents[result[-1]])
    result.reverse()
    return result


def add_duplicate_paths(
    graph: SourceGraph,
    selected_pairs: list[tuple[int, int, int, int]],
) -> tuple[list[Edge], list[dict]]:
    real_edges = list(graph.source_edges)
    records: list[dict] = []
    for pair_index, (distance, component_id, left, right) in enumerate(
        selected_pairs, start=1
    ):
        node_path = shortest_path(graph.adjacency, left, right)
        source_edge_ids: list[int] = []
        for start, end in zip(node_path, node_path[1:]):
            source_edge_id = graph.representative_edge[undirected_pair(start, end)]
            edge_id = len(real_edges)
            real_edges.append(Edge(edge_id, start, end, "duplicate", source_edge_id))
            source_edge_ids.append(source_edge_id)
        if len(source_edge_ids) != distance:
            raise RuntimeError("Odd-pair distance changed during path reconstruction.")
        records.append(
            {
                "index": pair_index,
                "component": component_id,
                "leftNode": left,
                "rightNode": right,
                "sourceEdgeIds": source_edge_ids,
            }
        )
    return real_edges, records


def edge_other_end(edge: Edge, node_id: int) -> int:
    if node_id == edge.left:
        return edge.right
    if node_id == edge.right:
        return edge.left
    raise RuntimeError("Traversal node is not incident to its edge.")


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
    graph: SourceGraph,
    real_edges: list[Edge],
    target_walks: int,
) -> tuple[list[Walk], list[Edge]]:
    all_edges = list(real_edges)
    component_of_node: dict[int, int] = {}
    for component in graph.components:
        for node_id in component.node_ids:
            component_of_node[node_id] = component.component_id

    real_by_component: list[list[int]] = [[] for _ in graph.components]
    for edge in real_edges:
        component_id = component_of_node[edge.left]
        if component_id != component_of_node[edge.right]:
            raise RuntimeError("Real edge crosses graph components.")
        real_by_component[component_id].append(edge.edge_id)

    walks: list[Walk] = []
    for component in graph.components:
        degree: Counter[int] = Counter()
        for edge_id in real_by_component[component.component_id]:
            edge = all_edges[edge_id]
            degree[edge.left] += 1
            degree[edge.right] += 1
        odd_nodes = sorted(node for node, value in degree.items() if value % 2)

        virtual_edge_ids: set[int] = set()
        for left, right in zip(odd_nodes[::2], odd_nodes[1::2], strict=True):
            edge_id = len(all_edges)
            all_edges.append(Edge(edge_id, left, right, "virtual", None))
            virtual_edge_ids.add(edge_id)

        component_edge_ids = (
            real_by_component[component.component_id] + sorted(virtual_edge_ids)
        )
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
            raise RuntimeError("Euler traversal missed component edges.")
        circuit = list(reversed(reverse_circuit))
        for previous, current in zip(circuit, circuit[1:]):
            if previous.end != current.start:
                raise RuntimeError("Euler circuit is discontinuous.")
        if circuit and circuit[-1].end != circuit[0].start:
            raise RuntimeError("Augmented Euler circuit did not close.")
        walks.extend(split_euler_circuit(circuit, virtual_edge_ids, component.component_id))

    walks.sort(
        key=lambda walk: (
            walk.component_id,
            walk.steps[0].start,
            walk.steps[0].end,
            walk.steps[0].edge_id,
        )
    )
    if len(walks) != target_walks:
        raise RuntimeError(f"Expected {target_walks:,} walks, built {len(walks):,}.")
    expected_real_ids = {edge.edge_id for edge in real_edges}
    traversal = Counter(step.edge_id for walk in walks for step in walk.steps)
    if traversal != Counter({edge_id: 1 for edge_id in expected_real_ids}):
        raise RuntimeError("Real-edge traversal is not exactly once per augmented edge.")
    if any(all_edges[step.edge_id].kind == "virtual" for walk in walks for step in walk.steps):
        raise RuntimeError("Virtual connector escaped into output geometry.")
    return walks, all_edges


def walk_node_ids(walk: Walk) -> tuple[int, ...]:
    if not walk.steps:
        raise RuntimeError("Empty walk generated.")
    node_ids = [walk.steps[0].start]
    for previous, current in zip(walk.steps, walk.steps[1:]):
        if previous.end != current.start:
            raise RuntimeError("Output walk is discontinuous.")
    node_ids.extend(step.end for step in walk.steps)
    return tuple(node_ids)


def walk_signature(walk: Walk, edges: list[Edge]) -> str:
    digest = hashlib.sha256()
    for step in walk.steps:
        edge = edges[step.edge_id]
        digest.update(str(edge.source_edge_id).encode("ascii"))
        digest.update(b":" + (b"1" if (step.start, step.end) == (edge.left, edge.right) else b"0"))
        digest.update(b";")
    return digest.hexdigest()


def split_walk_at(walk: Walk, split_at: int) -> tuple[Walk, Walk]:
    """Split at an existing vertex without duplicating or inventing an edge."""

    if not 0 < split_at < len(walk.steps):
        raise RuntimeError("A two-point walk cannot be split further.")
    return (
        Walk(walk.component_id, walk.steps[:split_at]),
        Walk(walk.component_id, walk.steps[split_at:]),
    )


def split_walk(walk: Walk) -> tuple[Walk, Walk]:
    return split_walk_at(walk, len(walk.steps) // 2)


def _greedy_assignment(
    walks: list[Walk],
    all_edges: list[Edge],
    track_quota: int,
) -> PoolAllocation | None:
    count = len(walks)
    route_quota = count - track_quota
    ranked = sorted(
        walks,
        key=lambda walk: (
            -walk.point_count,
            walk.component_id,
            walk_signature(walk, all_edges),
        ),
    )
    route_members: set[Walk] = set()
    track_members: set[Walk] = set()
    route_points = 0
    track_points = 0
    for position, walk in enumerate(ranked):
        remaining = count - position
        routes_left = route_quota - len(route_members)
        tracks_left = track_quota - len(track_members)
        if routes_left == remaining:
            pool = "route"
        elif tracks_left == remaining:
            pool = "track"
        elif routes_left == 0:
            pool = "track"
        elif tracks_left == 0:
            pool = "route"
        else:
            route_load = route_points * MAX_TRACK_POINTS
            track_load = track_points * MAX_ROUTE_POINTS
            pool = "route" if route_load <= track_load else "track"
        if pool == "route":
            route_members.add(walk)
            route_points += walk.point_count
        else:
            track_members.add(walk)
            track_points += walk.point_count

    if route_points > MAX_ROUTE_POINTS or track_points > AREA_MAX_TRACK_POINTS:
        return None
    routes = tuple(walk for walk in walks if walk in route_members)
    tracks = tuple(walk for walk in walks if walk in track_members)
    return PoolAllocation(routes, tracks, route_points, track_points)


def _reachable_bitsets(weights: list[int], max_count: int, max_sum: int) -> list[int]:
    mask = (1 << (max_sum + 1)) - 1
    reachable = [0] * (max_count + 1)
    reachable[0] = 1
    for index, weight in enumerate(weights, start=1):
        for count in range(min(index, max_count), 0, -1):
            reachable[count] |= (reachable[count - 1] << weight) & mask
    return reachable


def _nearest_reachable_sum(bits: int, low: int, high: int, target: int) -> int | None:
    if low > high:
        return None
    width = high - low + 1
    window = (bits >> low) & ((1 << width) - 1)
    if not window:
        return None
    target = min(high, max(low, target)) - low
    lower_mask = window & ((1 << (target + 1)) - 1)
    lower = lower_mask.bit_length() - 1 if lower_mask else None
    upper_window = window >> target
    upper = (
        target + ((upper_window & -upper_window).bit_length() - 1)
        if upper_window
        else None
    )
    if lower is None:
        chosen = upper
    elif upper is None:
        chosen = lower
    elif target - lower <= upper - target:
        chosen = lower
    else:
        chosen = upper
    assert chosen is not None
    return low + chosen


def _reconstruct_subset(
    indexed_weights: list[tuple[int, int]],
    count: int,
    target_sum: int,
) -> set[int]:
    """Reconstruct one deterministic exact subset with divide-and-conquer DP."""

    if count == 0:
        if target_sum != 0:
            raise RuntimeError("Subset reconstruction reached an impossible empty sum.")
        return set()
    if len(indexed_weights) == 1:
        index, weight = indexed_weights[0]
        if count == 1 and weight == target_sum:
            return {index}
        raise RuntimeError("Subset reconstruction reached an impossible leaf.")

    middle = len(indexed_weights) // 2
    left = indexed_weights[:middle]
    right = indexed_weights[middle:]
    left_max_count = min(count, len(left))
    right_max_count = min(count, len(right))
    left_dp = _reachable_bitsets(
        [weight for _index, weight in left], left_max_count, target_sum
    )
    right_dp = _reachable_bitsets(
        [weight for _index, weight in right], right_max_count, target_sum
    )
    low_left_count = max(0, count - len(right))
    high_left_count = min(count, len(left))
    for left_count in range(low_left_count, high_left_count + 1):
        right_count = count - left_count
        left_bits = left_dp[left_count]
        right_bits = right_dp[right_count]
        candidates = left_bits & ((1 << (target_sum + 1)) - 1)
        while candidates:
            lowest = candidates & -candidates
            left_sum = lowest.bit_length() - 1
            if (right_bits >> (target_sum - left_sum)) & 1:
                return _reconstruct_subset(
                    left, left_count, left_sum
                ) | _reconstruct_subset(
                    right, right_count, target_sum - left_sum
                )
            candidates ^= lowest
    raise RuntimeError("Exact pool subset could not be reconstructed.")


def _exact_assignment(walks: list[Walk]) -> set[int] | None:
    """Return exact track-member indices, preferring as many tracks as possible."""

    count = len(walks)
    weights = [walk.point_count for walk in walks]
    total_points = sum(weights)
    minimum_tracks = max(0, count - AREA_MAX_ROUTES)
    maximum_tracks = min(count, AREA_MAX_TRACKS)
    low_points = max(0, total_points - MAX_ROUTE_POINTS)
    high_points = min(AREA_MAX_TRACK_POINTS, total_points)
    if low_points > high_points:
        return None
    reachable = _reachable_bitsets(weights, maximum_tracks, high_points)
    desired_points = max(low_points, min(high_points, total_points // 2))
    for track_count in range(maximum_tracks, minimum_tracks - 1, -1):
        track_sum = _nearest_reachable_sum(
            reachable[track_count], low_points, high_points, desired_points
        )
        if track_sum is None:
            continue
        return _reconstruct_subset(
            list(enumerate(weights)), track_count, track_sum
        )
    return None


def allocate_pools(walks: list[Walk], all_edges: list[Edge]) -> PoolAllocation:
    """Assign paths with a fast rider-first path and an exact capacity fallback."""

    normalized = list(walks)
    while any(walk.point_count > MAX_ROUTE_POINTS for walk in normalized):
        if len(normalized) >= AREA_MAX_PATHS:
            raise CapacityError(
                "An overlong walk cannot be split within the path-count limit."
            )
        index = max(
            (position for position, walk in enumerate(normalized) if walk.point_count > MAX_ROUTE_POINTS),
            key=lambda position: (normalized[position].point_count, -position),
        )
        left, right = split_walk(normalized[index])
        normalized[index : index + 1] = [left, right]

    while True:
        count = len(normalized)
        if count > AREA_MAX_PATHS:
            raise CapacityError(
                f"Area has {count:,} paths; device limit is {AREA_MAX_PATHS:,}."
            )
        if sum(walk.point_count for walk in normalized) > (
            AREA_MAX_TRACK_POINTS + MAX_ROUTE_POINTS
        ):
            raise PermanentCapacityError(
                "Area point geometry exceeds the two independent point pools."
            )
        preferred_track_count = min(count, AREA_MAX_TRACKS)
        greedy = _greedy_assignment(
            normalized, all_edges, preferred_track_count
        )
        if greedy is not None:
            return greedy

        exact_tracks = _exact_assignment(normalized)
        if exact_tracks is not None:
            tracks = tuple(
                walk for index, walk in enumerate(normalized) if index in exact_tracks
            )
            routes = tuple(
                walk for index, walk in enumerate(normalized) if index not in exact_tracks
            )
            track_points = sum(walk.point_count for walk in tracks)
            route_points = sum(walk.point_count for walk in routes)
            return PoolAllocation(routes, tracks, route_points, track_points)

        if len(normalized) >= AREA_MAX_PATHS:
            raise CapacityError(
                f"No feasible independent-pool partition exists within {AREA_MAX_PATHS} paths."
            )
        splittable = [
            (walk.point_count, -position, position)
            for position, walk in enumerate(normalized)
            if len(walk.steps) >= 2
        ]
        if not splittable:
            raise CapacityError("No feasible pool partition and no walk can be split.")

        # Try capacity-shaped cuts before falling back to a midpoint. Each cut
        # reuses an existing vertex and is accepted only when exact DP proves
        # the resulting two-pool partition feasible.
        split_applied = False
        total_points = sum(walk.point_count for walk in normalized)
        desired_track_points = max(
            2,
            min(
                AREA_MAX_TRACK_POINTS,
                total_points // 2,
            ),
        )
        for _points, _tie, index in sorted(splittable, reverse=True):
            walk = normalized[index]
            step_count = len(walk.steps)
            candidate_points = {
                walk.point_count // 2,
                AREA_MAX_TRACK_POINTS,
                MAX_ROUTE_POINTS,
                desired_track_points,
                max(2, total_points - MAX_ROUTE_POINTS),
            }
            cuts = sorted(
                {
                    point_count - 1
                    for point_count in candidate_points
                    if 1 < point_count < walk.point_count
                    and 0 < point_count - 1 < step_count
                },
                key=lambda cut: (abs(cut - step_count // 2), cut),
            )
            for cut in cuts:
                left, right = split_walk_at(walk, cut)
                trial = normalized[:index] + [left, right] + normalized[index + 1 :]
                if _exact_assignment(trial) is not None:
                    normalized = trial
                    split_applied = True
                    break
            if split_applied:
                break
        if not split_applied:
            _points, _tie, index = max(splittable)
            left, right = split_walk(normalized[index])
            normalized[index : index + 1] = [left, right]


def path_name(kind: str, index: int, label: str) -> str:
    value = f"{kind}{index:03d} {label}"
    if len(value) > MAX_DEVICE_NAME_LENGTH:
        raise RuntimeError(f"Device path name exceeds {MAX_DEVICE_NAME_LENGTH}: {value}")
    return value


def root_node() -> ET.Element:
    return ET.Element(
        qname("gpx"),
        {
            "version": "1.1",
            "creator": "Bob's Motorcycle Trails",
            f"{{{XSI_NS}}}schemaLocation": SCHEMA_LOCATION,
        },
    )


def write_compact_tree(path: Path, root: ET.Element) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    ET.ElementTree(root).write(
        temporary,
        encoding="utf-8",
        xml_declaration=True,
        short_empty_elements=False,
    )
    os.replace(temporary, path)


def write_area_gpx(
    path: Path,
    device_code: str,
    allocation: PoolAllocation,
    nodes: tuple[Point, ...],
) -> None:
    root = root_node()
    if not re.fullmatch(r"[A-Z0-9]{7}", device_code):
        raise RuntimeError(f"Invalid seven-character device code: {device_code}")
    for index, walk in enumerate(allocation.routes, start=1):
        route = ET.SubElement(root, qname("rte"))
        ET.SubElement(route, qname("name")).text = path_name("R", index, device_code)
        for node_id in walk_node_ids(walk):
            point = nodes[node_id]
            ET.SubElement(
                route,
                qname("rtept"),
                {"lat": point.latitude, "lon": point.longitude},
            )
    for index, walk in enumerate(allocation.tracks, start=1):
        track = ET.SubElement(root, qname("trk"))
        ET.SubElement(track, qname("name")).text = path_name("T", index, device_code)
        segment = ET.SubElement(track, qname("trkseg"))
        for node_id in walk_node_ids(walk):
            point = nodes[node_id]
            ET.SubElement(
                segment,
                qname("trkpt"),
                {"lat": point.latitude, "lon": point.longitude},
            )
    write_compact_tree(path, root)


def write_context_track_gpx(path: Path, routes: tuple[object, ...]) -> None:
    """Write the approved state-border route decomposition as standalone tracks."""

    root = root_node()
    for index, route in enumerate(routes, start=1):
        track = ET.SubElement(root, qname("trk"))
        ET.SubElement(track, qname("name")).text = path_name("S", index, "STATE")
        segment = ET.SubElement(track, qname("trkseg"))
        for point in route.points:
            ET.SubElement(
                segment,
                qname("trkpt"),
                {"lat": point.latitude, "lon": point.longitude},
            )
    write_compact_tree(path, root)


def validate_context_track_output(path: Path, context: object) -> dict:
    counts, routes, tracks = output_sequences(path)
    if routes or counts["routeCount"] or counts["routePointCount"]:
        raise RuntimeError("USA context add-on must contain tracks only.")
    expected = [
        tuple((point.latitude, point.longitude) for point in route.points)
        for route in context.routes
    ]
    if tracks != expected:
        raise RuntimeError("USA context track coordinates/order changed during serialization.")
    if counts["trackCount"] != CONTEXT_TRACK_RESERVE:
        raise RuntimeError(
            f"Expected {CONTEXT_TRACK_RESERVE} context tracks; found {counts['trackCount']}."
        )
    if counts["trackPointCount"] != CONTEXT_TRACK_POINT_RESERVE:
        raise RuntimeError(
            f"Expected {CONTEXT_TRACK_POINT_RESERVE:,} context points; "
            f"found {counts['trackPointCount']:,}."
        )
    return {
        **counts,
        "file": path.name,
        "bytes": path.stat().st_size,
        "sha256": sha256_file(path),
    }


def output_sequences(path: Path) -> tuple[dict, list[tuple[tuple[str, str], ...]], list[tuple[tuple[str, str], ...]]]:
    source_text = path.read_text(encoding="utf-8")
    editorial_markers = (
        "<!--",
        "<metadata",
        "<desc",
        "<cmt",
        "<link",
        "<sym",
        "<type",
        "codex",
        "chatgpt",
        "openai",
        "ai-generated",
        "generated by ai",
    )
    lowered_source = source_text.casefold()
    found_markers = [marker for marker in editorial_markers if marker in lowered_source]
    if found_markers:
        raise RuntimeError(
            f"Output GPX contains editorial or internal metadata {found_markers}: {path}"
        )

    root = ET.parse(path).getroot()
    if root.tag != qname("gpx") or root.get("version") != "1.1":
        raise RuntimeError(f"Expected namespaced GPX 1.1 output: {path}")
    if root.get("creator") != "Bob's Motorcycle Trails":
        raise RuntimeError(f"Unexpected GPX creator: {path}")
    child_order = {"rte": 0, "trk": 1}
    ranks = [child_order.get(local_name(child.tag), 99) for child in root]
    if 99 in ranks or ranks != sorted(ranks):
        raise RuntimeError(f"GPX 1.1 child order violation: {path}")

    element_counts = Counter(local_name(element.tag) for element in root.iter())
    forbidden = sum(element_counts[name] for name in ("wpt", "ele", "time", "extensions"))
    if forbidden:
        raise RuntimeError(f"Output retained waypoint/telemetry elements: {path}")

    names: list[str] = []
    routes: list[tuple[tuple[str, str], ...]] = []
    for route in root.findall(qname("rte")):
        name_node = route.find(qname("name"))
        name = name_node.text.strip() if name_node is not None and name_node.text else ""
        names.append(name)
        points = tuple(
            (
                checked_coordinate(node.get("lat"), path, "latitude"),
                checked_coordinate(node.get("lon"), path, "longitude"),
            )
            for node in route.findall(qname("rtept"))
        )
        if len(points) < 2:
            raise RuntimeError(f"Output route has fewer than two points: {path}")
        routes.append(points)

    tracks: list[tuple[tuple[str, str], ...]] = []
    for track in root.findall(qname("trk")):
        name_node = track.find(qname("name"))
        name = name_node.text.strip() if name_node is not None and name_node.text else ""
        names.append(name)
        segments = track.findall(qname("trkseg"))
        if len(segments) != 1:
            raise RuntimeError(f"Every output track must contain one segment: {path}")
        points = tuple(
            (
                checked_coordinate(node.get("lat"), path, "latitude"),
                checked_coordinate(node.get("lon"), path, "longitude"),
            )
            for node in segments[0].findall(qname("trkpt"))
        )
        if len(points) < 2:
            raise RuntimeError(f"Output track has fewer than two points: {path}")
        tracks.append(points)

    if any(not name or len(name) > MAX_DEVICE_NAME_LENGTH for name in names):
        raise RuntimeError(f"Missing or oversized device path name: {path}")
    if len(names) != len(set(name[:MAX_DEVICE_NAME_LENGTH] for name in names)):
        raise RuntimeError(f"Device path names collide after truncation: {path}")
    counts = {
        "waypointCount": element_counts["wpt"],
        "routeCount": len(routes),
        "routePointCount": sum(len(points) for points in routes),
        "trackCount": len(tracks),
        "trackPointCount": sum(len(points) for points in tracks),
        "elevationCount": element_counts["ele"],
        "timeCount": element_counts["time"],
        "extensionsCount": element_counts["extensions"],
    }
    return counts, routes, tracks


def expected_sequence(walk: Walk, nodes: tuple[Point, ...]) -> tuple[tuple[str, str], ...]:
    return tuple(
        (nodes[node_id].latitude, nodes[node_id].longitude)
        for node_id in walk_node_ids(walk)
    )


def bounds(nodes: tuple[Point, ...]) -> list[float]:
    return [
        min(float(point.longitude) for point in nodes),
        min(float(point.latitude) for point in nodes),
        max(float(point.longitude) for point in nodes),
        max(float(point.latitude) for point in nodes),
    ]


def graph_signature(graph: SourceGraph) -> str:
    def numeric_text(value: str) -> str:
        number = Decimal(value)
        if number == 0:
            number = Decimal(0)
        return format(number.normalize(), "f")

    digest = hashlib.sha256()
    for segment in graph.source_segments:
        digest.update(segment.trail_id.encode("utf-8"))
        digest.update(b"\0" + str(segment.segment_index).encode("ascii") + b"\0")
        for node_id in segment.node_ids:
            point = graph.nodes[node_id]
            digest.update(numeric_text(point.latitude).encode("utf-8"))
            digest.update(b"," + numeric_text(point.longitude).encode("utf-8") + b";")
    return digest.hexdigest()


def validate_area_output(
    path: Path,
    graph: SourceGraph,
    real_edges: list[Edge],
    all_edges: list[Edge],
    allocation: PoolAllocation,
) -> dict:
    counts, routes, tracks = output_sequences(path)
    expected_routes = [expected_sequence(walk, graph.nodes) for walk in allocation.routes]
    expected_tracks = [expected_sequence(walk, graph.nodes) for walk in allocation.tracks]
    if routes != expected_routes or tracks != expected_tracks:
        raise RuntimeError(f"Output coordinate/order mismatch: {path}")
    if counts["trackCount"] > AREA_MAX_TRACKS or counts["routeCount"] > AREA_MAX_ROUTES:
        raise RuntimeError(f"Output exceeds device path counts: {path}")
    if counts["trackPointCount"] > MAX_TRACK_POINTS:
        raise RuntimeError(f"Output track-point pool exceeds capacity: {path}")
    if counts["routePointCount"] > MAX_ROUTE_POINTS:
        raise RuntimeError(f"Output route-point pool exceeds capacity: {path}")

    source_ids = {edge.edge_id for edge in graph.source_edges}
    duplicate_ids = {edge.edge_id for edge in real_edges if edge.kind == "duplicate"}
    walks = allocation.routes + allocation.tracks
    traversed = Counter(step.edge_id for walk in walks for step in walk.steps)
    if traversed != Counter({edge_id: 1 for edge_id in source_ids | duplicate_ids}):
        raise RuntimeError(f"Source/retrace edge accounting failed: {path}")
    for edge_id in duplicate_ids:
        duplicate = real_edges[edge_id]
        if duplicate.source_edge_id not in source_ids:
            raise RuntimeError("Retraced edge does not reference canonical source geometry.")
        source = graph.source_edges[duplicate.source_edge_id]
        if undirected_pair(duplicate.left, duplicate.right) != undirected_pair(source.left, source.right):
            raise RuntimeError("Retraced edge changed canonical source geometry.")
    if any(all_edges[step.edge_id].kind == "virtual" for walk in walks for step in walk.steps):
        raise RuntimeError("Fabricated virtual connector escaped into output.")

    return {
        **counts,
        "file": path.name,
        "bytes": path.stat().st_size,
        "sha256": sha256_file(path),
        "bounds": bounds(graph.nodes),
        "deviceHeadroom": {
            "trackSlots": MAX_TRACKS - counts["trackCount"],
            "trackPoints": MAX_TRACK_POINTS - counts["trackPointCount"],
            "routeSlots": MAX_ROUTES - counts["routeCount"],
            "routePoints": MAX_ROUTE_POINTS - counts["routePointCount"],
        },
    }


def build_area_pack(
    database: Path,
    target_id: str,
    target_name: str,
    target_kind: str,
    device_code: str,
    catalog: list[dict],
    output_path: Path,
) -> dict:
    graph = load_source_graph(database, catalog)
    if len(graph.components) > AREA_MAX_PATHS:
        raise PermanentCapacityError(
            f"Target {target_id} has {len(graph.components):,} disconnected components, "
            f"beyond the {AREA_MAX_PATHS:,}-path device limit."
        )
    no_retrace_point_floor = len(graph.source_edges) + graph.minimum_walk_count
    if no_retrace_point_floor > AREA_MAX_TRACK_POINTS + MAX_ROUTE_POINTS:
        raise PermanentCapacityError(
            f"Target {target_id} needs at least {no_retrace_point_floor:,} output "
            "points, beyond the two independent pools."
        )
    initial_target_walks = min(graph.minimum_walk_count, AREA_MAX_PATHS)
    minimum_target_walks = len(graph.components)
    capacity_error: CapacityError | None = None
    for target_walks in range(
        initial_target_walks, minimum_target_walks - 1, -1
    ):
        selected_pairs, minimum_walks = choose_duplicate_pairs(graph, target_walks)
        real_edges, duplicate_records = add_duplicate_paths(graph, selected_pairs)
        walks, all_edges = build_walks(graph, real_edges, target_walks)
        try:
            allocation = allocate_pools(walks, all_edges)
        except PermanentCapacityError:
            raise
        except CapacityError as error:
            capacity_error = error
            continue
        break
    else:
        assert capacity_error is not None
        raise CapacityError(
            f"Target {target_id} has no device-compatible graph/pool construction."
        ) from capacity_error
    write_area_gpx(output_path, device_code, allocation, graph.nodes)
    output = validate_area_output(
        output_path, graph, real_edges, all_edges, allocation
    )

    source_points = sum(len(segment.node_ids) for segment in graph.source_segments)
    duplicated_edges = len(real_edges) - len(graph.source_edges)
    final_walk_count = len(allocation.routes) + len(allocation.tracks)
    manifest = {
        "schemaVersion": 1,
        "target": {
            "id": target_id,
            "name": target_name,
            "kind": target_kind,
            "deviceCode": device_code,
        },
        "source": {
            "trailCount": len(catalog),
            "segmentCount": len(graph.source_segments),
            "pointCount": source_points,
            "atomicEdgeCount": len(graph.source_edges),
            "nodeCount": len(graph.nodes),
            "normalizedNumericGeometrySha256": graph_signature(graph),
            "trailIds": [row["trail_id"] for row in sorted(catalog, key=lambda row: row["trail_id"])],
            "files": [
                {
                    "trailId": snapshot.trail_id,
                    "path": snapshot.relative_path,
                    "sha256": snapshot.sha256,
                }
                for snapshot in graph.source_files
            ],
        },
        "topology": {
            "exactCoordinateNodeCount": len(graph.nodes),
            "connectedComponentCount": len(graph.components),
            "oddNodeCount": sum(len(component.odd_node_ids) for component in graph.components),
            "minimumWalkCountWithoutRetracing": minimum_walks,
            "graphWalkCountBeforeCapacitySplits": len(walks),
            "outputWalkCount": final_walk_count,
            "capacitySplitBoundaryPointCount": final_walk_count - len(walks),
            "pairedOddNodeCount": len(selected_pairs) * 2,
            "duplicatedExistingEdgeTraversalCount": duplicated_edges,
            "retracePercentOfSourceEdges": (
                duplicated_edges / len(graph.source_edges) * 100
            ),
        },
        "pools": {
            "areaLimits": {
                "tracks": AREA_MAX_TRACKS,
                "trackPoints": MAX_TRACK_POINTS,
                "routes": AREA_MAX_ROUTES,
                "routePoints": MAX_ROUTE_POINTS,
            },
            "trackCount": output["trackCount"],
            "trackPointCount": output["trackPointCount"],
            "routeCount": output["routeCount"],
            "routePointCount": output["routePointCount"],
        },
        "policies": {
            "joins": "exact decimal-coordinate junctions only",
            "retracing": "deterministic shortest-first paths over existing source edges only",
            "poolAssignment": "tracks-first with exact independent-pool capacity fallback",
            "capacitySplitting": "overlong walks split only at existing source vertices",
            "telemetry": "waypoints, elevation, time, and extensions omitted",
            "coordinates": (
                "exact numeric latitude/longitude values preserved; equivalent decimal "
                "spellings normalize to the first canonical occurrence"
            ),
        },
        "invariants": {
            "everySourceAtomicEdgeTraversedExactlyOnce": True,
            "everyRetracedAtomicEdgeReferencesSourceGeometry": True,
            "fabricatedConnectorEdges": 0,
            "sourceGeometryOmitted": False,
            "numericCoordinatesChanged": 0,
            "capacitySplitsOnlyAtExistingVertices": True,
            "waypointCount": 0,
            "telemetryElements": 0,
            "standaloneAreaPack": True,
            "optionalContextAddonBundled": False,
        },
        "output": output,
        "retracedPaths": duplicate_records,
    }
    return manifest


def write_json_atomic(path: Path, value: object) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    os.replace(temporary, path)
