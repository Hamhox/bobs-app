#!/usr/bin/env python3
"""Focused tests for reviewed semantic riding-region assignment."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import unittest


TOOLS = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location(
    "trail_data_builder", TOOLS / "build-local-trail-data.py"
)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load the trail-data builder.")
BUILDER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = BUILDER
SPEC.loader.exec_module(BUILDER)


def trail(trail_id: str, source_paths: str, longitude: float) -> dict[str, object]:
    return {
        "trail_id": trail_id,
        "source_paths": source_paths,
        "center": [longitude, 45.0],
        "bbox": [longitude, 45.0, longitude + 0.01, 45.01],
        "point_count": 10,
    }


class SemanticRegionTests(unittest.TestCase):
    def test_merges_areas_claims_only_unassigned_sources_and_audits_moves(self) -> None:
        trails = [
            trail("trail-a", "source/area-a.gpx", -122.0),
            trail("trail-b", "source/pack.gpx", -121.9),
            trail("trail-c", "source/area-c.gpx", -121.8),
            trail("trail-f", "source/pack.gpx", -121.7),
            trail("trail-x", "source/manual.gpx", -121.6),
        ]
        area_assignments = {
            "trail-a": "area-a",
            "trail-b": "area-b",
            "trail-c": "area-c",
        }
        config = {
            "areas": [
                {"id": "area-a"},
                {"id": "area-b"},
                {"id": "area-c"},
            ],
            "collections": [],
            "semanticRegions": [
                {
                    "id": "reviewed-region",
                    "name": "Reviewed Region",
                    "sourceAreaIds": ["area-a"],
                    "claimSourcePathPrefixes": ["source/pack.gpx"],
                    "retainAssignedTrailIds": ["trail-b"],
                    "includeTrailIds": ["trail-x"],
                    "reassignTrailIds": ["trail-c"],
                }
            ],
        }

        records, replaced = BUILDER.apply_semantic_regions(
            trails,
            area_assignments,
            {},
            set(),
            config,
            [],
            False,
        )

        self.assertEqual(replaced, {"area-a"})
        self.assertEqual(area_assignments["trail-a"], "reviewed-region")
        self.assertEqual(area_assignments["trail-c"], "reviewed-region")
        self.assertEqual(area_assignments["trail-f"], "reviewed-region")
        self.assertEqual(area_assignments["trail-x"], "reviewed-region")
        self.assertEqual(
            area_assignments["trail-b"],
            "area-b",
            "A source-prefix rule must not silently steal an assigned trail.",
        )
        self.assertEqual(
            records[0]["assignmentBreakdown"],
            {
                "reviewed-source-area": 1,
                "reviewed-source-path": 1,
                "reviewed-trail-include": 1,
                "reviewed-trail-reassignment": 1,
            },
        )
        self.assertEqual(
            records[0]["sourcePathAudit"]["initialRetainedAssignments"],
            {"trail-b": "area-b"},
        )

    def test_source_selector_fails_on_unreviewed_assigned_match(self) -> None:
        trails = [trail("trail-a", "source/pack/a.gpx", -122.0)]
        with self.assertRaisesRegex(RuntimeError, "retainAssignedTrailIds"):
            BUILDER.apply_semantic_regions(
                trails,
                {"trail-a": "area-a"},
                {},
                set(),
                {
                    "areas": [{"id": "area-a"}],
                    "collections": [],
                    "semanticRegions": [
                        {
                            "id": "reviewed-region",
                            "name": "Reviewed Region",
                            "claimSourcePathPrefixes": ["source/pack/"],
                        }
                    ],
                },
                [],
                False,
            )

    def test_two_regions_cannot_resolve_the_same_trail(self) -> None:
        trails = [trail("trail-a", "source/a.gpx", -122.0)]
        with self.assertRaisesRegex(RuntimeError, "both resolve trail"):
            BUILDER.apply_semantic_regions(
                trails,
                {"trail-a": "area-a"},
                {},
                set(),
                {
                    "areas": [{"id": "area-a"}],
                    "collections": [],
                    "semanticRegions": [
                        {
                            "id": "first-region",
                            "name": "First Region",
                            "sourceAreaIds": ["area-a"],
                        },
                        {
                            "id": "second-region",
                            "name": "Second Region",
                            "reassignTrailIds": ["trail-a"],
                        },
                    ],
                },
                [],
                False,
            )

    def test_source_path_selectors_respect_component_boundaries(self) -> None:
        self.assertTrue(
            BUILDER.source_path_selector_matches(
                "kelly/OBDR/day-1.gpx", "kelly/OBDR/"
            )
        )
        self.assertTrue(
            BUILDER.source_path_selector_matches(
                "kelly/moab.gpx", "kelly/moab.gpx"
            )
        )
        self.assertFalse(
            BUILDER.source_path_selector_matches(
                "kelly/OBDR2/day-1.gpx", "kelly/OBDR/"
            )
        )
        self.assertFalse(
            BUILDER.source_path_selector_matches(
                "kelly/moab.gpx.bak", "kelly/moab.gpx"
            )
        )

    def test_assigned_manual_include_requires_explicit_reassignment(self) -> None:
        trails = [trail("trail-a", "source/a.gpx", -122.0)]
        with self.assertRaisesRegex(RuntimeError, "reassignTrailIds"):
            BUILDER.apply_semantic_regions(
                trails,
                {"trail-a": "area-a"},
                {},
                set(),
                {
                    "areas": [{"id": "area-a"}],
                    "collections": [],
                    "semanticRegions": [
                        {
                            "id": "reviewed-region",
                            "name": "Reviewed Region",
                            "includeTrailIds": ["trail-a"],
                        }
                    ],
                },
                [],
                False,
            )

    def test_collection_members_cannot_be_absorbed(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "cannot absorb collection members"):
            BUILDER.apply_semantic_regions(
                [trail("trail-a", "source/a.gpx", -122.0)],
                {"trail-a": "member-a"},
                {"trail-a": "collection-a"},
                set(),
                {
                    "areas": [],
                    "collections": [
                        {"id": "collection-a", "members": [{"id": "member-a"}]}
                    ],
                    "semanticRegions": [
                        {
                            "id": "reviewed-region",
                            "name": "Reviewed Region",
                            "sourceAreaIds": ["member-a"],
                        }
                    ],
                },
                [],
                False,
            )


if __name__ == "__main__":
    unittest.main()
