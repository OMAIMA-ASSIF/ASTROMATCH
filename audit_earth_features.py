
from pathlib import Path
import pandas as pd
import numpy as np

# ============================================================
# ASTROMATCH - Earth Feature Metadata Audit
# Does not modify any original dataset or ML model.
# ============================================================

ROOT = Path(__file__).resolve().parent

ENRICHED_FILE = ROOT / "astromatch_enriched_earth.csv"
MASTER_FILE = ROOT / "earth_all_features.csv"

OUT = ROOT / "mission_data" / "processed"
OUT.mkdir(parents=True, exist_ok=True)

AUDIT_FILE = OUT / "earth_feature_data_audit.csv"
METADATA_FILE = OUT / "earth_feature_metadata_template.csv"
CATEGORIES_FILE = OUT / "earth_categorical_value_counts.csv"


# ------------------------------------------------------------
# 1. Select the master dataset
# ------------------------------------------------------------

if ENRICHED_FILE.exists():
    DATA_FILE = ENRICHED_FILE
    print("Using enriched master dataset.")
else:
    DATA_FILE = MASTER_FILE
    print("Enriched dataset not found. Using earth_all_features.csv.")

if not DATA_FILE.exists():
    raise FileNotFoundError(f"Dataset not found: {DATA_FILE}")

df = pd.read_csv(DATA_FILE, low_memory=False)

print("\nDataset:", DATA_FILE.name)
print("Rows:", f"{len(df):,}")
print("Columns:", len(df.columns))


# ------------------------------------------------------------
# 2. Define the Earth features to audit
# ------------------------------------------------------------

feature_groups = {
    "baseline_climate": [
        "precipitation",
        "annual_temperature_range",
        "lst_diurnal_range",
        "mean_annual_temperature"
    ],
    "baseline_terrain": [
        "slope",
        "roughness",
        "elevation"
    ],
    "baseline_vegetation": [
        "vegetation"
    ],
    "additional_aridity": [
        "ai_valeur",
        "ai_classe_code",
        "ai_classe_nom"
    ],
    "additional_geology": [
        "glim_code",
        "glim_classe"
    ],
    "additional_relief": [
        "local_relief_m"
    ],
    "additional_rock_cover": [
        "bare_pct",
        "land_frac"
    ],
    "additional_solar": [
        "ssrd_wm2",
        "energie_kwh_m2_an"
    ]
}

features = [
    (group, feature)
    for group, columns in feature_groups.items()
    for feature in columns
]


# ------------------------------------------------------------
# 3. Build the numerical/data-availability audit
# ------------------------------------------------------------

categorical_features = ["ai_classe_nom", "glim_classe"]

audit_rows = []

for group, feature in features:

    if feature not in df.columns:
        audit_rows.append({
            "feature": feature,
            "feature_group": group,
            "exists": False,
            "observed_dtype": None,
            "total_cells": len(df),
            "available_cells": 0,
            "missing_cells": len(df),
            "availability_pct": 0,
            "missing_pct": 100,
            "unique_values": None,
            "min": np.nan,
            "q25": np.nan,
            "median": np.nan,
            "mean": np.nan,
            "q75": np.nan,
            "max": np.nan
        })
        continue

    series = df[feature]

    if feature in categorical_features:
        valid = series.dropna()
        available = len(valid)
        stats = {
            "min": np.nan,
            "q25": np.nan,
            "median": np.nan,
            "mean": np.nan,
            "q75": np.nan,
            "max": np.nan
        }

    else:
        numeric = pd.to_numeric(series, errors="coerce")
        valid = numeric.dropna()
        available = len(valid)

        if available:
            stats = {
                "min": valid.min(),
                "q25": valid.quantile(0.25),
                "median": valid.median(),
                "mean": valid.mean(),
                "q75": valid.quantile(0.75),
                "max": valid.max()
            }
        else:
            stats = {
                "min": np.nan,
                "q25": np.nan,
                "median": np.nan,
                "mean": np.nan,
                "q75": np.nan,
                "max": np.nan
            }

    missing = len(df) - available

    audit_rows.append({
        "feature": feature,
        "feature_group": group,
        "exists": True,
        "observed_dtype": str(series.dtype),
        "total_cells": len(df),
        "available_cells": available,
        "missing_cells": missing,
        "availability_pct": available / len(df) * 100,
        "missing_pct": missing / len(df) * 100,
        "unique_values": series.nunique(dropna=True),
        **stats
    })

audit = pd.DataFrame(audit_rows)
audit.to_csv(AUDIT_FILE, index=False)
# ------------------------------------------------------------
# 4. Create a metadata template
# ------------------------------------------------------------

metadata_rows = []

for group, feature in features:

    exists = feature in df.columns

    metadata_rows.append({
        "feature": feature,
        "feature_group": group,
        "unit": "TO_VERIFY",
        "measurement_definition": "TO_VERIFY",
        "source_product": "TO_VERIFY",
        "source_version": "TO_VERIFY",
        "spatial_resolution": "TO_VERIFY",
        "temporal_resolution": "TO_VERIFY",
        "spatial_aggregation": "TO_VERIFY",
        "calculation_method": "TO_VERIFY",
        "measurement_height_or_depth": "TO_VERIFY",
        "metadata_status": "PENDING" if exists else "FEATURE_NOT_FOUND"
    })

metadata = pd.DataFrame(metadata_rows)
metadata.to_csv(METADATA_FILE, index=False)


# ------------------------------------------------------------
# 5. Inspect categorical value distributions
# ------------------------------------------------------------

categorical_features = [
    "ai_classe_nom",
    "ai_classe_code",
    "glim_code",
    "glim_classe"
]

category_rows = []

for feature in categorical_features:

    if feature not in df.columns:
        print(f"Warning: categorical feature not found: {feature}")
        continue

    counts = (
        df[feature]
        .value_counts(dropna=False)
        .head(50)
    )

    for value, count in counts.items():

        category_rows.append({
            "feature": feature,
            "value": str(value),
            "cell_count": int(count),
            "percentage_of_master": count / len(df) * 100
        })

categories = pd.DataFrame(category_rows)
categories.to_csv(CATEGORIES_FILE, index=False)


# ------------------------------------------------------------
# 6. Check coordinates and enriched cluster labels
# ------------------------------------------------------------

def find_column(columns, options):
    lookup = {str(c).strip().lower(): c for c in columns}

    for option in options:
        if option.lower() in lookup:
            return lookup[option.lower()]

    return None


lat_col = find_column(df.columns, ["lat", "latitude"])
lon_col = find_column(
    df.columns,
    ["lon", "longitude", "longitude_east_deg", "lng"]
)

print("\nCoordinate checks:")

if lat_col and lon_col:

    print("Latitude column:", lat_col)
    print("Longitude column:", lon_col)

    lat = pd.to_numeric(df[lat_col], errors="coerce")
    lon = pd.to_numeric(df[lon_col], errors="coerce")

    valid_coords = lat.notna() & lon.notna()

    print("Valid coordinate cells:", f"{valid_coords.sum():,}")
    print("Missing coordinate cells:", f"{(~valid_coords).sum():,}")

else:
    print("Latitude/longitude columns not detected.")


for label in ["kmeans_cluster", "dbscan_cluster"]:

    if label in df.columns:
        print(f"\n{label} distribution:")
        print(df[label].value_counts(dropna=False).to_string())

    else:
        print(f"\n{label} is not present in this dataset.")


# ------------------------------------------------------------
# 7. Display results
# ------------------------------------------------------------

print("\n" + "=" * 65)
print("EARTH FEATURE AUDIT COMPLETED")
print("=" * 65)

print("\nFeature availability and distributions:")

print(
    audit[
        [
            "feature",
            "exists",
            "observed_dtype",
            "available_cells",
            "availability_pct",
            "min",
            "median",
            "max"
        ]
    ].round(4).to_string(index=False)
)

print("\nGenerated files:")
print(AUDIT_FILE)
print(METADATA_FILE)
print(CATEGORIES_FILE)

print("\nOriginal datasets were not modified.")
