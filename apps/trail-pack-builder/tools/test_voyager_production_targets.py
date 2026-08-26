#!/usr/bin/env python3
"""Focused target-discovery tests for the Voyager production driver."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest


TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))
SPEC = importlib.util.spec_from_file_location(
    "voyager_production_driver", TOOLS / "build-voyager-production-packs.py"
)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load the Voyager production driver.")
DRIVER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = DRIVER
SPEC.loader.exec_module(DRIVER)


CATALOG_FIELDS = [
    "trail_id",
    "display_name",
    "bbox",
    "length_m",
    "point_count",
    "elevation_coverage",
    "gpx_path",
    "area_id",
    "collection_id",
]


def catalog_row(
    trail_id: str,
    point_count: int,
    area_id: str | None,
    collection_id: str | None,
) -> list:
    return [
        trail_id,
        trail_id,
        [0.0, 0.0, 1.0, 1.0],
        1_000.0,
        point_count,
        1.0,
        f"gpx/{trail_id}.gpx",
        area_id,
        collection_id,
    ]


def write_json(path: Path, document: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document), encoding="utf-8")


def write_database(root: Path, *, include_orphan: bool = False) -> None:
    generation = "web-map/v2/generations/test"
    g1_catalog = [
        catalog_row("trail-a1", 10, "area-a", "forest-a"),
        catalog_row("trail-a2", 20, "area-a", "forest-a"),
        catalog_row("trail-o1", 40, None, "forest-a"),
    ]
    g2_catalog = [
        catalog_row("trail-b1", 30, "area-b", None),
        catalog_row("trail-o2", 50, None, "forest-b"),
        catalog_row("trail-unassigned", 60, None, None),
    ]
    if include_orphan:
        g2_catalog.append(catalog_row("trail-orphan", 70, None, "missing-collection"))

    write_json(
        root / f"{generation}/groups/g1.json",
        {"catalogFields": CATALOG_FIELDS, "catalog": g1_catalog},
    )
    write_json(
        root / f"{generation}/groups/g2.json",
        {"catalogFields": CATALOG_FIELDS, "catalog": g2_catalog},
    )
    overview = {
        "groupFields": ["id", "file"],
        "groups": [
            ["g1", f"{generation}/groups/g1.json"],
            ["g2", f"{generation}/groups/g2.json"],
        ],
        "areaFields": ["id", "name", "count", "pointCount", "groupIds"],
        "areas": [
            ["area-a", "Area A", 2, 30, ["g1"]],
            ["area-b", "Area B", 1, 30, ["g2"]],
        ],
        "collectionFields": ["id", "name", "groupIds"],
        "collections": [
            ["forest-a", "Forest A", ["g1"]],
            ["forest-b", "Forest B", ["g2"]],
            ["forest-empty", "Forest Empty", ["g2"]],
        ],
    }
    write_json(root / f"{generation}/overview.json", overview)
    write_json(
        root / "web-map/v2/manifest.json",
        {
            "version": 2,
            "overviewFile": f"{generation}/overview.json",
            "counts": {"namedAssignedTrails": 6 if include_orphan else 5},
        },
    )


class VoyagerProductionTargetTests(unittest.TestCase):
    def test_builds_every_area_and_nonempty_collection_remainder(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            database = Path(temporary)
            write_database(database)

            _, _, targets = DRIVER.load_targets(database)

        self.assertEqual(
            [target.target_id for target in targets],
            ["area-a", "area-b", "forest-a-other", "forest-b-other"],
        )
        by_id = {target.target_id: target for target in targets}
        self.assertEqual(by_id["forest-a-other"].name, "Forest A - Other")
        self.assertEqual(by_id["forest-a-other"].kind, "collection-remainder")
        self.assertEqual(by_id["forest-a-other"].expected_point_count, 40)
        self.assertEqual(
            [row["trail_id"] for row in by_id["forest-a-other"].catalog],
            ["trail-o1"],
        )
        self.assertEqual(by_id["forest-b-other"].name, "Forest B - Other")
        self.assertNotIn("forest-empty-other", by_id)

    def test_rejects_named_trail_without_area_or_collection_target(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            database = Path(temporary)
            write_database(database, include_orphan=True)

            with self.assertRaisesRegex(
                RuntimeError, r"exactly cover.*trail-orphan"
            ):
                DRIVER.load_targets(database)


if __name__ == "__main__":
    unittest.main()
