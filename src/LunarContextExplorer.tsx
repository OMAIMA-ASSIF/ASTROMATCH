import { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import { Download, Layers3, MapPinned, Search } from "lucide-react";
import GlobeCanvas, { type GlobeMarker } from "./GlobeCanvas";
import { loadLunarContextCells } from "./data";
import type { Cell, MissionReferenceRecord, MissionSite } from "./data";
import {
  filterLunarContext,
  lunarContextCsvRows,
  lunarContextGeoJSON,
  type EarthContextCell,
  type LunarContextFeature,
  type LunarContextFilter,
  type LunarContextLayer,
  type LunarContextRegion,
} from "./lunarContext";

type Props = {
  site: MissionSite;
  records: MissionReferenceRecord[];
  earthCells: Cell[];
};

const LAYER_FEATURES: Record<LunarContextLayer, Array<{ value: LunarContextFeature; label: string; unit: string }>> = {
  terrain: [
    { value: "slope", label: "Slope", unit: "° (source statistic to verify)" },
    { value: "local_relief_m", label: "Local relief", unit: "m" },
    { value: "roughness", label: "Roughness", unit: "source unit to verify" },
  ],
  geology: [
    { value: "glim_code", label: "GLiM lithology", unit: "categorical" },
  ],
  surface: [
    { value: "vegetation", label: "Vegetation", unit: "source index" },
    { value: "bare_pct", label: "Bare-ground fraction", unit: "% as supplied" },
    { value: "land_frac", label: "Land fraction", unit: "source fraction" },
  ],
};

const LAYER_COLORS: Record<LunarContextLayer, string> = {
  terrain: "#69d5de",
  geology: "#b1a0ff",
  surface: "#e9ae79",
};

const DEFAULT_FILTER: LunarContextFilter = {
  layer: "geology",
  feature: "glim_code",
  minimum: null,
  maximum: null,
  glimCode: "all",
};

const REFERENCE_FIELDS = [
  {
    key: "feature_1_geology_description",
    label: "Geological description",
    suffix: "",
  },
  { key: "feature_1_data_scope", label: "Geology data scope", suffix: "" },
  { key: "feature_4_local_relief_m", label: "Reported local relief", suffix: " m" },
  { key: "feature_4_mean_slope_deg", label: "Reported mean slope", suffix: "°" },
  { key: "feature_4_dem_resolution_m", label: "Lunar DEM resolution", suffix: " m" },
  {
    key: "feature_5_mean_solar_visibility_pct",
    label: "Modeled solar visibility",
    suffix: "%",
  },
  { key: "feature_5_model_resolution_m", label: "Solar model resolution", suffix: " m" },
] as const;

const FEATURE_LABELS: Record<string, string> = {
  slope: "Slope",
  local_relief_m: "Local relief",
  roughness: "Roughness",
  vegetation: "Vegetation",
  bare_pct: "Bare-ground fraction",
  land_frac: "Land fraction",
  precipitation: "Precipitation",
  ai_valeur: "Aridity value",
  elevation: "Elevation",
  annual_temperature_range: "Annual temperature range",
  lst_diurnal_range: "Surface temperature range",
  mean_annual_temperature: "Mean annual temperature",
  ssrd_wm2: "Surface solar flux",
  energie_kwh_m2_an: "Solar energy",
  glim_code: "GLiM code",
  glim_class: "GLiM class",
};

function optionalNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatValue(value: number | null | undefined, digits = 2): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "Unavailable"
    : value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function contextValue(region: LunarContextRegion): string {
  if (region.context_feature === "glim_code") {
    return `${region.glim_code_mode ?? "Unknown"} · ${region.glim_class_mode ?? "class not supplied"}`;
  }
  const summary = region.feature_summaries[region.context_feature];
  return `${formatValue(summary?.median)} · ${LAYER_FEATURES[region.context_layer].find((item) => item.value === region.context_feature)?.unit ?? ""}`;
}

function setForLayer(filter: LunarContextFilter, layer: LunarContextLayer): LunarContextFilter {
  const feature = LAYER_FEATURES[layer][0].value;
  return {
    ...filter,
    layer,
    feature,
    minimum: null,
    maximum: null,
    glimCode: "all",
  };
}

function ReferenceProfile({ site, records }: Pick<Props, "site" | "records">) {
  const record = records[0] ?? {};
  return (
    <section className="mission-reference-card lunar-reference-card">
      <div className="mission-panel-heading">
        <div>
          <span className="panel-overline">LUNAR REFERENCE PROFILE</span>
          <h2>{site.site}</h2>
        </div>
        <span className="mission-body-tag">MOON</span>
      </div>
      <div className="mission-coordinates">
        {site.latitude_deg.toFixed(4)}° / {site.longitude_signed_deg.toFixed(4)}° · signed longitude
      </div>
      <p>{site.spatial_scope_note}</p>
      <div className="lunar-source-line">
        <span>REFERENCE READINESS</span><strong>{site.data_readiness}</strong>
        <span>REFERENCE RADIUS</span>
        <strong>{site.sampling_radius_km === null ? "Not specified" : `${site.sampling_radius_km} km`}</strong>
      </div>
      <div className="lunar-reference-values">
        {REFERENCE_FIELDS.map(({ key, label, suffix }) => {
          const value = record[key]?.trim();
          if (!value) return null;
          return (
            <div key={key}>
              <span>{label}</span>
              <strong>{value}{suffix}</strong>
            </div>
          );
        })}
      </div>
      <div className="lunar-source-line">
        <span>REFERENCE SOURCE</span>
        <strong>{record.source_file ?? "mission reference data"}</strong>
      </div>
      <p className="lunar-reference-caveat">
        These source values describe this lunar site or its stated regional proxy. Earth filters below are independently
        configurable and do not compare against these measurements. The 80 m lunar DEM and 0.5° Earth grid have
        different spatial support.
      </p>
      {site.site === "Haworth Cold Trap" && (
        <p className="lunar-reference-caveat">
          The supplied composition is a nearby-region proxy; the cold-trap interior composition is unmeasured.
        </p>
      )}
    </section>
  );
}

export default function LunarContextExplorer({ site, records, earthCells }: Props) {
  const [earthContextCells, setEarthContextCells] = useState<EarthContextCell[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [draftBySite, setDraftBySite] = useState<Record<string, LunarContextFilter>>({});
  const [appliedBySite, setAppliedBySite] = useState<Record<string, LunarContextFilter>>({});
  const [validationError, setValidationError] = useState<string | null>(null);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [regionSearch, setRegionSearch] = useState("");
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareNotice, setCompareNotice] = useState<string | null>(null);
  const filter = draftBySite[site.site_id] ?? DEFAULT_FILTER;
  const appliedFilter = appliedBySite[site.site_id] ?? DEFAULT_FILTER;

  useEffect(() => {
    let active = true;
    setLoadError(null);
    loadLunarContextCells()
      .then((cells) => {
        if (active) setEarthContextCells(cells);
      })
      .catch((reason: unknown) => {
        if (active) {
          setLoadError(reason instanceof Error ? reason.message : "Earth context data could not be loaded.");
        }
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  const categories = useMemo(() => {
    if (!earthContextCells) return [];
    const values = new Map<string, string>();
    for (const cell of earthContextCells) {
      if (cell.glimCode) values.set(cell.glimCode, cell.glimClass ?? "");
    }
    return Array.from(values, ([code, glimClass]) => ({ code, glimClass }))
      .sort((a, b) => Number(a.code) - Number(b.code));
  }, [earthContextCells]);

  const result = useMemo(
    () => earthContextCells ? filterLunarContext(earthContextCells, appliedFilter) : null,
    [earthContextCells, appliedFilter],
  );
  const regions = result?.regions ?? [];
  const visibleRegions = useMemo(() => {
    const query = regionSearch.trim().toLowerCase();
    return regions
      .filter((region) => !query || [
        region.region_id,
        contextValue(region),
        region.context_reason,
        `${region.representative_lat} ${region.representative_lon}`,
        region.glim_class_mode ?? "",
      ].some((value) => value.toLowerCase().includes(query)))
      .sort((a, b) => b.support_cells - a.support_cells || a.region_id.localeCompare(b.region_id));
  }, [regions, regionSearch]);
  const selectedRegion = regions.find((region) => region.region_id === selectedRegionId) ?? regions[0] ?? null;
  const comparedRegions = compareIds
    .map((id) => regions.find((region) => region.region_id === id))
    .filter((region): region is LunarContextRegion => region !== undefined);
  const markers: GlobeMarker[] = regions.map((region) => ({
    id: region.region_id,
    latitude: region.representative_lat,
    longitude: region.representative_lon,
    color: LAYER_COLORS[appliedFilter.layer],
  }));
  const features = LAYER_FEATURES[filter.layer];

  useEffect(() => {
    setSelectedRegionId(null);
    setRegionSearch("");
    setCompareIds([]);
    setCompareNotice(null);
  }, [site.site_id, appliedFilter]);

  const setDraft = (next: LunarContextFilter) => {
    setDraftBySite((current) => ({ ...current, [site.site_id]: next }));
    setValidationError(null);
  };

  const applyFilter = () => {
    if (filter.minimum !== null && filter.maximum !== null && filter.minimum > filter.maximum) {
      setValidationError("Minimum Earth value must not exceed the maximum.");
      return;
    }
    setAppliedBySite((current) => ({ ...current, [site.site_id]: filter }));
    setSelectedRegionId(null);
    setCompareIds([]);
    setCompareNotice(null);
    setRegionSearch("");
    setValidationError(null);
  };

  const toggleCompare = (regionId: string) => {
    if (compareIds.includes(regionId)) {
      setCompareIds((current) => current.filter((value) => value !== regionId));
      setCompareNotice(null);
      return;
    }
    if (compareIds.length >= 2) {
      setCompareNotice("Two Earth regions are already selected. Remove one before adding another.");
      return;
    }
    setCompareIds((current) => [...current, regionId]);
    setCompareNotice(null);
  };

  const exportCsv = () => {
    if (!regions.length) return;
    const contents = Papa.unparse(lunarContextCsvRows(regions));
    const url = URL.createObjectURL(new Blob([contents], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${site.site_id}-earth-context.csv`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const exportGeoJson = () => {
    if (!regions.length) return;
    const contents = JSON.stringify(lunarContextGeoJSON(regions), null, 2);
    const url = URL.createObjectURL(new Blob([contents], { type: "application/geo+json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${site.site_id}-earth-context.geojson`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  if (loadError) {
    return (
      <div className="mission-load-state mission-error">
        <strong>Earth context data unavailable</strong>
        <span>{loadError}</span>
        <button type="button" onClick={() => setAttempt((value) => value + 1)}>Retry</button>
      </div>
    );
  }

  return (
    <div className="lunar-context-workspace">
      <div className="lunar-context-heading">
        <div>
          <span className="panel-overline">LUNAR TERRAIN & GEOLOGICAL CONTEXT EXPLORER</span>
          <h2>{site.site} <span>/ Earth context</span></h2>
        </div>
        <span className="lunar-context-status">EARTH-ONLY CONTEXT</span>
      </div>
      <p className="lunar-context-required-label">
        Exploratory terrestrial context candidates — require higher-resolution terrain and geological validation.
      </p>
      <p className="lunar-how-to">
        Quick start: choose Terrain, Geology, or Surface; set an Earth filter and apply it. Search the resulting Earth regions,
        then use COMPARE on up to two regions to review their measurements side by side.
      </p>

      <div className="lunar-profile-grid">
        <ReferenceProfile site={site} records={records} />
        <section className="lunar-science-note">
          <span className="panel-overline">INTERPRETATION GUARDRAILS</span>
          <h3>Explore dimensions, not equivalences.</h3>
          <p>Filters use Earth measurements only. The lunar slope and relief values above do not set Earth thresholds and are not compared directly.</p>
          <p>Earth GLiM classes are broad terrestrial lithology labels; they do not prove lunar mineralogical or impact-ejecta equivalence.</p>
          <p>Earth latitude is not used as a substitute for lunar solar visibility. Bare-ground fraction is not lunar regolith.</p>
          <div className="lunar-grid-note">Earth grid: 0.5° · source product resolution and aggregation windows: not fully documented</div>
        </section>
      </div>

      <section className="lunar-filter-panel">
        <div className="mission-panel-heading">
          <div>
            <span className="panel-overline">EARTH EXPLORATION FILTERS</span>
            <h2>Choose a descriptive layer</h2>
          </div>
          <span className="lunar-source-tag">EARTH VALUES ONLY</span>
        </div>
        <div className="lunar-layer-switch" role="group" aria-label="Select Earth context layer">
          {(["terrain", "geology", "surface"] as const).map((layer) => (
            <button
              type="button"
              key={layer}
              className={filter.layer === layer ? "is-active" : ""}
              aria-pressed={filter.layer === layer}
              onClick={() => setDraft(setForLayer(filter, layer))}
            >
              <span style={{ backgroundColor: LAYER_COLORS[layer] }} />
              {layer}
            </button>
          ))}
        </div>
        <div className="lunar-filter-controls">
          <label>
            <span>Earth measurement</span>
            <select
              aria-label="Earth measurement"
              value={filter.feature}
              onChange={(event) => setDraft({
                ...filter,
                feature: event.target.value as LunarContextFeature,
                minimum: null,
                maximum: null,
                glimCode: "all",
              })}
            >
              {features.map((feature) => (
                <option key={feature.value} value={feature.value}>{feature.label} · {feature.unit}</option>
              ))}
            </select>
          </label>
          {filter.layer === "geology" ? (
            <label>
              <span>GLiM category</span>
              <select
                aria-label="Earth GLiM category"
                value={filter.glimCode}
                onChange={(event) => setDraft({ ...filter, glimCode: event.target.value })}
              >
                <option value="all">All supplied categories</option>
                {categories.map((category) => (
                  <option key={category.code} value={category.code}>
                    GLiM {category.code}{category.glimClass ? ` · ${category.glimClass}` : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <label>
                <span>Minimum Earth value <small>(optional)</small></span>
                <input
                  type="number"
                  step="any"
                  value={filter.minimum ?? ""}
                  onChange={(event) => setDraft({ ...filter, minimum: optionalNumber(event.target.value) })}
                  placeholder="No lower bound"
                  aria-label="Minimum Earth value"
                />
              </label>
              <label>
                <span>Maximum Earth value <small>(optional)</small></span>
                <input
                  type="number"
                  step="any"
                  value={filter.maximum ?? ""}
                  onChange={(event) => setDraft({ ...filter, maximum: optionalNumber(event.target.value) })}
                  placeholder="No upper bound"
                  aria-label="Maximum Earth value"
                />
              </label>
            </>
          )}
          <button type="button" className="lunar-apply-button" onClick={applyFilter}>
            APPLY EARTH FILTER
          </button>
        </div>
        {validationError && <p className="lunar-filter-error" role="alert">{validationError}</p>}
        <p className="lunar-filter-note">
          Missing selected-feature values are excluded and counted as unavailable, never changed to zero. A filter
          result describes Earth cells only; changing the lunar reference site does not turn it into a site match.
        </p>
      </section>

      {!earthContextCells ? (
        <div className="mission-load-state">
          <div className="loading-orbit"><Layers3 size={22} /></div>
          <strong>LOADING EARTH TERRAIN, SURFACE & GLiM CONTEXT</strong>
        </div>
      ) : result && (
        <>
          <div className="lunar-context-metrics">
            <div><span>EARTH CELLS AVAILABLE</span><strong>{earthContextCells.length.toLocaleString()}</strong></div>
            <div><span>EARTH CELLS MATCHING FILTER</span><strong>{result.cellsMatched.toLocaleString()}</strong></div>
            <div><span>CONNECTED CONTEXT REGIONS</span><strong>{regions.length.toLocaleString()}</strong></div>
            <div><span>SELECTED FEATURE UNAVAILABLE</span><strong>{result.cellsMissingSelectedFeature.toLocaleString()}</strong></div>
            <div><span>AVAILABLE BUT OUTSIDE FILTER</span><strong>{result.cellsOutsideFilter.toLocaleString()}</strong></div>
          </div>
          <div className="lunar-discovery-grid">
            <section className="mission-map-card lunar-map-card">
              <div className="mission-panel-heading">
                <div><span className="panel-overline">GEOGRAPHIC CONTEXT</span><h2>Terrestrial regions</h2></div>
                <span className="lunar-map-legend"><i style={{ backgroundColor: LAYER_COLORS[appliedFilter.layer] }} /> FILTERED EARTH REGION</span>
              </div>
              <div className="mission-map-wrap">
                <GlobeCanvas
                  cells={earthCells}
                  clusterFilter={null}
                  selectedCell={null}
                  onSelectCell={() => undefined}
                  markers={markers}
                  selectedMarkerId={selectedRegion?.region_id}
                  onSelectMarker={setSelectedRegionId}
                />
              </div>
              <p className="lunar-map-foot">
                Existing K-Means colors are background context only. {LAYER_FEATURES[appliedFilter.layer][0].label} filters
                identify Earth regions meeting the current Earth-only filter; they do not establish a match to this lunar site.
              </p>
            </section>

            <section className="mission-results-card lunar-region-card">
              <div className="mission-panel-heading">
                <div><span className="panel-overline">EXPLORATORY EARTH REGIONS</span><h2>Contexts to inspect</h2></div>
                <span className="mission-results-count">{regions.length.toLocaleString()}</span>
              </div>
              <p className="lunar-list-order">Largest connected Earth regions first; size is for browsing, not evidence of lunar relevance.</p>
              <label className="mission-search lunar-region-search">
              <Search size={13} />
              <input
                aria-label="Search Earth context regions"
                value={regionSearch}
                onChange={(event) => setRegionSearch(event.target.value)}
                placeholder="Search ID, coordinates, GLiM class"
              />
              </label>
              <div className="mission-export-actions lunar-export-actions">
                <button type="button" onClick={exportCsv} disabled={!regions.length}><Download size={13} /> CSV</button>
                <button type="button" onClick={exportGeoJson} disabled={!regions.length}><Download size={13} /> GeoJSON</button>
              </div>
              <div className="mission-result-list lunar-result-list">
                {visibleRegions.length ? visibleRegions.slice(0, 120).map((region) => (
                  <div
                    className={`mission-result-row ${selectedRegion?.region_id === region.region_id ? "is-active" : ""}`}
                    key={region.region_id}
                  >
                    <button
                      type="button"
                      className="mission-result-select"
                      onClick={() => setSelectedRegionId(region.region_id)}
                    >
                      <span className="mission-result-marker"><MapPinned size={14} /></span>
                      <span className="mission-result-copy">
                        <strong>{region.region_id}</strong>
                        <small>{contextValue(region)}</small>
                      </span>
                      <span className="mission-result-size">{region.support_cells.toLocaleString()}<small>cells</small></span>
                    </button>
                    <button
                      type="button"
                      className={`mission-compare-button ${compareIds.includes(region.region_id) ? "is-active" : ""}`}
                      onClick={() => toggleCompare(region.region_id)}
                      aria-label={`${compareIds.includes(region.region_id) ? "Remove" : "Add"} ${region.region_id} ${compareIds.includes(region.region_id) ? "from" : "to"} Earth context comparison`}
                      aria-pressed={compareIds.includes(region.region_id)}
                    >
                      {compareIds.includes(region.region_id) ? "IN COMPARE" : "COMPARE"}
                    </button>
                  </div>
                )) : (
                  <div className="mission-empty-state">
                    <strong>{regions.length ? "No Earth regions match this search" : "No Earth regions satisfy the current filter"}</strong>
                    <p>{regions.length ? "Try another region ID, coordinate, or GLiM class." : "Try a wider Earth value range or another GLiM category. Unavailable measurements are not treated as zero."}</p>
                  </div>
                )}
                {visibleRegions.length > 120 && (
                  <div className="mission-list-limit">
                    Showing 120 of {visibleRegions.length.toLocaleString()} search results. Exports include all {regions.length.toLocaleString()} regions matching the Earth filter.
                  </div>
                )}
              </div>
            </section>
          </div>

          <section className="lunar-region-detail">
            <div className="mission-panel-heading">
            <div><span className="panel-overline">SELECTED EARTH CONTEXT REGION</span><h2>{selectedRegion?.region_id ?? "No region selected"}</h2></div>
            <span className="lunar-context-status">DESCRIPTIVE CONTEXT</span>
            </div>
            {selectedRegion ? (
              <>
                <p className="lunar-region-reason">{selectedRegion.context_reason}</p>
                <div className="lunar-region-stats">
                  <div><span>REPRESENTATIVE EARTH CELL</span><strong>{selectedRegion.representative_lat.toFixed(3)}°, {selectedRegion.representative_lon.toFixed(3)}°</strong></div>
                  <div><span>REGION CENTROID</span><strong>{selectedRegion.centroid_lat.toFixed(3)}°, {selectedRegion.centroid_lon.toFixed(3)}°</strong></div>
                  <div><span>SUPPORTING CELLS</span><strong>{selectedRegion.support_cells.toLocaleString()}</strong></div>
                  <div><span>GRID-CELL FOOTPRINT</span><strong>{formatValue(selectedRegion.approx_area_km2, 0)} km²</strong></div>
                  <div><span>K-MEANS CONTEXT</span><strong>{selectedRegion.kmeans_cluster_mode === null ? "Unavailable" : `Cluster ${selectedRegion.kmeans_cluster_mode}`}</strong></div>
                  <div><span>DBSCAN CONTEXT</span><strong>{selectedRegion.dbscan_cluster_mode === null ? "Unavailable" : selectedRegion.dbscan_cluster_mode < 0 ? "Noise (-1)" : `Cluster ${selectedRegion.dbscan_cluster_mode}`}</strong></div>
                  <div><span>GLiM CLASS</span><strong>{selectedRegion.glim_code_mode ?? "Unavailable"} · {selectedRegion.glim_class_mode ?? "class not supplied"}</strong></div>
                  <div><span>EARTH CELL ID</span><strong>{selectedRegion.earth_cell_id}</strong></div>
                </div>
                <div className="lunar-feature-summaries">
                  {Object.entries(selectedRegion.feature_summaries).map(([field, summary]) => (
                    <div key={field}>
                      <span>{FEATURE_LABELS[field] ?? field}</span>
                      <strong>{summary.median === null ? "Categorical" : formatValue(summary.median)}</strong>
                      <small>{summary.availableCells.toLocaleString()} available · {summary.missingCells.toLocaleString()} unavailable</small>
                    </div>
                  ))}
                </div>
                <p className="lunar-region-limitations">{selectedRegion.limitations}</p>
                <p className="lunar-region-limitations">
                  Provenance: outputs/astromatch_enriched_earth.csv. Earth feature source resolution, aggregation
                  window and time period remain pending verification; lunar reference provenance is shown above.
                </p>
              </>
            ) : (
              <p className="lunar-region-limitations">No region is available for the applied Earth-only filter.</p>
            )}
          </section>

          <section className="lunar-region-detail lunar-compare-card">
            <div className="mission-panel-heading">
              <div><span className="panel-overline">EARTH-TO-EARTH REVIEW</span><h2>Compare two Earth regions</h2></div>
              <span>{comparedRegions.length} / 2</span>
            </div>
            <p className="mission-compare-help">
              Click COMPARE beside one or two regions in the list. This compares their Earth measurements under the current
              descriptive filter; it does not compare either region with the Moon reference site.
            </p>
            {compareNotice && <p className="mission-compare-notice" role="status">{compareNotice}</p>}
            {comparedRegions.length ? (
              <div className="lunar-compare-grid">
                {comparedRegions.map((region) => {
                  const featureSummary = region.feature_summaries[region.context_feature];
                  const feature = LAYER_FEATURES[region.context_layer].find((item) => item.value === region.context_feature);
                  return (
                    <div className="lunar-compare-region" key={region.region_id}>
                      <strong>{region.region_id}</strong>
                      <span>{region.context_layer.toUpperCase()} · {feature?.label ?? region.context_feature}: {contextValue(region)}</span>
                      <span>{region.support_cells.toLocaleString()} cells · {formatValue(region.approx_area_km2, 0)} km²</span>
                      <span>Representative Earth location: {region.representative_lat.toFixed(3)}°, {region.representative_lon.toFixed(3)}°</span>
                      <span>Selected-feature data: {featureSummary ? `${featureSummary.availableCells.toLocaleString()} available · ${featureSummary.missingCells.toLocaleString()} unavailable` : "availability not supplied"}</span>
                      <span>GLiM: {region.glim_code_mode ?? "Unavailable"} · {region.glim_class_mode ?? "class not supplied"}</span>
                      <span>K-Means / DBSCAN context: {region.kmeans_cluster_mode ?? "Unavailable"} / {region.dbscan_cluster_mode ?? "Unavailable"}</span>
                      <small>{region.context_reason}</small>
                      <button type="button" className="mission-compare-button is-active" aria-label={`Remove ${region.region_id} from Earth context comparison`} onClick={() => toggleCompare(region.region_id)}>
                        REMOVE
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="mission-compare-empty">Nothing selected yet. Choose COMPARE on one region, then a second.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
