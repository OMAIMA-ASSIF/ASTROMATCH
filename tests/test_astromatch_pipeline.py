import json
import unittest
from pathlib import Path

from run_astromatch_pipeline import (
    POLICY_PATH,
    cell_area_km2,
    coordinate_key,
    normalize_longitude,
    read_sites,
    regions_geojson,
    screening_decision,
    summarize_regions,
    validate_policy,
)


class CoordinateAndAreaTests(unittest.TestCase):
    def test_longitudes_normalize_across_antimeridian(self):
        self.assertAlmostEqual(normalize_longitude(208.142), -151.858)
        self.assertEqual(normalize_longitude(180), -180)
        self.assertEqual(coordinate_key(0, 360), (0.0, 0.0))

    def test_cell_area_accounts_for_latitude(self):
        self.assertGreater(cell_area_km2(0), cell_area_km2(80))
        self.assertGreater(cell_area_km2(89.75), 0)

    def test_region_joins_across_longitude_wrap(self):
        base = {
            "reference_site": "Example",
            "site_id": "MARS_TEST",
            "mission_body": "MARS",
            "screening_scenario": "strict",
            "candidate_tier": "SCREENED_DRY_LOW_VEGETATION",
            "land_fraction": "1",
            "vegetation": "0.05",
            "ai_valeur": "0.1",
            "ai_classe_nom": "Aride",
            "kmeans_cluster": "",
            "dbscan_cluster": "",
            "screening_conditions_passed": "land_fraction_threshold",
            "screening_conditions_unavailable": "",
            "screening_conditions_failed": "",
            "screening_evidence_coverage_pct": 66.67,
            "explanation": "Test-only screening record.",
            "limitations": "Test.",
            "similarity_score": "",
            "score_type": "screening_only",
            "data_quality_status": "SCREENING_PROXY_ONLY",
        }
        cells = [
            {
                **base,
                "grid_row": 10,
                "grid_col": col,
                "lat": 0.25,
                "lon": longitude,
                "earth_cell_id": f"10:{col}",
            }
            for col, longitude in ((719, 179.75), (0, -179.75))
        ]
        regions = summarize_regions(cells, grid_height=360, grid_width=720)
        self.assertEqual(len(regions), 1)
        self.assertEqual(regions[0]["support_cells"], 2)
        self.assertEqual(regions[0]["screening_evidence_coverage_pct"], 66.67)

    def test_adjacent_regions_with_different_screening_tiers_stay_separate(self):
        base = {
            "reference_site": "Mars context",
            "site_id": "MARS_CONTEXT",
            "mission_body": "MARS",
            "screening_scenario": "strict",
            "land_fraction": "1",
            "vegetation": "0.05",
            "ai_valeur": "0.1",
            "ai_classe_nom": "Aride",
            "screening_conditions_passed": "land_fraction_threshold",
            "screening_conditions_unavailable": "",
            "screening_conditions_failed": "",
            "screening_evidence_coverage_pct": 100,
            "explanation": "Exploratory test screen.",
            "limitations": "Not a planetary match.",
            "similarity_score": "",
            "score_type": "screening_only",
            "data_quality_status": "SCREENING_PROXY_ONLY",
        }
        cells = [
            {
                **base,
                "grid_row": 10,
                "grid_col": col,
                "lat": 0.25,
                "lon": longitude,
                "earth_cell_id": f"10:{col}",
                "candidate_tier": tier,
            }
            for col, longitude, tier in (
                (10, -174.75, "SCREENED_DRY_LOW_VEGETATION"),
                (11, -174.25, "SCREENED_LOW_VEGETATION_ARIDITY_UNKNOWN"),
            )
        ]
        regions = summarize_regions(cells, grid_height=360, grid_width=720)
        self.assertEqual(len(regions), 2)
        self.assertEqual(
            {region["candidate_tier"] for region in regions},
            {"SCREENED_DRY_LOW_VEGETATION", "SCREENED_LOW_VEGETATION_ARIDITY_UNKNOWN"},
        )

    def test_geojson_export_preserves_coordinates_and_feature_summaries(self):
        region = {
            "region_id": "MARS_strict_10_11",
            "representative_lon": -174.25,
            "representative_lat": 0.25,
            "feature_summaries_json": json.dumps({"vegetation": {"median": 0.05}}),
            "similarity_score": "",
        }
        exported = json.loads(json.dumps(regions_geojson([region])))
        self.assertEqual(exported["type"], "FeatureCollection")
        self.assertEqual(exported["features"][0]["geometry"]["type"], "Point")
        self.assertEqual(exported["features"][0]["geometry"]["coordinates"], [-174.25, 0.25])
        self.assertEqual(exported["features"][0]["properties"]["feature_summaries"]["vegetation"]["median"], 0.05)


class ScreeningTests(unittest.TestCase):
    def setUp(self):
        self.scenario = {
            "vegetation_max": 0.1,
            "minimum_land_fraction": 0.5,
            "accepted_aridity_classes": ["Hyper-aride", "Aride"],
        }

    def test_missing_vegetation_is_not_zero(self):
        decision = screening_decision({
            "land_fraction": "1",
            "vegetation": "",
            "ai_classe_nom": "Aride",
            "lat": "10",
        }, self.scenario)
        self.assertFalse(decision["eligible"])
        self.assertIn("vegetation", decision["unavailable"])

    def test_extended_screen_accepts_its_wider_vegetation_and_aridity_rules(self):
        row = {
            "land_fraction": "1",
            "vegetation": "0.15",
            "ai_classe_nom": "Semi-aride",
            "lat": "10",
        }
        strict = screening_decision(row, self.scenario)
        extended = screening_decision(row, {
            "vegetation_max": 0.2,
            "minimum_land_fraction": 0.5,
            "accepted_aridity_classes": ["Hyper-aride", "Aride", "Semi-aride"],
        })
        self.assertFalse(strict["eligible"])
        self.assertTrue(extended["eligible"])
        self.assertEqual(extended["candidate_tier"], "SCREENED_SEMIARID_LOW_VEGETATION")

    def test_vegetation_above_extended_threshold_is_filtered(self):
        decision = screening_decision({
            "land_fraction": "1",
            "vegetation": "0.25",
            "ai_classe_nom": "Aride",
            "lat": "10",
        }, {
            "vegetation_max": 0.2,
            "minimum_land_fraction": 0.5,
            "accepted_aridity_classes": ["Hyper-aride", "Aride", "Semi-aride"],
        })
        self.assertFalse(decision["eligible"])
        self.assertIn("low_vegetation_threshold", decision["failed"])

    def test_missing_southern_polar_aridity_is_unknown_not_dry(self):
        decision = screening_decision({
            "land_fraction": "1",
            "vegetation": "0.02",
            "ai_classe_nom": "",
            "lat": "-75",
        }, self.scenario)
        self.assertTrue(decision["eligible"])
        self.assertEqual(decision["filter_aridity_status"], "UNKNOWN_SOUTHERN_POLAR_ARIDITY")
        self.assertEqual(decision["candidate_tier"], "SCREENED_LOW_VEGETATION_ARIDITY_UNKNOWN")
        self.assertNotIn("terrestrial_aridity_category_proxy", decision["passed"])
        self.assertIn("terrestrial_aridity_category", decision["unavailable"])

    def test_non_dry_class_fails_strict_screen(self):
        decision = screening_decision({
            "land_fraction": "1",
            "vegetation": "0.05",
            "ai_classe_nom": "Humide",
            "lat": "10",
        }, self.scenario)
        self.assertFalse(decision["eligible"])
        self.assertIn("terrestrial_aridity_category_proxy", decision["failed"])

    def test_cluster_labels_do_not_control_screening(self):
        decision = screening_decision({
            "land_fraction": "1",
            "vegetation": "0.05",
            "ai_classe_nom": "Aride",
            "lat": "10",
            "kmeans_cluster": "",
            "dbscan_cluster": "",
        }, self.scenario)
        self.assertTrue(decision["eligible"])


class PolicyTests(unittest.TestCase):
    def test_reference_site_data_contains_all_five_independent_sites(self):
        sites = read_sites()
        self.assertEqual(len(sites), 5)
        self.assertEqual(
            {site["site_id"] for site in sites},
            {
                "MOON_SHACKLETON",
                "MOON_MALAPERT",
                "MOON_HAWORTH",
                "MARS_GALE",
                "MARS_UTOPIA",
            },
        )
        utopia = next(site for site in sites if site["site_id"] == "MARS_UTOPIA")
        self.assertIn("Southern Utopia", utopia["spatial_scope_note"])

    def test_policy_disables_unapproved_numeric_similarity(self):
        policy = json.loads(POLICY_PATH.read_text(encoding="utf-8"))
        validate_policy(policy)
        self.assertFalse(policy["numeric_similarity_enabled"])

    def test_policy_rejects_reversed_vegetation_thresholds(self):
        policy = json.loads(POLICY_PATH.read_text(encoding="utf-8"))
        policy["screening_scenarios"]["strict"]["vegetation_max"] = 0.3
        policy["screening_scenarios"]["extended"]["vegetation_max"] = 0.2
        with self.assertRaises(ValueError):
            validate_policy(policy)


if __name__ == "__main__":
    unittest.main()
