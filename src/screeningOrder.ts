import type { ScreeningRegion } from "./data";

const TIER_ORDER: Record<string, number> = {
  SCREENED_DRY_LOW_VEGETATION: 0,
  SCREENED_SEMIARID_LOW_VEGETATION: 1,
  SCREENED_LOW_VEGETATION_ARIDITY_UNKNOWN: 2,
};

export function orderScreeningRegions(regions: readonly ScreeningRegion[]): ScreeningRegion[] {
  return [...regions].sort((a, b) => {
    const tierDifference = (TIER_ORDER[a.candidate_tier] ?? 99) - (TIER_ORDER[b.candidate_tier] ?? 99);
    if (tierDifference) return tierDifference;
    const coverageDifference = b.screening_evidence_coverage_pct - a.screening_evidence_coverage_pct;
    return coverageDifference || a.region_id.localeCompare(b.region_id);
  });
}
