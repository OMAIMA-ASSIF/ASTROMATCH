
from pathlib import Path
import numpy as np
import zarr

ROOT = Path(__file__).resolve().parent

candidates = [
    ROOT / "predictors.zarr",
    ROOT / "cache" / "predictors.zarr"
]

zarr_path = next(
    (p for p in candidates if p.exists()),
    None
)

if zarr_path is None:
    raise FileNotFoundError(
        "predictors.zarr was not found in the root or cache folder."
    )

print("Zarr store:", zarr_path)

group = zarr.open_group(str(zarr_path), mode="r")

print("\nRoot metadata:")
for key, value in dict(group.attrs).items():
    print(f"{key}: {value}")

if "lst_source" not in group:
    raise KeyError("lst_source array does not exist in Zarr.")

arr = group["lst_source"]

print("\nlst_source metadata:")
print("Shape:", arr.shape)
print("Dtype:", arr.dtype)

for key, value in dict(arr.attrs).items():
    print(f"{key}: {value}")

values = np.asarray(arr[:])
unique, counts = np.unique(values, return_counts=True)

print("\nlst_source value distribution:")
for value, count in zip(unique, counts):
    print(f"Code {value}: {count:,} cells")

print("\nInspection completed.")
