import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { loadLunarContextCells, loadMissionData } from "../src/data.ts";
import { filterLunarContext } from "../src/lunarContext.ts";
import { orderScreeningRegions } from "../src/screeningOrder.ts";

const routes: Record<string, string> = {
  "/data/mission-sites.csv": "mission_data/processed/mission_reference_sites.csv",
  "/data/screening-regions.csv": "outputs/astromatch/analogue_regions.csv",
  "/data/mission-coverage.csv": "outputs/astromatch/matching_coverage_report.csv",
  "/data/mission-compatibility.csv": "mission_data/scoring/feature_compatibility_final.csv",
  "/data/mission-reference-details.json": "outputs/astromatch/mission_reference_details.json",
  "/data/screening-run-manifest.json": "outputs/astromatch/matching_run_manifest.json",
  "/data/mission-earth-context.csv": "outputs/astromatch_enriched_earth.csv",
};

test("frontend data adapters load actual generated site, region, policy, and Earth context data", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const route = String(input);
    const file = routes[route];
    if (!file) throw new Error(`Unexpected frontend data request: ${route}`);
    return new Response(await readFile(resolve(process.cwd(), file)), { status: 200 });
  }) as typeof fetch;

  try {
    const mission = await loadMissionData();
    assert.deepEqual(
      mission.sites.map((site) => site.site_id).sort(),
      ["MARS_GALE", "MARS_UTOPIA", "MOON_HAWORTH", "MOON_MALAPERT", "MOON_SHACKLETON"],
    );
    assert.ok(mission.regions.length > 0);
    assert.ok(mission.regions.every((region) => region.mission_body === "MARS"));
    assert.ok(mission.regions.every((region) => region.similarity_score === null));
    assert.ok(mission.regions.every((region) => region.feature_summaries.vegetation));
    assert.equal(mission.screeningPolicy.numeric_similarity_enabled, false);
    assert.equal(mission.coverage.length, 10);
    assert.ok(mission.coverage.every((site) => site.numeric_similarity_score === null));
    const originalRegionIds = mission.regions.map((region) => region.region_id);
    const orderedRegions = orderScreeningRegions(mission.regions);
    const tierRank: Record<string, number> = {
      SCREENED_DRY_LOW_VEGETATION: 0,
      SCREENED_SEMIARID_LOW_VEGETATION: 1,
      SCREENED_LOW_VEGETATION_ARIDITY_UNKNOWN: 2,
    };
    for (let index = 1; index < orderedRegions.length; index += 1) {
      const previous = orderedRegions[index - 1];
      const current = orderedRegions[index];
      const previousRank = tierRank[previous.candidate_tier] ?? 99;
      const currentRank = tierRank[current.candidate_tier] ?? 99;
      assert.ok(previousRank <= currentRank);
      if (previousRank === currentRank) {
        assert.ok(previous.screening_evidence_coverage_pct >= current.screening_evidence_coverage_pct);
      }
    }
    assert.deepEqual(mission.regions.map((region) => region.region_id), originalRegionIds);

    const utopia = mission.referenceDetails.MARS_UTOPIA;
    assert.ok(utopia.records.some((record) =>
      record.subregion === "Southern Utopia - Zhurong region"
      || record.geological_unit === "Southern Utopia - Zhurong surveyed soils",
    ));
    assert.match(utopia.site.spatial_scope_note, /Southern Utopia/);

    const contextCells = await loadLunarContextCells();
    assert.equal(contextCells.length, 85_478);
    assert.ok(contextCells.some((cell) => cell.glimCode !== null));
    assert.ok(contextCells.some((cell) => cell.slope === null));
    const geologyContexts = filterLunarContext(contextCells, {
      layer: "geology",
      feature: "glim_code",
      minimum: null,
      maximum: null,
      glimCode: "all",
    });
    const slopeContexts = filterLunarContext(contextCells, {
      layer: "terrain",
      feature: "slope",
      minimum: 1,
      maximum: 3,
      glimCode: "all",
    });
    assert.ok(geologyContexts.cellsMatched > 0);
    assert.ok(geologyContexts.regions.length > 0);
    assert.ok(slopeContexts.cellsMatched > 0);
    assert.ok(slopeContexts.cellsMissingSelectedFeature > 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
