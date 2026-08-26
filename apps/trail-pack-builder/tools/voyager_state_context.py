"""Sanitize and route a deduplicated state-context GPX for Voyager pilots."""

from __future__ import annotations

from collections import Counter, defaultdict, deque
from dataclasses import dataclass
from decimal import Decimal
import hashlib
import math
from pathlib import Path
import xml.etree.ElementTree as ET


GPX_NS = "http://www.topografix.com/GPX/1/1"
EARTH_RADIUS_METERS = 6_371_008.8
CoordinateKey = tuple[Decimal, Decimal]


def qname(name: str) -> str:
    return f"{{{GPX_NS}}}{name}"


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


@dataclass(frozen=True)
class ContextPoint:
    latitude: str
    longitude: str

    @property
    def key(self) -> CoordinateKey:
        return (Decimal(self.longitude), Decimal(self.latitude))


@dataclass(frozen=True)
class ContextSegment:
    index: int
    source_points: tuple[ContextPoint, ...]
    points: tuple[ContextPoint, ...]

    @property
    def start(self) -> CoordinateKey:
        return self.points[0].key

    @property
    def end(self) -> CoordinateKey:
        return self.points[-1].key


@dataclass(frozen=True)
class ContextStep:
    segment: ContextSegment
    reversed: bool

    @property
    def points(self) -> tuple[ContextPoint, ...]:
        return tuple(reversed(self.segment.points)) if self.reversed else self.segment.points


@dataclass(frozen=True)
class ContextRoute:
    steps: tuple[ContextStep, ...]

    @property
    def points(self) -> tuple[ContextPoint, ...]:
        result: list[ContextPoint] = []
        for step in self.steps:
            points = step.points
            if result:
                if result[-1].key != points[0].key:
                    raise RuntimeError("Context route contains a non-exact join.")
                result.extend(points[1:])
            else:
                result.extend(points)
        return tuple(result)


@dataclass(frozen=True)
class ContextBuild:
    source_path: Path
    source_sha256: str
    source_counts: dict
    tolerance_meters: float
    simplification_metric: str
    maximum_deviation_meters: float
    simplified_point_count: int
    removed_point_count: int
    component_count: int
    odd_endpoint_count: int
    routes: tuple[ContextRoute, ...]
    duplicate_atomic_edge_count: int
    proper_crossing_count: int

    @property
    def route_point_count(self) -> int:
        return sum(len(route.points) for route in self.routes)


def checked_coordinate(value: str, label: str, source: Path) -> float:
    try:
        number = float(value)
    except ValueError as error:
        raise RuntimeError(f"Invalid {label} in {source}") from error
    if not math.isfinite(number):
        raise RuntimeError(f"Non-finite {label} in {source}")
    return number


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_context_source(path: Path) -> tuple[list[tuple[ContextPoint, ...]], dict]:
    root = ET.parse(path).getroot()
    if root.tag != qname("gpx") or root.get("version") != "1.1":
        raise RuntimeError(f"Expected namespaced GPX 1.1 context source: {path}")

    element_counts = Counter(local_name(element.tag) for element in root.iter())
    source_routes = root.findall(qname("rte"))
    if source_routes:
        raise RuntimeError("State context source must use tracks, not pre-existing routes.")

    segments: list[tuple[ContextPoint, ...]] = []
    for track in root.findall(qname("trk")):
        for segment in track.findall(qname("trkseg")):
            points: list[ContextPoint] = []
            for node in segment.findall(qname("trkpt")):
                latitude = node.get("lat")
                longitude = node.get("lon")
                if latitude is None or longitude is None:
                    raise RuntimeError("Context track point is missing coordinates.")
                latitude_value = checked_coordinate(latitude, "latitude", path)
                longitude_value = checked_coordinate(longitude, "longitude", path)
                if not -90 <= latitude_value <= 90 or not -180 <= longitude_value <= 180:
                    raise RuntimeError(f"Out-of-range context coordinates in {path}")
                points.append(ContextPoint(latitude, longitude))
            if len(points) < 2:
                raise RuntimeError("Context source contains an unusable track segment.")
            segments.append(tuple(points))

    if not segments:
        raise RuntimeError("Context source contains no track segments.")
    counts = {
        "waypointCount": element_counts["wpt"],
        "routeCount": len(source_routes),
        "trackCount": len(root.findall(qname("trk"))),
        "segmentCount": len(segments),
        "pointCount": sum(len(points) for points in segments),
        "elevationElementCount": element_counts["ele"],
        "timeElementCount": element_counts["time"],
        "extensionsElementCount": element_counts["extensions"],
    }
    return segments, counts


def angular_distance(left: ContextPoint, right: ContextPoint) -> float:
    left_latitude = math.radians(float(left.latitude))
    right_latitude = math.radians(float(right.latitude))
    latitude_delta = right_latitude - left_latitude
    longitude_delta = math.radians(float(right.longitude) - float(left.longitude))
    haversine = (
        math.sin(latitude_delta / 2) ** 2
        + math.cos(left_latitude)
        * math.cos(right_latitude)
        * math.sin(longitude_delta / 2) ** 2
    )
    return 2 * math.atan2(math.sqrt(haversine), math.sqrt(max(0.0, 1 - haversine)))


def initial_bearing(start: ContextPoint, end: ContextPoint) -> float:
    start_latitude = math.radians(float(start.latitude))
    end_latitude = math.radians(float(end.latitude))
    longitude_delta = math.radians(float(end.longitude) - float(start.longitude))
    return math.atan2(
        math.sin(longitude_delta) * math.cos(end_latitude),
        math.cos(start_latitude) * math.sin(end_latitude)
        - math.sin(start_latitude)
        * math.cos(end_latitude)
        * math.cos(longitude_delta),
    )


def point_segment_distance_meters(
    point: ContextPoint,
    start: ContextPoint,
    end: ContextPoint,
) -> float:
    segment_distance = angular_distance(start, end)
    if segment_distance == 0:
        return angular_distance(point, start) * EARTH_RADIUS_METERS
    point_distance = angular_distance(start, point)
    cross_track = math.asin(
        max(
            -1.0,
            min(
                1.0,
                math.sin(point_distance)
                * math.sin(initial_bearing(start, point) - initial_bearing(start, end)),
            ),
        )
    )
    along_track = math.atan2(
        math.sin(point_distance)
        * math.cos(initial_bearing(start, point) - initial_bearing(start, end)),
        math.cos(point_distance),
    )
    if along_track < 0 or along_track > segment_distance:
        return min(angular_distance(point, start), angular_distance(point, end)) * EARTH_RADIUS_METERS
    return abs(cross_track) * EARTH_RADIUS_METERS


def simplify_open_chain(
    points: tuple[ContextPoint, ...],
    tolerance_meters: float,
) -> tuple[ContextPoint, ...]:
    keep = {0, len(points) - 1}
    stack = [(0, len(points) - 1)]
    while stack:
        start, end = stack.pop()
        best_index: int | None = None
        best_distance = -1.0
        for index in range(start + 1, end):
            distance = point_segment_distance_meters(
                points[index], points[start], points[end]
            )
            if distance > best_distance:
                best_distance = distance
                best_index = index
        if best_index is not None and best_distance > tolerance_meters:
            keep.add(best_index)
            stack.append((best_index, end))
            stack.append((start, best_index))
    return tuple(points[index] for index in sorted(keep))


def simplify_segment(
    points: tuple[ContextPoint, ...],
    tolerance_meters: float,
) -> tuple[ContextPoint, ...]:
    if tolerance_meters <= 0 or len(points) <= 2:
        return points
    if points[0].key != points[-1].key:
        return simplify_open_chain(points, tolerance_meters)

    ring = list(points[:-1])
    anchor_index = min(
        range(len(ring)),
        key=lambda index: (
            float(ring[index].latitude),
            float(ring[index].longitude),
            index,
        ),
    )
    rotated = ring[anchor_index:] + ring[:anchor_index]
    farthest_index = 1
    farthest_distance = -1.0
    for index, point in enumerate(rotated[1:], start=1):
        distance = angular_distance(rotated[0], point)
        if distance > farthest_distance:
            farthest_distance = distance
            farthest_index = index
    first = simplify_open_chain(
        tuple(rotated[: farthest_index + 1]), tolerance_meters
    )
    second = simplify_open_chain(
        tuple(rotated[farthest_index:] + [rotated[0]]), tolerance_meters
    )
    simplified = first + second[1:]
    if len(simplified) < 4:
        return tuple(rotated + [rotated[0]])
    return simplified


def maximum_deviation(
    source: tuple[ContextPoint, ...],
    simplified: tuple[ContextPoint, ...],
) -> float:
    if source == simplified:
        return 0.0
    maximum = 0.0
    for point in source:
        distance = min(
            point_segment_distance_meters(point, left, right)
            for left, right in zip(simplified, simplified[1:])
        )
        maximum = max(maximum, distance)
    return maximum


def atomic_edge_duplicates(segments: list[ContextSegment]) -> int:
    occurrences: Counter[tuple[CoordinateKey, CoordinateKey]] = Counter()
    for segment in segments:
        for left, right in zip(segment.points, segment.points[1:]):
            if left.key == right.key:
                raise RuntimeError("Context simplification produced a zero-length edge.")
            key = tuple(sorted((left.key, right.key)))
            occurrences[key] += 1
    return sum(count - 1 for count in occurrences.values() if count > 1)


def orientation(
    first: CoordinateKey,
    second: CoordinateKey,
    third: CoordinateKey,
) -> Decimal:
    return (
        (second[0] - first[0]) * (third[1] - first[1])
        - (second[1] - first[1]) * (third[0] - first[0])
    )


def proper_intersection(
    left_a: CoordinateKey,
    left_b: CoordinateKey,
    right_a: CoordinateKey,
    right_b: CoordinateKey,
) -> bool:
    if (
        max(left_a[0], left_b[0]) <= min(right_a[0], right_b[0])
        or max(right_a[0], right_b[0]) <= min(left_a[0], left_b[0])
        or max(left_a[1], left_b[1]) <= min(right_a[1], right_b[1])
        or max(right_a[1], right_b[1]) <= min(left_a[1], left_b[1])
    ):
        return False
    first = orientation(left_a, left_b, right_a)
    second = orientation(left_a, left_b, right_b)
    third = orientation(right_a, right_b, left_a)
    fourth = orientation(right_a, right_b, left_b)
    return (
        ((first > 0 and second < 0) or (first < 0 and second > 0))
        and ((third > 0 and fourth < 0) or (third < 0 and fourth > 0))
    )


def count_proper_crossings(segments: list[ContextSegment]) -> int:
    edges = [
        (segment.index, edge_index, left.key, right.key)
        for segment in segments
        for edge_index, (left, right) in enumerate(zip(segment.points, segment.points[1:]))
    ]
    crossings = 0
    for index, (segment_id, edge_index, left_a, left_b) in enumerate(edges):
        for other_segment, other_edge, right_a, right_b in edges[index + 1 :]:
            if segment_id == other_segment and abs(edge_index - other_edge) <= 1:
                continue
            if proper_intersection(left_a, left_b, right_a, right_b):
                crossings += 1
    return crossings


def route_decomposition(
    segments: list[ContextSegment],
) -> tuple[list[ContextRoute], int, int]:
    endpoint_id: dict[CoordinateKey, int] = {}
    endpoints: list[CoordinateKey] = []

    def node_id(key: CoordinateKey) -> int:
        result = endpoint_id.get(key)
        if result is None:
            result = len(endpoints)
            endpoint_id[key] = result
            endpoints.append(key)
        return result

    edge_endpoints: list[tuple[int, int]] = []
    adjacency: dict[int, list[int]] = defaultdict(list)
    for segment in segments:
        left = node_id(segment.start)
        right = node_id(segment.end)
        edge_endpoints.append((left, right))
        adjacency[left].append(segment.index)
        adjacency[right].append(segment.index)

    remaining = set(range(len(segments)))
    components: list[list[int]] = []
    while remaining:
        first = min(remaining)
        remaining.remove(first)
        queue = deque([first])
        component: list[int] = []
        while queue:
            edge_id = queue.popleft()
            component.append(edge_id)
            for endpoint in edge_endpoints[edge_id]:
                for neighbor in adjacency[endpoint]:
                    if neighbor in remaining:
                        remaining.remove(neighbor)
                        queue.append(neighbor)
        components.append(sorted(component))

    routes: list[ContextRoute] = []
    odd_count = 0
    minimum_routes = 0
    next_virtual_id = len(segments)
    for component in components:
        degrees: Counter[int] = Counter()
        component_nodes: set[int] = set()
        graph_edges: dict[int, tuple[int, int, bool]] = {}
        for edge_id in component:
            left, right = edge_endpoints[edge_id]
            graph_edges[edge_id] = (left, right, False)
            degrees[left] += 1
            degrees[right] += 1
            component_nodes.update((left, right))
        odd_nodes = sorted(node for node in component_nodes if degrees[node] % 2)
        odd_count += len(odd_nodes)
        minimum_routes += max(1, len(odd_nodes) // 2)
        virtual_ids: set[int] = set()
        for left, right in zip(odd_nodes[::2], odd_nodes[1::2], strict=True):
            edge_id = next_virtual_id
            next_virtual_id += 1
            graph_edges[edge_id] = (left, right, True)
            virtual_ids.add(edge_id)

        traversal_adjacency: dict[int, list[int]] = defaultdict(list)
        for edge_id, (left, right, _virtual) in graph_edges.items():
            traversal_adjacency[left].append(edge_id)
            traversal_adjacency[right].append(edge_id)
        for incident in traversal_adjacency.values():
            incident.sort(reverse=True)

        start = odd_nodes[0] if odd_nodes else min(component_nodes)
        used: set[int] = set()
        node_stack = [start]
        edge_stack: list[tuple[int, int, int]] = []
        reverse_circuit: list[tuple[int, int, int]] = []
        while node_stack:
            node = node_stack[-1]
            incident = traversal_adjacency[node]
            while incident and incident[-1] in used:
                incident.pop()
            if incident:
                edge_id = incident.pop()
                if edge_id in used:
                    continue
                used.add(edge_id)
                left, right, _virtual = graph_edges[edge_id]
                other = right if node == left else left
                node_stack.append(other)
                edge_stack.append((edge_id, node, other))
            else:
                node_stack.pop()
                if edge_stack:
                    reverse_circuit.append(edge_stack.pop())

        circuit = list(reversed(reverse_circuit))
        if used != set(graph_edges):
            raise RuntimeError("Context Euler traversal missed graph edges.")
        for previous, current in zip(circuit, circuit[1:]):
            if previous[2] != current[1]:
                raise RuntimeError("Context Euler traversal is discontinuous.")
        if circuit and circuit[-1][2] != circuit[0][1]:
            raise RuntimeError("Augmented context Euler circuit did not close.")

        if virtual_ids:
            first_virtual = next(
                index for index, item in enumerate(circuit) if item[0] in virtual_ids
            )
            circuit = circuit[first_virtual + 1 :] + circuit[: first_virtual + 1]
        steps: list[ContextStep] = []
        for edge_id, start_node, end_node in circuit:
            if edge_id in virtual_ids:
                if not steps:
                    raise RuntimeError("Context virtual edge produced an empty route.")
                routes.append(ContextRoute(tuple(steps)))
                steps = []
                continue
            segment = segments[edge_id]
            left, right = edge_endpoints[edge_id]
            if (start_node, end_node) == (left, right):
                steps.append(ContextStep(segment, False))
            elif (start_node, end_node) == (right, left):
                steps.append(ContextStep(segment, True))
            else:
                raise RuntimeError("Context traversal orientation mismatch.")
        if steps:
            routes.append(ContextRoute(tuple(steps)))

    routes.sort(key=lambda route: min(step.segment.index for step in route.steps))
    membership = Counter(
        step.segment.index for route in routes for step in route.steps
    )
    if membership != Counter({segment.index: 1 for segment in segments}):
        raise RuntimeError("Context routes lost or duplicated topology segments.")
    if len(routes) != minimum_routes:
        raise RuntimeError("Context route decomposition is not minimal.")
    return routes, len(components), odd_count


def build_state_context(path: Path, tolerance_meters: float) -> ContextBuild:
    source_path = path.resolve()
    if not source_path.is_file():
        raise RuntimeError(f"Missing state-context GPX: {source_path}")
    if tolerance_meters < 0 or not math.isfinite(tolerance_meters):
        raise RuntimeError("Context simplification tolerance must be a finite nonnegative value.")

    source_segments, source_counts = parse_context_source(source_path)
    segments = [
        ContextSegment(
            index=index,
            source_points=points,
            points=simplify_segment(points, tolerance_meters),
        )
        for index, points in enumerate(source_segments)
    ]
    for segment in segments:
        source_is_closed = segment.source_points[0].key == segment.source_points[-1].key
        if source_is_closed:
            if segment.points[0].key != segment.points[-1].key:
                raise RuntimeError("Context simplification opened a closed segment.")
        else:
            if segment.points[0].key != segment.source_points[0].key:
                raise RuntimeError("Context simplification changed a segment start endpoint.")
            if segment.points[-1].key != segment.source_points[-1].key:
                raise RuntimeError("Context simplification changed a segment end endpoint.")
        if any(point not in segment.source_points for point in segment.points):
            raise RuntimeError("Context simplification invented or moved a coordinate.")

    duplicate_edges = atomic_edge_duplicates(segments)
    if duplicate_edges:
        raise RuntimeError("Context contains doubled or reversed atomic border edges.")
    crossing_count = count_proper_crossings(segments)
    if crossing_count:
        raise RuntimeError(
            f"Context simplification introduced {crossing_count} proper crossings."
        )
    routes, component_count, odd_count = route_decomposition(segments)
    simplified_point_count = sum(len(segment.points) for segment in segments)
    maximum = max(
        maximum_deviation(segment.source_points, segment.points)
        for segment in segments
    )
    return ContextBuild(
        source_path=source_path,
        source_sha256=sha256_file(source_path),
        source_counts=source_counts,
        tolerance_meters=tolerance_meters,
        simplification_metric="per-segment spherical cross-track Douglas-Peucker",
        maximum_deviation_meters=maximum,
        simplified_point_count=simplified_point_count,
        removed_point_count=source_counts["pointCount"] - simplified_point_count,
        component_count=component_count,
        odd_endpoint_count=odd_count,
        routes=tuple(routes),
        duplicate_atomic_edge_count=duplicate_edges,
        proper_crossing_count=crossing_count,
    )
