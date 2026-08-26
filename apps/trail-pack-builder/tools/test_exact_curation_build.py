#!/usr/bin/env python3
"""Focused tests for exact grouping-board compilation."""

from __future__ import annotations

import copy
import importlib.util
from pathlib import Path
import sys
import unittest


TOOLS = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location(
    "trail_data_builder_exact_curation", TOOLS / "build-local-trail-data.py"
)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load the trail-data builder.")
BUILDER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = BUILDER
SPEC.loader.exec_module(BUILDER)


CATALOG_SHA = "1" * 64


def source_rows() -> list[dict[str, str]]:
    return [
        {"trail_id": "trail-a"},
        {"trail_id": "trail-b"},
        {"trail_id": "trail-c"},
        {"trail_id": "trail-delete"},
    ]


def project() -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "kind": "bobs-trail-pack-curation",
        "source": {
            "qualityScope": "internal-canonical",
            "sourceCatalogSha256": CATALOG_SHA,
            "trailCount": 4,
        },
        "packs": [
            {
                "id": "alpha",
                "name": "Alpha",
                "labelPoint": [-122.0, 45.0],
                "trailIds": ["trail-a", "trail-b"],
            },
            {
                "id": "beta",
                "name": "Beta",
                "labelPoint": [-121.5, 45.5],
                "trailIds": ["trail-c"],
            },
            {
                "id": "loose-outliers",
                "name": "delete2",
                "labelPoint": [-100.0, 40.0],
                "trailIds": ["trail-delete"],
            },
        ],
        "unassignedTrailIds": [],
    }


def geometry_trails() -> list[dict[str, object]]:
    return [
        {
            "trail_id": "trail-a",
            "group_id": "n45-w122",
            "bbox": [-122.1, 44.9, -122.0, 45.0],
            "point_count": 10,
        },
        {
            "trail_id": "trail-b",
            "group_id": "n45-w122",
            "bbox": [-122.0, 45.0, -121.9, 45.1],
            "point_count": 20,
        },
        {
            "trail_id": "trail-c",
            "group_id": "n46-w122",
            "bbox": [-121.6, 45.4, -121.5, 45.5],
            "point_count": 30,
        },
    ]


class ExactCurationValidationTests(unittest.TestCase):
    def test_delete_number_pack_is_discarded_after_full_universe_validation(self) -> None:
        compiled = BUILDER.validate_curation_project(
            project(),
            source_rows(),
            CATALOG_SHA,
            file_name="curation.json",
            project_sha256="2" * 64,
        )

        self.assertEqual(compiled["productTrailIds"], {"trail-a", "trail-b", "trail-c"})
        self.assertEqual(compiled["discardedTrailIds"], {"trail-delete"})
        self.assertEqual([pack["id"] for pack in compiled["productPacks"]], ["alpha", "beta"])
        self.assertEqual([pack["id"] for pack in compiled["discardPacks"]], ["loose-outliers"])
        provenance = BUILDER.curation_public_provenance(compiled)
        self.assertEqual(provenance["sourceTrailCount"], 4)
        self.assertEqual(provenance["productTrailCount"], 3)
        self.assertEqual(provenance["discardedTrailCount"], 1)
        self.assertEqual(provenance["sha256"], "2" * 64)

    def test_rejects_unassigned_or_incomplete_production_projects(self) -> None:
        unassigned = project()
        unassigned["packs"][1]["trailIds"] = []
        unassigned["packs"].pop(1)
        unassigned["unassignedTrailIds"] = ["trail-c"]
        with self.assertRaisesRegex(RuntimeError, "cannot contain unassigned"):
            BUILDER.validate_curation_project(unassigned, source_rows(), CATALOG_SHA)

        incomplete = project()
        incomplete["packs"][0]["trailIds"].remove("trail-b")
        with self.assertRaisesRegex(RuntimeError, "missing 1 source trail IDs"):
            BUILDER.validate_curation_project(incomplete, source_rows(), CATALOG_SHA)

    def test_rejects_duplicate_membership_and_wrong_catalog_hash(self) -> None:
        duplicate = project()
        duplicate["packs"][1]["trailIds"].append("trail-a")
        with self.assertRaisesRegex(RuntimeError, "appears in both"):
            BUILDER.validate_curation_project(duplicate, source_rows(), CATALOG_SHA)

        wrong_hash = project()
        wrong_hash["source"]["sourceCatalogSha256"] = "0" * 64
        with self.assertRaisesRegex(RuntimeError, "SHA-256 does not match"):
            BUILDER.validate_curation_project(wrong_hash, source_rows(), CATALOG_SHA)

    def test_collection_remainder_is_collection_only_not_a_normal_area(self) -> None:
        curated = project()
        curated["packs"][0]["trailIds"] = ["trail-a"]
        curated["packs"][1]["trailIds"] = ["trail-b"]
        curated["packs"].insert(
            2,
            {
                "id": "logical-region-other",
                "name": "Logical Region - Other",
                "labelPoint": [-121.5, 45.5],
                "trailIds": ["trail-c"],
            },
        )
        curated["collections"] = [
            {
                "id": "logical-region",
                "name": "Logical Region",
                "labelPoint": [-121.8, 45.2],
                "memberPackIds": ["alpha", "beta"],
                "remainderPackId": "logical-region-other",
            }
        ]
        compiled = BUILDER.validate_curation_project(
            curated, source_rows(), CATALOG_SHA
        )
        (
            area_assignments,
            collection_assignments,
            overview_areas,
            overview_collections,
            stats,
            review,
        ) = BUILDER.build_exact_curation_areas(geometry_trails(), compiled)

        self.assertEqual(
            area_assignments,
            {"trail-a": "alpha", "trail-b": "beta"},
        )
        self.assertEqual(
            collection_assignments,
            {
                "trail-a": "logical-region",
                "trail-b": "logical-region",
                "trail-c": "logical-region",
            },
        )
        self.assertEqual([row[0] for row in overview_areas], ["alpha", "beta"])
        self.assertEqual(overview_collections[0][0], "logical-region")
        self.assertEqual(overview_collections[0][-1], ["alpha", "beta"])
        self.assertEqual(overview_collections[0][2:4], [3, 60])
        self.assertEqual(stats["logicalAreas"], 1)
        self.assertEqual(stats["areaAssignedTrails"], 2)
        self.assertEqual(stats["collectionAssignedTrails"], 3)
        self.assertEqual(stats["namedAssignedTrails"], 3)
        self.assertEqual(stats["curationCollectionRemainderPacks"], 1)
        self.assertEqual(stats["curationCollectionRemainderTrails"], 1)
        self.assertEqual(stats["curationDiscardedTrails"], 1)
        self.assertEqual(review["summary"]["assignmentMode"], "exact-curation-project")
        remainder_review = next(
            row for row in review["packs"] if row["id"] == "logical-region-other"
        )
        self.assertEqual(remainder_review["status"], "collection-remainder")
        self.assertEqual(review["generatedAreas"], [])

        invalid = copy.deepcopy(curated)
        invalid["collections"][0]["memberPackIds"] = ["alpha", "loose-outliers"]
        with self.assertRaisesRegex(RuntimeError, "unknown product pack"):
            BUILDER.validate_curation_project(invalid, source_rows(), CATALOG_SHA)

        invalid_remainder = copy.deepcopy(curated)
        invalid_remainder["collections"][0]["remainderPackId"] = "beta"
        with self.assertRaisesRegex(RuntimeError, "runtime collection contract"):
            BUILDER.validate_curation_project(
                invalid_remainder, source_rows(), CATALOG_SHA
            )


if __name__ == "__main__":
    unittest.main()
