
from pathlib import Path
import pandas as pd
import numpy as np

ROOT = Path(__file__).resolve().parent

FILE = ROOT / "outputs" / "astromatch_enriched_earth.csv"
OUT = ROOT / "outputs"

if not FILE.exists():
    raise FileNotFoundError(FILE)

print("Loading enriched Earth dataset...")
df = pd.read_csv(FILE, low_memory=False)

print("\n" + "=" * 65)
print("ASTROMATCH ENRICHED DATASET AUDIT")
print("=" * 65)

print("File:", FILE)
print("Rows:", f"{len(df):,}")
print("Columns:", len(df.columns))

print("\nAll columns:")
for col in df.columns:
    print(f" - {col} [{df[col].dtype}]")


# --------------------------------------------------
# 1. Cluster label completeness
# --------------------------------------------------

for col in ["kmeans_cluster", "dbscan_cluster"]:

    print(f"\n{col}:")

    if col not in df.columns:
        print("NOT FOUND")
        continue

    print("Available:", df[col].notna().sum())
    print("Missing:", df[col].isna().sum())
    print("Distribution including missing:")

    print(
        df[col]
        .value_counts(dropna=False)
        .sort_index()
        .to_string()
    )


# --------------------------------------------------
# 2. Additional-feature availability
# --------------------------------------------------

features = [
    "precipitation",
    "annual_temperature_range",
    "lst_diurnal_range",
    "mean_annual_temperature",
    "slope",
    "roughness",
    "elevation",
    "vegetation",
    "ai_valeur",
    "local_relief_m",
    "bare_pct",
    "land_frac",
    "ssrd_wm2",
    "energie_kwh_m2_an",
    "glim_code"
]

coverage_rows = []

for col in features:

    if col not in df.columns:
        continue

    numeric = pd.to_numeric(df[col], errors="coerce")

    coverage_rows.append({
        "feature": col,
        "available_cells": numeric.notna().sum(),
        "missing_cells": numeric.isna().sum(),
        "availability_pct": numeric.notna().mean() * 100
    })

coverage = pd.DataFrame(coverage_rows)

coverage.to_csv(
    OUT / "enriched_feature_coverage.csv",
    index=False
)

print("\nFeature coverage:")
print(coverage.round(3).to_string(index=False))


# --------------------------------------------------
# 3. Inspect matching-distance columns
# --------------------------------------------------

match_columns = [
    col for col in df.columns
    if col.endswith("_match_km")
]

distance_rows = []

print("\nMatching-distance columns:")

for col in match_columns:

    values = pd.to_numeric(df[col], errors="coerce").dropna()

    if len(values) == 0:
        continue

    row = {
        "column": col,
        "available_cells": len(values),
        "missing_cells": df[col].isna().sum(),
        "zero_distance_cells": (values == 0).sum(),
        "min": values.min(),
        "median": values.median(),
        "p90": values.quantile(0.90),
        "p95": values.quantile(0.95),
        "max": values.max()
    }

    distance_rows.append(row)

distance_summary = pd.DataFrame(distance_rows)

print(distance_summary.round(4).to_string(index=False))

distance_summary.to_csv(
    OUT / "enriched_match_distance_summary.csv",
    index=False
)


# --------------------------------------------------
# 4. Compare land fraction columns
# --------------------------------------------------

print("\nLand fraction comparison:")

land_columns = ["land_fraction", "land_frac"]

if all(col in df.columns for col in land_columns):

    a = pd.to_numeric(df["land_fraction"], errors="coerce")
    b = pd.to_numeric(df["land_frac"], errors="coerce")

    valid = a.notna() & b.notna()

    if valid.sum() > 0:

        differences = (a[valid] - b[valid]).abs()

        print("Comparable cells:", valid.sum())
        print("Correlation:", a[valid].corr(b[valid]))
        print("Exact equal:", (differences == 0).sum())
        print("Mean absolute difference:", differences.mean())
        print("Maximum absolute difference:", differences.max())

else:
    print("One or both columns not present.")


# --------------------------------------------------
# 5. Inspect LST provenance
# --------------------------------------------------

print("\nLST source distribution:")

if "lst_source" in df.columns:

    print(
        df["lst_source"]
        .value_counts(dropna=False)
        .to_string()
    )


# --------------------------------------------------
# 6. Geographic checks
# --------------------------------------------------

print("\nGeographic coverage:")

for col in ["lat", "lon"]:

    if col in df.columns:
        print(
            col,
            "min =", df[col].min(),
            "max =", df[col].max(),
            "missing =", df[col].isna().sum()
        )


# --------------------------------------------------
# 7. Save a compact audit
# --------------------------------------------------

print("\nGenerated files:")

print(OUT / "enriched_feature_coverage.csv")
print(OUT / "enriched_match_distance_summary.csv")

print("\nInspection completed.")
print("Original datasets were not modified.")
