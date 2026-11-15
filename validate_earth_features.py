"""Quality-control audit for TerraNova's merged global Earth feature dataset.

Expected layout (script in repository root):
    earth_all_features.csv
    earth_layers/
        aridity.csv
        geological.csv
        local_relief.csv
        rock_cover.csv
        solar_illumination.csv

Run:
    python validate_earth_features.py

This script DOES NOT edit earth_all_features.csv. It creates an outputs/
folder containing diagnostic CSVs, a text report and (if matplotlib is
installed) a global missing-data map.
"""
from __future__ import annotations

import math
import re
import sys
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parent
MASTER_CSV = ROOT / "earth_all_features.csv"
LAYER_DIR = ROOT / "earth_layers"
OUTPUT_DIR = ROOT / "outputs"

# TerraNova's current reference grid: 360 x 720 global cell centres at 0.5 degrees.
GRID_ROWS = 360
GRID_COLS = 720
CELL_DEGREES = 0.5
GRID_LAT_ORIGIN = 89.75
GRID_LON_ORIGIN = -179.75
EARTH_RADIUS_KM = 6371.0088
NEAREST_LIMIT_KM = 65.0  # Must match the merge script used to build the master CSV.
COORD_TOLERANCE_DEGREES = 1e-4

BASE_PREDICTORS = [
    "precipitation",
    "vegetation",
    "annual_temperature_range",
    "lst_diurnal_range",
    "slope",
    "roughness",
    "elevation",
    "mean_annual_temperature",
]

LAYER_SPECS: dict[str, dict[str, Any]] = {
    "aridity": {
        "file": "aridity.csv",
        "columns": ["ai_valeur", "ai_classe_code", "ai_classe_nom"],
        "primary": "ai_valeur",
    },
    "geological": {
        "file": "geological.csv",
        "columns": ["glim_code", "glim_classe"],
        "primary": "glim_code",
    },
    "local_relief": {
        "file": "local_relief.csv",
        "columns": ["local_relief_m"],
        "primary": "local_relief_m",
    },
    "rock_cover": {
        "file": "rock_cover.csv",
        "columns": ["bare_pct", "land_frac"],
        "primary": "bare_pct",
    },
    "solar_illumination": {
        "file": "solar_illumination.csv",
        "columns": ["ssrd_wm2", "energie_kwh_m2_an"],
        "primary": "energie_kwh_m2_an",
    },
}

# Feature groups used to report the number of candidate cells with complete data.
FEATURE_GROUPS: dict[str, list[str]] = {
    "base_8_predictors": BASE_PREDICTORS,
    "aridity": ["ai_valeur"],
    "geological": ["glim_code"],
    "local_relief": ["local_relief_m"],
    "rock_cover": ["bare_pct"],
    "solar_illumination": ["energie_kwh_m2_an"],
}


def normalise_name(value: object) -> str:
    name = str(value).strip().strip('"').strip("'").lstrip("\ufeff").lower()
    return re.sub(r"[^a-z0-9]+", "_", name).strip("_")


def detect_delimiter(path: Path) -> str:
    candidates: list[tuple[int, str]] = []
    for delimiter in [",", ";", "\t", "|"]:
        try:
            sample = pd.read_csv(path, sep=delimiter, nrows=5, dtype=str, engine="python")
            names = {normalise_name(c) for c in sample.columns}
            has_lon = bool(names & {"lon", "long", "longitude", "lng", "x"})
            has_lat = bool(names & {"lat", "latitude", "y"})
            score = 100 * (int(has_lon) + int(has_lat)) + len(sample.columns)
            candidates.append((score, delimiter))
        except Exception:
            continue
    if not candidates:
        raise ValueError(f"Cannot detect delimiter in {path}")
    score, delimiter = max(candidates, key=lambda item: item[0])
    if score < 200:
        raise ValueError(
            f"Cannot identify separate lon/lat columns in {path.name}. "
            "Check the CSV header and delimiter."
        )
    return delimiter


def to_numeric_decimal_comma(series: pd.Series) -> pd.Series:
    text = series.astype("string").str.strip()
    # Source CSVs may use decimal commas with semicolon delimiters.
    text = text.str.replace(",", ".", regex=False)
    return pd.to_numeric(text, errors="coerce")


def read_source_layer(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(f"Source file not found: {path}")
    delimiter = detect_delimiter(path)
    df = pd.read_csv(path, sep=delimiter, dtype=str, engine="python")
    df.columns = [normalise_name(c) for c in df.columns]

    rename: dict[str, str] = {}
    for column in df.columns:
        if column in {"longitude", "long", "lng", "x"}:
            rename[column] = "lon"
        elif column in {"latitude", "y"}:
            rename[column] = "lat"
    df = df.rename(columns=rename)

    if df.columns.duplicated().any():
        raise ValueError(f"{path.name}: duplicate headers after normalisation")
    if not {"lon", "lat"}.issubset(df.columns):
        raise ValueError(f"{path.name}: expected lon and lat columns; found {list(df.columns)}")

    df["lon"] = to_numeric_decimal_comma(df["lon"])
    df["lat"] = to_numeric_decimal_comma(df["lat"])
    invalid = df[["lon", "lat"]].isna().any(axis=1)
    invalid_count = int(invalid.sum())
    df = df.loc[~invalid].copy()
    if df.empty:
        raise ValueError(f"{path.name}: no valid coordinates after parsing")
    if not df["lat"].between(-90, 90).all():
        raise ValueError(f"{path.name}: latitude outside [-90, 90]")
    df["lon"] = ((df["lon"].astype(float) + 180.0) % 360.0) - 180.0
    df["lat"] = df["lat"].astype(float)

    for column in df.columns:
        if column in {"lon", "lat"}:
            continue
        raw = df[column].astype("string").str.strip()
        nonempty = raw.notna() & raw.ne("")
        if nonempty.any():
            numeric = to_numeric_decimal_comma(df[column])
            if numeric[nonempty].notna().mean() >= 0.90:
                df[column] = numeric
            else:
                df[column] = raw.replace({"": pd.NA, "nan": pd.NA, "None": pd.NA})

    df.attrs["invalid_coordinate_rows"] = invalid_count
    return df.reset_index(drop=True)


def lonlat_to_xyz(lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
    lon_r = np.deg2rad(np.asarray(lon, dtype=np.float64))
    lat_r = np.deg2rad(np.asarray(lat, dtype=np.float64))
    cos_lat = np.cos(lat_r)
    return np.column_stack((cos_lat * np.cos(lon_r), cos_lat * np.sin(lon_r), np.sin(lat_r)))


def chord_to_km(chord: np.ndarray) -> np.ndarray:
    return 2.0 * EARTH_RADIUS_KM * np.arcsin(np.clip(np.asarray(chord) / 2.0, 0.0, 1.0))


def pct(n: int, denominator: int) -> float:
    return 100.0 * n / denominator if denominator else math.nan


def add_issue(issues: list[str], message: str) -> None:
    issues.append(message)


def main() -> int:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    if not MASTER_CSV.exists():
        raise FileNotFoundError(
            f"Cannot find {MASTER_CSV}. Put validate_earth_features.py next to earth_all_features.csv."
        )
    if not LAYER_DIR.is_dir():
        raise FileNotFoundError(f"Cannot find source folder: {LAYER_DIR}")

    print("=" * 78)
    print("TERRANOVA — EARTH DATA QUALITY AUDIT")
    print("=" * 78)
    print(f"Master CSV : {MASTER_CSV}")
    print(f"Source CSVs: {LAYER_DIR}")
    print(f"Reports    : {OUTPUT_DIR}")

    df = pd.read_csv(MASTER_CSV, encoding="utf-8-sig", low_memory=False)
    df.columns = [normalise_name(c) for c in df.columns]
    n = len(df)
    issues: list[str] = []
    warnings: list[str] = []
    report_lines: list[str] = []

    if n == 0:
        raise ValueError("Master CSV is empty")

    required_master = {"grid_row", "grid_col", "lon", "lat", "land_fraction"}
    missing_master = required_master - set(df.columns)
    if missing_master:
        raise ValueError(f"Master CSV missing required columns: {sorted(missing_master)}")

    print(f"\nMaster dataset: {n:,} rows x {len(df.columns)} columns")
    report_lines.append(f"Master dataset: {n:,} rows x {len(df.columns)} columns")

    # Ensure expected measurement columns are numeric where appropriate.
    numeric_candidates = set(BASE_PREDICTORS) | {
        "grid_row", "grid_col", "lon", "lat", "land_fraction",
        "ai_valeur", "ai_classe_code", "glim_code", "local_relief_m",
        "bare_pct", "land_frac", "ssrd_wm2", "energie_kwh_m2_an",
    }
    for column in numeric_candidates & set(df.columns):
        df[column] = pd.to_numeric(df[column], errors="coerce")

    # 1) Structural and grid integrity checks.
    row_values = df["grid_row"].to_numpy(dtype=float)
    col_values = df["grid_col"].to_numpy(dtype=float)
    grid_index_valid = (
        np.isfinite(row_values) & np.isfinite(col_values)
        & (row_values >= 0) & (row_values < GRID_ROWS)
        & (col_values >= 0) & (col_values < GRID_COLS)
        & (row_values == np.floor(row_values))
        & (col_values == np.floor(col_values))
    )
    invalid_grid_count = int((~grid_index_valid).sum())
    if invalid_grid_count:
        add_issue(issues, f"{invalid_grid_count} rows have invalid grid_row/grid_col indices")

    grid_pairs = df[["grid_row", "grid_col"]]
    duplicate_grid = int(grid_pairs.duplicated().sum())
    duplicate_coords = int(df[["lon", "lat"]].duplicated().sum())
    if duplicate_grid:
        add_issue(issues, f"{duplicate_grid} duplicate grid cells in the master CSV")
    if duplicate_coords:
        add_issue(issues, f"{duplicate_coords} duplicate lon/lat coordinate pairs in the master CSV")

    expected_lat = GRID_LAT_ORIGIN - df["grid_row"] * CELL_DEGREES
    expected_lon = GRID_LON_ORIGIN + df["grid_col"] * CELL_DEGREES
    coord_error = np.maximum(
        np.abs(df["lat"].to_numpy(dtype=float) - expected_lat.to_numpy(dtype=float)),
        np.abs(df["lon"].to_numpy(dtype=float) - expected_lon.to_numpy(dtype=float)),
    )
    bad_coord = int((~np.isfinite(coord_error) | (coord_error > COORD_TOLERANCE_DEGREES)).sum())
    if bad_coord:
        add_issue(issues, f"{bad_coord} rows do not match the expected 0.5-degree cell-centre coordinates")

    land = df["land_fraction"]
    invalid_land = int((land.isna() | ~land.between(0.5, 1.0)).sum())
    if invalid_land:
        add_issue(issues, f"{invalid_land} rows have land_fraction missing or outside [0.5, 1.0]")

    if n != 85478:
        warnings.append(
            f"Master row count is {n:,}, whereas the reported successful merge had 85,478 rows. "
            "Confirm that this is the intended file/version."
        )

    report_lines.extend([
        "", "STRUCTURAL CHECKS",
        f"Rows: {n:,}",
        f"Duplicate grid cells: {duplicate_grid:,}",
        f"Duplicate lon/lat pairs: {duplicate_coords:,}",
        f"Invalid grid indices: {invalid_grid_count:,}",
        f"Coordinates off expected 0.5-degree centres: {bad_coord:,}",
        f"Rows with land_fraction outside [0.5, 1.0] or missing: {invalid_land:,}",
    ])

    # 2) Per-column missingness and basic numeric range checks.
    summary_records: list[dict[str, Any]] = []
    protected = {"grid_row", "grid_col", "lon", "lat"}
    for column in df.columns:
        if column in protected:
            continue
        missing_count = int(df[column].isna().sum())
        valid_count = n - missing_count
        record: dict[str, Any] = {
            "column": column,
            "valid_count": valid_count,
            "missing_count": missing_count,
            "valid_pct": pct(valid_count, n),
            "missing_pct": pct(missing_count, n),
            "unique_values": int(df[column].nunique(dropna=True)),
        }
        if pd.api.types.is_numeric_dtype(df[column]):
            values = df[column].to_numpy(dtype=float)
            finite = values[np.isfinite(values)]
            record["min"] = float(np.min(finite)) if finite.size else np.nan
            record["median"] = float(np.median(finite)) if finite.size else np.nan
            record["max"] = float(np.max(finite)) if finite.size else np.nan
            record["infinite_count"] = int(np.isinf(values).sum())
        else:
            record["min"] = np.nan
            record["median"] = np.nan
            record["max"] = np.nan
            record["infinite_count"] = 0
        summary_records.append(record)
    summary = pd.DataFrame(summary_records)
    summary.to_csv(OUTPUT_DIR / "earth_validation_summary.csv", index=False, encoding="utf-8-sig")

    # Detect physically invalid values only where bounds are clear from units/definitions.
    range_checks = {
        "precipitation": (0.0, None),
        "annual_temperature_range": (0.0, None),
        "slope": (0.0, None),
        "roughness": (0.0, None),
        "local_relief_m": (0.0, None),
        "ai_valeur": (0.0, None),
        "bare_pct": (0.0, 100.0),
        "land_frac": (0.0, 1.0),
        "ssrd_wm2": (0.0, None),
        "energie_kwh_m2_an": (0.0, None),
    }
    range_issues: list[str] = []
    for column, (lower, upper) in range_checks.items():
        if column not in df.columns:
            continue
        series = pd.to_numeric(df[column], errors="coerce")
        invalid = series.notna()
        if lower is not None:
            invalid &= series < lower
        if upper is not None:
            invalid &= series > upper
        count = int(invalid.sum())
        if count:
            msg = f"{column}: {count:,} values outside expected range [{lower}, {upper}]"
            range_issues.append(msg)
            add_issue(issues, msg)

    # 3) Feature-group completeness and cells with missing core features.
    group_records: list[dict[str, Any]] = []
    missing_flags: dict[str, np.ndarray] = {}
    for group, columns in FEATURE_GROUPS.items():
        present = [column for column in columns if column in df.columns]
        if not present:
            warnings.append(f"Feature group {group}: none of its expected columns are in the master CSV")
            continue
        absent_columns = sorted(set(columns) - set(present))
        if absent_columns:
            warnings.append(f"Feature group {group}: missing expected columns {absent_columns}")
        complete = df[present].notna().all(axis=1).to_numpy()
        missing_flags[group] = ~complete
        count = int(complete.sum())
        group_records.append({
            "feature_group": group,
            "columns_checked": ";".join(present),
            "complete_cells": count,
            "incomplete_cells": n - count,
            "complete_pct": pct(count, n),
            "incomplete_pct": pct(n - count, n),
        })
    groups_df = pd.DataFrame(group_records)
    groups_df.to_csv(OUTPUT_DIR / "earth_feature_group_coverage.csv", index=False, encoding="utf-8-sig")

    if missing_flags:
        any_missing = np.logical_or.reduce(list(missing_flags.values()))
        missing_cells = df.loc[any_missing, ["grid_row", "grid_col", "lon", "lat"]].copy()
        missing_cells["missing_feature_groups"] = [
            ";".join(group for group, flags in missing_flags.items() if flags[index])
            for index in np.flatnonzero(any_missing)
        ]
        missing_cells.to_csv(OUTPUT_DIR / "earth_missing_cells.csv", index=False, encoding="utf-8-sig")

    # 4) Missingness by 10-degree latitude band.
    lat_edges = np.arange(-90, 100, 10)
    lat_labels = [f"[{lat_edges[i]}, {lat_edges[i+1]})" for i in range(len(lat_edges) - 1)]
    lat_bin = pd.cut(df["lat"], bins=lat_edges, labels=lat_labels, right=False, include_lowest=True)
    latitude_records: list[dict[str, Any]] = []
    for band in lat_labels:
        selection = lat_bin == band
        band_n = int(selection.sum())
        if not band_n:
            continue
        for group, columns in FEATURE_GROUPS.items():
            present = [c for c in columns if c in df.columns]
            if not present:
                continue
            missing_count = int(df.loc[selection, present].isna().any(axis=1).sum())
            latitude_records.append({
                "latitude_band": band,
                "feature_group": group,
                "cells": band_n,
                "incomplete_cells": missing_count,
                "incomplete_pct": pct(missing_count, band_n),
            })
    latitude_df = pd.DataFrame(latitude_records)
    latitude_df.to_csv(OUTPUT_DIR / "earth_coverage_by_latitude.csv", index=False, encoding="utf-8-sig")

    # 5) Audit each source file against the target grid and explain missingness.
    target_lon = df["lon"].to_numpy(dtype=np.float64)
    target_lat = df["lat"].to_numpy(dtype=np.float64)
    target_row = df["grid_row"].fillna(-1).to_numpy(dtype=np.int64)
    target_col = df["grid_col"].fillna(-1).to_numpy(dtype=np.int64)
    target_cell_ids = target_row * GRID_COLS + target_col
    target_cell_set = set(target_cell_ids.tolist())

    alignment_records: list[dict[str, Any]] = []
    distance_records: list[dict[str, Any]] = []
    per_layer_missing_for_plot: dict[str, np.ndarray] = {}

    for layer_name, spec in LAYER_SPECS.items():
        path = LAYER_DIR / spec["file"]
        source = read_source_layer(path)
        source_n = len(source)
        duplicate_coords = int(source[["lon", "lat"]].duplicated().sum())
        if duplicate_coords:
            warnings.append(f"{layer_name}: {duplicate_coords:,} duplicate source coordinate pairs")

        for col in spec["columns"]:
            if col not in source.columns:
                warnings.append(f"{layer_name}: source CSV does not contain expected column {col!r}")

        # Determine the share of source points that lie on the exact TerraNova grid.
        source_row_float = (GRID_LAT_ORIGIN - source["lat"].to_numpy()) / CELL_DEGREES
        source_col_float = (source["lon"].to_numpy() - GRID_LON_ORIGIN) / CELL_DEGREES
        source_rows = np.rint(source_row_float).astype(np.int64)
        source_cols = np.rint(source_col_float).astype(np.int64)
        in_bounds = (
            (source_rows >= 0) & (source_rows < GRID_ROWS)
            & (source_cols >= 0) & (source_cols < GRID_COLS)
        )
        safe_rows = np.clip(source_rows, 0, GRID_ROWS - 1)
        safe_cols = np.clip(source_cols, 0, GRID_COLS - 1)
        exact = (
            in_bounds
            & (np.abs(source["lat"].to_numpy() - (GRID_LAT_ORIGIN - safe_rows * CELL_DEGREES)) <= COORD_TOLERANCE_DEGREES)
            & (np.abs(source["lon"].to_numpy() - (GRID_LON_ORIGIN + safe_cols * CELL_DEGREES)) <= COORD_TOLERANCE_DEGREES)
        )
        exact_share = pct(int(exact.sum()), source_n)
        exact_grid = bool(exact.all())
        layer_output_missing = ~df[spec["primary"]].notna().to_numpy() if spec["primary"] in df.columns else np.ones(n, dtype=bool)
        per_layer_missing_for_plot[layer_name] = layer_output_missing

        output_match_col = f"{layer_name}_match_km"
        output_match_present = output_match_col in df.columns
        if output_match_present:
            match_distances = pd.to_numeric(df[output_match_col], errors="coerce")
            matched_count = int(match_distances.notna().sum())
            match_dist_median = float(match_distances.median()) if matched_count else np.nan
            match_dist_p95 = float(match_distances.quantile(0.95)) if matched_count else np.nan
        else:
            matched_count = n - int(layer_output_missing.sum())
            match_dist_median = np.nan
            match_dist_p95 = np.nan

        if exact_grid:
            src_cell_ids = source_rows * GRID_COLS + source_cols
            source_cell_set = set(src_cell_ids.tolist())
            covered = np.fromiter((int(cell) in source_cell_set for cell in target_cell_ids), dtype=bool, count=n)
            covered_count = int(covered.sum())
            output_missing_count = int(layer_output_missing.sum())
            source_lookup = source.copy()
            source_lookup["_cell"] = src_cell_ids
            source_lookup = source_lookup.drop_duplicates("_cell").set_index("_cell")
            null_summary: list[str] = []
            for col in spec["columns"]:
                if col in source_lookup.columns:
                    matched_values = pd.Series(target_cell_ids).map(source_lookup[col])
                    value_na_count = int((covered & matched_values.isna().to_numpy()).sum())
                    null_summary.append(f"{col}={value_na_count}")
                else:
                    null_summary.append(f"{col}=column_missing")
            alignment_records.append({
                "layer": layer_name,
                "method_expected": "exact grid-cell join",
                "source_rows": source_n,
                "source_exact_grid_pct": exact_share,
                "source_duplicate_coordinates": duplicate_coords,
                "target_cells_with_source_point": covered_count,
                "target_source_coverage_pct": pct(covered_count, n),
                "master_missing_primary_pct": pct(output_missing_count, n),
                "source_value_nulls_on_covered_cells": "; ".join(null_summary),
                "master_match_distance_median_km": match_dist_median,
                "master_match_distance_p95_km": match_dist_p95,
                "notes": "Source coordinates are all on the 0.5-degree reference grid.",
            })
        else:
            source_xyz = lonlat_to_xyz(source["lon"].to_numpy(), source["lat"].to_numpy())
            target_xyz = lonlat_to_xyz(target_lon, target_lat)
            tree = cKDTree(source_xyz)
            try:
                chord, nearest_index = tree.query(target_xyz, k=1, workers=-1)
            except TypeError:
                chord, nearest_index = tree.query(target_xyz, k=1)
            nearest_km = chord_to_km(chord)
            thresholds = [25, 40, 55, 65, 80, 100, 150]
            counts = {threshold: int((nearest_km <= threshold).sum()) for threshold in thresholds}
            covered_count = counts[65]
            source_selected = source.iloc[nearest_index].reset_index(drop=True)
            output_missing_count = int(layer_output_missing.sum())

            # The merge should carry a source value when a source point is within 65 km
            # and its primary measurement is non-null. Compare expected vs actual.
            primary_col = spec["primary"]
            if primary_col in source_selected.columns:
                source_value_present = source_selected[primary_col].notna().to_numpy()
                expected_primary_present = (nearest_km <= NEAREST_LIMIT_KM) & source_value_present
                expected_primary_missing = ~expected_primary_present
                disagreement = int(np.logical_xor(expected_primary_missing, layer_output_missing).sum())
            else:
                expected_primary_present = nearest_km <= NEAREST_LIMIT_KM
                disagreement = -1

            for threshold in thresholds:
                distance_records.append({
                    "layer": layer_name,
                    "distance_threshold_km": threshold,
                    "cells_with_nearest_source_within_threshold": counts[threshold],
                    "coverage_pct": pct(counts[threshold], n),
                })
            distance_records.extend([
                {
                    "layer": layer_name,
                    "distance_threshold_km": "p50_nearest_distance",
                    "cells_with_nearest_source_within_threshold": float(np.quantile(nearest_km, 0.50)),
                    "coverage_pct": np.nan,
                },
                {
                    "layer": layer_name,
                    "distance_threshold_km": "p90_nearest_distance",
                    "cells_with_nearest_source_within_threshold": float(np.quantile(nearest_km, 0.90)),
                    "coverage_pct": np.nan,
                },
                {
                    "layer": layer_name,
                    "distance_threshold_km": "p95_nearest_distance",
                    "cells_with_nearest_source_within_threshold": float(np.quantile(nearest_km, 0.95)),
                    "coverage_pct": np.nan,
                },
                {
                    "layer": layer_name,
                    "distance_threshold_km": "p99_nearest_distance",
                    "cells_with_nearest_source_within_threshold": float(np.quantile(nearest_km, 0.99)),
                    "coverage_pct": np.nan,
                },
            ])
            alignment_records.append({
                "layer": layer_name,
                "method_expected": f"spherical nearest neighbour, max {NEAREST_LIMIT_KM:g} km",
                "source_rows": source_n,
                "source_exact_grid_pct": exact_share,
                "source_duplicate_coordinates": duplicate_coords,
                "target_cells_with_source_point": covered_count,
                "target_source_coverage_pct": pct(covered_count, n),
                "master_missing_primary_pct": pct(output_missing_count, n),
                "source_value_nulls_on_covered_cells": int(((nearest_km <= NEAREST_LIMIT_KM) & ~source_selected[primary_col].notna().to_numpy()).sum()) if primary_col in source_selected.columns else -1,
                "master_match_distance_median_km": match_dist_median,
                "master_match_distance_p95_km": match_dist_p95,
                "notes": f"Missing-vs-recomputed matching disagreement: {disagreement:,} cells.",
            })
            if disagreement > max(5, int(0.001 * n)):
                warnings.append(
                    f"{layer_name}: recomputed nearest-neighbour audit differs from master missingness in {disagreement:,} cells. "
                    "Check whether the merge used the same source file, distance limit and code version."
                )

        if exact_grid:
            # Record source coverage and distance thresholds (the exact source grid is either
            # present at the same cell centre or absent; it should not be nearest-filled).
            distance_records.append({
                "layer": layer_name,
                "distance_threshold_km": "exact_grid_source_coverage",
                "cells_with_nearest_source_within_threshold": covered_count,
                "coverage_pct": pct(covered_count, n),
            })

    alignment_df = pd.DataFrame(alignment_records)
    alignment_df.to_csv(OUTPUT_DIR / "earth_source_alignment.csv", index=False, encoding="utf-8-sig")
    pd.DataFrame(distance_records).to_csv(
        OUTPUT_DIR / "earth_nearest_distance_diagnostics.csv", index=False, encoding="utf-8-sig"
    )

    # 6) Check source/output missing counts agree per primary column.
    for layer_name, spec in LAYER_SPECS.items():
        primary = spec["primary"]
        if primary in df.columns:
            miss = int(df[primary].isna().sum())
            if miss:
                warnings.append(
                    f"{layer_name}: {miss:,} candidate cells ({pct(miss, n):.2f}%) have no primary value. "
                    "Use the alignment and latitude reports to decide whether this is expected source coverage or a grid/matching issue."
                )

    # 7) Create a world scatter map of missing cells by layer (optional dependency).
    map_path = OUTPUT_DIR / "earth_missing_coverage_map.png"
    try:
        import matplotlib.pyplot as plt

        plot_layers = ["aridity", "geological", "local_relief", "rock_cover", "solar_illumination"]
        fig, axes = plt.subplots(3, 2, figsize=(15, 11), constrained_layout=True)
        axes_flat = axes.ravel()
        for ax, layer_name in zip(axes_flat, plot_layers):
            missing_mask = per_layer_missing_for_plot.get(layer_name, np.ones(n, dtype=bool))
            valid_mask = ~missing_mask
            ax.scatter(target_lon[valid_mask], target_lat[valid_mask], s=1, alpha=0.15, label="value available")
            ax.scatter(target_lon[missing_mask], target_lat[missing_mask], s=2, alpha=0.75, label="missing")
            ax.set_xlim(-180, 180)
            ax.set_ylim(-90, 90)
            ax.set_title(f"{layer_name}: {pct(int(valid_mask.sum()), n):.1f}% available")
            ax.set_xlabel("Longitude")
            ax.set_ylabel("Latitude")
            ax.grid(True, linewidth=0.3, alpha=0.4)
        axes_flat[-1].axis("off")
        axes_flat[0].legend(loc="lower left", fontsize=8)
        fig.suptitle("TerraNova — spatial distribution of missing feature values", fontsize=14)
        fig.savefig(map_path, dpi=180)
        plt.close(fig)
        map_created = True
    except ImportError:
        map_created = False
        warnings.append("matplotlib is not installed; skipped the missing-coverage PNG map. Install with: pip install matplotlib")

    # 8) Save a readable text report and print the key findings.
    report_lines.extend(["", "FEATURE-GROUP COMPLETENESS"])
    for record in group_records:
        report_lines.append(
            f"{record['feature_group']}: {record['complete_cells']:,}/{n:,} complete "
            f"({record['complete_pct']:.2f}%)"
        )

    report_lines.extend(["", "SOURCE ALIGNMENT"])
    for record in alignment_records:
        report_lines.append(
            f"{record['layer']}: source rows={record['source_rows']:,}; "
            f"source coverage={record['target_source_coverage_pct']:.2f}%; "
            f"master primary missing={record['master_missing_primary_pct']:.2f}%; "
            f"method={record['method_expected']}"
        )
        if record["notes"]:
            report_lines.append(f"  Notes: {record['notes']}")

    report_lines.extend(["", "RANGE CHECKS"] + (range_issues or ["No out-of-range values found for the tested fields."]))
    report_lines.extend(["", "ISSUES"] + (issues or ["No structural or tested range errors found."]))
    report_lines.extend(["", "WARNINGS"] + (warnings or ["No warnings."]))
    report_text = "\n".join(report_lines)
    (OUTPUT_DIR / "earth_validation_report.txt").write_text(report_text, encoding="utf-8")

    print("\nFEATURE-GROUP COMPLETENESS")
    print(groups_df.to_string(index=False) if not groups_df.empty else "No feature groups evaluated")
    print("\nSOURCE COVERAGE")
    if not alignment_df.empty:
        show_cols = ["layer", "method_expected", "source_rows", "target_source_coverage_pct", "master_missing_primary_pct", "notes"]
        print(alignment_df[show_cols].to_string(index=False))
    print("\nWARNINGS")
    for message in warnings:
        print(f"  WARNING: {message}")
    print("\nISSUES")
    for message in issues:
        print(f"  ERROR: {message}")
    print("\nAUDIT FILES")
    for filename in [
        "earth_validation_report.txt",
        "earth_validation_summary.csv",
        "earth_feature_group_coverage.csv",
        "earth_source_alignment.csv",
        "earth_nearest_distance_diagnostics.csv",
        "earth_coverage_by_latitude.csv",
        "earth_missing_cells.csv",
    ]:
        path = OUTPUT_DIR / filename
        if path.exists():
            print(f"  + {path}")
    if map_created:
        print(f"  + {map_path}")

    print("\n" + "=" * 78)
    if issues:
        print(f"AUDIT COMPLETED WITH {len(issues)} STRUCTURAL/RANGE ISSUE(S). Review the report.")
    else:
        print("AUDIT COMPLETED: no structural or tested range errors found.")
    print("Missing values are not automatically filled or removed.")
    print("=" * 78)
    return 1 if issues else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"\nAUDIT FAILED: {type(exc).__name__}: {exc}", file=sys.stderr)
        raise
