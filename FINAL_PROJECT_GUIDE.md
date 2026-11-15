# ASTROMATCH — Final Project Guide

## What the application does

ASTROMATCH presents the existing Earth environmental classification and mission-reference data in a React/Vite interface. The application offers:

- A global Earth Explorer using the saved 78,247-cell K-Means K=5 assignments, actual cluster profiles, geological composition, and measurement coverage.
- A Mars screening view for Gale Crater and Utopia Planitia. Strict and extended filters are transparent terrestrial screens, not validated planetary matches.
- A Lunar Terrain & Geological Context Explorer for Shackleton Rim, Malapert Massif, and Haworth Cold Trap. It filters actual Earth cells by terrain, GLiM geology, and surface features without claiming lunar equivalence.
- Reference panels that retain site coordinates, source provenance, available measurements, and relevant scope caveats.

Both discovery workflows are exploratory, not validated planetary rankings. Cluster labels are context only. Missing measurements remain unavailable rather than being replaced with zero.

## Architecture

| Layer | Responsibility |
|---|---|
| [`run_astromatch_pipeline.py`](./run_astromatch_pipeline.py) | Validates the existing Earth data and saved cluster labels; generates the conservative Mars screening, regional summaries, coverage/audit tables, reference details, manifest, and extended-screen point GeoJSON. It does not retrain the clustering models. |
| [`outputs/astromatch/`](./outputs/astromatch) | Generated mission screening and audit outputs. The complete current inventory is below. |
| [`outputs/astromatch_enriched_earth.csv`](./outputs/astromatch_enriched_earth.csv) | Existing 85,478-cell Earth context source used for user-filtered Moon exploration. It is served directly; no second lunar candidate dataset is generated. |
| [`vite.config.ts`](./vite.config.ts) | Maps `/data/*` requests to the existing CSV/JSON files, including cluster outputs, mission references, region summaries, and Earth context. No separate backend or database is used. |
| [`src/data.ts`](./src/data.ts) | Loads and validates CSV/JSON data with Papa Parse and reusable typed adapters. It loads mission site references, screening regions, coverage, compatibility, the run manifest, and Earth context. |
| [`src/App.tsx`](./src/App.tsx) | Landing page, global explorer, Mars mission screening, site selection, and exports. |
| [`src/GlobeCanvas.tsx`](./src/GlobeCanvas.tsx) | Canvas-based globe and region markers, avoiding one DOM marker per Earth cell. |
| [`src/screeningOrder.ts`](./src/screeningOrder.ts) | Stable, transparent Mars result ordering by screening tier, then evidence coverage; it does not calculate an analogue score. |
| [`src/LunarContextExplorer.tsx`](./src/LunarContextExplorer.tsx) | Per-site Earth-only lunar context filters, reference facts, searchable region list, Earth-to-Earth comparison of up to two regions, detail panel, and exports. The list shows up to 120 search results at a time; exports include every filtered region. |
| [`src/lunarContext.ts`](./src/lunarContext.ts) | Null-aware filtering, connected-cell grouping, latitude-aware grid-footprint areas, feature summaries, CSV rows, and GeoJSON features. |
| `tests/` | Python screening/pipeline tests and Node tests for real-data adapters, lunar context filters, missing values, regions, areas, and GeoJSON. |

### Data flow and frontend integration

The browser consumes `analogue_regions.csv`, `matching_coverage_report.csv`, `mission_reference_details.json`, the screening policy in `matching_run_manifest.json`, mission reference-site data, and the enriched Earth CSV. Moon filter results are computed in the browser from the enriched Earth rows.

The current frontend does **not** load `mars_screening_candidates.csv`, `mission_matching_results.csv`, `top_analogs_per_reference.csv`, or the pre-generated `analogue_regions.geojson`; it uses the regional CSV and its own export path. Those files remain available for auditing and downstream use. The result exports named `mission_matching_results.csv` and `top_analogs_per_reference.csv` are byte-for-byte identical; neither is a numerical ranking.

## Run locally

Run commands from the project root:

```powershell
# Regenerate the current mission-screening outputs from existing data.
python .\run_astromatch_pipeline.py

# Start the frontend.
npm run dev

# Optional: bind to loopback explicitly.
npm run dev -- --host 127.0.0.1
```

The development server prints its local URL (normally `http://localhost:5173/`). Pipeline screening thresholds are configurable; use `python .\run_astromatch_pipeline.py --help` to see the available options. Do not retrain K-Means or DBSCAN to run the application.

## Current discovery results

### Mars: shared exploratory screening

The current policy is:

- **Strict:** vegetation `<= 0.1`, land fraction `>= 0.5`, and aridity class Hyper-aride or Aride. Cells south of 60°S with missing aridity are counted as **aridity unknown**, not as dry.
- **Extended:** vegetation `<= 0.2`, land fraction `>= 0.5`, and Hyper-aride, Aride, or Semi-aride; the same southern-polar unknown rule applies.

| Screen | Known dry/arid cells per site | Semi-arid cells per site | Aridity-unknown cells per site | Total cells per site | Regions per site |
|---|---:|---:|---:|---:|---:|
| Strict | 2,541 | — | 24,199 | **26,740** | 242 |
| Extended | 7,819 | 704 | 24,199 | **32,722** | 384 |

Gale and Utopia have **separate reference profiles but identical Earth screening cell sets** within each scenario. The screen does not use a site-specific validated Mars requirement. Accordingly, the combined candidate CSV contains 118,924 rows: the same 26,740 strict and 32,722 extended cells are represented once for each Martian reference site. The regions CSV contains 1,252 rows across both sites and both tiers (strict and extended). The GeoJSON contains 768 Point features for the extended scenario only (384 per site); the points mark representative region coordinates, not region boundaries.

The browser displays 26,740 strict cells / 242 regions and 32,722 extended cells / 384 regions. Markers represent shared Mars-wide screening results, not Gale or Utopia matches.

To explore Mars, choose **Strict** or **Extended**, select **Gale Crater** or **Utopia Planitia** to review that site's source-backed reference profile, then select an Earth region to inspect its coordinates and screening evidence. The visible list is ordered by screening tier (known dry/arid, then semi-arid when present, then aridity unknown); ties use higher screening-evidence coverage, then region ID. This is an inspection order, not an analogue-quality rank. Click **COMPARE** beside up to two entries in “Regions to inspect”; their recorded Earth measurements appear side by side. Gale and Utopia have separate reference profiles but share the same Mars-wide Earth screening set.

### Moon: user-filtered terrestrial context

The Moon view is not empty and does not fabricate a Moon candidate set. It loads all 85,478 Earth context cells and lets users independently filter terrain, GLiM category, and surface features for each lunar reference site. The default geology view (all supplied GLiM categories) yields 85,009 cells with geology available, 469 unavailable cells, and 13,264 connected context regions. These are Earth filter results and change with the selected layer and bounds; they are not lunar matches or a fixed candidate count.

Live local-browser checks also applied a terrain slope maximum of 5° (78,918 cells, 183 regions, 6,485 unavailable slope values) and the supplied GLiM code 16 (24,586 cells, 116 regions, 469 unavailable geology values). These are examples of filter output, not scientific equivalence thresholds.

To explore lunar context, select **Moon**, choose Shackleton Rim, Malapert Massif, or Haworth Cold Trap, select **Terrain**, **Geology**, or **Surface**, set an Earth-only filter, and apply it. Search the resulting region list by identifier, coordinates, or GLiM class. Click **COMPARE** on up to two regions to compare their actual Earth measurements, coverage, area, and classification context. This is Earth-to-Earth review; it does not compare either region with the Moon.

All three lunar sites remain separately selectable:

| Site | Reference coordinates (signed longitude) | Source-backed lunar profile |
|---|---|---|
| Shackleton Rim | 89.8392°S, 151.8580°W | Relief 1,264.02 m; slope 21.04°; 80 m DEM; modeled solar visibility 33.776% at 60 m. Geology is a qualitative impact-ejecta/anorthosite-bearing rim description. |
| Malapert Massif | 85.9640°S, 2.3190°W | Relief 526.7 m; slope 12.49°; 80 m DEM; modeled solar visibility 40.858% at 60 m. Geology is a published regional feldspathic/noritic regolith and impact-ejecta proxy. |
| Haworth Cold Trap | 87.5750°S, 27.0230°W | Relief 752.39 m; slope 20.68°; 80 m DEM; modeled solar visibility 0.289% at 60 m. Composition is a nearby-region proxy; the cold-trap interior is unmeasured. |

Each screen filter uses Earth values only. The 0.5° Earth grid and finer-resolution lunar terrain data have different spatial support; Earth slope/relief is not asserted equivalent to lunar slope/relief. Earth latitude is not a lunar illumination proxy. GLiM classes do not prove lunar mineralogical equivalence, and terrestrial bare ground is not lunar regolith. Region ordering by cell count is provided only for browsing convenience, not as evidence of relevance.

### Reference records and provenance

The five reference sites are Shackleton Rim, Malapert Massif, Haworth Cold Trap, Gale Crater, and Utopia Planitia. [`mission_reference_details.json`](./outputs/astromatch/mission_reference_details.json) contains 1 lunar record for each Moon site, 18 Gale records, and 17 Utopia records. Lunar profiles are sourced from [`mission_data/raw/lunar_reference.csv`](./mission_data/raw/lunar_reference.csv); Mars measurements are linked to their source files under [`mission_data/raw/mars/`](./mission_data/raw/mars).

Gale is centered at 5.4°S, 137.8°E. Its source records include distinct point, rover-traverse, landing-ellipse, and regional scopes. Utopia Planitia is centered at 47°N, 118°E; some geology and rock measurements refer to Southern Utopia near Zhurong and are not measurements at the reference coordinate. Those records remain separately described rather than collapsed into one fictional profile.

## Output audit — `outputs/astromatch`

This audit reads the generated files currently present in the folder. CSV missing counts are blank/NA cells; JSON missing counts are null or empty-string leaves. “Columns” for JSON/GeoJSON means top-level keys or feature properties, as applicable.

| File | Rows / features | Columns / properties | Missing values | Sites / result interpretation |
|---|---:|---:|---:|---|
| [`analogue_regions.csv`](./outputs/astromatch/analogue_regions.csv) | 1,252 | 33 | 3,928 | Gale and Utopia; strict and extended **screening region summaries**, not rankings. |
| [`analogue_regions.geojson`](./outputs/astromatch/analogue_regions.geojson) | 768 Point features | 34 properties | 2,844 null/empty property values; 0 invalid coordinates | Gale and Utopia; extended-screen representative points only. |
| [`earth_screening_audit.csv`](./outputs/astromatch/earth_screening_audit.csv) | 8 | 9 | 0 | Earth-wide descriptive feature statistics; no reference site. |
| [`earth_screening_categories.csv`](./outputs/astromatch/earth_screening_categories.csv) | 6 | 3 | 0 | Earth aridity-category counts, including UNKNOWN; no reference site. |
| [`feature_contributions.csv`](./outputs/astromatch/feature_contributions.csv) | 0 | 9 | 0 | Empty numerical-similarity contribution output; scoring is disabled. |
| [`mars_screening_candidates.csv`](./outputs/astromatch/mars_screening_candidates.csv) | 118,924 | 55 | 1,415,276 | Gale and Utopia copies of the shared strict/extended Mars screens. `similarity_score` and `feature_coverage_pct` are null for all rows. |
| [`matching_coverage_report.csv`](./outputs/astromatch/matching_coverage_report.csv) | 10 | 15 | 10 | Five sites × two scenarios; all numerical similarity scores are unavailable. |
| [`matching_run_manifest.json`](./outputs/astromatch/matching_run_manifest.json) | 1 JSON object | 14 top-level keys | 0 | Run metadata, policy, output list, label-regression check, and safeguards. |
| [`mission_matching_results.csv`](./outputs/astromatch/mission_matching_results.csv) | 768 | 33 | 2,392 | Gale and Utopia extended-screen region summaries; not numerical matches. |
| [`mission_reference_details.json`](./outputs/astromatch/mission_reference_details.json) | 5 site objects | Nested `site` and `records` | 39 empty-string values | Three lunar profiles, Gale (18 records), and Utopia (17 records); empty values indicate unavailable or inapplicable source fields. |
| [`moon_screening_candidates.csv`](./outputs/astromatch/moon_screening_candidates.csv) | 0 | 55 | 0 | No Moon screening candidates are generated; the file is header-only by design. Moon exploration is interactive and descriptive instead. |
| [`screening_candidate_counts.csv`](./outputs/astromatch/screening_candidate_counts.csv) | 5 | 4 | 0 | Mars tier counts per reference and combined duplicated-row counts. |
| [`screening_coverage_by_latitude.csv`](./outputs/astromatch/screening_coverage_by_latitude.csv) | 6 | 7 | 0 | Earth screening input availability and candidate counts by latitude band. |
| [`screening_filter_audit.csv`](./outputs/astromatch/screening_filter_audit.csv) | 18 | 5 | 0 | Filter-outcome counts for the two Mars scenarios. |
| [`top_analogs_per_reference.csv`](./outputs/astromatch/top_analogs_per_reference.csv) | 768 | 33 | 2,392 | Byte-for-byte duplicate of [`mission_matching_results.csv`](./outputs/astromatch/mission_matching_results.csv); extended-screen region summaries, not ranked analogues. |

The largest missing-value counts in `mars_screening_candidates.csv` reflect unavailable source measurements and ineligible score fields: aridity and aridity-distance fields each have 96,796 missing values; terrain slope/elevation have 25,940 each; roughness has 28,836; land/rock-cover fields have 96,928 each; cluster labels have 28,840 each; and the similarity score is missing in all 118,924 rows. Geology and solar fields each have 686 missing values. These are preserved as missing values, not zero.

Missing-value detail for `analogue_regions.csv`: `similarity_score` and `screening_conditions_failed` are empty for all 1,252 rows; `screening_conditions_unavailable` is empty for 1,172; aridity median/class and local-relief median each have 80 empty values; K-Means and DBSCAN modal labels each have 6 empty values.

### CSV schemas

The generated CSV headers are:

```text
analogue_regions.csv:
reference_site, site_id, mission_body, screening_scenario, region_id, candidate_tier, support_cells, approx_area_km2, centroid_lat, centroid_lon, representative_lat, representative_lon, earth_cell_id, vegetation_median, vegetation_min, ai_valeur_median, aridity_class_mode, land_fraction_mean, kmeans_cluster_mode, dbscan_cluster_mode, median_slope, median_local_relief_m, screening_conditions_passed, screening_conditions_unavailable, screening_conditions_failed, screening_evidence_coverage_pct, feature_summaries_json, explanation, limitations, similarity_score, score_type, ranking_basis, data_quality_status

mars_screening_candidates.csv and moon_screening_candidates.csv:
grid_row, grid_col, lon, lat, land_fraction, precipitation, vegetation, annual_temperature_range, lst_diurnal_range, slope, roughness, elevation, mean_annual_temperature, lst_source, ai_valeur, ai_classe_code, ai_classe_nom, aridity_match_km, glim_code, glim_classe, geological_match_km, local_relief_m, local_relief_match_km, bare_pct, land_frac, rock_cover_match_km, ssrd_wm2, energie_kwh_m2_an, solar_illumination_match_km, kmeans_cluster, dbscan_cluster, reference_site, site_id, mission_body, screening_scenario, earth_cell_id, candidate_tier, similarity_score, score_type, eligible_feature_count, available_feature_count, feature_coverage_pct, screening_criteria_available_count, screening_evidence_coverage_pct, missing_features, screening_conditions_passed, screening_conditions_unavailable, screening_conditions_failed, filter_land_pass, filter_vegetation_pass, filter_aridity_pass, filter_aridity_status, explanation, limitations, data_quality_status

mission_matching_results.csv and top_analogs_per_reference.csv:
reference_site, site_id, mission_body, screening_scenario, region_id, candidate_tier, support_cells, approx_area_km2, centroid_lat, centroid_lon, representative_lat, representative_lon, earth_cell_id, vegetation_median, vegetation_min, ai_valeur_median, aridity_class_mode, land_fraction_mean, kmeans_cluster_mode, dbscan_cluster_mode, median_slope, median_local_relief_m, screening_conditions_passed, screening_conditions_unavailable, screening_conditions_failed, screening_evidence_coverage_pct, feature_summaries_json, explanation, limitations, similarity_score, score_type, ranking_basis, data_quality_status

earth_screening_audit.csv:
variable, valid_count, missing_count, missing_pct, minimum, q25, median, q75, maximum

earth_screening_categories.csv:
field, category, count

feature_contributions.csv:
reference_site, mission_body, earth_cell_id, feature, difference, normalized_distance, weight, similarity_contribution, exclusion_reason

matching_coverage_report.csv:
reference_site, site_id, mission_body, screening_scenario, earth_cells_tested, screening_candidate_cells, screening_evidence_coverage_pct, candidate_regions, known_dry_class_cells, aridity_unknown_southern_polar_cells, numeric_score_eligible_features, numeric_similarity_score, result_type, interpretation, site_scope_note

screening_candidate_counts.csv:
scenario, candidate_tier, count_per_martian_reference_site, count_including_two_independent_reference_sets

screening_coverage_by_latitude.csv:
latitude_band, cells, aridity_available, vegetation_available, aridity_unknown_southern_polar, strict_screened_candidates, extended_screened_candidates

screening_filter_audit.csv:
scenario, filter, outcome, cell_count, percent_of_earth_cells
```

The GeoJSON is a `FeatureCollection` whose Point feature properties use the `analogue_regions.csv` fields plus `feature_summaries` and `classification`. The manifest keys are `generated_at_utc`, `earth_input`, `earth_rows`, `reference_site_count`, `numeric_similarity_enabled`, `numeric_eligible_criteria`, `screening_policy`, `screening_candidate_rows`, `screening_region_rows`, `lunar_context_source`, `cluster_label_regression`, `protected_input_sha256`, `generated_files`, and `output_notes`. Reference details are JSON keyed by the five site IDs, each with a site object and a source-record array.

## Validation and demonstration status

Last validation of the current implementation:

- Python pipeline tests: **14 passed** (`python -m unittest discover -s tests -v`).
- Lunar context and frontend data tests: **7 passed** (`node --experimental-strip-types --test .\tests\lunar_context.test.ts .\tests\frontend_data.test.ts`).
- Frontend production build: **passed** (`npm run build`; TypeScript check and Vite build).
- Live local-browser checks: landing page and Global Explorer loaded; actual cluster statistics, geology and coverage displayed; Moon mode loaded the 85,478-row Earth context; terrain and GLiM filters returned the counts above; all three lunar sites and both Mars references were selectable; Moon search and two-region comparison were exercised, including the two-region limit; strict/extended Mars counts, shared-screen caveat, reference provenance, and 390px mobile no-horizontal-overflow were checked.
- Export verification: tests cover the Moon CSV/GeoJSON serializers, and the live Mars export handlers generated a 242-row strict CSV and parseable GeoJSON with 242 Point features. The integrated browser did not surface a native download event, so the final file-save event itself is not claimed as browser-verified.

Re-run tests and build with:

```powershell
python -m unittest discover -s tests -v
node --experimental-strip-types --test .\tests\lunar_context.test.ts .\tests\frontend_data.test.ts
npm run build
```

## Scientific limitations

1. **No validated planetary ranking:** available discovery results are exploratory and do not establish that an Earth region is an analogue.
2. **Mars filters are terrestrial exploratory proxies:** Earth aridity classes and vegetation thresholds are not standardized Martian measurements. Southern-polar missing aridity is explicitly unknown.
3. **Gale and Utopia screens are shared:** identical Earth cell sets are copied per reference for reporting; they are not site-specific discoveries. Utopia records from Southern Utopia/Zhurong retain their separate scope.
4. **Moon results are descriptive Earth contexts:** user-configured filters do not compare Earth and lunar values or calculate similarity. Higher-resolution lunar and terrestrial terrain/geological validation remains necessary.
5. **Incompatible surface/geology measurements stay distinct:** Earth GLiM is not a lunar mineralogical class; bare-ground fraction is not regolith or Mars rock abundance; Earth latitude is not lunar illumination.
6. **Earth source metadata is incomplete:** the 0.5° grid is documented in the application, but source-product resolution, aggregation windows, and some periods/units still need provenance verification.
7. **Region areas are approximate grid-footprint areas:** they account for latitude-dependent cell area but are not land-only area measurements. GeoJSON locations are representative Points, not polygon boundaries.
8. **Clustering is context, not prediction:** saved K-Means and DBSCAN labels match the existing 78,247-cell label files; the mission screens do not use those labels as suitability scores.
