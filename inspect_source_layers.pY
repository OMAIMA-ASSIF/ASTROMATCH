
from pathlib import Path
import re
import numpy as np
import pandas as pd

# ============================================================
# ASTROMATCH: Inspect the five original Earth feature layers
# Read-only audit. Does not modify source datasets.
# ============================================================

ROOT = Path(__file__).resolve().parent
LAYER_DIR = ROOT / "earth_layers"
OUT = ROOT / "outputs"

OUT.mkdir(exist_ok=True)

LAYERS = {
    "aridity": {
        "file": "aridity.csv",
        "features": ["ai_valeur", "ai_classe_code", "ai_classe_nom"]
    },
    "geology": {
        "file": "geological.csv",
        "features": ["glim_code", "glim_classe"]
    },
    "local_relief": {
        "file": "local_relief.csv",
        "features": ["local_relief_m"]
    },
    "rock_cover": {
        "file": "rock_cover.csv",
        "features": ["bare_pct", "land_frac"]
    },
    "solar": {
        "file": "solar_illumination.csv",
        "features": ["ssrd_wm2", "energie_kwh_m2_an"]
    }
}

# TerraNova reference grid
CELL_DEGREES = 0.5
LAT_ORIGIN = 89.75
LON_ORIGIN = -179.75
GRID_ROWS = 360
GRID_COLS = 720


def normalize_name(value):
    name = str(value).strip().lstrip("\ufeff").lower()
    name = re.sub(r"[^a-z0-9]+", "_", name)
    return name.strip("_")


def normalize_longitude(lon):
    return ((lon + 180) % 360) - 180


def detect_delimiter(path):
    candidates = [",", ";", "\t", "|"]
    best = None
    best_score = -1

    for sep in candidates:
        try:
            sample = pd.read_csv(
                path, sep=sep, nrows=5,
                dtype=str, engine="python"
            )
            columns = [normalize_name(c) for c in sample.columns]

            score = len(columns)

            if "lat" in columns and (
                "lon" in columns or
                "longitude" in columns
            ):
                score += 100

            if score > best_score:
                best_score = score
                best = sep

        except Exception:
            continue

    if best is None:
        raise ValueError(f"Could not detect delimiter: {path}")

    return best


def find_coord(columns, candidates):
    for candidate in candidates:
        if candidate in columns:
            return candidate
    return None


inventory_rows = []
feature_rows = []
category_rows = []

for layer_name, config in LAYERS.items():

    path = LAYER_DIR / config["file"]

    if not path.exists():
        print(f"\nWARNING: Missing source file: {path}")
        continue

    print("\n" + "=" * 70)
    print(f"SOURCE LAYER: {layer_name.upper()}")
    print("=" * 70)

    sep = detect_delimiter(path)

    raw = pd.read_csv(
        path,
        sep=sep,
        dtype=str,
        low_memory=False
    )

    raw.columns = [normalize_name(c) for c in raw.columns]

    if len(set(raw.columns)) != len(raw.columns):
        raise ValueError(
            f"Duplicate normalized headers in {config['file']}"
        )

    print("File:", config["file"])
    print("Size:", f"{path.stat().st_size:,} bytes")
    print("Rows:", f"{len(raw):,}")
    print("Delimiter:", repr(sep))
    print("Columns:", ", ".join(raw.columns))

    lat_col = find_coord(
        raw.columns,
        ["lat", "latitude", "latitude_deg", "y"]
    )

    lon_col = find_coord(
        raw.columns,
        ["lon", "lng", "long", "longitude",
         "longitude_deg", "longitude_east_deg", "x"]
    )

    if lat_col is None or lon_col is None:
        raise ValueError(
            f"Coordinates not found in {config['file']}: "
            f"{list(raw.columns)}"
        )

    lat = pd.to_numeric(raw[lat_col], errors="coerce")
    lon = pd.to_numeric(
        raw[lon_col].str.replace(",", ".", regex=False),
        errors="coerce"
    )

    lon = normalize_longitude(lon)

    valid_coords = lat.notna() & lon.notna()

    duplicate_count = int(
        pd.DataFrame({
            "lat": lat,
            "lon": lon
        }).duplicated().sum()
    )

    # Check alignment with the 0.5-degree reference grid.
    row_float = (LAT_ORIGIN - lat) / CELL_DEGREES
    col_float = (lon - LON_ORIGIN) / CELL_DEGREES

    row = np.rint(row_float)
    col = np.rint(col_float)

    row_safe = np.clip(row.fillna(-999).astype(int),
                       0, GRID_ROWS - 1)
    col_safe = np.clip(col.fillna(-999).astype(int),
                       0, GRID_COLS - 1)

    expected_lat = LAT_ORIGIN - row_safe * CELL_DEGREES
    expected_lon = LON_ORIGIN + col_safe * CELL_DEGREES

    aligned = (
        valid_coords
        & (row >= 0) & (row < GRID_ROWS)
        & (col >= 0) & (col < GRID_COLS)
        & np.isclose(lat, expected_lat, atol=1e-4)
        & np.isclose(lon, expected_lon, atol=1e-4)
    )

    aligned_pct = (
        aligned.sum() / valid_coords.sum() * 100
        if valid_coords.sum() else np.nan
    )

    print("\nCoordinate information:")
    print("Latitude range:", lat.min(), "to", lat.max())
    print("Longitude range:", lon.min(), "to", lon.max())
    print("Valid coordinates:", int(valid_coords.sum()))
    print("Duplicate coordinates:", duplicate_count)
    print("Points on 0.5-degree grid:", f"{aligned_pct:.2f}%")

    inventory_rows.append({
        "layer": layer_name,
        "source_file": config["file"],
        "rows": len(raw),
        "columns": len(raw.columns),
        "coordinate_columns": f"{lat_col}, {lon_col}",
        "latitude_min": lat.min(),
        "latitude_max": lat.max(),
        "longitude_min": lon.min(),
        "longitude_max": lon.max(),
        "valid_coordinates": int(valid_coords.sum()),
        "duplicate_coordinates": duplicate_count,
        "grid_aligned_pct": aligned_pct,
        "column_names": ";".join(raw.columns)
    })

    # Inspect expected value features.
    for feature in config["features"]:

        if feature not in raw.columns:
            print(f"\nMISSING EXPECTED FEATURE: {feature}")
            continue

        series = raw[feature].astype("string").str.strip()
        series = series.replace(
            ["", "nan", "NaN", "None", "null"], pd.NA
        )

        numeric = pd.to_numeric(
            series.str.replace(",", ".", regex=False),
            errors="coerce"
        )

        is_numeric = numeric.notna().sum() > 0

        if is_numeric:
            valid = numeric.dropna()

            record = {
                "layer": layer_name,
                "feature": feature,
                "type": "numeric",
                "available": len(valid),
                "missing": len(raw) - len(valid),
                "unique_values": series.nunique(dropna=True),
                "min": valid.min() if len(valid) else np.nan,
                "q25": valid.quantile(0.25) if len(valid) else np.nan,
                "median": valid.median() if len(valid) else np.nan,
                "mean": valid.mean() if len(valid) else np.nan,
                "q75": valid.quantile(0.75) if len(valid) else np.nan,
                "max": valid.max() if len(valid) else np.nan
            }

        else:
            record = {
                "layer": layer_name,
                "feature": feature,
                "type": "categorical",
                "available": int(series.notna().sum()),
                "missing": int(series.isna().sum()),
                "unique_values": series.nunique(dropna=True),
                "min": np.nan,
                "q25": np.nan,
                "median": np.nan,
                "mean": np.nan,
                "q75": np.nan,
                "max": np.nan
            }

            counts = series.value_counts(dropna=False).head(20)

            for value, count in counts.items():
                category_rows.append({
                    "layer": layer_name,
                    "feature": feature,
                    "category": str(value),
                    "count": int(count)
                })

        feature_rows.append(record)

        print(f"\nFeature: {feature}")
        print("Type:", record["type"])
        print("Available:", record["available"])
        print("Missing:", record["missing"])
        print("Unique:", record["unique_values"])

        if is_numeric:
            print(
                "Min / median / max:",
                record["min"],
                record["median"],
                record["max"]
            )
        else:
            print("Top categories:")
            print(series.value_counts(dropna=False).head(10).to_string())

    print("\nFirst three source records:")
    print(raw.head(3).to_string(index=False))


# ------------------------------------------------------------
# Save the audit reports
# ------------------------------------------------------------

inventory = pd.DataFrame(inventory_rows)
feature_stats = pd.DataFrame(feature_rows)
categories = pd.DataFrame(category_rows)

inventory.to_csv(
    OUT / "earth_source_layer_inventory.csv", index=False
)

feature_stats.to_csv(
    OUT / "earth_source_layer_feature_statistics.csv", index=False
)

categories.to_csv(
    OUT / "earth_source_layer_categories.csv", index=False
)

print("\n" + "=" * 70)
print("SOURCE LAYER INSPECTION COMPLETED")
print("=" * 70)

print("\nGenerated reports:")
print(OUT / "earth_source_layer_inventory.csv")
print(OUT / "earth_source_layer_feature_statistics.csv")
print(OUT / "earth_source_layer_categories.csv")

print("\nNo original source files were modified.")
