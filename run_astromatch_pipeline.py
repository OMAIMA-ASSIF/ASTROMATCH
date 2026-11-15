from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import unicodedata
from collections import Counter, defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parent
EARTH_PATH = ROOT / "outputs" / "astromatch_enriched_earth.csv"
KMEANS_PATH = ROOT / "clustring" / "kmeans_cells.csv"
DBSCAN_PATH = ROOT / "clustring" / "dbscan_cells.csv"
SITES_PATH = ROOT / "mission_data" / "processed" / "mission_reference_sites.csv"
COMPATIBILITY_PATH = ROOT / "mission_data" / "processed" / "earth_mission_feature_compatibility.csv"
METADATA_PATH = ROOT / "mission_data" / "processed" / "earth_feature_metadata_template.csv"
POLICY_PATH = ROOT / "mission_data" / "scoring" / "mission_scoring_policy.json"
OUTPUT_DIR = ROOT / "outputs" / "astromatch"

EXPECTED_EARTH_ROWS = 85_478
EARTH_RADIUS_KM = 6_371.0088
GRID_STEP_DEGREES = 0.5
DRY_CLASSES = {"hyper-aride", "aride"}
SEMIARID_CLASS = "semi-aride"
SOUTHERN_POLAR_LATITUDE = -60.0
FEATURE_SUMMARY_COLUMNS = (
    "precipitation", "vegetation", "annual_temperature_range", "lst_diurnal_range",
    "slope", "roughness", "elevation", "mean_annual_temperature", "ai_valeur",
    "land_fraction", "local_relief_m", "bare_pct", "land_frac", "ssrd_wm2",
    "energie_kwh_m2_an",
)
NUMERIC_STATUSES = {
    "NUMERIC_ELIGIBLE",
    "SCREENING_ONLY",
    "QUALITATIVE_ONLY",
    "EXCLUDED",
    "NEEDS_VALIDATION",
}

BASE_RESULT_FIELDS = [
    "reference_site",
    "site_id",
    "mission_body",
    "screening_scenario",
    "earth_cell_id",
    "lat",
    "lon",
    "grid_row",
    "grid_col",
    "candidate_tier",
    "similarity_score",
    "score_type",
    "eligible_feature_count",
    "available_feature_count",
    "feature_coverage_pct",
    "screening_criteria_available_count",
    "screening_evidence_coverage_pct",
    "missing_features",
    "screening_conditions_passed",
    "screening_conditions_unavailable",
    "screening_conditions_failed",
    "filter_land_pass",
    "filter_vegetation_pass",
    "filter_aridity_pass",
    "filter_aridity_status",
    "kmeans_cluster",
    "dbscan_cluster",
    "explanation",
    "limitations",
    "data_quality_status",
]


def read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    if not path.is_file():
        raise FileNotFoundError(f"Required input file not found: {path}")
    with path.open("r", encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        if reader.fieldnames is None:
            raise ValueError(f"CSV has no header: {path}")
        return list(reader.fieldnames), list(reader)


def write_csv(path: Path, fields: list[str], rows: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def parse_number(value: Any) -> float | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        number = float(text)
    except ValueError:
        return None
    return number if math.isfinite(number) else None


def normalize_longitude(longitude: float) -> float:
    return (longitude + 180.0) % 360.0 - 180.0


def coordinate_key(latitude: Any, longitude: Any) -> tuple[float, float]:
    lat = parse_number(latitude)
    lon = parse_number(longitude)
    if lat is None or lon is None or not -90 <= lat <= 90:
        raise ValueError(f"Invalid coordinate: latitude={latitude!r}, longitude={longitude!r}")
    return round(lat, 6), round(normalize_longitude(lon), 6)


def normalized_label(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or "").strip().casefold())
    return "".join(char for char in text if not unicodedata.combining(char))


def cell_area_km2(latitude: float, step_degrees: float = GRID_STEP_DEGREES) -> float:
    half_step = step_degrees / 2.0
    south = max(-90.0, latitude - half_step)
    north = min(90.0, latitude + half_step)
    longitude_width = math.radians(step_degrees)
    return EARTH_RADIUS_KM**2 * longitude_width * (
        math.sin(math.radians(north)) - math.sin(math.radians(south))
    )


def validate_policy(policy: dict[str, Any]) -> None:
    scenarios = policy.get("screening_scenarios")
    if not isinstance(scenarios, dict) or not {"strict", "extended"}.issubset(scenarios):
        raise ValueError("Policy must define strict and extended screening scenarios.")
    strict = scenarios["strict"]
    extended = scenarios["extended"]
    for name, scenario in scenarios.items():
        threshold = parse_number(scenario.get("vegetation_max"))
        land_fraction = parse_number(scenario.get("minimum_land_fraction"))
        if threshold is None or threshold < 0:
            raise ValueError(f"{name} vegetation_max must be a nonnegative number.")
        if land_fraction is None or not 0 <= land_fraction <= 1:
            raise ValueError(f"{name} minimum_land_fraction must be between 0 and 1.")
    if parse_number(extended["vegetation_max"]) < parse_number(strict["vegetation_max"]):
        raise ValueError("Extended vegetation threshold must be at least the strict threshold.")
    if policy.get("numeric_similarity_enabled") is not False:
        raise ValueError("Numeric similarity must remain disabled until a criterion is approved.")
    if any(status not in NUMERIC_STATUSES for status in policy.get("compatibility_statuses", {})):
        raise ValueError("Policy contains an unsupported compatibility status.")


def validate_earth_rows(
    rows: list[dict[str, str]],
    kmeans: dict[tuple[float, float], int],
    dbscan: dict[tuple[float, float], int],
) -> dict[str, Any]:
    if len(rows) != EXPECTED_EARTH_ROWS:
        raise ValueError(f"Expected {EXPECTED_EARTH_ROWS} Earth cells; found {len(rows)}.")
    required = {
        "grid_row", "grid_col", "lat", "lon", "land_fraction", "vegetation",
        "ai_valeur", "ai_classe_nom", "kmeans_cluster", "dbscan_cluster",
    }
    if not rows or not required.issubset(rows[0]):
        missing = sorted(required - set(rows[0] if rows else []))
        raise ValueError(f"Enriched Earth dataset is missing required columns: {missing}")

    seen_cells: set[tuple[int, int]] = set()
    seen_coordinates: set[tuple[float, float]] = set()
    kmeans_matches = 0
    dbscan_matches = 0
    label_mismatches: list[str] = []
    for row in rows:
        grid_row = parse_number(row["grid_row"])
        grid_col = parse_number(row["grid_col"])
        if grid_row is None or grid_col is None:
            raise ValueError("Earth dataset contains a missing grid row or column.")
        grid_key = int(grid_row), int(grid_col)
        if grid_key in seen_cells:
            raise ValueError(f"Duplicate grid cell: {grid_key}")
        seen_cells.add(grid_key)
        key = coordinate_key(row["lat"], row["lon"])
        if key in seen_coordinates:
            raise ValueError(f"Duplicate Earth coordinate: {key}")
        seen_coordinates.add(key)

        for column, labels, counter_name in (
            ("kmeans_cluster", kmeans, "kmeans"),
            ("dbscan_cluster", dbscan, "dbscan"),
        ):
            expected = labels.get(key)
            actual_value = parse_number(row.get(column))
            if expected is not None:
                if actual_value is None or int(actual_value) != expected:
                    label_mismatches.append(f"{counter_name}:{key}")
                elif counter_name == "kmeans":
                    kmeans_matches += 1
                else:
                    dbscan_matches += 1
            elif actual_value is not None:
                label_mismatches.append(f"unexpected-{counter_name}:{key}")

    if label_mismatches:
        raise ValueError(
            "Existing cluster labels do not match the saved cluster CSVs; "
            f"first discrepancies: {label_mismatches[:5]}"
        )
    return {
        "master_rows": len(rows),
        "unique_grid_cells": len(seen_cells),
        "kmeans_labelled_cells": kmeans_matches,
        "dbscan_labelled_cells": dbscan_matches,
        "unlabelled_cells": len(rows) - kmeans_matches,
        "labels_match_saved_csvs": True,
    }


def read_cluster_labels(path: Path, latitude_column: str, longitude_column: str) -> dict[tuple[float, float], int]:
    _, rows = read_csv(path)
    labels: dict[tuple[float, float], int] = {}
    for row in rows:
        key = coordinate_key(row[latitude_column], row[longitude_column])
        cluster = parse_number(row.get("cluster"))
        if cluster is None:
            raise ValueError(f"Missing cluster label in {path} at {key}.")
        if key in labels:
            raise ValueError(f"Duplicate cluster coordinate in {path}: {key}")
        labels[key] = int(cluster)
    return labels


def screening_decision(row: dict[str, str], scenario: dict[str, Any]) -> dict[str, Any]:
    land = parse_number(row.get("land_fraction"))
    vegetation = parse_number(row.get("vegetation"))
    latitude = parse_number(row.get("lat"))
    land_pass = land is not None and land >= float(scenario["minimum_land_fraction"])
    vegetation_pass = vegetation is not None and vegetation <= float(scenario["vegetation_max"])

    aridity = normalized_label(row.get("ai_classe_nom"))
    allowed_classes = {normalized_label(value) for value in scenario["accepted_aridity_classes"]}
    if aridity in allowed_classes:
        aridity_pass = True
        aridity_status = "KNOWN_DRY_CLASS"
    elif not aridity and latitude is not None and latitude <= SOUTHERN_POLAR_LATITUDE:
        aridity_pass = True
        aridity_status = "UNKNOWN_SOUTHERN_POLAR_ARIDITY"
    elif not aridity:
        aridity_pass = False
        aridity_status = "UNKNOWN_ARIDITY"
    else:
        aridity_pass = False
        aridity_status = "OUTSIDE_SELECTED_DRY_CLASSES"

    passed: list[str] = []
    unavailable: list[str] = []
    failed: list[str] = []
    if land_pass:
        passed.append("land_fraction_threshold")
    else:
        failed.append("land_fraction_threshold")
        if land is None:
            unavailable.append("land_fraction")
    if vegetation_pass:
        passed.append("low_vegetation_threshold")
    else:
        failed.append("low_vegetation_threshold")
        if vegetation is None:
            unavailable.append("vegetation")
    if aridity_pass and aridity_status == "KNOWN_DRY_CLASS":
        passed.append("terrestrial_aridity_category_proxy")
    elif aridity_pass:
        unavailable.append("terrestrial_aridity_category")
    else:
        failed.append("terrestrial_aridity_category_proxy")
        if aridity_status == "UNKNOWN_ARIDITY":
            unavailable.append("terrestrial_aridity_category")

    eligible = land_pass and vegetation_pass and aridity_pass
    if eligible and aridity_status == "UNKNOWN_SOUTHERN_POLAR_ARIDITY":
        tier = "SCREENED_LOW_VEGETATION_ARIDITY_UNKNOWN"
        data_quality = "ARIDITY_UNAVAILABLE"
    elif eligible and aridity == normalized_label("Semi-aride"):
        tier = "SCREENED_SEMIARID_LOW_VEGETATION"
        data_quality = "SCREENING_PROXY_ONLY"
    elif eligible:
        tier = "SCREENED_DRY_LOW_VEGETATION"
        data_quality = "SCREENING_PROXY_ONLY"
    else:
        tier = "NOT_SELECTED"
        data_quality = "INCOMPLETE_OR_FILTERS_NOT_MET"
    explanation = (
        "Screening-only result using terrestrial aridity class, an exploratory vegetation "
        "threshold, and master land_fraction; it is not a validated planetary analogue."
    )
    if aridity_status == "UNKNOWN_SOUTHERN_POLAR_ARIDITY":
        explanation += " Aridity is unknown in this southern polar latitude band; missing data was not treated as dry."

    return {
        "filter_land_pass": land_pass,
        "filter_vegetation_pass": vegetation_pass,
        "filter_aridity_pass": aridity_pass,
        "filter_aridity_status": aridity_status,
        "eligible": eligible,
        "candidate_tier": tier,
        "data_quality_status": data_quality,
        "passed": passed,
        "unavailable": unavailable,
        "failed": failed,
        "explanation": explanation,
    }


def numeric_summaries(rows: list[dict[str, str]], columns: list[str]) -> list[dict[str, Any]]:
    values: dict[str, list[float]] = {column: [] for column in columns}
    missing: Counter[str] = Counter()
    for row in rows:
        for column in columns:
            value = parse_number(row.get(column))
            if value is None:
                missing[column] += 1
            else:
                values[column].append(value)

    result: list[dict[str, Any]] = []
    for column in columns:
        series = sorted(values[column])
        count = len(series)
        if count:
            median = series[count // 2] if count % 2 else (series[count // 2 - 1] + series[count // 2]) / 2
            result.append({
                "variable": column,
                "valid_count": count,
                "missing_count": missing[column],
                "missing_pct": 100 * missing[column] / len(rows) if rows else 0,
                "minimum": series[0],
                "q25": series[int((count - 1) * 0.25)],
                "median": median,
                "q75": series[int((count - 1) * 0.75)],
                "maximum": series[-1],
            })
        else:
            result.append({
                "variable": column,
                "valid_count": 0,
                "missing_count": missing[column],
                "missing_pct": 100.0 if rows else 0,
                "minimum": "",
                "q25": "",
                "median": "",
                "q75": "",
                "maximum": "",
            })
    return result


def latitude_band(latitude: float) -> str:
    if latitude < -60:
        return "south_polar_60_to_90"
    if latitude < -30:
        return "south_mid_30_to_60"
    if latitude < 0:
        return "south_tropics_0_to_30"
    if latitude < 30:
        return "north_tropics_0_to_30"
    if latitude < 60:
        return "north_mid_30_to_60"
    return "north_polar_60_to_90"


def candidate_rows(
    rows: list[dict[str, str]],
    sites: list[dict[str, str]],
    scenario_name: str,
    scenario: dict[str, Any],
) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    mars_sites = [site for site in sites if site["mission_body"] == "MARS"]
    for site in mars_sites:
        for row in rows:
            decision = screening_decision(row, scenario)
            if not decision["eligible"]:
                continue
            latitude = float(row["lat"])
            longitude = normalize_longitude(float(row["lon"]))
            cluster = row.get("kmeans_cluster", "")
            dbscan = row.get("dbscan_cluster", "")
            available = 3 - len(decision["unavailable"])
            result.append({
                **row,
                "reference_site": site["site"],
                "site_id": site["site_id"],
                "mission_body": "MARS",
                "screening_scenario": scenario_name,
                "earth_cell_id": f"{int(float(row['grid_row']))}:{int(float(row['grid_col']))}",
                "lat": latitude,
                "lon": longitude,
                "candidate_tier": decision["candidate_tier"],
                "similarity_score": "",
                "score_type": "screening_only",
                "eligible_feature_count": 0,
                "available_feature_count": 0,
                "feature_coverage_pct": "",
                "screening_criteria_available_count": available,
                "screening_evidence_coverage_pct": round(100 * available / 3, 2),
                "missing_features": ";".join(decision["unavailable"]),
                "screening_conditions_passed": ";".join(decision["passed"]),
                "screening_conditions_unavailable": ";".join(decision["unavailable"]),
                "screening_conditions_failed": ";".join(decision["failed"]),
                "filter_land_pass": decision["filter_land_pass"],
                "filter_vegetation_pass": decision["filter_vegetation_pass"],
                "filter_aridity_pass": decision["filter_aridity_pass"],
                "filter_aridity_status": decision["filter_aridity_status"],
                "kmeans_cluster": cluster,
                "dbscan_cluster": dbscan,
                "explanation": decision["explanation"],
                "limitations": site["spatial_scope_note"],
                "data_quality_status": decision["data_quality_status"],
            })
    return result


def circular_mean_longitude(longitudes: list[float]) -> float:
    if not longitudes:
        return 0.0
    radians = [math.radians(normalize_longitude(value)) for value in longitudes]
    sin_mean = sum(math.sin(value) for value in radians) / len(radians)
    cos_mean = sum(math.cos(value) for value in radians) / len(radians)
    return normalize_longitude(math.degrees(math.atan2(sin_mean, cos_mean)))


def summarize_regions(
    cells: list[dict[str, Any]],
    grid_height: int,
    grid_width: int,
) -> list[dict[str, Any]]:
    by_grid: dict[tuple[int, int], dict[str, Any]] = {}
    for cell in cells:
        key = int(float(cell["grid_row"])), int(float(cell["grid_col"]))
        by_grid[key] = cell
    unseen = set(by_grid)
    components: list[list[dict[str, Any]]] = []
    while unseen:
        start = unseen.pop()
        queue = deque([start])
        component = [by_grid[start]]
        while queue:
            row, col = queue.popleft()
            neighbors = (
                (row - 1, col),
                (row + 1, col),
                (row, (col - 1) % grid_width),
                (row, (col + 1) % grid_width),
            )
            for neighbor in neighbors:
                if (
                    neighbor in unseen
                    and 0 <= neighbor[0] < grid_height
                    and by_grid[neighbor]["candidate_tier"] == by_grid[start]["candidate_tier"]
                ):
                    unseen.remove(neighbor)
                    queue.append(neighbor)
                    component.append(by_grid[neighbor])
        components.append(component)

    regions: list[dict[str, Any]] = []
    for component in components:
        first = component[0]
        latitudes = [float(cell["lat"]) for cell in component]
        longitudes = [float(cell["lon"]) for cell in component]
        areas = [
            cell_area_km2(float(cell["lat"]), GRID_STEP_DEGREES)
            * (parse_number(cell.get("land_fraction")) or 0.0)
            for cell in component
        ]
        representative = min(
            component,
            key=lambda cell: (
                parse_number(cell.get("vegetation")) is None,
                parse_number(cell.get("vegetation")) or math.inf,
                int(float(cell["grid_row"])),
                int(float(cell["grid_col"])),
            ),
        )

        def median_value(column: str) -> float | str:
            values = sorted(
                value for cell in component
                if (value := parse_number(cell.get(column))) is not None
            )
            if not values:
                return ""
            middle = len(values) // 2
            return values[middle] if len(values) % 2 else (values[middle - 1] + values[middle]) / 2

        def mode_value(column: str) -> str:
            counts = Counter(str(cell.get(column, "")).strip() for cell in component)
            counts.pop("", None)
            return counts.most_common(1)[0][0] if counts else ""

        feature_summaries: dict[str, dict[str, Any]] = {}
        for column in FEATURE_SUMMARY_COLUMNS:
            values = [
                value for cell in component
                if (value := parse_number(cell.get(column))) is not None
            ]
            feature_summaries[column] = {
                "median": median_value(column) if values else None,
                "available_cells": len(values),
                "missing_cells": len(component) - len(values),
            }
        for column in ("glim_code", "glim_classe"):
            available = sum(bool(str(cell.get(column, "")).strip()) for cell in component)
            feature_summaries[column] = {
                "mode": mode_value(column) or None,
                "available_cells": available,
                "missing_cells": len(component) - available,
            }

        region_id = (
            f"{first['site_id']}_{first['screening_scenario']}_"
            f"{int(float(representative['grid_row']))}_{int(float(representative['grid_col']))}"
        )
        regions.append({
            "reference_site": first["reference_site"],
            "site_id": first["site_id"],
            "mission_body": first["mission_body"],
            "screening_scenario": first["screening_scenario"],
            "region_id": region_id,
            "candidate_tier": first["candidate_tier"],
            "support_cells": len(component),
            "approx_area_km2": round(sum(areas), 3),
            "centroid_lat": round(sum(latitudes) / len(latitudes), 6),
            "centroid_lon": round(circular_mean_longitude(longitudes), 6),
            "representative_lat": float(representative["lat"]),
            "representative_lon": float(representative["lon"]),
            "earth_cell_id": representative["earth_cell_id"],
            "vegetation_median": median_value("vegetation"),
            "vegetation_min": min(
                (value for cell in component if (value := parse_number(cell.get("vegetation"))) is not None),
                default="",
            ),
            "ai_valeur_median": median_value("ai_valeur"),
            "aridity_class_mode": mode_value("ai_classe_nom"),
            "land_fraction_mean": round(
                sum(parse_number(cell.get("land_fraction")) or 0.0 for cell in component)
                / len(component), 6
            ),
            "kmeans_cluster_mode": mode_value("kmeans_cluster"),
            "dbscan_cluster_mode": mode_value("dbscan_cluster"),
            "median_slope": median_value("slope"),
            "median_local_relief_m": median_value("local_relief_m"),
            "screening_conditions_passed": first["screening_conditions_passed"],
            "screening_conditions_unavailable": first["screening_conditions_unavailable"],
            "screening_conditions_failed": first["screening_conditions_failed"],
            "screening_evidence_coverage_pct": round(
                sum(float(cell["screening_evidence_coverage_pct"]) for cell in component)
                / len(component), 2
            ),
            "feature_summaries_json": json.dumps(feature_summaries, ensure_ascii=False, allow_nan=False),
            "explanation": first["explanation"],
            "limitations": first["limitations"],
            "similarity_score": "",
            "score_type": "screening_only",
            "ranking_basis": "region_cell_count_only_not_similarity",
            "data_quality_status": first["data_quality_status"],
        })
    return sorted(regions, key=lambda region: (-int(region["support_cells"]), region["region_id"]))


def read_sites() -> list[dict[str, str]]:
    _, sites = read_csv(SITES_PATH)
    expected = {
        "MOON_SHACKLETON", "MOON_MALAPERT", "MOON_HAWORTH", "MARS_GALE", "MARS_UTOPIA"
    }
    actual = {site.get("site_id", "") for site in sites}
    if actual != expected:
        raise ValueError(f"Reference site IDs differ from the expected five: {sorted(actual)}")
    return sites


def read_compatibility() -> tuple[list[str], list[dict[str, str]]]:
    fields, rows = read_csv(COMPATIBILITY_PATH)
    if len(rows) != 17:
        raise ValueError(f"Expected 17 existing compatibility criteria; found {len(rows)}.")
    if any(str(row.get("score_eligible_now", "")).casefold() not in {"false", "0"} for row in rows):
        raise ValueError("An existing criterion is marked score-eligible; review policy before proceeding.")
    return fields, rows


def source_refs_for_site(site: dict[str, str]) -> list[dict[str, str]]:
    sources: list[Path] = []
    if site["mission_body"] == "MOON":
        sources = [ROOT / "mission_data" / "raw" / "lunar_reference.csv"]
    else:
        sources = sorted((ROOT / "mission_data" / "raw" / "mars").glob("*.csv"))
    records: list[dict[str, str]] = []
    site_name = normalized_label(site["site"])
    site_token = normalized_label(site["site"].split()[0])
    for path in sources:
        _, rows = read_csv(path)
        for row in rows:
            locator = " ".join(
                str(value)
                for key, value in row.items()
                if normalized_label(key) in {"site", "location", "region"}
            )
            normalized_locator = normalized_label(locator)
            if site_name in normalized_locator or site_token in normalized_locator.split():
                records.append({"source_file": path.relative_to(ROOT).as_posix(), **row})
    return records


def reference_records_for_criterion(
    site: dict[str, str],
    criterion: str,
    records: list[dict[str, str]],
) -> list[dict[str, str]]:
    if site["mission_body"] == "MOON":
        return [
            record for record in records
            if record.get("source_file", "").endswith("lunar_reference.csv")
        ]
    source_by_criterion = {
        "annual_temperature_range": "annual_temperature.csv",
        "aridity": "aridity.csv",
        "solar_flux": "solar_flux.csv",
        "elevation": "elevation.csv",
        "geological_composition": "geology.csv",
        "lst_diurnal_range": "diurnal_temperature.csv",
        "mean_annual_temperature": "mean_temperature.csv",
        "precipitation": "precipitation.csv",
        "local_relief": "local_relief.csv",
        "rock_abundance": "rock_abundance.csv",
        "roughness": "roughness.csv",
        "slope": "slope.csv",
        "vegetation": "vegetation.csv",
    }
    source_name = source_by_criterion.get(criterion)
    if source_name is None:
        return []
    return [
        record for record in records
        if Path(record.get("source_file", "")).name == source_name
    ]


def reference_definition(
    records: list[dict[str, str]],
    criterion: str,
) -> tuple[str, str, str, str]:
    if not records:
        return "", "", "", ""
    record = records[0]
    source = record.get("source_file", "")
    if source.endswith("lunar_reference.csv"):
        mapping = {
            "geology_category": (
                "feature_1_geology_description", "feature_1_data_scope", "feature_1_scoring_rule"
            ),
            "local_relief_m": (
                "feature_4_local_relief_m", "feature_4_dem_resolution_m", "feature_4_scoring_rule"
            ),
            "mean_slope_deg": (
                "feature_4_mean_slope_deg", "feature_4_dem_resolution_m", "feature_4_scoring_rule"
            ),
            "mean_solar_visibility_pct": (
                "feature_5_mean_solar_visibility_pct", "feature_5_model_resolution_m", "feature_5_scoring_rule"
            ),
        }
        fields = mapping.get(criterion, ("", "", ""))
        unit_by_criterion = {
            "geology_category": "categorical description",
            "local_relief_m": "m",
            "mean_slope_deg": "degrees",
            "mean_solar_visibility_pct": "%",
        }
        return (
            record.get(fields[0], ""),
            record.get(fields[1], ""),
            record.get(fields[2], ""),
            unit_by_criterion.get(criterion, ""),
        )
    definitions = list(dict.fromkeys(
        row.get("definition")
        or row.get("notes")
        or row.get("interpretation_notes")
        or row.get("qualitative_aridity")
        or row.get("metric", "")
        for row in records
        if row.get("definition") or row.get("notes") or row.get("interpretation_notes")
        or row.get("qualitative_aridity") or row.get("metric")
    ))
    scales = list(dict.fromkeys(
        row.get("spatial_and_method_notes")
        or row.get("subregion")
        or row.get("measurement_basis")
        or row.get("site", "")
        for row in records
        if row.get("spatial_and_method_notes") or row.get("subregion")
        or row.get("measurement_basis") or row.get("site")
    ))
    urls = list(dict.fromkeys(row.get("source_url", "") for row in records if row.get("source_url")))
    units = list(dict.fromkeys(row.get("unit", "") for row in records if row.get("unit")))
    if criterion == "local_relief":
        definitions = [record.get("relief_local_m", "")]
        units = ["m"]
    elif criterion == "solar_flux":
        solar_values = [
            value for key, value in record.items()
            if "flux_vis" in normalized_label(key) and value
        ]
        definitions = solar_values
        units = ["W/m2"] if solar_values else []
    return (
        " | ".join(value for value in definitions if value),
        " | ".join(value for value in scales if value),
        " | ".join(urls),
        " | ".join(units),
    )


def expand_compatibility(
    existing_fields: list[str],
    existing_rows: list[dict[str, str]],
    sites: list[dict[str, str]],
) -> list[dict[str, Any]]:
    earth_sources = {
        "ai_valeur": "earth_layers/aridity.csv",
        "ai_classe_nom": "earth_layers/aridity.csv",
        "vegetation": "predictors.zarr/vegetation",
        "local_relief_m": "earth_layers/local_relief.csv",
        "glim_code": "earth_layers/geological.csv",
        "glim_classe": "earth_layers/geological.csv",
        "bare_pct": "earth_layers/rock_cover.csv",
        "land_frac": "earth_layers/rock_cover.csv",
        "ssrd_wm2": "earth_layers/solar_illumination.csv",
        "energie_kwh_m2_an": "earth_layers/solar_illumination.csv",
    }
    earth_units = {
        "ai_valeur": "TO_VERIFY",
        "ai_classe_nom": "categorical",
        "vegetation": "TO_VERIFY",
        "local_relief_m": "m",
        "slope": "degrees; statistic/scale TO_VERIFY",
        "glim_code": "categorical",
        "glim_classe": "categorical",
        "bare_pct": "TO_VERIFY",
        "land_frac": "TO_VERIFY",
        "ssrd_wm2": "W/m2; source definition TO_VERIFY",
        "energie_kwh_m2_an": "kWh/m2/year; source definition TO_VERIFY",
    }
    status_overrides = {
        "aridity": "SCREENING_ONLY",
        "vegetation": "SCREENING_ONLY",
        "geology_category": "QUALITATIVE_ONLY",
        "geological_composition": "QUALITATIVE_ONLY",
        "rock_abundance": "EXCLUDED",
        "elevation": "EXCLUDED",
        "mean_solar_visibility_pct": "EXCLUDED",
        "lst_diurnal_range": "NEEDS_VALIDATION",
        "annual_temperature_range": "NEEDS_VALIDATION",
        "mean_annual_temperature": "NEEDS_VALIDATION",
        "precipitation": "NEEDS_VALIDATION",
        "local_relief": "NEEDS_VALIDATION",
        "local_relief_m": "NEEDS_VALIDATION",
        "slope": "NEEDS_VALIDATION",
        "mean_slope_deg": "NEEDS_VALIDATION",
        "roughness": "NEEDS_VALIDATION",
        "solar_flux": "NEEDS_VALIDATION",
    }
    by_body: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in existing_rows:
        by_body[row["mission_body"]].append(row)

    expanded: list[dict[str, Any]] = []
    for site in sites:
        records = source_refs_for_site(site)
        for base in by_body[site["mission_body"]]:
            criterion = base["criterion"]
            status = status_overrides.get(criterion)
            if status is None:
                old = base["decision"].upper()
                status = "NEEDS_VALIDATION" if old == "CONDITIONAL" else "QUALITATIVE_ONLY"
            criterion_records = reference_records_for_criterion(
                site,
                criterion,
                records,
            )
            if site["mission_body"] == "MARS":
                site_token = normalized_label(site["site"].split()[0])
                criterion_records = [
                    record for record in criterion_records
                    if any(site_token in normalized_label(value) for value in record.values())
                ]
            reference_def, reference_scale, reference_source, reference_unit = reference_definition(
                criterion_records,
                criterion,
            )
            if not reference_def:
                reference_def = base["reason"]
            earth_feature = base.get("earth_feature", "")
            earth_cols = [part.strip() for part in earth_feature.split(";")]
            earth_source = ";".join(dict.fromkeys(
                earth_sources.get(column, "source product/definition TO_VERIFY")
                for column in earth_cols
            ))
            validation = base.get("validation_needed", "")
            if status == "SCREENING_ONLY":
                validation = (
                    "Use only as an explicitly labelled screening proxy; the proxy does not establish "
                    "a Martian physical equivalent."
                )
            expanded.append({
                "mission_body": site["mission_body"],
                "reference_site": site["site"],
                "site_id": site["site_id"],
                "criterion": criterion,
                "earth_feature": earth_feature,
                "reference_feature": criterion,
                "earth_unit": ";".join(dict.fromkeys(
                    earth_units.get(column, "TO_VERIFY") for column in earth_cols
                )),
                "reference_unit": reference_unit,
                "earth_measurement_definition": "TO_VERIFY in earth_feature_metadata_template.csv",
                "reference_measurement_definition": reference_def,
                "earth_spatial_temporal_scale": "Global 0.5-degree grid; source resolution/period TO_VERIFY",
                "reference_spatial_temporal_scale": reference_scale,
                "compatibility_status": status,
                "score_eligible_now": False,
                "scientific_justification": base.get("reason", ""),
                "remaining_validation": validation,
                "earth_source_provenance": earth_source,
                "reference_source_file": base.get("mission_source_file", ""),
                "reference_source_url": reference_source,
            })
    return expanded


def write_csv_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def regions_geojson(regions: list[dict[str, Any]]) -> dict[str, Any]:
    features = []
    for region in regions:
        properties = {
            key: value
            for key, value in region.items()
            if key != "feature_summaries_json"
        }
        if region.get("feature_summaries_json"):
            properties["feature_summaries"] = json.loads(region["feature_summaries_json"])
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [region["representative_lon"], region["representative_lat"]],
            },
            "properties": {
                **properties,
                "classification": "screening region—not a validated planetary analogue",
            },
        })
    return {"type": "FeatureCollection", "features": features}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def run_pipeline(
    strict_threshold: float | None = None,
    extended_threshold: float | None = None,
    policy_path: Path = POLICY_PATH,
) -> dict[str, Any]:
    policy = json.loads(policy_path.read_text(encoding="utf-8"))
    if strict_threshold is not None:
        policy["screening_scenarios"]["strict"]["vegetation_max"] = strict_threshold
    if extended_threshold is not None:
        policy["screening_scenarios"]["extended"]["vegetation_max"] = extended_threshold
    validate_policy(policy)

    earth_fields, earth_rows = read_csv(EARTH_PATH)
    kmeans = read_cluster_labels(KMEANS_PATH, "latitude", "longitude")
    dbscan = read_cluster_labels(DBSCAN_PATH, "latitude", "longitude")
    preservation = validate_earth_rows(earth_rows, kmeans, dbscan)
    sites = read_sites()
    compatibility_fields, compatibility_rows = read_compatibility()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    numeric_columns = [
        "ai_valeur", "vegetation", "land_fraction", "lat", "lon",
        "slope", "local_relief_m", "roughness",
    ]
    audit = numeric_summaries(earth_rows, numeric_columns)
    write_csv(OUTPUT_DIR / "earth_screening_audit.csv", list(audit[0]), audit)

    categorical_counts: Counter[tuple[str, str]] = Counter()
    latitude_counts: dict[str, Counter[str]] = defaultdict(Counter)
    threshold_counts: Counter[tuple[str, str]] = Counter()
    candidate_latitude_counts: Counter[tuple[str, str]] = Counter()
    filter_counts: Counter[tuple[str, str, str]] = Counter()
    for row in earth_rows:
        lat = parse_number(row.get("lat"))
        if lat is None:
            continue
        band = latitude_band(lat)
        cls = row.get("ai_classe_nom", "").strip() or "UNKNOWN"
        categorical_counts[("ai_classe_nom", cls)] += 1
        latitude_counts[band]["cells"] += 1
        if parse_number(row.get("ai_valeur")) is not None:
            latitude_counts[band]["aridity_available"] += 1
        if parse_number(row.get("vegetation")) is not None:
            latitude_counts[band]["vegetation_available"] += 1
        for name, scenario in policy["screening_scenarios"].items():
            decision = screening_decision(row, scenario)
            if decision["eligible"]:
                threshold_counts[(name, decision["candidate_tier"])] += 1
                candidate_latitude_counts[(name, band)] += 1
            for filter_name, passed in (
                ("land_fraction", decision["filter_land_pass"]),
                ("vegetation", decision["filter_vegetation_pass"]),
                ("aridity_category", decision["filter_aridity_pass"]),
            ):
                if filter_name == "aridity_category" and decision["filter_aridity_status"] == "UNKNOWN_SOUTHERN_POLAR_ARIDITY":
                    outcome = "unknown"
                elif passed:
                    outcome = "pass"
                elif filter_name == "land_fraction" and parse_number(row.get("land_fraction")) is None:
                    outcome = "unknown"
                elif filter_name == "vegetation" and parse_number(row.get("vegetation")) is None:
                    outcome = "unknown"
                elif filter_name == "aridity_category" and decision["filter_aridity_status"] == "UNKNOWN_ARIDITY":
                    outcome = "unknown"
                else:
                    outcome = "fail"
                filter_counts[(name, filter_name, outcome)] += 1
            if (
                name == "strict"
                and decision["filter_aridity_status"] == "UNKNOWN_SOUTHERN_POLAR_ARIDITY"
            ):
                latitude_counts[band]["aridity_unknown_southern_polar"] += 1

    category_rows = [
        {"field": field, "category": category, "count": count}
        for (field, category), count in sorted(categorical_counts.items())
    ]
    write_csv(OUTPUT_DIR / "earth_screening_categories.csv", ["field", "category", "count"], category_rows)
    coverage_rows = [
        {
            "latitude_band": band,
            **{
                field: counts.get(field, 0)
                for field in (
                    "cells",
                    "aridity_available",
                    "vegetation_available",
                    "aridity_unknown_southern_polar",
                )
            },
            "strict_screened_candidates": candidate_latitude_counts[("strict", band)],
            "extended_screened_candidates": candidate_latitude_counts[("extended", band)],
        }
        for band, counts in sorted(latitude_counts.items())
    ]
    write_csv(
        OUTPUT_DIR / "screening_coverage_by_latitude.csv",
        [
            "latitude_band", "cells", "aridity_available", "vegetation_available",
            "aridity_unknown_southern_polar", "strict_screened_candidates",
            "extended_screened_candidates",
        ],
        coverage_rows,
    )
    screening_filter_rows = [
        {
            "scenario": scenario_name,
            "filter": filter_name,
            "outcome": outcome,
            "cell_count": filter_counts.get((scenario_name, filter_name, outcome), 0),
            "percent_of_earth_cells": round(
                100 * filter_counts.get((scenario_name, filter_name, outcome), 0) / len(earth_rows),
                3,
            ),
        }
        for scenario_name in ("strict", "extended")
        for filter_name in ("land_fraction", "vegetation", "aridity_category")
        for outcome in ("pass", "fail", "unknown")
    ]
    write_csv(
        OUTPUT_DIR / "screening_filter_audit.csv",
        ["scenario", "filter", "outcome", "cell_count", "percent_of_earth_cells"],
        screening_filter_rows,
    )

    candidate_fields = earth_fields + [
        field for field in BASE_RESULT_FIELDS
        if field not in earth_fields and field not in {"lat", "lon"}
    ]
    mars_candidates: list[dict[str, Any]] = []
    all_regions: list[dict[str, Any]] = []
    coverage_report: list[dict[str, Any]] = []
    for scenario_name, scenario in policy["screening_scenarios"].items():
        selected = candidate_rows(earth_rows, sites, scenario_name, scenario)
        mars_candidates.extend(selected)
        for site in (site for site in sites if site["mission_body"] == "MARS"):
            site_cells = [
                cell for cell in selected
                if cell["site_id"] == site["site_id"]
            ]
            regions = summarize_regions(site_cells, grid_height=360, grid_width=720)
            all_regions.extend(regions)
            known_aridity = sum(
                cell["filter_aridity_status"] == "KNOWN_DRY_CLASS" for cell in site_cells
            )
            unknown_aridity = sum(
                cell["filter_aridity_status"] == "UNKNOWN_SOUTHERN_POLAR_ARIDITY"
                for cell in site_cells
            )
            coverage_report.append({
                "reference_site": site["site"],
                "site_id": site["site_id"],
                "mission_body": site["mission_body"],
                "screening_scenario": scenario_name,
                "earth_cells_tested": len(earth_rows),
                "screening_candidate_cells": len(site_cells),
                "screening_evidence_coverage_pct": (
                    round(
                        sum(float(cell["screening_evidence_coverage_pct"]) for cell in site_cells)
                        / len(site_cells),
                        2,
                    )
                    if site_cells else 0
                ),
                "candidate_regions": len(regions),
                "known_dry_class_cells": known_aridity,
                "aridity_unknown_southern_polar_cells": unknown_aridity,
                "numeric_score_eligible_features": 0,
                "numeric_similarity_score": "",
                "result_type": "screening_only",
                "interpretation": (
                    "Shared Mars-wide exploratory terrestrial dry-class/low-vegetation screen, "
                    "applied identically for Gale and Utopia. Site labels provide reference context, "
                    "not site-specific analogue scores or validated matches."
                ),
                "site_scope_note": site["spatial_scope_note"],
            })
        for site in (site for site in sites if site["mission_body"] == "MOON"):
            coverage_report.append({
                "reference_site": site["site"],
                "site_id": site["site_id"],
                "mission_body": site["mission_body"],
                "screening_scenario": scenario_name,
                "earth_cells_tested": len(earth_rows),
                "screening_candidate_cells": 0,
                "screening_evidence_coverage_pct": 0,
                "candidate_regions": 0,
                "known_dry_class_cells": 0,
                "aridity_unknown_southern_polar_cells": 0,
                "numeric_score_eligible_features": 0,
                "numeric_similarity_score": "",
                "result_type": "context_only",
                "interpretation": (
                    "No lunar screening candidates or similarity scores are generated. The frontend offers user-filtered "
                    "descriptive Earth terrain, GLiM and surface contexts; these are not lunar matches."
                ),
                "site_scope_note": site["spatial_scope_note"],
            })

    moon_fields = candidate_fields
    write_csv(OUTPUT_DIR / "mars_screening_candidates.csv", candidate_fields, mars_candidates)
    write_csv(OUTPUT_DIR / "moon_screening_candidates.csv", moon_fields, [])
    region_fields = list(all_regions[0]) if all_regions else [
        "reference_site", "site_id", "mission_body", "screening_scenario", "region_id",
        "candidate_tier", "support_cells", "approx_area_km2", "centroid_lat", "centroid_lon",
        "representative_lat", "representative_lon", "earth_cell_id", "vegetation_median",
        "vegetation_min", "ai_valeur_median", "aridity_class_mode", "land_fraction_mean",
        "kmeans_cluster_mode", "dbscan_cluster_mode", "median_slope", "median_local_relief_m",
        "screening_conditions_passed", "screening_conditions_unavailable", "screening_evidence_coverage_pct", "explanation",
        "screening_conditions_failed", "feature_summaries_json", "limitations", "similarity_score",
        "score_type", "ranking_basis", "data_quality_status",
    ]
    write_csv(OUTPUT_DIR / "analogue_regions.csv", region_fields, all_regions)
    region_export = [
        region for region in all_regions
        if region["screening_scenario"] == "extended"
    ]
    top_fields = region_fields
    write_csv(OUTPUT_DIR / "top_analogs_per_reference.csv", top_fields, region_export)

    write_csv_json(OUTPUT_DIR / "analogue_regions.geojson", regions_geojson(region_export))

    # This file intentionally has no rows: no feature is approved for numerical comparison.
    contribution_fields = [
        "reference_site", "mission_body", "earth_cell_id", "feature",
        "difference", "normalized_distance", "weight", "similarity_contribution",
        "exclusion_reason",
    ]
    write_csv(OUTPUT_DIR / "feature_contributions.csv", contribution_fields, [])
    write_csv(
        OUTPUT_DIR / "matching_coverage_report.csv",
        list(coverage_report[0]) if coverage_report else ["reference_site"],
        coverage_report,
    )
    matching_results = [
        region for region in region_export
    ]
    write_csv(
        OUTPUT_DIR / "mission_matching_results.csv",
        top_fields,
        matching_results,
    )
    final_compatibility = expand_compatibility(compatibility_fields, compatibility_rows, sites)
    write_csv(
        ROOT / "mission_data" / "scoring" / "feature_compatibility_final.csv",
        list(final_compatibility[0]),
        final_compatibility,
    )
    counts_rows = [
        {
            "scenario": scenario,
            "candidate_tier": tier,
            "count_per_martian_reference_site": count,
            "count_including_two_independent_reference_sets": count * 2,
        }
        for (scenario, tier), count in sorted(threshold_counts.items())
    ]
    write_csv(
        OUTPUT_DIR / "screening_candidate_counts.csv",
        ["scenario", "candidate_tier", "count_per_martian_reference_site", "count_including_two_independent_reference_sets"],
        counts_rows,
    )
    reference_details = {
        site["site_id"]: {
            "site": site,
            "records": source_refs_for_site(site),
        }
        for site in sites
    }
    write_csv_json(OUTPUT_DIR / "mission_reference_details.json", reference_details)

    protected_inputs = [EARTH_PATH, KMEANS_PATH, DBSCAN_PATH]
    manifest = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "earth_input": EARTH_PATH.relative_to(ROOT).as_posix(),
        "earth_rows": len(earth_rows),
        "reference_site_count": len(sites),
        "numeric_similarity_enabled": False,
        "numeric_eligible_criteria": 0,
        "screening_policy": policy,
        "screening_candidate_rows": len(mars_candidates),
        "screening_region_rows": len(all_regions),
        "lunar_context_source": {
            "path": "outputs/astromatch_enriched_earth.csv",
            "rows": len(earth_rows),
            "frontend_use": "User-filtered descriptive terrain, geology and surface context; no lunar similarity scoring.",
        },
        "cluster_label_regression": preservation,
        "protected_input_sha256": {
            path.relative_to(ROOT).as_posix(): sha256_file(path)
            for path in protected_inputs
        },
        "generated_files": [
            "earth_screening_audit.csv",
            "earth_screening_categories.csv",
            "screening_coverage_by_latitude.csv",
            "screening_filter_audit.csv",
            "screening_candidate_counts.csv",
            "mars_screening_candidates.csv",
            "moon_screening_candidates.csv",
            "analogue_regions.csv",
            "top_analogs_per_reference.csv",
            "analogue_regions.geojson",
            "feature_contributions.csv",
            "matching_coverage_report.csv",
            "mission_matching_results.csv",
            "mission_reference_details.json",
            "feature_compatibility_final.csv",
        ],
        "output_notes": [
            "Similarity scores and feature contributions are intentionally empty.",
            "The same Mars-wide terrestrial screen is repeated for Gale and Utopia; repeated candidates are not site-specific analogue findings.",
            "Moon candidate CSV is intentionally empty because available criteria are not validated for numeric or site-specific screening.",
            "Region cell-count order is not an analogue-suitability ranking.",
            "Aridity missing at latitudes south of -60 degrees is marked unknown and is not interpreted as dry.",
        ],
    }
    write_csv_json(OUTPUT_DIR / "matching_run_manifest.json", manifest)
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description="Build conservative ASTROMATCH mission screening outputs.")
    parser.add_argument("--strict-vegetation-threshold", type=float)
    parser.add_argument("--extended-vegetation-threshold", type=float)
    parser.add_argument("--policy", type=Path, default=POLICY_PATH)
    args = parser.parse_args()
    manifest = run_pipeline(
        strict_threshold=args.strict_vegetation_threshold,
        extended_threshold=args.extended_vegetation_threshold,
        policy_path=args.policy,
    )
    print(f"ASTROMATCH screening outputs written to {OUTPUT_DIR}")
    print(f"Earth rows checked: {manifest['earth_rows']}")
    print(f"Saved K-Means/DBSCAN labels unchanged: {manifest['cluster_label_regression']['labels_match_saved_csvs']}")
    print(f"Screening rows: {manifest['screening_candidate_rows']}")
    print(f"Numeric similarity eligible criteria: {manifest['numeric_eligible_criteria']}")
    print("Scores are disabled; screening outputs are not validated planetary analogues.")


if __name__ == "__main__":
    main()
