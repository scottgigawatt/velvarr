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
