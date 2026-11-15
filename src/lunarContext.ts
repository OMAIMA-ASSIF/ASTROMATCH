export type LunarContextLayer = "terrain" | "geology" | "surface";
export type LunarContextFeature =
  | "slope"
  | "local_relief_m"
  | "roughness"
  | "vegetation"
  | "bare_pct"
  | "land_frac"
  | "glim_code";

export type EarthContextCell = {
  gridRow: number;
  gridCol: number;
  latitude: number;
  longitude: number;
  kmeansCluster: number | null;
  dbscanCluster: number | null;
  slope: number | null;
  localReliefM: number | null;
  roughness: number | null;
  vegetation: number | null;
  barePct: number | null;
  landFrac: number | null;
  precipitation: number | null;
  aiValue: number | null;
  elevation: number | null;
  annualTemperatureRange: number | null;
  lstDiurnalRange: number | null;
  meanAnnualTemperature: number | null;
  ssrdWm2: number | null;
  energyKwhM2Year: number | null;
  glimCode: string | null;
  glimClass: string | null;
};

export type LunarContextFilter = {
  layer: LunarContextLayer;
  feature: LunarContextFeature;
  minimum: number | null;
  maximum: number | null;
  glimCode: string;
};

export type ContextFeatureSummary = {
  median: number | null;
  availableCells: number;
  missingCells: number;
};

export type LunarContextRegion = {
  region_id: string;
  context_layer: LunarContextLayer;
  context_feature: LunarContextFeature;
  context_value: string | number | null;
  context_reason: string;
  representative_lat: number;
  representative_lon: number;
  centroid_lat: number;
  centroid_lon: number;
  support_cells: number;
  approx_area_km2: number;
  earth_cell_id: string;
  glim_code_mode: string | null;
  glim_class_mode: string | null;
  kmeans_cluster_mode: number | null;
  dbscan_cluster_mode: number | null;
  feature_summaries: Record<string, ContextFeatureSummary>;
  limitations: string;
};

export type LunarContextResult = {
  regions: LunarContextRegion[];
  cellsAvailable: number;
  cellsMatched: number;
  cellsMissingSelectedFeature: number;
  cellsOutsideFilter: number;
};

const EARTH_RADIUS_KM = 6_371.0088;
const GRID_STEP_DEGREES = 0.5;
const SUMMARY_FIELDS = [
  "slope",
  "local_relief_m",
  "roughness",
  "vegetation",
  "bare_pct",
  "land_frac",
  "precipitation",
  "ai_valeur",
  "elevation",
  "annual_temperature_range",
  "lst_diurnal_range",
  "mean_annual_temperature",
  "ssrd_wm2",
  "energie_kwh_m2_an",
] as const;

const FEATURE_LABELS: Record<LunarContextFeature, string> = {
  slope: "Earth slope",
  local_relief_m: "Earth local relief",
  roughness: "Earth terrain roughness",
  vegetation: "Earth vegetation",
  bare_pct: "Earth bare-ground percentage",
  land_frac: "Earth land fraction",
  glim_code: "Earth GLiM lithology",
};

const CONTEXT_LIMITATIONS =
  "Exploratory terrestrial context only. Earth cells are on a 0.5-degree grid; source-product resolution and aggregation windows are not fully documented. Lunar terrain uses finer-scale source data, so values are not compared as equivalent measurements. GLiM classes do not establish lunar mineralogical equivalence. These measurements do not establish an Earth analogue to a lunar site.";

function selectedValue(cell: EarthContextCell, feature: LunarContextFeature): number | string | null {
  if (feature === "glim_code") return cell.glimCode;
  switch (feature) {
    case "slope": return cell.slope;
    case "local_relief_m": return cell.localReliefM;
    case "roughness": return cell.roughness;
    case "vegetation": return cell.vegetation;
    case "bare_pct": return cell.barePct;
    case "land_frac": return cell.landFrac;
  }
}

function summaryValue(cell: EarthContextCell, field: typeof SUMMARY_FIELDS[number]): number | null {
  switch (field) {
    case "slope": return cell.slope;
    case "local_relief_m": return cell.localReliefM;
    case "roughness": return cell.roughness;
    case "vegetation": return cell.vegetation;
    case "bare_pct": return cell.barePct;
    case "land_frac": return cell.landFrac;
    case "precipitation": return cell.precipitation;
    case "ai_valeur": return cell.aiValue;
    case "elevation": return cell.elevation;
    case "annual_temperature_range": return cell.annualTemperatureRange;
    case "lst_diurnal_range": return cell.lstDiurnalRange;
    case "mean_annual_temperature": return cell.meanAnnualTemperature;
    case "ssrd_wm2": return cell.ssrdWm2;
    case "energie_kwh_m2_an": return cell.energyKwhM2Year;
  }
}

function areaKm2(latitude: number): number {
  const halfStep = GRID_STEP_DEGREES / 2;
  const south = Math.max(-90, latitude - halfStep);
  const north = Math.min(90, latitude + halfStep);
  return EARTH_RADIUS_KM ** 2
    * (GRID_STEP_DEGREES * Math.PI / 180)
    * (Math.sin(north * Math.PI / 180) - Math.sin(south * Math.PI / 180));
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}

function mode(values: Array<string | number | null>): string | number | null {
  const counts = new Map<string | number, number>();
  for (const value of values) {
    if (value === null || value === "") continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let winner: string | number | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      winner = value;
      bestCount = count;
    }
  }
  return winner;
}

function circularMeanLongitude(longitudes: number[]): number {
  const radians = longitudes.map((longitude) => longitude * Math.PI / 180);
  const sin = radians.reduce((sum, value) => sum + Math.sin(value), 0) / radians.length;
  const cos = radians.reduce((sum, value) => sum + Math.cos(value), 0) / radians.length;
  return (Math.atan2(sin, cos) * 180 / Math.PI + 540) % 360 - 180;
}

function reasonFor(filter: LunarContextFilter, region: EarthContextCell[]): string {
  if (filter.layer === "geology") {
    const code = filter.glimCode === "all"
      ? mode(region.map((cell) => cell.glimCode))
      : filter.glimCode;
    const category = mode(region.map((cell) => cell.glimClass));
    return `Selected because these Earth cells carry GLiM code ${code ?? "not reported"}${category ? ` (${category})` : ""}. This is a descriptive Earth geology filter, not a lunar mineralogical match.`;
  }
  const bounds = [
    filter.minimum === null ? null : `at least ${filter.minimum}`,
    filter.maximum === null ? null : `at most ${filter.maximum}`,
  ].filter((value): value is string => value !== null);
  return `Selected by ${FEATURE_LABELS[filter.feature]} using Earth data${bounds.length ? ` (${bounds.join(", ")}; inclusive)` : " (no numeric bounds set)"}. These thresholds are not derived from lunar measurements.`;
}

function summarizeComponent(
  component: EarthContextCell[],
  filter: LunarContextFilter,
): LunarContextRegion {
  const ordered = [...component].sort((a, b) => a.gridRow - b.gridRow || a.gridCol - b.gridCol);
  const first = ordered[0];
  const latitudes = component.map((cell) => cell.latitude);
  const longitudes = component.map((cell) => cell.longitude);
  const featureSummaries: Record<string, ContextFeatureSummary> = {};

  for (const field of SUMMARY_FIELDS) {
    const values = component
      .map((cell) => summaryValue(cell, field))
      .filter((value): value is number => value !== null && Number.isFinite(value));
    featureSummaries[field] = {
      median: median(values),
      availableCells: values.length,
      missingCells: component.length - values.length,
    };
  }
  for (const field of ["glim_code", "glim_class"] as const) {
    const availableCells = component.filter((cell) => Boolean(
      field === "glim_code" ? cell.glimCode : cell.glimClass,
    )).length;
    featureSummaries[field] = {
      median: null,
      availableCells,
      missingCells: component.length - availableCells,
    };
  }

  const selectedSummary = filter.feature === "glim_code"
    ? null
    : featureSummaries[filter.feature];
  const geologyCode = mode(component.map((cell) => cell.glimCode));
  const geologyClass = mode(component.map((cell) => cell.glimClass));
  const kmeansMode = mode(component.map((cell) => cell.kmeansCluster));
  const dbscanMode = mode(component.map((cell) => cell.dbscanCluster));
  const regionId = `${filter.layer}_${first.gridRow}_${first.gridCol}_${component.length}`;

  return {
    region_id: regionId,
    context_layer: filter.layer,
    context_feature: filter.feature,
    context_value: filter.feature === "glim_code"
      ? filter.glimCode === "all" ? geologyCode : filter.glimCode
      : selectedSummary?.median ?? null,
    context_reason: reasonFor(filter, component),
    representative_lat: first.latitude,
    representative_lon: first.longitude,
    centroid_lat: latitudes.reduce((sum, value) => sum + value, 0) / latitudes.length,
    centroid_lon: circularMeanLongitude(longitudes),
    support_cells: component.length,
    approx_area_km2: component.reduce((sum, cell) => sum + areaKm2(cell.latitude), 0),
    earth_cell_id: `${first.gridRow}:${first.gridCol}`,
    glim_code_mode: typeof geologyCode === "string" ? geologyCode : null,
    glim_class_mode: typeof geologyClass === "string" ? geologyClass : null,
    kmeans_cluster_mode: typeof kmeansMode === "number" ? kmeansMode : null,
    dbscan_cluster_mode: typeof dbscanMode === "number" ? dbscanMode : null,
    feature_summaries: featureSummaries,
    limitations: `${CONTEXT_LIMITATIONS} Missing values remain unavailable; feature summaries report per-region availability.`,
  };
}

export function filterLunarContext(
  cells: EarthContextCell[],
  filter: LunarContextFilter,
): LunarContextResult {
  if (filter.minimum !== null && filter.maximum !== null && filter.minimum > filter.maximum) {
    throw new Error("Minimum Earth feature value must not exceed the maximum.");
  }
  const matched: EarthContextCell[] = [];
  let cellsAvailable = 0;
  let cellsMissingSelectedFeature = 0;

  for (const cell of cells) {
    const value = selectedValue(cell, filter.feature);
    if (value === null || value === "") {
      cellsMissingSelectedFeature++;
      continue;
    }
    if (typeof value !== "number" && filter.feature !== "glim_code") {
      throw new Error(`Unexpected non-numeric value for ${filter.feature}.`);
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
      cellsMissingSelectedFeature++;
      continue;
    }
    cellsAvailable++;
    const passes = filter.feature === "glim_code"
      ? filter.glimCode === "all" || value === filter.glimCode
      : (filter.minimum === null || (value as number) >= filter.minimum)
        && (filter.maximum === null || (value as number) <= filter.maximum);
    if (passes) matched.push(cell);
  }

  const byGrid = new Map<string, EarthContextCell>();
  for (const cell of matched) {
    const key = `${cell.gridRow}:${cell.gridCol}`;
    if (byGrid.has(key)) throw new Error(`Duplicate Earth grid cell in context data: ${key}`);
    byGrid.set(key, cell);
  }
  const unseen = new Set(byGrid.keys());
  const regions: LunarContextRegion[] = [];
  const gridWidth = 720;

  while (unseen.size) {
    const start = unseen.values().next().value as string;
    unseen.delete(start);
    const queue = [start];
    const component = [byGrid.get(start)!];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const [rowText, colText] = queue[cursor].split(":");
      const row = Number(rowText);
      const col = Number(colText);
      const currentCell = byGrid.get(queue[cursor])!;
      const neighbors = [
        `${row - 1}:${col}`,
        `${row + 1}:${col}`,
        `${row}:${(col - 1 + gridWidth) % gridWidth}`,
        `${row}:${(col + 1) % gridWidth}`,
      ];
      for (const neighbor of neighbors) {
        const neighborCell = byGrid.get(neighbor);
        const sameGeologyClass = filter.layer !== "geology"
          || neighborCell?.glimCode === currentCell.glimCode;
        if (unseen.has(neighbor) && sameGeologyClass) {
          unseen.delete(neighbor);
          queue.push(neighbor);
          component.push(neighborCell!);
        }
      }
    }
    regions.push(summarizeComponent(component, filter));
  }

  regions.sort((a, b) => b.support_cells - a.support_cells || a.region_id.localeCompare(b.region_id));
  return {
    regions,
    cellsAvailable,
    cellsMatched: matched.length,
    cellsMissingSelectedFeature,
    cellsOutsideFilter: cellsAvailable - matched.length,
  };
}

export function lunarContextGeoJSON(regions: LunarContextRegion[]) {
  return {
    type: "FeatureCollection" as const,
    features: regions.map((region) => ({
      type: "Feature" as const,
      geometry: {
        type: "Point" as const,
        coordinates: [region.representative_lon, region.representative_lat],
      },
      properties: region,
    })),
  };
}

export function lunarContextCsvRows(regions: LunarContextRegion[]): Array<Record<string, string | number | null>> {
  return regions.map((region) => ({
    ...region,
    feature_summaries: JSON.stringify(region.feature_summaries),
  }));
}

export function lunarContextFeatureValue(
  cell: EarthContextCell,
  feature: LunarContextFeature,
): number | string | null {
  return selectedValue(cell, feature);
}

export function lunarContextFeatureLabel(feature: LunarContextFeature): string {
  return FEATURE_LABELS[feature];
}
