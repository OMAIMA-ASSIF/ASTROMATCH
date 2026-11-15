import assert from "node:assert/strict";
import test from "node:test";
import {
  filterLunarContext,
  lunarContextGeoJSON,
  type EarthContextCell,
} from "../src/lunarContext.ts";

function cell(
  gridRow: number,
  gridCol: number,
  latitude: number,
  longitude: number,
  overrides: Partial<EarthContextCell> = {},
): EarthContextCell {
  return {
    gridRow,
    gridCol,
    latitude,
    longitude,
    kmeansCluster: 1,
    dbscanCluster: 0,
    slope: 1,
    localReliefM: 100,
    roughness: 5,
    vegetation: 0.1,
    barePct: 60,
    landFrac: 1,
    precipitation: 300,
    aiValue: 0.2,
    elevation: 500,
    annualTemperatureRange: 25,
    lstDiurnalRange: 10,
    meanAnnualTemperature: 5,
    ssrdWm2: 100,
    energyKwhM2Year: 900,
    glimCode: "16.0",
    glimClass: "ig",
    ...overrides,
  };
}

test("terrain filters preserve missing values as unavailable and group dateline neighbors", () => {
  const result = filterLunarContext([
    cell(10, 719, 0.25, 179.75),
    cell(10, 0, 0.25, -179.75),
    cell(10, 1, 0.25, -179.25, { slope: null }),
    cell(10, 20, 0.25, -169.75, { slope: 2 }),
  ], {
    layer: "terrain",
    feature: "slope",
    minimum: 1,
    maximum: 1,
    glimCode: "all",
  });

  assert.equal(result.cellsAvailable, 3);
  assert.equal(result.cellsMatched, 2);
  assert.equal(result.cellsMissingSelectedFeature, 1);
  assert.equal(result.cellsOutsideFilter, 1);
  assert.equal(result.regions.length, 1);
  assert.equal(result.regions[0].support_cells, 2);
  assert.equal(result.regions[0].feature_summaries.slope.missingCells, 0);
});

test("GLiM filtering uses supplied codes and reports unavailable geology", () => {
  const result = filterLunarContext([
    cell(20, 5, 10.25, 2.75, { glimCode: "16.0", glimClass: "ig" }),
    cell(20, 6, 10.25, 3.25, { glimCode: "1.0", glimClass: "su" }),
    cell(20, 7, 10.25, 3.75, { glimCode: null, glimClass: null }),
  ], {
    layer: "geology",
    feature: "glim_code",
    minimum: null,
    maximum: null,
    glimCode: "16.0",
  });

  assert.equal(result.cellsAvailable, 2);
  assert.equal(result.cellsMatched, 1);
  assert.equal(result.cellsMissingSelectedFeature, 1);
  assert.equal(result.regions[0].glim_code_mode, "16.0");
  assert.match(result.regions[0].context_reason, /descriptive Earth geology filter/);
});

test("all-GLiM browsing keeps adjacent Earth lithology classes in separate regions", () => {
  const result = filterLunarContext([
    cell(21, 5, 10.75, 2.75, { glimCode: "16.0", glimClass: "ig" }),
    cell(21, 6, 10.75, 3.25, { glimCode: "1.0", glimClass: "su" }),
  ], {
    layer: "geology",
    feature: "glim_code",
    minimum: null,
    maximum: null,
    glimCode: "all",
  });

  assert.equal(result.cellsMatched, 2);
  assert.equal(result.regions.length, 2);
  assert.deepEqual(new Set(result.regions.map((region) => region.glim_code_mode)), new Set(["16.0", "1.0"]));
});

test("surface filters do not substitute missing bare-ground values with zero", () => {
  const result = filterLunarContext([
    cell(30, 2, 20.25, 1.25, { barePct: 0 }),
    cell(30, 3, 20.25, 1.75, { barePct: null }),
  ], {
    layer: "surface",
    feature: "bare_pct",
    minimum: 0,
    maximum: 0,
    glimCode: "all",
  });

  assert.equal(result.cellsMatched, 1);
  assert.equal(result.cellsMissingSelectedFeature, 1);
  assert.equal(result.regions[0].feature_summaries.bare_pct.median, 0);
  assert.equal(result.regions[0].feature_summaries.bare_pct.missingCells, 0);
});

test("region area accounts for latitude and GeoJSON uses valid lon-lat points", () => {
  const result = filterLunarContext([
    cell(180, 1, 0.25, 0.75),
    cell(1, 1, 89.75, 0.75),
  ], {
    layer: "terrain",
    feature: "slope",
    minimum: null,
    maximum: null,
    glimCode: "all",
  });
  const equatorial = result.regions.find((region) => region.centroid_lat < 1)!;
  const polar = result.regions.find((region) => region.centroid_lat > 80)!;
  assert.ok(equatorial.approx_area_km2 > polar.approx_area_km2);

  const geojson = lunarContextGeoJSON(result.regions);
  const parsed = JSON.parse(JSON.stringify(geojson));
  assert.equal(parsed.type, "FeatureCollection");
  assert.equal(parsed.features.length, 2);
  assert.deepEqual(parsed.features[0].geometry.type, "Point");
  assert.equal(parsed.features[0].geometry.coordinates.length, 2);
  assert.ok(!("similarity_score" in parsed.features[0].properties));
});

test("invalid exploratory ranges are rejected instead of silently normalized", () => {
  assert.throws(() => filterLunarContext([], {
    layer: "terrain",
    feature: "slope",
    minimum: 4,
    maximum: 2,
    glimCode: "all",
  }), /Minimum Earth feature value/);
});
