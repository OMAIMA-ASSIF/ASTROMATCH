
from pathlib import Path
import pandas as pd

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "mission_data" / "processed"
OUT.mkdir(parents=True, exist_ok=True)

MARS_SOURCE_FILES = {
    "annual_temperature_range": "annual_temperature.csv",
    "aridity": "aridity.csv",
    "lst_diurnal_range": "diurnal_temperature.csv",
    "elevation": "elevation.csv",
    "geological_composition": "geology.csv",
    "local_relief": "local_relief.csv",
    "mean_annual_temperature": "mean_temperature.csv",
    "precipitation": "precipitation.csv",
    "rock_abundance": "rock_abundance.csv",
    "roughness": "roughness.csv",
    "slope": "slope.csv",
    "solar_flux": "solar_flux.csv",
    "vegetation": "vegetation.csv",
}

# --------------------------------------------------
# A. Reference-site registry
# --------------------------------------------------

moon_sites = [
    {
        "mission_body": "MOON",
        "site_id": "MOON_SHACKLETON",
        "site": "Shackleton Rim",
        "latitude_deg": -89.8392,
        "longitude_east_deg": 208.142,
        "sampling_radius_km": 2,
        "data_readiness": "PROVISIONAL_PROOF_OF_CONCEPT",
        "spatial_scope_note": "Lunar south-polar reference site"
    },
    {
        "mission_body": "MOON",
        "site_id": "MOON_MALAPERT",
        "site": "Malapert Massif",
        "latitude_deg": -85.964,
        "longitude_east_deg": 357.681,
        "sampling_radius_km": 2,
        "data_readiness": "PROVISIONAL_PROOF_OF_CONCEPT",
        "spatial_scope_note": "Lunar south-polar reference site"
    },
    {
        "mission_body": "MOON",
        "site_id": "MOON_HAWORTH",
        "site": "Haworth Cold Trap",
        "latitude_deg": -87.575,
        "longitude_east_deg": 332.977,
        "sampling_radius_km": 2,
        "data_readiness": "PROVISIONAL_PROOF_OF_CONCEPT",
        "spatial_scope_note": "Nearby-region composition is a proxy; cold-trap interior composition is unmeasured"
    }
]

mars_sites = [
    {
        "mission_body": "MARS",
        "site_id": "MARS_GALE",
        "site": "Gale Crater",
        "latitude_deg": -5.4,
        "longitude_east_deg": 137.8,
        "sampling_radius_km": None,
        "data_readiness": "SOURCE_SPECIFIC",
        "spatial_scope_note": "Keep rover landing ellipse, geological units and regional measurements distinct"
    },
    {
        "mission_body": "MARS",
        "site_id": "MARS_UTOPIA",
        "site": "Utopia Planitia",
        "latitude_deg": 47.0,
        "longitude_east_deg": 118.0,
        "sampling_radius_km": None,
        "data_readiness": "SOURCE_SPECIFIC",
        "spatial_scope_note": "Some supplied geological and rock measurements refer to Southern Utopia near Zhurong, not this reference coordinate"
    }
]

sites = pd.DataFrame(moon_sites + mars_sites)

# Keep original east longitude AND create GIS-friendly longitude.
sites["longitude_signed_deg"] = (
    (sites["longitude_east_deg"] + 180) % 360
) - 180

sites.to_csv(
    OUT / "mission_reference_sites.csv",
    index=False
)


# --------------------------------------------------
# B. Earth-feature compatibility registry
# --------------------------------------------------

rules = [
    # MOON
    {
        "mission_body": "MOON",
        "criterion": "geology_category",
        "earth_feature": "glim_code; glim_classe",
        "decision": "QUALITATIVE_ONLY",
        "score_eligible_now": False,
        "reason": "Broad Earth lithology classes are not equivalent to lunar mineralogical or impact-ejecta descriptions.",
        "validation_needed": "Define and scientifically review a lunar-to-Earth geological analogue crosswalk."
    },
    {
        "mission_body": "MOON",
        "criterion": "local_relief_m",
        "earth_feature": "local_relief_m",
        "decision": "CONDITIONAL",
        "score_eligible_now": False,
        "reason": "Both describe terrain relief, but spatial windows and measurement resolutions may differ.",
        "validation_needed": "Verify Earth and Moon window sizes, DEM resolution and relief calculation."
    },
    {
        "mission_body": "MOON",
        "criterion": "mean_slope_deg",
        "earth_feature": "slope",
        "decision": "CONDITIONAL",
        "score_eligible_now": False,
        "reason": "Slope statistics are comparable only when the statistic and spatial baseline match.",
        "validation_needed": "Verify Earth slope unit, mean versus RMS definition, and DEM resolution."
    },
    {
        "mission_body": "MOON",
        "criterion": "mean_solar_visibility_pct",
        "earth_feature": "ssrd_wm2; energie_kwh_m2_an",
        "decision": "NO_DIRECT_EQUIVALENT",
        "score_eligible_now": False,
        "reason": "Solar radiation energy is not the same physical quantity as the percentage of time a site is illuminated.",
        "validation_needed": "Obtain an Earth illumination-visibility metric with a comparable model and time window."
    },

    # MARS
    {
        "mission_body": "MARS",
        "criterion": "annual_temperature_range",
        "earth_feature": "annual_temperature_range",
        "decision": "CONDITIONAL",
        "score_eligible_now": False,
        "reason": "Gale and Utopia use different temporal definitions and must be compared independently.",
        "validation_needed": "Verify the Earth temperature statistic uses a comparable annual aggregation and measurement type."
    },
    {
        "mission_body": "MARS",
        "criterion": "aridity",
        "earth_feature": "ai_valeur; ai_classe_nom",
        "decision": "SCREENING_PROXY",
        "score_eligible_now": False,
        "reason": "The supplied Mars descriptions are qualitative; no standardized Martian P/PET value is provided.",
        "validation_needed": "Define an Earth dryness screening rule without calling it a Martian aridity index."
    },
    {
        "mission_body": "MARS",
        "criterion": "solar_flux",
        "earth_feature": "ssrd_wm2",
        "decision": "CONDITIONAL",
        "score_eligible_now": False,
        "reason": "Mars reference is visible downward flux; Earth shortwave radiation may cover a different spectral range.",
        "validation_needed": "Verify spectral band, surface quantity, averaging period and units."
    },
    {
        "mission_body": "MARS",
        "criterion": "elevation",
        "earth_feature": "elevation",
        "decision": "EXCLUDE_DIRECT_SCORING",
        "score_eligible_now": False,
        "reason": "Mars elevation is relative to the Martian areoid; Earth elevation uses a different reference datum.",
        "validation_needed": "Do not compare absolute numbers. Consider separate terrain-context features only."
    },
    {
        "mission_body": "MARS",
        "criterion": "geological_composition",
        "earth_feature": "glim_code; glim_classe",
        "decision": "QUALITATIVE_ONLY",
        "score_eligible_now": False,
        "reason": "Broad Earth lithology categories are not equivalent to Mars sample mineral abundances.",
        "validation_needed": "Develop an expert-reviewed mineralogical and lithological analogue mapping."
    },
    {
        "mission_body": "MARS",
        "criterion": "lst_diurnal_range",
        "earth_feature": "lst_diurnal_range",
        "decision": "NOT_ELIGIBLE_YET",
        "score_eligible_now": False,
        "reason": "Gale air temperature and Utopia modeled soil-surface temperature have different physical definitions and temporal aggregation.",
        "validation_needed": "Establish matching surface or air temperature definitions, periods and observation conditions."
    },
    {
        "mission_body": "MARS",
        "criterion": "mean_annual_temperature",
        "earth_feature": "mean_annual_temperature",
        "decision": "CONDITIONAL",
        "score_eligible_now": False,
        "reason": "Mars values refer to near-surface measurements/statistics; the Earth feature measurement height and definition must be verified.",
        "validation_needed": "Check Earth measurement height, annual averaging and temperature definition."
    },
    {
        "mission_body": "MARS",
        "criterion": "precipitation",
        "earth_feature": "precipitation",
        "decision": "CONDITIONAL",
        "score_eligible_now": False,
        "reason": "Mars target is zero present-day liquid precipitation; Earth precipitation may include snowfall.",
        "validation_needed": "Verify whether Earth data separates liquid rainfall from total precipitation."
    },
    {
        "mission_body": "MARS",
        "criterion": "local_relief",
        "earth_feature": "local_relief_m",
        "decision": "CONDITIONAL",
        "score_eligible_now": False,
        "reason": "Relief depends on the calculation window and DEM support; target locations may have different spatial footprints.",
        "validation_needed": "Match spatial window, DEM resolution and relief definition."
    },
    {
        "mission_body": "MARS",
        "criterion": "rock_abundance",
        "earth_feature": "bare_pct; land_frac",
        "decision": "NO_DIRECT_EQUIVALENT",
        "score_eligible_now": False,
        "reason": "Bare-ground fraction is not the percentage of surface covered by rocks.",
        "validation_needed": "Obtain a comparable Earth rock-abundance or image-derived rock-cover dataset."
    },
    {
        "mission_body": "MARS",
        "criterion": "roughness",
        "earth_feature": "roughness",
        "decision": "CONDITIONAL",
        "score_eligible_now": False,
        "reason": "Roughness measurements depend on the algorithm, footprint and spatial scale.",
        "validation_needed": "Verify Earth roughness definition, units, DEM source and resolution."
    },
    {
        "mission_body": "MARS",
        "criterion": "slope",
        "earth_feature": "slope",
        "decision": "CONDITIONAL",
        "score_eligible_now": False,
        "reason": "Gale uses RMS slope at 5 m; Utopia uses mean slope at 10 m.",
        "validation_needed": "Produce or obtain Earth slope at the matching baseline and statistic."
    },
    {
        "mission_body": "MARS",
        "criterion": "vegetation",
        "earth_feature": "vegetation",
        "decision": "SCREENING_PROXY",
        "score_eligible_now": False,
        "reason": "Mars value zero is a conceptual bare-surface/no-known-vegetation proxy, not a measured Mars NDVI.",
        "validation_needed": "Verify the Earth vegetation variable definition and use it only as a bare-land screening indicator."
    }
]

# Attach paths that match the mission_data/raw layout.
for rule in rules:
    if rule["mission_body"] == "MOON":
        source_relative_path = Path("mission_data") / "raw" / "lunar_reference.csv"
    else:
        source_relative_path = (
            Path("mission_data")
            / "raw"
            / "mars"
            / MARS_SOURCE_FILES[rule["criterion"]]
        )

    source_path = ROOT / source_relative_path
    if not source_path.is_file():
        raise FileNotFoundError(
            f"Missing source file for {rule['mission_body']} "
            f"{rule['criterion']}: {source_path}"
        )
    rule["mission_source_file"] = source_relative_path.as_posix()

compatibility = pd.DataFrame(rules)

compatibility.to_csv(
    OUT / "earth_mission_feature_compatibility.csv",
    index=False
)

print("Mission registry created successfully.")
print("Output directory:", OUT)

print("\nReference sites:")
print(
    sites[
        ["mission_body", "site", "latitude_deg",
         "longitude_east_deg", "longitude_signed_deg"]
    ].to_string(index=False)
)

print("\nCompatibility decisions:")
print(
    compatibility[
        ["mission_body", "criterion", "decision"]
    ].to_string(index=False)
)

print("\nCurrently score-eligible criteria:",
      int(compatibility["score_eligible_now"].sum()))
