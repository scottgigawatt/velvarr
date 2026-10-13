import assert from "node:assert/strict";
import { test } from "node:test";
import { recentPopularWindow } from "../src/lib/tmdb-discovery.ts";
import { searchTmdb, DEFAULT_ADULT_KEYWORDS } from "../src/server/tmdb.ts";
import { AppError } from "../src/server/http.ts";

test("recent release windows are inclusive UTC calendar dates", () => {
  const now = new Date("2024-03-01T00:30:00Z");
  assert.deepEqual(recentPopularWindow(30, now), {
    start: "2024-02-01",
    end: "2024-03-01",
  });
  assert.deepEqual(recentPopularWindow(90, now), {
    start: "2023-12-03",
    end: "2024-03-01",
  });
  assert.deepEqual(recentPopularWindow(365, now), {
    start: "2023-03-03",
    end: "2024-03-01",
  });
});

function fixture(
  options: { keywords?: number[][]; pages?: number; matches?: number[] } = {},
) {
  const paths: URL[] = [];
  let searches = 0;
  const read = async <T>(path: string): Promise<T> => {
    const url = new URL(path, "http://fixture");
    paths.push(url);
    if (url.pathname === "/3/genre/movie/list") return { genres: [] } as T;
    if (url.pathname === "/3/search/keyword") {
      searches++;
      return {
        results:
          url.searchParams.get("query") === "pornography"
            ? [{ id: 445, name: "pornography" }]
            : [],
      } as T;
    }
    if (url.pathname.endsWith("/keywords")) {
      const movieId = Number(url.pathname.split("/")[3]);
      const ids = options.matches
        ? options.matches.includes(movieId)
          ? [445, 44]
          : [55]
        : (options.keywords?.[movieId - 1] ?? [445]);
      return {
        keywords: ids.map((id) => ({
          id,
          name: id === 445 ? "pornography" : id === 44 ? "Wanted" : "Hidden",
        })),
      } as T;
    }
    assert.equal(url.pathname, "/3/discover/movie");
    assert.equal(url.searchParams.get("include_adult"), "true");
    assert.equal(url.searchParams.get("region"), "US");
    assert.equal(url.searchParams.get("sort_by"), "popularity.desc");
    const page = Number(url.searchParams.get("page"));
    return {
      page,
      total_pages: options.pages ?? 1,
      total_results: options.pages ?? options.keywords?.length ?? 1,
      results: Array.from(
        { length: options.keywords?.length ?? 1 },
        (_, i) => ({
          id: options.pages ? page : i + 1,
          title: "Fixture " + i,
          // Primary dates can differ from the US release date used by Discover.
          release_date: "2020-01-01",
          adult: i === 1,
        }),
      ),
    } as T;
  };
  return { read, paths, searches: () => searches };
}

test("broad keyword defaults keep unflagged adult media and reject flag-only mainstream results", async () => {
  const f = fixture({ keywords: [[445], [55]] });
  const result = await searchTmdb(f.read, {
    provider: "tmdb",
    kind: "movie",
    sort: "recent-popular",
  });
  assert.deepEqual(
    result.items.map((d) => d.reference.id),
    ["1"],
  );
  assert.equal(result.items[0]!.adult, false);
  assert.equal(result.totalCountKnown, false);
  assert.equal(result.sort?.key, "recent-popular");
  const listing = f.paths.find((p) => p.pathname === "/3/discover/movie")!;
  assert.equal(listing.searchParams.get("with_keywords"), "445");
  const window = recentPopularWindow();
  assert.equal(listing.searchParams.get("release_date.gte"), window.start);
  assert.equal(listing.searchParams.get("release_date.lte"), window.end);
  await searchTmdb(f.read, {
    provider: "tmdb",
    kind: "movie",
    sort: "recent-popular",
    recentDays: 90,
  });
  assert.equal(
    f.searches(),
    DEFAULT_ADULT_KEYWORDS.length,
    "successful catalog is cached for this transport",
  );
  assert.ok(
    f.paths.some(
      (p) =>
        p.searchParams.get("release_date.gte") ===
        recentPopularWindow(90).start,
    ),
  );
});

test("personal tags narrow the adult scope and foreign provider tags never become TMDB filters", async () => {
  const f = fixture({ keywords: [[445, 44], [44], [445], [445, 44, 55]] });
  const result = await searchTmdb(f.read, {
    provider: "tmdb",
    kind: "movie",
    sort: "recent-popular",
    year: 2026,
    cast: "5",
    company: "8",
    includeTags: [
      { name: "Wanted", tmdb: "44" },
      { name: "Gay", tpdb: "00000000-0000-4000-8000-000000000033" },
    ],
    excludeTags: [{ name: "Hidden", tmdb: "55" }],
    releaseDate: { cutoff: "2027-01-01", operation: "<" },
  });
  assert.deepEqual(
    result.items.map((d) => d.reference.id),
    ["1"],
  );
  const params = f.paths.find(
    (p) => p.pathname === "/3/discover/movie",
  )!.searchParams;
  assert.equal(params.get("with_keywords"), "44");
  assert.equal(params.get("without_keywords"), "55");
  assert.equal(params.get("with_cast"), "5");
  assert.equal(params.get("with_companies"), "8");
  assert.equal(params.get("primary_release_year"), "2026");
  assert.equal(params.get("primary_release_date.lte"), "2027-01-01");
});

test("legacy TMDB trending links use Discover, with no weekly trending request", async () => {
  const f = fixture();
  const result = await searchTmdb(f.read, {
    provider: "tmdb",
    kind: "movie",
    sort: "trending",
  });
  assert.equal(result.sort?.key, "recent-popular");
  assert.equal(
    f.paths.some((p) => p.pathname.includes("trending")),
    false,
  );
});

test("adult keyword lookup fails closed and retries after unavailable metadata", async () => {
  let ready = false,
    listings = 0;
  const f = fixture();
  const read = async <T>(path: string): Promise<T> => {
    if (path.startsWith("/3/search/keyword") && !ready)
      return { results: [{ id: 999, name: "unrelated keyword" }] } as T;
    if (path.startsWith("/3/discover")) listings++;
    return f.read<T>(path);
  };
  const query = {
    provider: "tmdb" as const,
    kind: "movie" as const,
    sort: "recent-popular" as const,
  };
  await assert.rejects(
    searchTmdb(read, query),
    (e: unknown) =>
      e instanceof AppError && e.code === "tmdb_adult_keywords_unavailable",
  );
  assert.equal(listings, 0);
  ready = true;
  assert.equal((await searchTmdb(read, query)).items.length, 1);
  for (const status of [401, 500])
    await assert.rejects(
      searchTmdb(async <T>(path: string): Promise<T> => {
        if (path.startsWith("/3/search/keyword"))
          throw new AppError(
            502,
            "upstream_unavailable",
            "Fixture failure",
            status,
          );
        return f.read<T>(path);
      }, query),
      (e: unknown) => e instanceof AppError && e.upstreamStatus === status,
    );
});

for (const matches of [[], [1, 20]])
  test(`bounded recent popularity preserves sparse matches (${matches.join(",") || "none"})`, async () => {
    const f = fixture({ pages: 100, matches });
    const result = await searchTmdb(f.read, {
      provider: "tmdb",
      kind: "movie",
      sort: "recent-popular",
      includeTags: [{ name: "Wanted", tmdb: "44" }],
    });
    assert.deepEqual(
      result.items.map((d) => d.reference.id),
      matches.map(String),
    );
    assert.equal(
      f.paths.filter((p) => p.pathname === "/3/discover/movie").length,
      40,
    );
    assert.equal(result.hasMore, false);
    assert.equal(result.total, undefined);
    assert.equal(result.errors?.[0]?.code, "scan_ceiling");
    assert.match(result.errors![0]!.message, /Expand the release window/);
  });

test("invalid windows fail before provider I/O and preview scans honor the small budget", async () => {
  const f = fixture({ pages: 100, matches: [] });
  await assert.rejects(
    searchTmdb(f.read, {
      provider: "tmdb",
      kind: "movie",
      sort: "recent-popular",
      recentDays: 31,
    }),
    (e: unknown) => e instanceof AppError && e.code === "invalid_search",
  );
  assert.equal(f.paths.length, 0);
  const result = await searchTmdb(f.read, {
    provider: "tmdb",
    kind: "movie",
    sort: "recent-popular",
    scanBudget: { maxPages: 3 },
  });
  assert.equal(
    f.paths.filter((p) => p.pathname === "/3/discover/movie").length,
    3,
  );
  assert.equal(result.items.length, 0);
  assert.equal(result.errors?.[0]?.code, "scan_ceiling");
});
