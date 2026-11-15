"""Attach saved TerraNova K-Means/DBSCAN labels to the master Earth dataset
and characterize the resulting clusters with the additional environmental layers.

Expected repository layout:
    earth_all_features.csv
    clustring/kmeans_cells.csv
    clustring/dbscan_cells.csv
    clustring/preprocessing.json   (read for documentation only; not refit)

Outputs are written to outputs/.
This script does NOT retrain either model, refit preprocessing, impute values,
or change any cluster assignment.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent
MASTER_PATH = ROOT / "earth_all_features.csv"
CLUSTER_DIR = ROOT / "clustring"  # This spelling matches the user's actual folder.
KMEANS_PATH = CLUSTER_DIR / "kmeans_cells.csv"
DBSCAN_PATH = CLUSTER_DIR / "dbscan_cells.csv"
PREPROCESSING_PATH = CLUSTER_DIR / "preprocessing.json"
OUTPUT_DIR = ROOT / "outputs"

BASE_FEATURES = [
    "precipitation",
    "vegetation",
    "annual_temperature_range",
    "lst_diurnal_range",
    "slope",
    "roughness",
    "elevation",
    "mean_annual_temperature",
]

# Numeric fields useful for describing environmental conditions by cluster.
NUMERIC_PROFILE_FEATURES = BASE_FEATURES + [
    "ai_valeur",
    "local_relief_m",
    "bare_pct",
    "land_frac",  # This is the rock-cover source's land fraction, not master land_fraction.
    "ssrd_wm2",
    "energie_kwh_m2_an",
]

# Class labels are summarized as distributions, never as numeric averages.
CATEGORICAL_PROFILE_FEATURES = ["ai_classe_nom", "glim_classe"]

FEATURE_GROUPS = {
    "base_8_predictors": BASE_FEATURES,
    "aridity": ["ai_valeur", "ai_classe_code", "ai_classe_nom"],
    "geological": ["glim_code", "glim_classe"],
    "local_relief": ["local_relief_m"],
    "rock_cover": ["bare_pct", "land_frac"],
    "solar_illumination": ["ssrd_wm2", "energie_kwh_m2_an"],
}

COORD_TOLERANCE = 1e-6
FEATURE_ATOL = 1e-5
FEATURE_RTOL = 1e-6


def require_file(path: Path) -> None:
    if not path.exists():
        raise FileNotFoundError(f"Required file not found: {path}")


def normalize_headers(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out.columns = [str(c).strip().lstrip("\ufeff").lower() for c in out.columns]
    if len(set(out.columns)) != len(out.columns):
        raise ValueError("Duplicate column names after lowercasing/normalization.")
    return out


def find_coordinate_columns(df: pd.DataFrame, source_name: str) -> tuple[str, str]:
    lat_candidates = ["lat", "latitude", "y"]
    lon_candidates = ["lon", "long", "longitude", "lng", "x"]
    lat_col = next((c for c in lat_candidates if c in df.columns), None)
    lon_col = next((c for c in lon_candidates if c in df.columns), None)
    if lat_col is None or lon_col is None:
        raise ValueError(
            f"{source_name} must contain latitude/longitude columns. "
            f"Available columns: {list(df.columns)}"
        )
    return lat_col, lon_col


def coordinate_keys(df: pd.DataFrame, lat_col: str, lon_col: str, source_name: str) -> pd.DataFrame:
    """Create stable rounded coordinate keys; normalize longitude to [-180, 180)."""
    lat = pd.to_numeric(df[lat_col], errors="coerce")
    lon = pd.to_numeric(df[lon_col], errors="coerce")
    invalid = lat.isna() | lon.isna() | ~lat.between(-90, 90) | ~lon.between(-180, 180)
    if invalid.any():
        raise ValueError(f"{source_name}: {int(invalid.sum())} invalid/missing coordinate rows.")
    lon_norm = ((lon + 180.0) % 360.0) - 180.0
    keys = pd.DataFrame({
        "_lat_key": lat.round(6),
        "_lon_key": lon_norm.round(6),
    }, index=df.index)
    dup = keys.duplicated(["_lat_key", "_lon_key"], keep=False)
    if dup.any():
        sample = keys.loc[dup].head(5).to_dict("records")
        raise ValueError(
            f"{source_name}: duplicate coordinate keys found ({int(dup.sum())} rows). "
            f"Sample: {sample}"
        )
    return keys


def load_cluster_file(path: Path, label_name: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    require_file(path)
    raw = normalize_headers(pd.read_csv(path, low_memory=False))
    lat_col, lon_col = find_coordinate_columns(raw, str(path))
    if "cluster" not in raw.columns:
        raise ValueError(f"{path} has no 'cluster' column.")
    if raw["cluster"].isna().any():
        raise ValueError(f"{path} contains missing cluster labels.")

    keys = coordinate_keys(raw, lat_col, lon_col, str(path))
    label_df = keys.copy()
    label_df[label_name] = raw["cluster"].to_numpy()
    # Keep integer cluster labels as nullable integers when possible; DBSCAN noise -1 is valid.
    numeric_label = pd.to_numeric(label_df[label_name], errors="coerce")
    if numeric_label.notna().all() and np.allclose(numeric_label, np.round(numeric_label)):
        label_df[label_name] = numeric_label.astype("int64")

    source = raw.copy()
    source["_lat_key"] = keys["_lat_key"]
    source["_lon_key"] = keys["_lon_key"]
    return label_df, source


def feature_value_audit(master: pd.DataFrame, cluster_source: pd.DataFrame,
                        master_lat: str, master_lon: str, algorithm: str) -> pd.DataFrame:
    """Check that raw predictor values in saved cluster files agree with master values."""
    master_keys = coordinate_keys(master, master_lat, master_lon, "master dataset")
    m = master[[*BASE_FEATURES]].copy()
    m["_lat_key"] = master_keys["_lat_key"].to_numpy()
    m["_lon_key"] = master_keys["_lon_key"].to_numpy()
    joined = cluster_source.merge(
        m, on=["_lat_key", "_lon_key"], how="left", suffixes=("_cluster_file", "_master"),
        validate="one_to_one", indicator=True
    )
    rows = []
    for feature in BASE_FEATURES:
        src_col = feature + "_cluster_file"
        master_col = feature + "_master"
        if src_col not in joined.columns or master_col not in joined.columns:
            rows.append({
                "algorithm": algorithm, "feature": feature, "compared_cells": 0,
                "mismatch_cells": np.nan, "max_absolute_difference": np.nan,
                "status": "not compared: feature column missing from cluster CSV or master"
            })
            continue
        a = pd.to_numeric(joined[src_col], errors="coerce")
        b = pd.to_numeric(joined[master_col], errors="coerce")
        valid = a.notna() & b.notna()
        equal = pd.Series(False, index=joined.index)
        equal.loc[valid] = np.isclose(a.loc[valid], b.loc[valid], atol=FEATURE_ATOL, rtol=FEATURE_RTOL)
        diff = (a.loc[valid] - b.loc[valid]).abs()
        rows.append({
            "algorithm": algorithm,
            "feature": feature,
            "compared_cells": int(valid.sum()),
            "mismatch_cells": int((~equal.loc[valid]).sum()),
            "max_absolute_difference": float(diff.max()) if len(diff) else np.nan,
            "status": "PASS" if valid.any() and equal.loc[valid].all() else "CHECK",
        })
    return pd.DataFrame(rows)


def summarize_numeric(df: pd.DataFrame, label_col: str, algorithm: str) -> pd.DataFrame:
    available_features = [c for c in NUMERIC_PROFILE_FEATURES if c in df.columns]
    rows: list[dict] = []
    labelled = df[df[label_col].notna()]
    for label, group in labelled.groupby(label_col, dropna=False, sort=True):
        cluster_size = len(group)
        for feature in available_features:
            values = pd.to_numeric(group[feature], errors="coerce")
            valid = values.dropna()
            rows.append({
                "algorithm": algorithm,
                "cluster": int(label) if isinstance(label, (int, np.integer)) else label,
                "cluster_cells": cluster_size,
                "feature": feature,
                "available_cells": int(valid.size),
                "missing_cells": int(cluster_size - valid.size),
                "availability_pct": round(100.0 * valid.size / cluster_size, 4) if cluster_size else np.nan,
                "mean": float(valid.mean()) if len(valid) else np.nan,
                "median": float(valid.median()) if len(valid) else np.nan,
                "std": float(valid.std()) if len(valid) > 1 else np.nan,
                "q25": float(valid.quantile(0.25)) if len(valid) else np.nan,
                "q75": float(valid.quantile(0.75)) if len(valid) else np.nan,
                "min": float(valid.min()) if len(valid) else np.nan,
                "max": float(valid.max()) if len(valid) else np.nan,
            })
    return pd.DataFrame(rows)


def summarize_categories(df: pd.DataFrame, label_col: str, algorithm: str) -> pd.DataFrame:
    rows: list[dict] = []
    labelled = df[df[label_col].notna()]
    for label, group in labelled.groupby(label_col, dropna=False, sort=True):
        for feature in CATEGORICAL_PROFILE_FEATURES:
            if feature not in group.columns:
                continue
            values = group[feature].dropna().astype("string").str.strip()
            values = values[values.ne("")]
            total_observed = len(values)
            if total_observed == 0:
                continue
            counts = values.value_counts(dropna=True)
            for category, count in counts.items():
                rows.append({
                    "algorithm": algorithm,
                    "cluster": int(label) if isinstance(label, (int, np.integer)) else label,
                    "feature": feature,
                    "category": str(category),
                    "count": int(count),
                    "observed_cells_in_cluster": int(total_observed),
                    "pct_of_observed": round(100.0 * count / total_observed, 4),
                })
    return pd.DataFrame(rows)


def summarize_coverage(df: pd.DataFrame, label_col: str, algorithm: str) -> pd.DataFrame:
    rows: list[dict] = []
    labelled = df[df[label_col].notna()]
    for label, group in labelled.groupby(label_col, dropna=False, sort=True):
        for group_name, columns in FEATURE_GROUPS.items():
            existing = [c for c in columns if c in group.columns]
            if not existing:
                continue
            complete = group[existing].notna().all(axis=1)
            total = len(group)
            n_valid = int(complete.sum())
            rows.append({
                "algorithm": algorithm,
                "cluster": int(label) if isinstance(label, (int, np.integer)) else label,
                "feature_group": group_name,
                "columns_checked": ";".join(existing),
                "cluster_cells": total,
                "complete_cells": n_valid,
                "incomplete_cells": total - n_valid,
                "completeness_pct": round(100.0 * n_valid / total, 4) if total else np.nan,
            })
    return pd.DataFrame(rows)


def summarize_labels(df: pd.DataFrame) -> pd.DataFrame:
    rows: list[dict] = []
    for algorithm, col in [("kmeans", "kmeans_cluster"), ("dbscan", "dbscan_cluster")]:
        if col not in df.columns:
            continue
        labels = df[col].dropna()
        counts = labels.value_counts().sort_index()
        total = int(labels.size)
        for label, count in counts.items():
            rows.append({
                "algorithm": algorithm,
                "cluster": int(label) if isinstance(label, (int, np.integer)) else label,
                "cells": int(count),
                "pct_of_labelled_cells": round(100.0 * count / total, 4) if total else np.nan,
                "is_dbscan_noise": bool(algorithm == "dbscan" and str(label) == "-1"),
            })
    return pd.DataFrame(rows)


def save_csv(df: pd.DataFrame, path: Path) -> None:
    df.to_csv(path, index=False, encoding="utf-8-sig")


def main() -> int:
    for p in [MASTER_PATH, KMEANS_PATH, DBSCAN_PATH]:
        require_file(p)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    print("=" * 72)
    print("ASTROMATCH — ENRICH EXISTING CLUSTERS AND CHARACTERIZE THEM")
    print("=" * 72)
    print(f"Master dataset : {MASTER_PATH}")
    print(f"K-Means labels : {KMEANS_PATH}")
    print(f"DBSCAN labels  : {DBSCAN_PATH}")
    print(f"Output folder  : {OUTPUT_DIR}")

    master = normalize_headers(pd.read_csv(MASTER_PATH, low_memory=False))
    master_lat, master_lon = find_coordinate_columns(master, "master dataset")
    master_keys = coordinate_keys(master, master_lat, master_lon, "master dataset")
    master = master.copy()
    master["_lat_key"] = master_keys["_lat_key"].to_numpy()
    master["_lon_key"] = master_keys["_lon_key"].to_numpy()

    missing_features = [c for c in BASE_FEATURES if c not in master.columns]
    if missing_features:
        raise ValueError(f"Master dataset is missing required base predictors: {missing_features}")

    k_labels, k_source = load_cluster_file(KMEANS_PATH, "kmeans_cluster")
    d_labels, d_source = load_cluster_file(DBSCAN_PATH, "dbscan_cluster")

    # A label coordinate must exist exactly once in the master dataset.
    for name, labels in [("K-Means", k_labels), ("DBSCAN", d_labels)]:
        check = labels.merge(
            master[["_lat_key", "_lon_key"]],
            on=["_lat_key", "_lon_key"], how="left", indicator=True,
            validate="one_to_one"
        )
        unmatched = int(check["_merge"].ne("both").sum())
        if unmatched:
            sample = check.loc[check["_merge"].ne("both"), ["_lat_key", "_lon_key"]].head(10)
            raise ValueError(
                f"{name}: {unmatched} cluster rows do not match master coordinates. "
                f"Sample keys:\n{sample.to_string(index=False)}"
            )

    # Confirm K-Means and DBSCAN labels refer to the same geographical population.
    k_set = set(map(tuple, k_labels[["_lat_key", "_lon_key"]].to_numpy()))
    d_set = set(map(tuple, d_labels[["_lat_key", "_lon_key"]].to_numpy()))
    if k_set != d_set:
        raise ValueError(
            f"K-Means and DBSCAN coordinate populations differ: "
            f"K-Means only={len(k_set-d_set):,}, DBSCAN only={len(d_set-k_set):,}."
        )

    # Left joins preserve every row in the 85,478-row master file.
    enriched = master.merge(
        k_labels, on=["_lat_key", "_lon_key"], how="left", validate="one_to_one"
    ).merge(
        d_labels, on=["_lat_key", "_lon_key"], how="left", validate="one_to_one"
    )
    enriched = enriched.drop(columns=["_lat_key", "_lon_key"])

    # The cluster CSVs contain raw values too. Compare them with master values to
    # detect accidental coordinate misalignment or a different feature snapshot.
    k_audit = feature_value_audit(master, k_source, master_lat, master_lon, "kmeans")
    d_audit = feature_value_audit(master, d_source, master_lat, master_lon, "dbscan")
    feature_audit = pd.concat([k_audit, d_audit], ignore_index=True)

    numeric_frames = []
    category_frames = []
    coverage_frames = []
    for algorithm, label_col in [("kmeans", "kmeans_cluster"), ("dbscan", "dbscan_cluster")]:
        numeric_frames.append(summarize_numeric(enriched, label_col, algorithm))
        category_frames.append(summarize_categories(enriched, label_col, algorithm))
        coverage_frames.append(summarize_coverage(enriched, label_col, algorithm))

    numeric_profiles = pd.concat(numeric_frames, ignore_index=True)
    category_distributions = pd.concat(category_frames, ignore_index=True)
    coverage_report = pd.concat(coverage_frames, ignore_index=True)
    label_summary = summarize_labels(enriched)

    # Save enriched master and diagnostics.
    outputs = {
        "astromatch_enriched_earth.csv": enriched,
        "cluster_numeric_profiles.csv": numeric_profiles,
        "cluster_category_distributions.csv": category_distributions,
        "cluster_feature_coverage.csv": coverage_report,
        "cluster_label_summary.csv": label_summary,
        "cluster_feature_value_audit.csv": feature_audit,
    }
    for filename, frame in outputs.items():
        save_csv(frame, OUTPUT_DIR / filename)

    preprocessing = None
    if PREPROCESSING_PATH.exists():
        try:
            preprocessing = json.loads(PREPROCESSING_PATH.read_text(encoding="utf-8"))
        except Exception as exc:
            preprocessing = {"read_error": str(exc)}

    k_count = int(enriched["kmeans_cluster"].notna().sum())
    d_count = int(enriched["dbscan_cluster"].notna().sum())
    unmatched_master = int(enriched["kmeans_cluster"].isna().sum())
    audit_mismatches = int(feature_audit["mismatch_cells"].fillna(0).sum())
    manifest = {
        "master_rows": int(len(enriched)),
        "master_columns_after_enrichment": int(len(enriched.columns)),
        "kmeans_labelled_cells": k_count,
        "dbscan_labelled_cells": d_count,
        "master_cells_without_clustering_labels": unmatched_master,
        "kmeans_dbscan_coordinate_populations_identical": True,
        "cluster_feature_value_mismatches_across_both_algorithms": audit_mismatches,
        "base_clustering_features": BASE_FEATURES,
        "additional_features_used_for_characterization": {
            "aridity": ["ai_valeur", "ai_classe_code", "ai_classe_nom"],
            "geological": ["glim_code", "glim_classe"],
            "local_relief": ["local_relief_m"],
            "rock_cover": ["bare_pct", "land_frac"],
            "solar_illumination": ["ssrd_wm2", "energie_kwh_m2_an"],
        },
        "preprocessing_configuration": preprocessing,
        "important_notes": [
            "No model was retrained and no preprocessing was refitted.",
            "Cluster labels were joined by rounded latitude/longitude keys (6 decimal places).",
            "All master rows were preserved; cells without baseline cluster labels retain null labels.",
            "DBSCAN label -1, if present, is preserved as the noise/outlier label.",
            "Missing auxiliary measurements were not imputed or replaced with zero.",
            "Categorical geological and aridity classes are summarized as distributions, not means.",
            "Cluster IDs are nominal labels; numeric ordering has no scientific meaning.",
        ],
        "generated_files": list(outputs.keys()),
    }
    manifest_path = OUTPUT_DIR / "astromatch_enrichment_manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")

    print("\nJOIN VALIDATION")
    print(f"Master rows preserved                 : {len(enriched):,}")
    print(f"K-Means labelled cells                : {k_count:,}")
    print(f"DBSCAN labelled cells                 : {d_count:,}")
    print(f"Master cells without labels           : {unmatched_master:,}")
    print(f"K-Means/DBSCAN coordinate sets match  : YES")
    print(f"Raw predictor value mismatches        : {audit_mismatches:,}")

    if audit_mismatches:
        print("WARNING: Inspect cluster_feature_value_audit.csv before relying on the enrichment.")
    else:
        print("Raw predictor audit                   : PASS")

    print("\nOUTPUT FILES")
    for filename in [*outputs.keys(), manifest_path.name]:
        print(f"  + {OUTPUT_DIR / filename}")

    print("\nNEXT INTERPRETATION STEP")
    print("Open cluster_feature_coverage.csv first, then cluster_numeric_profiles.csv,")
    print("cluster_category_distributions.csv, and cluster_label_summary.csv.")
    print("No clustering or preprocessing was repeated.")
    print("=" * 72)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"\nERROR: {exc}", file=sys.stderr)
        raise
