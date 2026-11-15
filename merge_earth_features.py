"""Merge TerraNova's Zarr predictor stack with additional global Earth CSV layers.

Expected layout (script placed in the repository root):

    predictors.zarr/                    # preferred location
    # or cache/predictors.zarr/          # also supported
    earth_layers/
        aridity.csv
        geological.csv
        local_relief.csv
        rock_cover.csv
        solar_illumination.csv
    merge_earth_features.py

Output:
    earth_all_features.csv               # created in the repository root

The Zarr stack supplies the reference 0.5-degree EPSG:4326 grid and the
existing TerraNova predictors. CSV layers already on that grid are joined by
cell. Other point CSV layers are mapped to the reference land cells with
spherical nearest-neighbour matching. Missing values are kept as NaN; they are
never silently replaced with zero.
"""
from __future__ import annotations

import re
from pathlib import Path

import numpy as np
import pandas as pd
import zarr
from scipy.spatial import cKDTree

# ---------------------------------------------------------------------------
# Paths and configuration
# ---------------------------------------------------------------------------

ROOT = Path(__file__).resolve().parent

# Your current layout has predictors.zarr at the repository root. The second
# path is supported in case you later use the repository's original cache/ layout.
_ZARR_CANDIDATES = [ROOT / "predictors.zarr", ROOT / "cache" / "predictors.zarr"]
ZARR_PATH = next((path for path in _ZARR_CANDIDATES if path.exists()), _ZARR_CANDIDATES[0])

LAYER_DIR = ROOT / "earth_layers"
OUTPUT_PATH = ROOT / "earth_all_features.csv"

# The current Yakiyo/terra-nova main branch stores these nine predictors.
BASE_PREDICTORS = [
    "precipitation",
    "vegetation",
    "annual_temperature_range",
    "lst_diurnal_range",
    "slope",
    "roughness",
    "elevation",
    "mean_annual_temperature"
]

# The five additional CSV layers you listed.
# Every non-coordinate column in each CSV is retained in the final dataset.
LAYER_FILES = {
    "aridity": LAYER_DIR / "aridity.csv",
    "geological": LAYER_DIR / "geological.csv",
    "local_relief": LAYER_DIR / "local_relief.csv",
    "rock_cover": LAYER_DIR / "rock_cover.csv",
    "solar_illumination": LAYER_DIR / "solar_illumination.csv",
}

CELL_DEGREES = 0.5
MIN_LAND_FRACTION = 0.5
EARTH_RADIUS_KM = 6371.0088
# Do not transfer a source value if its closest source point is farther away.
MAX_NEAREST_KM = 65.0
COORD_TOLERANCE_DEGREES = 1e-4


# ---------------------------------------------------------------------------
# CSV reading and normalisation
# ---------------------------------------------------------------------------


def normalise_column_name(value: object) -> str:
    """Normalise a CSV column header to lowercase snake_case."""
    name = str(value).strip().strip('"').strip("'").lstrip("\ufeff").lower()
    name = re.sub(r"[^a-z0-9]+", "_", name)
    return name.strip("_")


def _detect_delimiter(path: Path) -> str:
    """Detect the delimiter by looking for separate longitude and latitude headers."""
    candidates: list[tuple[int, str]] = []
    for delimiter in [",", ";", "\t", "|"]:
        try:
            sample = pd.read_csv(
                path,
                sep=delimiter,
                nrows=5,
                dtype=str,
                engine="python",
            )
            names = {normalise_column_name(column) for column in sample.columns}
            has_lon = bool(names & {"lon", "long", "longitude", "lng", "x"})
            has_lat = bool(names & {"lat", "latitude", "y"})
            score = 100 * (int(has_lon) + int(has_lat)) + len(sample.columns)
            candidates.append((score, delimiter))
        except Exception:
            continue

    if not candidates:
        raise ValueError(f"Could not detect the CSV delimiter for: {path}")

    best_score, best_delimiter = max(candidates, key=lambda item: item[0])
    if best_score < 200:
        raise ValueError(
            f"Could not identify separate lon/lat columns in {path.name}. "
            "Check that the first row contains column headers named lon and lat."
        )
    return best_delimiter


def _to_numeric_with_decimal_comma(series: pd.Series) -> pd.Series:
    """Convert numeric text while accepting decimal commas (e.g. '0,0024')."""
    text = series.astype("string").str.strip()
    text = text.str.replace(",", ".", regex=False)
    return pd.to_numeric(text, errors="coerce")


def read_layer_csv(path: Path) -> pd.DataFrame:
    """Read a layer CSV, accepting comma/semicolon delimiters and decimal commas."""
    if not path.exists():
        raise FileNotFoundError(
            f"Missing CSV: {path}\n"
            f"Place {path.name} inside {LAYER_DIR} or update LAYER_FILES."
        )

    delimiter = _detect_delimiter(path)
    df = pd.read_csv(path, sep=delimiter, dtype=str, engine="python")
    df.columns = [normalise_column_name(column) for column in df.columns]

    # Standardise common coordinate-column names.
    rename: dict[str, str] = {}
    for column in df.columns:
        if column in {"longitude", "long", "lng", "x"}:
            rename[column] = "lon"
        elif column in {"latitude", "y"}:
            rename[column] = "lat"
    df = df.rename(columns=rename)

    # Duplicate column names after normalisation are ambiguous and unsafe.
    if df.columns.duplicated().any():
        duplicates = df.columns[df.columns.duplicated()].tolist()
        raise ValueError(f"{path.name}: duplicate column names after normalisation: {duplicates}")

    missing_coordinates = {"lon", "lat"} - set(df.columns)
    if missing_coordinates:
        raise ValueError(
            f"{path.name}: missing coordinate columns {sorted(missing_coordinates)}. "
            f"Parsed columns: {list(df.columns)}"
        )

    # Parse decimal commas in coordinates and measurements.
    df["lon"] = _to_numeric_with_decimal_comma(df["lon"])
    df["lat"] = _to_numeric_with_decimal_comma(df["lat"])

    invalid_coordinate_rows = int(df[["lon", "lat"]].isna().any(axis=1).sum())
    if invalid_coordinate_rows:
        print(f"  Warning: dropping {invalid_coordinate_rows:,} rows with invalid coordinates")
    df = df.dropna(subset=["lon", "lat"]).copy()

    if df.empty:
        raise ValueError(f"{path.name}: no rows with valid longitude/latitude were found")

    if not df["lat"].between(-90.0, 90.0).all():
        bad = df.loc[~df["lat"].between(-90.0, 90.0), "lat"].head().tolist()
        raise ValueError(f"{path.name}: latitude values outside [-90, 90], examples: {bad}")

    if not np.isfinite(df["lon"].to_numpy(dtype=float)).all():
        raise ValueError(f"{path.name}: longitude contains infinite values")
    if not np.isfinite(df["lat"].to_numpy(dtype=float)).all():
        raise ValueError(f"{path.name}: latitude contains infinite values")

    # Normalise longitude to [-180, 180).
    df["lon"] = ((df["lon"].astype(float) + 180.0) % 360.0) - 180.0
    df["lat"] = df["lat"].astype(float)

    # Convert columns that are numeric in at least 90% of their non-empty rows.
    # Category names such as 'Hyper-aride' and 'sm' remain strings.
    for column in df.columns:
        if column in {"lon", "lat"}:
            continue
        original = df[column].astype("string").str.strip()
        non_empty = original.notna() & original.ne("")
        if not non_empty.any():
            continue
        numeric = _to_numeric_with_decimal_comma(df[column])
        numeric_share = numeric[non_empty].notna().mean()
        if numeric_share >= 0.90:
            df[column] = numeric
        else:
            df[column] = original.replace({"": pd.NA, "nan": pd.NA, "None": pd.NA})

    value_columns = [column for column in df.columns if column not in {"lon", "lat"}]
    if not value_columns:
        raise ValueError(f"{path.name}: no feature columns found besides lon and lat")

    if df.duplicated(["lon", "lat"]).any():
        examples = df.loc[
            df.duplicated(["lon", "lat"], keep=False), ["lon", "lat"]
        ].head(10)
        raise ValueError(
            f"{path.name}: duplicate source coordinates found. Examples:\n{examples.to_string(index=False)}"
        )

    return df[["lon", "lat", *value_columns]].reset_index(drop=True)


# ---------------------------------------------------------------------------
# Spatial matching
# ---------------------------------------------------------------------------


def lonlat_to_unit_xyz(lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
    """Convert lon/lat to 3-D unit-sphere coordinates for geodesic NN search."""
    lon_rad = np.deg2rad(np.asarray(lon, dtype=np.float64))
    lat_rad = np.deg2rad(np.asarray(lat, dtype=np.float64))
    cos_lat = np.cos(lat_rad)
    return np.column_stack(
        (
            cos_lat * np.cos(lon_rad),
            cos_lat * np.sin(lon_rad),
            np.sin(lat_rad),
        )
    )


def _query_tree(tree: cKDTree, target_xyz: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Use all CPU cores when supported by the installed SciPy version."""
    try:
        return tree.query(target_xyz, k=1, workers=-1)
    except TypeError:  # compatibility with older SciPy releases
        return tree.query(target_xyz, k=1)


def map_layer_to_reference_grid(
    layer_name: str,
    source: pd.DataFrame,
    target_cells: np.ndarray,
    target_lon: np.ndarray,
    target_lat: np.ndarray,
    lat_axis: np.ndarray,
    lon_axis: np.ndarray,
) -> tuple[pd.DataFrame, str]:
    """Map one CSV layer onto candidate cells, using exact or spherical NN matching."""
    nrows = len(lat_axis)
    ncols = len(lon_axis)
    value_columns = [column for column in source.columns if column not in {"lon", "lat"}]

    source_lon = source["lon"].to_numpy(dtype=np.float64)
    source_lat = source["lat"].to_numpy(dtype=np.float64)

    # Check whether every source coordinate is a centre on TerraNova's 0.5-degree grid.
    row_float = (float(lat_axis[0]) - source_lat) / CELL_DEGREES
    col_float = (source_lon - float(lon_axis[0])) / CELL_DEGREES
    rows = np.rint(row_float).astype(np.int64)
    cols = np.rint(col_float).astype(np.int64)

    in_bounds = (rows >= 0) & (rows < nrows) & (cols >= 0) & (cols < ncols)
    safe_rows = np.clip(rows, 0, nrows - 1)
    safe_cols = np.clip(cols, 0, ncols - 1)
    exact_grid = (
        in_bounds
        & np.isclose(source_lat, lat_axis[safe_rows], atol=COORD_TOLERANCE_DEGREES, rtol=0.0)
        & np.isclose(source_lon, lon_axis[safe_cols], atol=COORD_TOLERANCE_DEGREES, rtol=0.0)
    )

    if exact_grid.all():
        source_cell_ids = rows * ncols + cols
        if pd.Series(source_cell_ids).duplicated().any():
            raise ValueError(f"{layer_name}: more than one CSV row maps to the same reference grid cell")

        mapped = source[value_columns].copy().reset_index(drop=True)
        mapped.insert(0, "_cell", source_cell_ids)
        mapped[f"{layer_name}_match_km"] = 0.0
        return mapped, "exact 0.5-degree cell-centre join"

    # The source points use another grid or spacing. Find each reference cell's
    # closest source point by great-circle distance (not Euclidean lon/lat distance).
    source_xyz = lonlat_to_unit_xyz(source_lon, source_lat)
    target_xyz = lonlat_to_unit_xyz(target_lon, target_lat)
    tree = cKDTree(source_xyz)
    chord_distance, nearest_index = _query_tree(tree, target_xyz)
    distance_km = 2.0 * EARTH_RADIUS_KM * np.arcsin(
        np.clip(chord_distance / 2.0, 0.0, 1.0)
    )

    mapped = source.iloc[nearest_index][value_columns].copy().reset_index(drop=True)
    within_limit = distance_km <= MAX_NEAREST_KM
    mapped.loc[~within_limit, value_columns] = np.nan
    mapped.insert(0, "_cell", target_cells)
    mapped[f"{layer_name}_match_km"] = np.where(within_limit, distance_km, np.nan)

    return mapped, f"spherical nearest neighbour (maximum distance {MAX_NEAREST_KM:g} km)"


# ---------------------------------------------------------------------------
# Main merge
# ---------------------------------------------------------------------------


def main() -> None:
    if not ZARR_PATH.exists():
        searched = "\n".join(f"  - {path}" for path in _ZARR_CANDIDATES)
        raise FileNotFoundError(
            "Could not find predictors.zarr. Checked these locations:\n"
            f"{searched}\nPut predictors.zarr in the repository root or cache/."
        )

    print("=" * 72)
    print("TERRANOVA — MERGE EARTH FEATURES")
    print("=" * 72)
    print(f"Repository root : {ROOT}")
    print(f"Zarr reference  : {ZARR_PATH}")
    print(f"CSV layer folder: {LAYER_DIR}")
    print(f"Output CSV      : {OUTPUT_PATH}")

    if not LAYER_DIR.is_dir():
        raise FileNotFoundError(f"CSV layer folder not found: {LAYER_DIR}")

    print("\nOpening Zarr reference grid...")
    zarr_root = zarr.open_group(str(ZARR_PATH), mode="r")

    required_arrays = {"lat", "lon", "land_fraction", *BASE_PREDICTORS}
    available_arrays = set(zarr_root.array_keys())
    missing_arrays = sorted(required_arrays - available_arrays)
    if missing_arrays:
        raise KeyError(
            "The Zarr store is missing required arrays: "
            f"{missing_arrays}. Available arrays: {sorted(available_arrays)}"
        )

    lat_axis = np.asarray(zarr_root["lat"][:], dtype=np.float64)
    lon_axis = np.asarray(zarr_root["lon"][:], dtype=np.float64)
    land_fraction = np.asarray(zarr_root["land_fraction"][:], dtype=np.float32)

    if lat_axis.ndim != 1 or lon_axis.ndim != 1:
        raise ValueError("Zarr lat and lon arrays must both be one-dimensional")
    expected_shape = (len(lat_axis), len(lon_axis))
    if land_fraction.shape != expected_shape:
        raise ValueError(
            f"Unexpected Zarr grid shape: land_fraction={land_fraction.shape}, "
            f"expected={expected_shape} from lat/lon axes"
        )
    if expected_shape != (360, 720):
        raise ValueError(
            f"Expected the TerraNova 360x720 grid; found {expected_shape}. "
            "Check that this is the correct predictors.zarr store."
        )

    # The repository grid is north-to-south in latitude and west-to-east in longitude.
    if not np.all(np.diff(lat_axis) < 0) or not np.all(np.diff(lon_axis) > 0):
        raise ValueError("Unexpected coordinate order in Zarr: lat must descend and lon must ascend")
    if not np.allclose(np.diff(lat_axis), -CELL_DEGREES, atol=1e-6):
        raise ValueError("Zarr latitude spacing is not 0.5 degrees")
    if not np.allclose(np.diff(lon_axis), CELL_DEGREES, atol=1e-6):
        raise ValueError("Zarr longitude spacing is not 0.5 degrees")

    # Use the repository's standard candidate-land definition.
    candidate_mask = np.isfinite(land_fraction) & (land_fraction >= MIN_LAND_FRACTION)
    target_cells = np.flatnonzero(candidate_mask.ravel())
    if target_cells.size == 0:
        raise ValueError("The Zarr land mask contains no candidate land cells")

    grid_rows, grid_cols = np.divmod(target_cells, len(lon_axis))
    target_lat = lat_axis[grid_rows]
    target_lon = lon_axis[grid_cols]

    result = pd.DataFrame(
        {
            "grid_row": grid_rows,
            "grid_col": grid_cols,
            "lon": target_lon,
            "lat": target_lat,
            "land_fraction": land_fraction.ravel()[target_cells],
            "_cell": target_cells,
        }
    )

    print(f"Reference grid   : {len(lat_axis)} rows x {len(lon_axis)} columns")
    print(f"Candidate land cells (land_fraction >= {MIN_LAND_FRACTION:.0%}): {len(result):,}")

    # Add all existing predictor arrays from predictors.zarr.
    print("\nLoading existing Zarr predictors...")
    for predictor in BASE_PREDICTORS:
        array = np.asarray(zarr_root[predictor][:], dtype=np.float32)
        if array.shape != expected_shape:
            raise ValueError(
                f"Predictor {predictor!r} has shape {array.shape}; expected {expected_shape}"
            )
        result[predictor] = array.ravel()[target_cells]
        print(f"  + {predictor}")

    # Keep this diagnostic column when available; it is not a scored predictor.
    if "lst_source" in available_arrays:
        lst_source = np.asarray(zarr_root["lst_source"][:])
        if lst_source.shape != expected_shape:
            raise ValueError(f"lst_source has shape {lst_source.shape}; expected {expected_shape}")
        result["lst_source"] = lst_source.ravel()[target_cells]

    # Add each supplied CSV layer.
    print("\nLoading and aligning additional CSV layers...")
    for layer_name, csv_path in LAYER_FILES.items():
        print(f"\n[{layer_name}] {csv_path}")
        source = read_layer_csv(csv_path)
        print(f"  Source rows: {len(source):,}")
        print(f"  Source columns: {', '.join(c for c in source.columns if c not in {'lon', 'lat'})}")

        mapped, method = map_layer_to_reference_grid(
            layer_name=layer_name,
            source=source,
            target_cells=target_cells,
            target_lon=target_lon,
            target_lat=target_lat,
            lat_axis=lat_axis,
            lon_axis=lon_axis,
        )

        new_columns = [column for column in mapped.columns if column != "_cell"]
        collisions = sorted(set(new_columns) & set(result.columns))
        if collisions:
            raise ValueError(
                f"{layer_name}: these CSV columns already exist in the output: {collisions}. "
                "Rename the conflicting source columns before merging."
            )

        result = result.merge(mapped, on="_cell", how="left", validate="one_to_one", sort=False)
        print(f"  Mapping method: {method}")
        print(f"  Added columns : {', '.join(new_columns)}")

    # Restore exact row order and remove the internal join key.
    result = result.sort_values("_cell", kind="stable").drop(columns="_cell").reset_index(drop=True)

    # Write atomically so an interrupted export does not leave a partial final CSV.
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary_output = OUTPUT_PATH.with_name(OUTPUT_PATH.stem + ".tmp" + OUTPUT_PATH.suffix)
    result.to_csv(
        temporary_output,
        index=False,
        encoding="utf-8-sig",
    )
    temporary_output.replace(OUTPUT_PATH)

    # Report missingness; NaN values remain in the file for later quality control.
    print("\n" + "=" * 72)
    print("MISSING-VALUE REPORT (missing values are not replaced with zero)")
    print("=" * 72)
    metadata_columns = {"grid_row", "grid_col", "lon", "lat"}
    for column in result.columns:
        if column in metadata_columns:
            continue
        missing_count = int(result[column].isna().sum())
        missing_percent = 100.0 * missing_count / len(result)
        print(f"{column:32s} {missing_count:>9,} missing ({missing_percent:6.2f}%)")

    print("\n" + "=" * 72)
    print("MERGE COMPLETED SUCCESSFULLY")
    print(f"Output: {OUTPUT_PATH}")
    print(f"Dataset shape: {result.shape[0]:,} rows x {result.shape[1]:,} columns")
    print("=" * 72)


if __name__ == "__main__":
    main()
