import { previewLimitError, type CatalogScanBudget } from "./catalog-budget.ts";
// TMDB movie reads only. Search pages stay lightweight; details are fetched on demand.
import type {
  CatalogDetail,
  CatalogReference,
  CatalogTagSelection,
} from "../lib/contracts.ts";
import { isCatalogId } from "../lib/contracts.ts";
import type { CatalogSearchPage } from "./providers.ts";
import { AppError } from "./http.ts";
import { tagMatches } from "./catalog-visibility.ts";
import { normalizeFacetName } from "../lib/contracts.ts";

export type TmdbQuery = {
  provider: "tmdb";
  kind: "movie";
  query?: string;
  year?: number;
  sort?: "relevance" | "recency" | "popularity" | "trending";
  cast?: string;
  company?: string;
  includeTags?: CatalogTagSelection[];
  excludeTags?: CatalogTagSelection[];
  releaseDate?: { cutoff: string; operation: "=" | "<" | "<=" | ">" | ">=" };
  direction?: "asc" | "desc";
  page?: number;
  perPage?: number;
  /** Internal preview policy, never forwarded to the provider. */
  scanBudget?: CatalogScanBudget;
};
type Row = Record<string, unknown>;
type Read = <T>(path: string) => Promise<T>;
const row = (v: unknown): Row =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {};
const text = (v: unknown, max = 1000): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, max) : undefined;
const id = (v: unknown): string | undefined =>
  typeof v === "number" && isCatalogId("tmdb", String(v))
    ? String(v)
    : undefined;
const image = (v: unknown): string | undefined =>
  typeof v === "string" && /^\/[A-Za-z0-9._-]+$/.test(v)
    ? `https://image.tmdb.org/t/p/w500${v}`
    : undefined;
const rows = (v: unknown): Row[] => (Array.isArray(v) ? v.map(row) : []);

function movie(
  v: unknown,
  genres: Map<string, string>,
): CatalogDetail | undefined {
  const r = row(v),
    movieId = id(r.id),
    title = text(r.title);
  if (!movieId || !title) return undefined;
  const tags = rows(r.genres).flatMap((g) =>
    id(g.id) && text(g.name, 120)
      ? [{ id: "genre:" + id(g.id)!, name: text(g.name, 120)! }]
      : [],
  );
  if (tags.length === 0 && Array.isArray(r.genre_ids)) {
    for (const raw of r.genre_ids) {
      const gid = id(raw),
        name = gid ? genres.get(gid) : undefined;
      if (gid && name) tags.push({ id: "genre:" + gid, name });
    }
  }
  const date = text(r.release_date, 10);
  const company = rows(r.production_companies).find((c) => text(c.name));
  return {
    reference: { provider: "tmdb", kind: "movie", id: movieId },
    title,
    ...(text(r.overview, 10000)
      ? { description: text(r.overview, 10000) }
      : {}),
    ...(date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? { releaseDate: date } : {}),
    ...(typeof r.runtime === "number" &&
    Number.isInteger(r.runtime) &&
    r.runtime > 0
      ? { durationSeconds: r.runtime * 60 }
      : {}),
    ...(typeof r.adult === "boolean" ? { adult: r.adult } : {}),
    imageUrl: image(r.poster_path),
    ...(company ? { studio: { name: text(company.name)! } } : {}),
    credits: [],
    tags,
    related: [],
    aliases: [],
    links: [],
    sourceUrl: `https://www.themoviedb.org/movie/${movieId}`,
  };
}

/** Bounded native pages, never a catalog download. Filtered totals stay unknown. */
export async function searchTmdb(
  read: Read,
  query: TmdbQuery,
): Promise<CatalogSearchPage> {
  if (query.kind !== "movie")
    throw new AppError(400, "invalid_search", "TMDB supports movies only.");
  for (const value of [query.cast, query.company]) {
    if (value !== undefined && !isCatalogId("tmdb", value))
      throw new AppError(
        400,
        "invalid_search",
        "Invalid TMDB cast or company ID.",
      );
  }
  const page = query.page ?? 1,
    perPage = query.perPage ?? 24;
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isInteger(perPage) ||
    perPage < 1 ||
    perPage > 100 ||
    (page - 1) * perPage > 10000
  )
    throw new AppError(400, "invalid_search", "Invalid TMDB page.");
  if (
    query.direction !== undefined &&
    query.direction !== "asc" &&
    query.direction !== "desc"
  )
    throw new AppError(
      400,
      "invalid_search",
      "Invalid TMDB filter or direction.",
    );
  const q = query.query?.trim();
  if (q && query.sort && query.sort !== "relevance")
    throw new AppError(
      400,
      "invalid_search",
      "TMDB title search uses relevance order. Clear the title to browse by release date.",
    );
  if (
    query.sort &&
    !["relevance", "recency", "popularity", "trending"].includes(query.sort)
  )
    throw new AppError(400, "invalid_search", "Unsupported TMDB sort.");
  if (!q && query.sort === "relevance")
    throw new AppError(
      400,
      "invalid_search",
      "TMDB relevance requires a title query.",
    );
  if (q && query.direction !== undefined)
    throw new AppError(
      400,
      "invalid_search",
      "TMDB relevance order takes no direction.",
    );
  const appliedSort = q
    ? { key: "relevance" as const, upstream: "relevance" }
    : {
        key:
          query.sort === "popularity"
            ? ("popularity" as const)
            : query.sort === "trending"
              ? ("trending" as const)
              : ("recency" as const),
        direction: query.direction ?? "desc",
        upstream:
          query.sort === "trending"
            ? "trending.week"
            : (query.sort === "popularity"
                ? "popularity."
                : "primary_release_date.") + (query.direction ?? "desc"),
      };
  const params = new URLSearchParams({
    include_adult: "true",
    language: "en-US",
  });
  if (q) params.set("query", q.slice(0, 500));
  else if (query.sort !== "trending")
    params.set("sort_by", appliedSort.upstream);
  if (query.year !== undefined) {
    if (!Number.isInteger(query.year) || query.year < 1900 || query.year > 2100)
      throw new AppError(400, "invalid_search", "Invalid TMDB release year.");
    params.set("primary_release_year", String(query.year));
  }
  const genreData = await read<Row>("/3/genre/movie/list?language=en-US");
  if (!Array.isArray(genreData.genres))
    throw new AppError(
      502,
      "upstream_bad_response",
      "TMDB returned an unusable genre list.",
    );
  const genres = new Map(
    rows(genreData.genres).flatMap((g) =>
      id(g.id) && text(g.name, 120)
        ? [[id(g.id)!, text(g.name, 120)!] as const]
        : [],
    ),
  );
  if (!q && query.sort !== "trending") {
    if (query.cast) params.set("with_cast", query.cast);
    if (query.company) params.set("with_companies", query.company);
  }
  const includes = query.includeTags ?? [];
  const excludes = query.excludeTags ?? [];
  const filtered = Boolean(
    includes.length ||
    excludes.length ||
    query.releaseDate ||
    query.cast ||
    query.company,
  );
  const nativeKeywords = !q && query.sort !== "trending";
  if (nativeKeywords && includes.length && includes.every((tag) => tag.tmdb))
    params.set("with_keywords", includes.map((tag) => tag.tmdb).join(","));
  if (nativeKeywords && excludes.some((tag) => tag.tmdb))
    params.set(
      "without_keywords",
      excludes.flatMap((tag) => (tag.tmdb ? [tag.tmdb] : [])).join(","),
    );
  if (!q && query.sort !== "trending" && query.releaseDate) {
    const { cutoff, operation } = query.releaseDate;
    if (["=", ">=", ">"].includes(operation))
      params.set("primary_release_date.gte", cutoff);
    if (["=", "<=", "<"].includes(operation))
      params.set("primary_release_date.lte", cutoff);
  }
  const offset = (page - 1) * perPage;
  let nativePage = filtered ? 1 : Math.floor(offset / 20) + 1;
  let skip = filtered ? offset : offset % 20;
  const items: CatalogDetail[] = [];
  let total: number | undefined,
    more = false;
  for (
    let fetched = 0;
    fetched < (query.scanBudget?.maxPages ?? 40);
    fetched++, nativePage++
  ) {
    if (nativePage > 500)
      throw new AppError(
        422,
        "query_too_broad",
        "TMDB limits browsing to 500 pages. Narrow the title or year.",
      );
    params.set("page", String(nativePage));
    const data = await read<Row>(
      (query.sort === "trending"
        ? "/3/trending/movie/week"
        : `/3/${q ? "search" : "discover"}/movie`) +
        "?" +
        params,
    );
    if (
      !Array.isArray(data.results) ||
      !Number.isInteger(data.total_pages) ||
      !Number.isInteger(data.total_results) ||
      Number(data.total_results) < 0 ||
      Number(data.total_pages) < 0 ||
      data.page !== nativePage
    )
      throw new AppError(
        502,
        "upstream_bad_response",
        "TMDB returned an unusable movie page.",
      );
    total = Number(data.total_results);
    more = false;
    let candidates = rows(data.results).flatMap((r) => {
      const d = movie(r, genres);
      if (!d)
        throw new AppError(
          502,
          "upstream_bad_response",
          "TMDB returned an unusable movie row.",
        );
      return [d];
    });
    if ((q || query.sort === "trending") && (query.cast || query.company)) {
      const qualified = await Promise.all(
        candidates.map(async (detail) => {
          const metadata = await read<Row>(
            "/3/movie/" + detail.reference.id + "?append_to_response=credits",
          );
          if (id(metadata.id) !== detail.reference.id)
            throw new AppError(
              502,
              "upstream_bad_response",
              "TMDB returned a different movie while filtering.",
            );
          if (
            (query.cast && !Array.isArray(row(metadata.credits).cast)) ||
            (query.company && !Array.isArray(metadata.production_companies))
          )
            throw new AppError(
              502,
              "upstream_bad_response",
              "TMDB returned unusable cast or company metadata.",
            );
          const matchesCast =
            !query.cast ||
            rows(row(metadata.credits).cast).some(
              (cast) => id(cast.id) === query.cast,
            );
          const matchesCompany =
            !query.company ||
            rows(metadata.production_companies).some(
              (company) => id(company.id) === query.company,
            );
          return matchesCast && matchesCompany ? detail : null;
        }),
      );
      candidates = qualified.filter(
        (detail): detail is CatalogDetail => detail !== null,
      );
    }
    if (includes.length || excludes.length) {
      candidates = await Promise.all(
        candidates.map(async (detail) => {
          const keywords = await read<Row>(
            "/3/movie/" + detail.reference.id + "/keywords",
          );
          if (!Array.isArray(keywords.keywords))
            throw new AppError(
              502,
              "upstream_bad_response",
              "TMDB returned unusable keywords.",
            );
          detail.tags.push(...keywordRows(keywords.keywords));
          return detail;
        }),
      );
      candidates = candidates.filter(
        (detail) =>
          includes.every((tag) =>
            tagMatches(detail, tag, tag.tmdb ? "exact" : "substring"),
          ) && !excludes.some((tag) => tagMatches(detail, tag, "family")),
      );
    }
    if (query.releaseDate) {
      const { cutoff, operation } = query.releaseDate;
      candidates = candidates.filter((detail) => {
        const date = detail.releaseDate;
        if (!date) return false;
        return operation === "="
          ? date === cutoff
          : operation === "<"
            ? date < cutoff
            : operation === "<="
              ? date <= cutoff
              : operation === ">"
                ? date > cutoff
                : date >= cutoff;
      });
    }
    for (let i = 0; i < candidates.length; i++) {
      if (skip > 0) {
        skip--;
        continue;
      }
      if (items.length === perPage) {
        more = true;
        break;
      }
      items.push(candidates[i]!);
    }
    more = more || nativePage < Number(data.total_pages);
    if (items.length >= perPage || !more)
      return {
        provider: "tmdb",
        kind: "movie",
        page,
        perPage,
        items,
        sort: appliedSort,
        hasMore: more,
        totalCountKnown: !filtered && Number(data.total_pages) <= 500,
        ...(!filtered && Number(data.total_pages) <= 500 ? { total } : {}),
      };
  }
  if (query.scanBudget)
    return {
      provider: "tmdb",
      kind: "movie",
      page,
      perPage,
      items,
      sort: appliedSort,
      hasMore: false,
      totalCountKnown: false,
      errors: [previewLimitError("tmdb")],
    };
  throw new AppError(
    422,
    "query_too_broad",
    "Too many TMDB pages to fill this filtered page. Narrow the title or year.",
  );
}

export async function detailTmdb(
  read: Read,
  reference: CatalogReference,
): Promise<CatalogDetail | null> {
  if (reference.kind !== "movie" || !isCatalogId("tmdb", reference.id))
    throw new AppError(
      400,
      "invalid_reference",
      "TMDB supports positive numeric movie IDs only.",
    );
  let data: Row;
  try {
    data = await read<Row>(
      `/3/movie/${reference.id}?append_to_response=credits,recommendations,alternative_titles,external_ids,keywords`,
    );
  } catch (err) {
    if (err instanceof AppError && err.upstreamStatus === 404) return null;
    throw err;
  }
  const detail = movie(data, new Map());
  if (!detail || detail.reference.id !== reference.id)
    throw new AppError(
      502,
      "upstream_bad_response",
      "TMDB returned a different or unusable movie.",
    );
  detail.tags.push(...keywordRows(row(data.keywords).keywords));
  detail.aliases = rows(row(data.alternative_titles).titles)
    .flatMap((a) => (text(a.title, 500) ? [text(a.title, 500)!] : []))
    .slice(0, 50);
  detail.related = rows(row(data.recommendations).results)
    .flatMap((r) =>
      id(r.id)
        ? [{ provider: "tmdb" as const, kind: "movie" as const, id: id(r.id)! }]
        : [],
    )
    .slice(0, 12);
  // Cast stays source-linked text: this integration exposes movies, not a third performer catalog.
  detail.links = rows(row(data.credits).cast)
    .slice(0, 20)
    .flatMap((c) =>
      id(c.id) && text(c.name, 120)
        ? [
            {
              url: `https://www.themoviedb.org/person/${id(c.id)}`,
              label: text(c.name, 120)!,
            },
          ]
        : [],
    );
  const imdb = text(row(data.external_ids).imdb_id, 20);
  if (imdb && /^tt[0-9]+$/.test(imdb))
    detail.links.push({
      url: `https://www.imdb.com/title/${imdb}/`,
      label: "IMDb",
    });
  return detail;
}

function keywordRows(value: unknown): { id: string; name: string }[] {
  return rows(value).flatMap((entry) =>
    id(entry.id) && text(entry.name, 120)
      ? [{ id: id(entry.id)!, name: text(entry.name, 120)! }]
      : [],
  );
}
export async function searchTmdbKeywords(
  read: Read,
  term: string,
): Promise<{ id: string; name: string }[]> {
  const data = await read<Row>(
    "/3/search/keyword?query=" + encodeURIComponent(term) + "&page=1",
  );
  if (!Array.isArray(data.results))
    throw new AppError(
      502,
      "upstream_bad_response",
      "TMDB returned an unusable keyword search.",
    );
  return keywordRows(data.results)
    .filter((entry) => normalizeFacetName(entry.name) !== "")
    .slice(0, 25);
}

/** Cast and production-company choices remain filters over movies, not deliverable identities. */
export async function searchTmdbFacets(
  read: Read,
  kind: "performer" | "studio",
  term: string,
): Promise<{ id: string; name: string }[]> {
  const data = await read<Row>(
    "/3/search/" +
      (kind === "performer" ? "person" : "company") +
      "?query=" +
      encodeURIComponent(term) +
      "&page=1",
  );
  if (!Array.isArray(data.results))
    throw new AppError(
      502,
      "upstream_bad_response",
      "TMDB returned an unusable facet search.",
    );
  return keywordRows(data.results).slice(0, 25);
}
