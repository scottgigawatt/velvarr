// Disclosed TMDB discovery defaults: recent US releases ranked by popularity.
export const RECENT_POPULAR_DAYS = [30, 90, 365] as const;
export const DEFAULT_RECENT_POPULAR_DAYS = 30;
export const RECENT_POPULAR_REGION = "US";

/** Inclusive calendar-date window, independent of the host timezone. */
export function recentPopularWindow(
  days: number = DEFAULT_RECENT_POPULAR_DAYS,
  now: Date = new Date(),
): { start: string; end: string } {
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const start = new Date(end.getTime() - (days - 1) * 86400000);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}
