
import pandas as pd

df = pd.read_csv("earth_all_features.csv")

base = [
    "precipitation",
    "vegetation",
    "annual_temperature_range",
    "lst_diurnal_range",
    "slope",
    "roughness",
    "elevation",
    "mean_annual_temperature"
]

extended = [
    "ai_valeur",
    "glim_code",
    "local_relief_m",
    "bare_pct",
    "energie_kwh_m2_an"
]

profiles = {
    "Base 8 predictors": base,
    "Extended 13 features": base + extended,
    "Base + aridity + geology": base + ["ai_valeur", "glim_code"],
    "Base + geology + solar": base + ["glim_code", "energie_kwh_m2_an"],
}

print("=" * 65)
print("ASTROMATCH — COMPLETE-CASE DATASET ANALYSIS")
print("=" * 65)

for name, columns in profiles.items():
    valid = df[columns].notna().all(axis=1)
    total = int(valid.sum())

    print(f"\n{name}")
    print(f"  Complete cells : {total:,}")
    print(f"  Excluded cells : {len(df)-total:,}")
    print(f"  Coverage       : {100*total/len(df):.2f}%")
    
    # Specifically assess southern polar coverage
    polar = df["lat"] < -60
    print(
        f"  Complete cells below -60°S: "
        f"{int((valid & polar).sum()):,}"
    )
