// Discover previews stop early without discarding matches or weakening personal filters.
import type { CatalogProvider, SourceError } from "../lib/contracts.ts";

/** Internal policy only; public query parameters cannot increase this budget. */
export type CatalogScanBudget = { maxPages: number };
export const DISCOVER_SCAN_BUDGET: CatalogScanBudget = { maxPages: 3 };

export function previewLimitError(provider: CatalogProvider): SourceError {
  return {
    provider,
    code: "scan_ceiling",
    message:
      "This preview is limited to keep discovery quick. Adjust your preferred or hidden tags, or open Browse to narrow the search.",
  };
}

/** Trending can filter only TMDB's weekly list, not discover the full catalog. */
export function trendingLimitError(): SourceError {
  return {
    provider: "tmdb",
    code: "scan_ceiling",
    message:
      "This search reached its limit while filtering TMDB's weekly trending list. Any matches found are shown. Use Popularity or Release recency to search the full movie catalog with these filters.",
  };
}
