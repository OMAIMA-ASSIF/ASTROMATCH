
from pathlib import Path
import pandas as pd
import numpy as np

ROOT = Path(__file__).resolve().parent
LAYER_DIR = ROOT / "earth_layers"

# 1. Is annual solar energy derived from mean solar flux?

import re
import pandas as pd
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SOLAR_FILE = ROOT / "earth_layers" / "solar_illumination.csv"


def normalize_header(value):
    name = str(value).strip().lstrip("\ufeff").lower()
    name = re.sub(r"[^a-z0-9]+", "_", name)
    return name.strip("_")


def read_solar_source(path):

    for separator in [",", ";", "\t", "|"]:

        try:
            preview = pd.read_csv(
                path,
                sep=separator,
                nrows=5,
                encoding="utf-8-sig",
                dtype=str
            )

            normalized = [
                normalize_header(c)
                for c in preview.columns
            ]

            required = {
                "ssrd_wm2",
                "energie_kwh_m2_an"
            }

            if required.issubset(set(normalized)):

                solar = pd.read_csv(
                    path,
                    sep=separator,
                    encoding="utf-8-sig",
                    low_memory=False
                )

                solar.columns = [
                    normalize_header(c)
                    for c in solar.columns
                ]

                print("Solar CSV loaded successfully.")
                print("Detected separator:", repr(separator))
                print("Columns:", solar.columns.tolist())

                return solar

        except Exception:
            continue

    raise ValueError(
        "Could not find ssrd_wm2 and energie_kwh_m2_an "
        f"in {path}. Check the original CSV headers."
    )


solar = read_solar_source(SOLAR_FILE)

flux = pd.to_numeric(solar["ssrd_wm2"], errors="coerce")
energy = pd.to_numeric(
    solar["energie_kwh_m2_an"], errors="coerce"
)

print("\nSolar feature validation")
print("Rows:", len(solar))
print("Valid flux values:", flux.notna().sum())
print("Valid annual energy values:", energy.notna().sum())

print("\nSolar flux statistics:")
print(flux.describe())

print("\nAnnual energy statistics:")
print(energy.describe())


flux = pd.to_numeric(solar["ssrd_wm2"], errors="coerce")
energy = pd.to_numeric(solar["energie_kwh_m2_an"], errors="coerce")

valid = flux.notna() & energy.notna()

# Calculate expected annual energy from mean solar flux
expected_energy = flux[valid] * (8760 / 1000)

# IMPORTANT: Calculate the difference before using it
difference = energy[valid] - expected_energy

print("=" * 60)
print("SOLAR ENERGY DERIVATION CHECK")
print("=" * 60)

print("Comparable rows:", int(valid.sum()))
print("Conversion factor:", 8760 / 1000)
print("Mean absolute error:", difference.abs().mean())
print("Maximum absolute error:", difference.abs().max())

print(
    "Rows matching formula:",
    int(np.isclose(
        energy[valid],
        expected_energy,
        rtol=1e-5,
        atol=1e-4
    ).sum())
)

# Detailed formula error diagnostics
error = difference.abs()

print("\n" + "=" * 60)
print("FORMULA ERROR DIAGNOSTICS")
print("=" * 60)

print("Correlation:", flux[valid].corr(energy[valid]))

for tolerance in [0.001, 0.01, 0.025, 0.05, 0.1]:
    count = (error <= tolerance).sum()
    print(
        f"Tolerance {tolerance}: "
        f"{count} / {len(error)} rows"
    )

print("\nError distribution:")
print(
    error.describe(
        percentiles=[0.5, 0.9, 0.95, 0.99]
    )
)

print("\nSolar units are still subject to source-documentation verification.")

# 2. Check the exact geographic ranges of additional sources.
print("\n" + "=" * 60)
print("SOURCE GEOGRAPHIC COVERAGE")
print("=" * 60)

for name in [
    "aridity",
    "geological",
    "local_relief",
    "rock_cover",
    "solar_illumination"
]:
    path = LAYER_DIR / f"{name}.csv"
    df = pd.read_csv(path, low_memory=False)

    print(f"\n{name}")
    print("Rows:", len(df))
    print("Latitude:", df["lat"].min(), "to", df["lat"].max())
    print("Longitude:", df["lon"].min(), "to", df["lon"].max())

print("\nChecks completed. No original files modified.")