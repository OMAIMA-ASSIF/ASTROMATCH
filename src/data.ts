import Papa from "papaparse";
import type { EarthContextCell } from "./lunarContext";

export type Cell = {
  latitude: number;
  longitude: number;
  cluster: number;
  features: Record<string, number | null>;
};

export type NumericProfile = {
  cluster: number;
  clusterCells: number;
  feature: string;
  availableCells: number;
  missingCells: number;
  availabilityPct: number;
  mean: number | null;
  median: number | null;
  std: number | null;
  q25: number | null;
  q75: number | null;
  min: number | null;
  max: number | null;
};

export type FeatureCoverage = {
  cluster: number;
  featureGroup: string;
  columnsChecked: string[];
  clusterCells: number;
  completeCells: number;
  incompleteCells: number;
  completenessPct: number;
};

export type GeologicalComposition = {
  cluster: number;
  code: string;
  className: string;
  cellCount: number;
  clusterCells: number;
  availableGeologyCells: number;
  missingGeologyCells: number;
  geologyCoveragePct: number;
  pctOfAvailable: number;
  pctOfAllCells: number;
};

export type GeologicalCoverage = {
  cluster: number;
  clusterCells: number;
  availableGeologyCells: number;
  missingGeologyCells: number;
  geologyCoveragePct: number;
};

export type EnrichmentManifest = {
  master_rows: number;
  kmeans_labelled_cells: number;
  dbscan_labelled_cells: number;
  master_cells_without_clustering_labels: number;
  cluster_feature_value_mismatches_across_both_algorithms: number;
  kmeans_dbscan_coordinate_populations_identical: boolean;
  generated_files: string[];
};

export type PreprocessingConfiguration = {
  features: string[];
  log1p_features: string[];
  scaler: string;
  quantile_range: number[];
  note: string;
};

export type ClusterLabelSummary = {
  algorithm: "kmeans" | "dbscan";
  cluster: number;
  cells: number;
  percentage: number;
};

export type ExplorerData = {
  cells: Cell[];
  profiles: NumericProfile[];
  featureCoverage: FeatureCoverage[];
  geology: GeologicalComposition[];
  geologyCoverage: GeologicalCoverage[];
  clusterCounts: number[];
  enrichment: EnrichmentManifest;
  preprocessing: PreprocessingConfiguration;
  labelSummary: ClusterLabelSummary[];
};

export type MissionSite = {
  mission_body: "MOON" | "MARS";
  site_id: string;
  site: string;
  latitude_deg: number;
  longitude_east_deg: number;
  longitude_signed_deg: number;
  sampling_radius_km: number | null;
  data_readiness: string;
  spatial_scope_note: string;
};

export type ScreeningRegion = {
  reference_site: string;
  site_id: string;
  mission_body: "MOON" | "MARS";
  screening_scenario: "strict" | "extended";
  region_id: string;
  candidate_tier: string;
  support_cells: number;
  approx_area_km2: number;
  centroid_lat: number;
  centroid_lon: number;
  representative_lat: number;
  representative_lon: number;
  earth_cell_id: string;
  vegetation_median: number | null;
  vegetation_min: number | null;
  ai_valeur_median: number | null;
  aridity_class_mode: string;
  land_fraction_mean: number | null;
  kmeans_cluster_mode: number | null;
  dbscan_cluster_mode: number | null;
  median_slope: number | null;
  median_local_relief_m: number | null;
  screening_conditions_passed: string;
  screening_conditions_unavailable: string;
  screening_conditions_failed: string;
  screening_evidence_coverage_pct: number;
  feature_summaries: Record<string, ScreeningFeatureSummary>;
  explanation: string;
  limitations: string;
  similarity_score: number | null;
  score_type: string;
  ranking_basis: string;
  data_quality_status: string;
};

export type ScreeningFeatureSummary = {
  median: number | null;
  mode?: string | null;
  available_cells: number;
  missing_cells: number;
};

export type MissionCoverage = {
  reference_site: string;
  site_id: string;
  mission_body: "MOON" | "MARS";
  screening_scenario: "strict" | "extended";
  earth_cells_tested: number;
  screening_candidate_cells: number;
  screening_evidence_coverage_pct: number;
  candidate_regions: number;
  known_dry_class_cells: number;
  aridity_unknown_southern_polar_cells: number;
  numeric_score_eligible_features: number;
  numeric_similarity_score: number | null;
  result_type: string;
  interpretation: string;
  site_scope_note: string;
};

export type MissionReferenceRecord = Record<string, string>;

export type MissionReferenceDetails = {
  site: MissionSite;
  records: MissionReferenceRecord[];
};

export type MissionScreeningScenario = {
  vegetation_max: number;
  minimum_land_fraction: number;
  accepted_aridity_classes: string[];
  southern_polar_aridity_policy: string;
};

export type MissionScreeningPolicy = {
  numeric_similarity_enabled: false;
  screening_interpretation: string;
  screening_scenarios: Record<"strict" | "extended", MissionScreeningScenario>;
};

export type MissionData = {
  sites: MissionSite[];
  regions: ScreeningRegion[];
  coverage: MissionCoverage[];
  compatibility: Record<string, string>[];
  referenceDetails: Record<string, MissionReferenceDetails>;
  screeningPolicy: MissionScreeningPolicy;
};

export const ENVIRONMENT_FEATURES = [
  "precipitation",
  "vegetation",
  "annual_temperature_range",
  "lst_diurnal_range",
  "slope",
  "roughness",
  "elevation",
  "mean_annual_temperature",
] as const;

const csvPaths = {
  cells: "/data/cells.csv",
  profiles: "/data/profiles.csv",
  featureCoverage: "/data/feature-coverage.csv",
  geology: "/data/geology.csv",
  geologyCoverage: "/data/geology-coverage.csv",
  labelSummary: "/data/label-summary.csv",
};

type CsvRow = Record<string, string>;

async function loadEnrichmentManifest(): Promise<EnrichmentManifest> {
  const response = await fetch("/data/enrichment-manifest.json");
  if (!response.ok) {
    throw new Error(`Could not load the enrichment manifest (${response.status} ${response.statusText}).`);
  }
  const value: unknown = await response.json();
  if (!value || typeof value !== "object") throw new Error("The enrichment manifest is not a JSON object.");
  const manifest = value as Record<string, unknown>;
  const numericFields = [
    "master_rows",
    "kmeans_labelled_cells",
    "dbscan_labelled_cells",
    "master_cells_without_clustering_labels",
    "cluster_feature_value_mismatches_across_both_algorithms",
  ] as const;
  for (const field of numericFields) {
    if (typeof manifest[field] !== "number" || !Number.isFinite(manifest[field])) {
      throw new Error(`The enrichment manifest is missing a valid ${field} value.`);
    }
  }
  if (
    typeof manifest.kmeans_dbscan_coordinate_populations_identical !== "boolean" ||
    !Array.isArray(manifest.generated_files) ||
    !manifest.generated_files.every((file) => typeof file === "string")
  ) {
    throw new Error("The enrichment manifest is missing required validation or output information.");
  }
  return manifest as EnrichmentManifest;
}

async function loadPreprocessingConfiguration(): Promise<PreprocessingConfiguration> {
  const response = await fetch("/data/preprocessing.json");
  if (!response.ok) {
    throw new Error(`Could not load the saved preprocessing configuration (${response.status} ${response.statusText}).`);
  }
  const value: unknown = await response.json();
  if (!value || typeof value !== "object") throw new Error("The preprocessing configuration is not a JSON object.");
  const configuration = value as Record<string, unknown>;
  if (
    !Array.isArray(configuration.features) ||
    !configuration.features.every((feature) => typeof feature === "string") ||
    !Array.isArray(configuration.log1p_features) ||
    !configuration.log1p_features.every((feature) => typeof feature === "string") ||
    typeof configuration.scaler !== "string" ||
    !Array.isArray(configuration.quantile_range) ||
    !configuration.quantile_range.every((value) => typeof value === "number") ||
    typeof configuration.note !== "string"
  ) {
    throw new Error("The saved preprocessing configuration is missing required fields.");
  }
  return configuration as PreprocessingConfiguration;
}

async function loadCsv(path: string): Promise<CsvRow[]> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Could not load ${path} (${response.status} ${response.statusText}).`);
  }
  const csv = await response.text();
  const parsed = Papa.parse<CsvRow>(csv, { header: true, skipEmptyLines: true });
  if (parsed.errors.length) {
    throw new Error(`Could not parse ${path}: ${parsed.errors[0].message}`);
  }
  return parsed.data;
}

async function fetchLunarContextCells(): Promise<EarthContextCell[]> {
  const rows = await loadCsv("/data/mission-earth-context.csv");
  const required = [
    "grid_row", "grid_col", "lat", "lon", "slope", "roughness", "local_relief_m",
    "vegetation", "bare_pct", "land_frac", "glim_code", "glim_classe",
    "kmeans_cluster", "dbscan_cluster",
  ];
  if (!rows.length || required.some((field) => !(field in rows[0]))) {
    throw new Error("Earth context data is missing grid coordinates or required terrain, surface, geology, or cluster fields.");
  }
  const cells = rows.map((row): EarthContextCell => ({
    gridRow: requiredNumber(row.grid_row, "Earth context grid row"),
    gridCol: requiredNumber(row.grid_col, "Earth context grid column"),
    latitude: requiredNumber(row.lat, "Earth context latitude"),
    longitude: requiredNumber(row.lon, "Earth context longitude"),
    kmeansCluster: numberValue(row.kmeans_cluster),
    dbscanCluster: numberValue(row.dbscan_cluster),
    slope: numberValue(row.slope),
    localReliefM: numberValue(row.local_relief_m),
    roughness: numberValue(row.roughness),
    vegetation: numberValue(row.vegetation),
    barePct: numberValue(row.bare_pct),
    landFrac: numberValue(row.land_frac),
    precipitation: numberValue(row.precipitation),
    aiValue: numberValue(row.ai_valeur),
    elevation: numberValue(row.elevation),
    annualTemperatureRange: numberValue(row.annual_temperature_range),
    lstDiurnalRange: numberValue(row.lst_diurnal_range),
    meanAnnualTemperature: numberValue(row.mean_annual_temperature),
    ssrdWm2: numberValue(row.ssrd_wm2),
    energyKwhM2Year: numberValue(row.energie_kwh_m2_an),
    glimCode: row.glim_code?.trim() || null,
    glimClass: row.glim_classe?.trim() || null,
  }));
  if (cells.length !== 85_478) {
    throw new Error(`Unexpected Earth context dataset: loaded ${cells.length.toLocaleString()} cells; expected 85,478.`);
  }
  return cells;
}

function numberValue(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function requiredNumber(value: string | undefined, field: string): number {
  const parsed = numberValue(value);
  if (parsed === null) throw new Error(`The CSV contains a missing or invalid ${field} value.`);
  return parsed;
}

function mapCells(rows: CsvRow[]): Cell[] {
  const required = ["latitude", "longitude", "cluster", ...ENVIRONMENT_FEATURES];
  if (!rows.length || required.some((column) => !(column in rows[0]))) {
    throw new Error("The K-Means CSV is missing required coordinates, cluster, or feature columns.");
  }

  return rows.map((row) => {
    const features: Record<string, number | null> = {};
    for (const feature of ENVIRONMENT_FEATURES) features[feature] = numberValue(row[feature]);
    return {
      latitude: requiredNumber(row.latitude, "latitude"),
      longitude: requiredNumber(row.longitude, "longitude"),
      cluster: requiredNumber(row.cluster, "cluster"),
      features,
    };
  });
}

async function fetchExplorerData(): Promise<ExplorerData> {
  const [csvRows, enrichment, preprocessing] = await Promise.all([
    Promise.all(Object.values(csvPaths).map(loadCsv)),
    loadEnrichmentManifest(),
    loadPreprocessingConfiguration(),
  ]);
  const [cellRows, profileRows, coverageRows, geologyRows, geologyCoverageRows, labelRows] = csvRows;

  const cells = mapCells(cellRows);
  const profiles: NumericProfile[] = profileRows
    .filter((row) => row.algorithm === "kmeans")
    .map((row) => ({
      cluster: requiredNumber(row.cluster, "profile cluster"),
      clusterCells: requiredNumber(row.cluster_cells, "profile cluster size"),
      feature: row.feature,
      availableCells: requiredNumber(row.available_cells, "feature available-cell count"),
      missingCells: requiredNumber(row.missing_cells, "feature missing-cell count"),
      availabilityPct: requiredNumber(row.availability_pct, "feature availability"),
      mean: numberValue(row.mean),
      median: numberValue(row.median),
      std: numberValue(row.std),
      q25: numberValue(row.q25),
      q75: numberValue(row.q75),
      min: numberValue(row.min),
      max: numberValue(row.max),
    }));

  const featureCoverage: FeatureCoverage[] = coverageRows
    .filter((row) => row.algorithm === "kmeans")
    .map((row) => ({
      cluster: requiredNumber(row.cluster, "coverage cluster"),
      featureGroup: row.feature_group,
      columnsChecked: (row.columns_checked ?? "").split(";").filter(Boolean),
      clusterCells: requiredNumber(row.cluster_cells, "coverage cluster size"),
      completeCells: requiredNumber(row.complete_cells, "complete cell count"),
      incompleteCells: requiredNumber(row.incomplete_cells, "incomplete cell count"),
      completenessPct: requiredNumber(row.completeness_pct, "feature completeness"),
    }));

  const geology: GeologicalComposition[] = geologyRows.map((row) => ({
    cluster: requiredNumber(row.cluster, "geology cluster"),
    code: row.glim_code,
    className: row.glim_classe,
    cellCount: requiredNumber(row.cell_count, "geology cell count"),
    clusterCells: requiredNumber(row.cluster_cells, "geology cluster size"),
    availableGeologyCells: requiredNumber(row.available_geology_cells, "available geology count"),
    missingGeologyCells: requiredNumber(row.missing_geology_cells, "missing geology count"),
    geologyCoveragePct: requiredNumber(row.geology_coverage_pct, "geology coverage"),
    pctOfAvailable: requiredNumber(row.percentage_of_available_geology, "geology proportion"),
    pctOfAllCells: requiredNumber(row.percentage_of_all_cluster_cells, "cluster geology proportion"),
  }));

  const geologyCoverage: GeologicalCoverage[] = geologyCoverageRows.map((row) => ({
    cluster: requiredNumber(row.cluster, "geology coverage cluster"),
    clusterCells: requiredNumber(row.cluster_cells, "geology coverage cluster size"),
    availableGeologyCells: requiredNumber(row.available_geology_cells, "available geology count"),
    missingGeologyCells: requiredNumber(row.missing_geology_cells, "missing geology count"),
    geologyCoveragePct: requiredNumber(row.geology_coverage_pct, "geology coverage"),
  }));

  const labelSummary: ClusterLabelSummary[] = labelRows
    .filter((row) => row.algorithm === "kmeans" || row.algorithm === "dbscan")
    .map((row) => ({
      algorithm: row.algorithm as ClusterLabelSummary["algorithm"],
      cluster: requiredNumber(row.cluster, "label-summary cluster"),
      cells: requiredNumber(row.cells, "label-summary cell count"),
      percentage: requiredNumber(row.pct_of_labelled_cells, "label-summary percentage"),
    }));

  const clusterCounts = Array.from({ length: 5 }, (_, cluster) =>
    cells.reduce((count, cell) => count + Number(cell.cluster === cluster), 0),
  );
  if (cells.length !== 78_247 || clusterCounts.some((count) => count === 0)) {
    throw new Error(`Unexpected K-Means dataset: loaded ${cells.length.toLocaleString()} cells; expected 78,247.`);
  }

  return { cells, profiles, featureCoverage, geology, geologyCoverage, clusterCounts, enrichment, preprocessing, labelSummary };
}

function mapMissionSite(row: CsvRow): MissionSite {
  if (row.mission_body !== "MOON" && row.mission_body !== "MARS") {
    throw new Error(`Unknown mission body in reference-site data: ${row.mission_body}`);
  }
  return {
    mission_body: row.mission_body,
    site_id: row.site_id,
    site: row.site,
    latitude_deg: requiredNumber(row.latitude_deg, "reference latitude"),
    longitude_east_deg: requiredNumber(row.longitude_east_deg, "reference east longitude"),
    longitude_signed_deg: requiredNumber(row.longitude_signed_deg, "reference signed longitude"),
    sampling_radius_km: numberValue(row.sampling_radius_km),
    data_readiness: row.data_readiness,
    spatial_scope_note: row.spatial_scope_note,
  };
}

function mapScreeningRegion(row: CsvRow): ScreeningRegion {
  if (row.mission_body !== "MOON" && row.mission_body !== "MARS") {
    throw new Error(`Unknown mission body in screening output: ${row.mission_body}`);
  }
  if (row.screening_scenario !== "strict" && row.screening_scenario !== "extended") {
    throw new Error(`Unknown screening scenario: ${row.screening_scenario}`);
  }
  let rawSummaries: unknown;
  try {
    rawSummaries = JSON.parse(row.feature_summaries_json);
  } catch {
    throw new Error(`Screening region ${row.region_id} has invalid feature summary JSON.`);
  }
  if (!rawSummaries || typeof rawSummaries !== "object" || Array.isArray(rawSummaries)) {
    throw new Error(`Screening region ${row.region_id} is missing feature summary data.`);
  }
  const featureSummaries: Record<string, ScreeningFeatureSummary> = {};
  for (const [feature, value] of Object.entries(rawSummaries)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Screening region ${row.region_id} has an invalid ${feature} summary.`);
    }
    const summary = value as Record<string, unknown>;
    const medianValue = summary.median === null || summary.median === undefined
      ? null
      : Number(summary.median);
    const availableCells = Number(summary.available_cells);
    const missingCells = Number(summary.missing_cells);
    const modeValue = summary.mode === null || summary.mode === undefined ? null : String(summary.mode);
    if (
      (medianValue !== null && !Number.isFinite(medianValue)) ||
      !Number.isInteger(availableCells) ||
      !Number.isInteger(missingCells) ||
      availableCells < 0 ||
      missingCells < 0 ||
      (availableCells + missingCells !== requiredNumber(row.support_cells, "screening region cell count"))
    ) {
      throw new Error(`Screening region ${row.region_id} has inconsistent ${feature} availability counts.`);
    }
    featureSummaries[feature] = {
      median: medianValue,
      mode: modeValue,
      available_cells: availableCells,
      missing_cells: missingCells,
    };
  }
  return {
    reference_site: row.reference_site,
    site_id: row.site_id,
    mission_body: row.mission_body,
    screening_scenario: row.screening_scenario,
    region_id: row.region_id,
    candidate_tier: row.candidate_tier,
    support_cells: requiredNumber(row.support_cells, "screening region cell count"),
    approx_area_km2: requiredNumber(row.approx_area_km2, "screening region area"),
    centroid_lat: requiredNumber(row.centroid_lat, "screening region latitude"),
    centroid_lon: requiredNumber(row.centroid_lon, "screening region longitude"),
    representative_lat: requiredNumber(row.representative_lat, "screening representative latitude"),
    representative_lon: requiredNumber(row.representative_lon, "screening representative longitude"),
    earth_cell_id: row.earth_cell_id,
    vegetation_median: numberValue(row.vegetation_median),
    vegetation_min: numberValue(row.vegetation_min),
    ai_valeur_median: numberValue(row.ai_valeur_median),
    aridity_class_mode: row.aridity_class_mode,
    land_fraction_mean: numberValue(row.land_fraction_mean),
    kmeans_cluster_mode: numberValue(row.kmeans_cluster_mode),
    dbscan_cluster_mode: numberValue(row.dbscan_cluster_mode),
    median_slope: numberValue(row.median_slope),
    median_local_relief_m: numberValue(row.median_local_relief_m),
    screening_conditions_passed: row.screening_conditions_passed,
    screening_conditions_unavailable: row.screening_conditions_unavailable,
    screening_conditions_failed: row.screening_conditions_failed,
    screening_evidence_coverage_pct: requiredNumber(
      row.screening_evidence_coverage_pct,
      "screening evidence coverage",
    ),
    feature_summaries: featureSummaries,
    explanation: row.explanation,
    limitations: row.limitations,
    similarity_score: numberValue(row.similarity_score),
    score_type: row.score_type,
    ranking_basis: row.ranking_basis,
    data_quality_status: row.data_quality_status,
  };
}

function mapMissionCoverage(row: CsvRow): MissionCoverage {
  if (row.mission_body !== "MOON" && row.mission_body !== "MARS") {
    throw new Error(`Unknown mission body in screening coverage: ${row.mission_body}`);
  }
  if (row.screening_scenario !== "strict" && row.screening_scenario !== "extended") {
    throw new Error(`Unknown screening scenario in coverage: ${row.screening_scenario}`);
  }
  return {
    reference_site: row.reference_site,
    site_id: row.site_id,
    mission_body: row.mission_body,
    screening_scenario: row.screening_scenario,
    earth_cells_tested: requiredNumber(row.earth_cells_tested, "tested Earth cells"),
    screening_candidate_cells: requiredNumber(row.screening_candidate_cells, "screened candidate cells"),
    screening_evidence_coverage_pct: requiredNumber(
      row.screening_evidence_coverage_pct,
      "screening evidence coverage",
    ),
    candidate_regions: requiredNumber(row.candidate_regions, "screened candidate regions"),
    known_dry_class_cells: requiredNumber(row.known_dry_class_cells, "known dry-class cells"),
    aridity_unknown_southern_polar_cells: requiredNumber(
      row.aridity_unknown_southern_polar_cells,
      "southern polar aridity-unknown cells",
    ),
    numeric_score_eligible_features: requiredNumber(
      row.numeric_score_eligible_features,
      "numeric eligible feature count",
    ),
    numeric_similarity_score: numberValue(row.numeric_similarity_score),
    result_type: row.result_type,
    interpretation: row.interpretation,
    site_scope_note: row.site_scope_note,
  };
}

async function loadMissionScreeningPolicy(): Promise<MissionScreeningPolicy> {
  const response = await fetch("/data/screening-run-manifest.json");
  if (!response.ok) {
    throw new Error(`Could not load generated screening settings (${response.status} ${response.statusText}).`);
  }
  const manifest: unknown = await response.json();
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("The generated screening manifest is not an object.");
  }
  const rawPolicy = (manifest as Record<string, unknown>).screening_policy;
  if (!rawPolicy || typeof rawPolicy !== "object" || Array.isArray(rawPolicy)) {
    throw new Error("The generated manifest does not include screening policy settings.");
  }
  const policy = rawPolicy as Record<string, unknown>;
  const rawScenarios = policy.screening_scenarios;
  if (
    policy.numeric_similarity_enabled !== false ||
    typeof policy.screening_interpretation !== "string" ||
    !rawScenarios ||
    typeof rawScenarios !== "object" ||
    Array.isArray(rawScenarios)
  ) {
    throw new Error("The generated screening policy is incomplete or enables unsupported numeric similarity.");
  }
  const scenarios = rawScenarios as Record<string, unknown>;
  const mappedScenarios = {} as MissionScreeningPolicy["screening_scenarios"];
  for (const name of ["strict", "extended"] as const) {
    const rawScenario = scenarios[name];
    if (!rawScenario || typeof rawScenario !== "object" || Array.isArray(rawScenario)) {
      throw new Error(`The generated screening policy is missing the ${name} scenario.`);
    }
    const scenario = rawScenario as Record<string, unknown>;
    const vegetationMax = Number(scenario.vegetation_max);
    const minimumLandFraction = Number(scenario.minimum_land_fraction);
    if (
      !Number.isFinite(vegetationMax) ||
      !Number.isFinite(minimumLandFraction) ||
      !Array.isArray(scenario.accepted_aridity_classes) ||
      !scenario.accepted_aridity_classes.every((value) => typeof value === "string") ||
      typeof scenario.southern_polar_aridity_policy !== "string"
    ) {
      throw new Error(`The generated ${name} screening settings are invalid.`);
    }
    mappedScenarios[name] = {
      vegetation_max: vegetationMax,
      minimum_land_fraction: minimumLandFraction,
      accepted_aridity_classes: scenario.accepted_aridity_classes as string[],
      southern_polar_aridity_policy: scenario.southern_polar_aridity_policy,
    };
  }
  return {
    numeric_similarity_enabled: false,
    screening_interpretation: policy.screening_interpretation,
    screening_scenarios: mappedScenarios,
  };
}

async function fetchMissionData(): Promise<MissionData> {
  const [siteRows, regionRows, coverageRows, compatibilityRows, screeningPolicy] = await Promise.all([
    loadCsv("/data/mission-sites.csv"),
    loadCsv("/data/screening-regions.csv"),
    loadCsv("/data/mission-coverage.csv"),
    loadCsv("/data/mission-compatibility.csv"),
    loadMissionScreeningPolicy(),
  ]);
  const detailsResponse = await fetch("/data/mission-reference-details.json");
  if (!detailsResponse.ok) {
    throw new Error(`Could not load mission reference details (${detailsResponse.status} ${detailsResponse.statusText}).`);
  }
  const detailsValue: unknown = await detailsResponse.json();
  if (!detailsValue || typeof detailsValue !== "object" || Array.isArray(detailsValue)) {
    throw new Error("Mission reference details are not a site-keyed object.");
  }
  const rawDetails = detailsValue as Record<string, unknown>;
  const sites = siteRows.map(mapMissionSite);
  const expectedSiteIds = new Set([
    "MOON_SHACKLETON",
    "MOON_MALAPERT",
    "MOON_HAWORTH",
    "MARS_GALE",
    "MARS_UTOPIA",
  ]);
  if (
    sites.length !== expectedSiteIds.size ||
    new Set(sites.map((site) => site.site_id)).size !== expectedSiteIds.size ||
    sites.some((site) => !expectedSiteIds.has(site.site_id))
  ) {
    throw new Error("Mission site data must include each of the five expected reference sites exactly once.");
  }
  const referenceDetails: Record<string, MissionReferenceDetails> = {};
  for (const site of sites) {
    const rawSiteDetails = rawDetails[site.site_id];
    if (!rawSiteDetails || typeof rawSiteDetails !== "object" || Array.isArray(rawSiteDetails)) {
      throw new Error(`Missing reference details for ${site.site}.`);
    }
    const recordsValue = (rawSiteDetails as Record<string, unknown>).records;
    if (
      !Array.isArray(recordsValue) ||
      recordsValue.some((record) =>
        !record ||
        typeof record !== "object" ||
        Array.isArray(record) ||
        Object.values(record).some((value) => typeof value !== "string"),
      )
    ) {
      throw new Error(`Reference source records are invalid for ${site.site}.`);
    }
    referenceDetails[site.site_id] = {
      site,
      records: recordsValue as MissionReferenceRecord[],
    };
  }
  return {
    sites,
    regions: regionRows.map(mapScreeningRegion),
    coverage: coverageRows.map(mapMissionCoverage),
    compatibility: compatibilityRows,
    referenceDetails,
    screeningPolicy,
  };
}

let explorerDataPromise: Promise<ExplorerData> | null = null;
let missionDataPromise: Promise<MissionData> | null = null;
let lunarContextCellsPromise: Promise<EarthContextCell[]> | null = null;

export function loadExplorerData(): Promise<ExplorerData> {
  if (!explorerDataPromise) {
    explorerDataPromise = fetchExplorerData().catch((error: unknown) => {
      explorerDataPromise = null;
      throw error;
    });
  }
  return explorerDataPromise;
}

export function loadMissionData(): Promise<MissionData> {
  if (!missionDataPromise) {
    missionDataPromise = fetchMissionData().catch((error: unknown) => {
      missionDataPromise = null;
      throw error;
    });
  }
  return missionDataPromise;
}

export function loadLunarContextCells(): Promise<EarthContextCell[]> {
  if (!lunarContextCellsPromise) {
    lunarContextCellsPromise = fetchLunarContextCells().catch((error: unknown) => {
      lunarContextCellsPromise = null;
      throw error;
    });
  }
  return lunarContextCellsPromise;
}
