
from pathlib import Path
import pandas as pd

# ============================================================
# ASTROMATCH - Geological composition by K-Means cluster
# ============================================================

ROOT = Path(__file__).resolve().parent

EARTH_FILE = ROOT / "earth_all_features.csv"
KMEANS_FILE = ROOT / "clustring" / "kmeans_cells.csv"
OUTPUT_DIR = ROOT / "outputs"

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

OUTPUT_FILE = OUTPUT_DIR / "cluster_geological_composition.csv"
COVERAGE_FILE = OUTPUT_DIR / "cluster_geological_coverage.csv"


# ------------------------------------------------------------
# 1. Find coordinate columns
# ------------------------------------------------------------

def find_column(df, candidates, description):
    lookup = {str(c).strip().lower(): c for c in df.columns}

    for candidate in candidates:
        if candidate.lower() in lookup:
            return lookup[candidate.lower()]

    raise ValueError(
        f"Cannot find {description}. "
        f"Available columns: {list(df.columns)}"
    )


def prepare_coordinates(df, lat_col, lon_col):
    result = df.copy()

    result["_lat_key"] = pd.to_numeric(
        result[lat_col], errors="coerce"
    ).round(5)

    result["_lon_key"] = pd.to_numeric(
        result[lon_col], errors="coerce"
    ).round(5)

    return result


# ------------------------------------------------------------
# 2. Load datasets
# ------------------------------------------------------------

print("Loading datasets...")

earth = pd.read_csv(EARTH_FILE, low_memory=False)
kmeans = pd.read_csv(KMEANS_FILE, low_memory=False)

print(f"Earth dataset: {len(earth):,} rows")
print(f"K-Means dataset: {len(kmeans):,} rows")


# ------------------------------------------------------------
# 3. Detect column names
# ------------------------------------------------------------

earth_lat = find_column(
    earth, ["lat", "latitude"], "Earth latitude"
)
earth_lon = find_column(
    earth, ["lon", "lng", "longitude"], "Earth longitude"
)

km_lat = find_column(
    kmeans, ["lat", "latitude"], "K-Means latitude"
)
km_lon = find_column(
    kmeans, ["lon", "lng", "longitude"], "K-Means longitude"
)

cluster_col = find_column(
    kmeans, ["cluster"], "K-Means cluster"
)

for col in ["glim_code", "glim_classe"]:
    if col not in earth.columns:
        raise ValueError(f"Missing geological column: {col}")


# ------------------------------------------------------------
# 4. Prepare merge keys
# ------------------------------------------------------------

earth = prepare_coordinates(earth, earth_lat, earth_lon)
kmeans = prepare_coordinates(kmeans, km_lat, km_lon)

earth = earth.dropna(subset=["_lat_key", "_lon_key"])
kmeans = kmeans.dropna(subset=["_lat_key", "_lon_key"])

# Check that each Earth coordinate identifies one source row.
duplicates = earth.duplicated(
    subset=["_lat_key", "_lon_key"], keep=False
)

if duplicates.any():
    raise ValueError(
        f"Found {duplicates.sum()} duplicate Earth coordinates. "
        "Resolve duplicates before merging."
    )

# Keep only the columns needed for the geological analysis.
earth_geo = earth[
    ["_lat_key", "_lon_key", "glim_code", "glim_classe"]
].copy()

kmeans_geo = kmeans[
    ["_lat_key", "_lon_key", cluster_col]
].copy()

kmeans_geo = kmeans_geo.rename(
    columns={cluster_col: "cluster"}
)


# ------------------------------------------------------------
# 5. Merge geological information with cluster assignments
# ------------------------------------------------------------

print("Matching geological data with K-Means cells...")

merged = kmeans_geo.merge(
    earth_geo,
    on=["_lat_key", "_lon_key"],
    how="left",
    validate="many_to_one",
    indicator=True
)

matched = (merged["_merge"] == "both").sum()

print(f"Matched cells: {matched:,}/{len(kmeans_geo):,}")
print(f"Unmatched cells: {len(kmeans_geo) - matched:,}")

merged = merged.drop(columns="_merge")


# ------------------------------------------------------------
# 6. Normalize missing geological values
# ------------------------------------------------------------

for col in ["glim_code", "glim_classe"]:
    merged[col] = merged[col].replace(
        ["", " ", "nan", "NaN", "None", "null"],
        pd.NA
    )

# A geological observation is usable when both fields exist.
valid_geo = merged.dropna(
    subset=["glim_code", "glim_classe"]
).copy()


# ------------------------------------------------------------
# 7. Calculate geological composition
# ------------------------------------------------------------

cluster_totals = merged.groupby("cluster").size().rename(
    "cluster_cells"
)

available_totals = valid_geo.groupby("cluster").size().rename(
    "available_geology_cells"
)

composition = (
    valid_geo.groupby(
        ["cluster", "glim_code", "glim_classe"],
        dropna=False
    )
    .size()
    .reset_index(name="cell_count")
)

composition = composition.merge(
    cluster_totals, on="cluster", how="left"
)

composition = composition.merge(
    available_totals, on="cluster", how="left"
)

composition["missing_geology_cells"] = (
    composition["cluster_cells"]
    - composition["available_geology_cells"]
)

composition["geology_coverage_pct"] = (
    composition["available_geology_cells"]
    / composition["cluster_cells"] * 100
)

# Percentage among cells with valid geological information.
composition["percentage_of_available_geology"] = (
    composition["cell_count"]
    / composition["available_geology_cells"] * 100
)

# Percentage among all cells in the cluster.
composition["percentage_of_all_cluster_cells"] = (
    composition["cell_count"]
    / composition["cluster_cells"] * 100
)

composition = composition.sort_values(
    ["cluster", "cell_count"],
    ascending=[True, False]
)


# ------------------------------------------------------------
# 8. Calculate cluster-level geological coverage
# ------------------------------------------------------------

coverage = cluster_totals.to_frame().join(
    available_totals
)

coverage["available_geology_cells"] = (
    coverage["available_geology_cells"].fillna(0).astype(int)
)

coverage["missing_geology_cells"] = (
    coverage["cluster_cells"]
    - coverage["available_geology_cells"]
)

coverage["geology_coverage_pct"] = (
    coverage["available_geology_cells"]
    / coverage["cluster_cells"] * 100
)

coverage = coverage.reset_index()


# ------------------------------------------------------------
# 9. Export results
# ------------------------------------------------------------

composition.to_csv(OUTPUT_FILE, index=False)
coverage.to_csv(COVERAGE_FILE, index=False)

print("\n============================================")
print("GEOLOGICAL ANALYSIS COMPLETED")
print("============================================")

print(f"\nComposition: {OUTPUT_FILE}")
print(f"Coverage:    {COVERAGE_FILE}")

print("\nGeological coverage by cluster:")
print(coverage.to_string(index=False))

print("\nTop 5 geological classes per cluster:")

for cluster, group in composition.groupby("cluster"):
    print(f"\nCluster {cluster}:")
    print(
        group[
            ["glim_code", "glim_classe", "cell_count",
             "percentage_of_available_geology"]
        ].head(5).to_string(index=False)
    )
