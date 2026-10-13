import { judgmentConfiguration, sameWork } from "../src/server/judgment.ts";
// Personal settings, provider isolation, and bounded keyword filtering use disposable data only.
import assert from "node:assert/strict";
import { test, after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as storage from "../src/server/storage.ts";
import {
  defaultPersonalSettings,
  parsePersonalSettings,
} from "../src/lib/personalization.ts";
import {
  httpAllowed,
  setHttpPolicy,
  validateBaseUrl,
  AppError,
} from "../src/server/http.ts";
import {
  whisparrConnectionStatuses,
  adminUpdateIntegrations,
} from "../src/app/api/[...path]/routes/admin.ts";
import { browseRoute } from "../src/app/api/[...path]/routes/catalog.ts";
import {
  searchTmdb,
  searchTmdbKeywords,
  searchTmdbFacets,
} from "../src/server/tmdb.ts";
import { resetMetaCache } from "../src/server/providers.ts";
import type { IntegrationConfig, ExternalUser } from "../src/lib/contracts.ts";
import type { AuthContext } from "../src/app/api/[...path]/admission.ts";
import { withFixture, sendJson, pathOf } from "./fixture.ts";

const previousDir = process.env.VELVARR_DATA_DIR;
const created: string[] = [];
process.env.VELVARR_SECRET_KEY = "48".repeat(32);
const owner: ExternalUser = {
  id: "e".repeat(32),
  name: "Fixture owner",
  isDisabled: false,
  enableRemoteAccess: true,
  enableMediaPlayback: true,
  isAdministrator: true,
};
const base: IntegrationConfig = {
  jellyfin: {
    url: "http://127.0.0.1:8096",
    externalUrl: "http://127.0.0.1:8096",
    apiKey: "fixture-jellyfin-key",
    serverId: "c".repeat(32),
    libraryIds: [],
  },
};
function fresh(config: IntegrationConfig = base): AuthContext {
  storage.closeStorage();
  const dir = mkdtempSync(join(tmpdir(), "velvarr-personal-settings-"));
  created.push(dir);
  process.env.VELVARR_DATA_DIR = dir;
  const grant = storage.bootstrap(config, owner, "fixture-jellyfin-session");
  return {
    config: storage.getConfig()!,
    account: storage.getAccount(owner.id)!,
    token: "fixture-jellyfin-session",
    rawSessionToken: grant.token,
  };
}
after(() => {
  storage.closeStorage();
  if (previousDir === undefined) delete process.env.VELVARR_DATA_DIR;
  else process.env.VELVARR_DATA_DIR = previousDir;
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});
test("personal settings defaults and every invalid presentation boundary are explicit", () => {
  const defaults = defaultPersonalSettings();
  assert.equal(defaults.browseRowLimit, 50);
  assert.deepEqual(defaults.includeTags, []);
  assert.equal(defaults.applyIncludeTags, true);
  assert.equal(defaults.personalizeDiscover, true);
  assert.deepEqual(defaults.appearance, {
    mode: "dark",
    preset: "velvet",
    accent: "#ef3483",
  });
  const parsed = parsePersonalSettings({
    applyIncludeTags: false,
    personalizeDiscover: false,
    browseRowLimit: 10,
    appearance: { mode: "system", preset: "custom", accent: "#ABCDEF" },
  });
  assert.equal(parsed.appearance.accent, "#abcdef");
  assert.equal(parsed.applyIncludeTags, false);
  assert.equal(parsed.personalizeDiscover, false);
  assert.equal(
    parsePersonalSettings({ browseRowLimit: 100 }).browseRowLimit,
    100,
  );
  for (const patch of [
    { browseRowLimit: null },
    { browseRowLimit: 9 },
    { browseRowLimit: 101 },
    { browseRowLimit: 10.5 },
    { browseRowLimit: "50" },
    { applyIncludeTags: "yes" },
    { personalizeDiscover: [] },
    { appearance: null },
    { appearance: [] },
    { appearance: { ...defaults.appearance, mode: "invalid" } },
    { appearance: { ...defaults.appearance, preset: "invalid" } },
    {
      appearance: {
        ...defaults.appearance,
        accent: "red; background:url(example)",
      },
    },
    { appearance: { ...defaults.appearance, accent: "#abc" } },
    { appearance: { ...defaults.appearance, extra: true } },
  ])
    assert.throws(() => parsePersonalSettings(patch));
});
test("a real schema-12 upgrade preserves history and personal settings stay isolated and atomic", () => {
  const ctx = fresh();
  storage.importAccounts([
    {
      ...owner,
      id: "f".repeat(32),
      name: "Fixture other",
      isAdministrator: false,
    },
  ]);
  const hidden = [{ name: "Hidden", tmdb: "44" }];
  storage.saveContentPreferences(owner.id, {
    hiddenTags: hidden,
    discoverOrder: ["genres"],
  });
  const request = storage.createRequest(owner.id, {
    provider: "tpdb",
    kind: "movie",
    id: "00000000-1111-4222-8333-444444444444",
  });
  storage.closeStorage();
  const db = new DatabaseSync(
    join(process.env.VELVARR_DATA_DIR!, "velvarr.sqlite"),
  );
  db.exec(
    "ALTER TABLE accounts DROP COLUMN personal_settings; PRAGMA user_version=12;",
  );
  db.close();
  storage.initializeStorage();
  assert.equal(storage.getRequest(request.id, ctx.account).id, request.id);
  const session = storage.getSession(ctx.rawSessionToken);
  assert.ok(session);
  assert.equal(session.account.id, owner.id);
  assert.deepEqual(storage.getContentPreferences(owner.id).hiddenTags, hidden);
  assert.equal(storage.getContentPreferences(owner.id).browseRowLimit, 50);
  const saved = storage.saveContentPreferences(owner.id, {
    includeTags: [{ name: "Preferred", tmdb: "77" }],
    browseRowLimit: 100,
    appearance: { mode: "light", preset: "ocean", accent: "#5b9eff" },
  });
  storage.saveContentPreferences(owner.id, { discoverOrder: ["studios"] });
  assert.deepEqual(
    storage.getContentPreferences(owner.id).includeTags,
    saved.includeTags,
  );
  assert.deepEqual(
    storage.getContentPreferences(owner.id).appearance,
    saved.appearance,
  );
  assert.equal(
    storage.getContentPreferences("f".repeat(32)).browseRowLimit,
    50,
  );
  const before = storage.getContentPreferences(owner.id);
  for (const patch of [
    { accountId: "f".repeat(32), includeTags: [] },
    { includeTags: [{ name: "Bad", tmdb: "0077" }] },
    { hiddenTags: [], browseRowLimit: 200 },
    { appearance: { ...saved.appearance, accent: "javascript:bad" } },
  ]) {
    assert.throws(
      () => storage.saveContentPreferences(owner.id, patch),
      (error: unknown) =>
        error instanceof AppError && error.code === "invalid_preferences",
    );
    assert.deepEqual(storage.getContentPreferences(owner.id), before);
  }
  storage.closeStorage();
  assert.deepEqual(storage.getContentPreferences(owner.id), before);
});
test("stored HTTP policy overrides the environment, persists, and cannot disable an in-use connection", async () => {
  const previous = process.env.VELVARR_ALLOW_HTTP;
  process.env.VELVARR_ALLOW_HTTP = "1";
  try {
    const ctx = fresh({ ...base, allowHttp: false });
    assert.equal(httpAllowed(), false);
    assert.throws(() => validateBaseUrl("http://media.local:8096"));
    await adminUpdateIntegrations(
      new Request("http://localhost/api/admin/integrations", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ allowHttp: true }),
      }),
      { ...ctx, config: storage.getConfig()! },
    );
    assert.equal(
      validateBaseUrl("http://media.local:8096"),
      "http://media.local:8096",
    );
    for (const host of ["public.example", "fdic.gov", "fc.public.example"])
      assert.throws(() => validateBaseUrl("http://" + host));
    storage.saveConfig({
      ...storage.getConfig()!,
      jellyfin: { ...base.jellyfin, url: "http://media.local:8096" },
    });
    await assert.rejects(
      adminUpdateIntegrations(
        new Request("http://localhost/api/admin/integrations", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ allowHttp: false }),
        }),
        { ...ctx, config: storage.getConfig()! },
      ),
      (error: unknown) =>
        error instanceof AppError && error.code === "http_in_use",
    );
    storage.closeStorage();
    storage.initializeStorage();
    assert.equal(httpAllowed(), true);
    assert.equal(
      process.env.VELVARR_ALLOW_HTTP,
      "1",
      "the UI choice never rewrites the environment",
    );
    setHttpPolicy(undefined);
  } finally {
    storage.closeStorage();
    if (previous === undefined) delete process.env.VELVARR_ALLOW_HTTP;
    else process.env.VELVARR_ALLOW_HTTP = previous;
  }
});
test("an authentication failure on one Whisparr does not hide another instance or leak either key", async () => {
  await withFixture(
    (req, res) => {
      if (pathOf(req.url ?? "").endsWith("system/status"))
        sendJson(res, 200, { appName: "Whisparr", version: "3.fixture" });
      else sendJson(res, 200, []);
    },
    async (healthy) => {
      await withFixture(
        (_req, res) => sendJson(res, 401, {}),
        async (broken) => {
          const config = {
            ...base,
            whisparrInstances: [
              {
                name: "Main",
                url: healthy.origin,
                apiKey: "fixture-healthy-key",
                movieProvider: "tpdb" as const,
                sceneDefault: true,
              },
              {
                name: "Alternate",
                url: broken.origin,
                apiKey: "fixture-broken-key",
                movieProvider: "tmdb" as const,
                sceneDefault: false,
              },
            ],
          };
          const ctx = fresh(config);
          const response = await whisparrConnectionStatuses(ctx);
          assert.equal(response.status, 200);
          const body = await response.json();
          assert.equal(body.instances[0].version, "3.fixture");
          assert.equal(body.instances[1].error.code, "upstream_auth");
          assert.equal(
            JSON.stringify(body).includes("fixture-healthy-key"),
            false,
          );
          assert.equal(
            JSON.stringify(body).includes("fixture-broken-key"),
            false,
          );
        },
      );
    },
  );
});
test("TMDB keywords are native, bounded, and applied alongside adult filtering and dates", async () => {
  const paths: string[] = [];
  const read = async <T>(path: string): Promise<T> => {
    paths.push(path);
    const url = new URL(path, "http://fixture");
    const data = path.startsWith("/3/search/keyword")
      ? { results: [{ id: 44, name: "Wanted" }] }
      : path.startsWith("/3/genre/movie/list")
        ? { genres: [{ id: 18, name: "Drama" }] }
        : path.endsWith("/keywords")
          ? { keywords: [{ id: 44, name: "Wanted" }] }
          : {
              page: 1,
              total_pages: 1,
              total_results: 3,
              results: [
                {
                  id: 1,
                  title: "Included",
                  adult: true,
                  genre_ids: [18],
                  release_date: "2026-01-01",
                },
                {
                  id: 2,
                  title: "Not adult",
                  adult: false,
                  genre_ids: [18],
                  release_date: "2026-01-01",
                },
                {
                  id: 3,
                  title: "Too new",
                  adult: true,
                  genre_ids: [18],
                  release_date: "2026-02-01",
                },
              ],
            };
    if (url.searchParams.has("with_keywords"))
      assert.equal(url.searchParams.get("with_keywords"), "44");
    return data as T;
  };
  assert.deepEqual(await searchTmdbKeywords(read, "Wanted"), [
    { id: "44", name: "Wanted" },
  ]);
  const page = await searchTmdb(read, {
    provider: "tmdb",
    kind: "movie",
    adultOnly: true,
    sort: "popularity",
    includeTags: [{ name: "Wanted", tmdb: "44" }],
    releaseDate: { cutoff: "2026-01-01", operation: "<=" },
    perPage: 10,
  });
  assert.deepEqual(
    page.items.map((item) => item.reference.id),
    ["1"],
  );
  assert.equal(page.totalCountKnown, false);
  assert.ok(paths.some((path) => path.includes("with_keywords=44")));
  const hidden = await searchTmdb(read, {
    provider: "tmdb",
    kind: "movie",
    includeTags: [{ name: "Wanted", tmdb: "44" }],
    excludeTags: [{ name: "Wanted", tmdb: "44" }],
  });
  assert.deepEqual(hidden.items, []);
  await searchTmdb(read, {
    provider: "tmdb",
    kind: "movie",
    sort: "trending",
    adultOnly: false,
  });
  assert.ok(paths.some((path) => path.startsWith("/3/trending/movie/week?")));
});
test("All browse gives TMDB movies an independent saved row limit and preserves a scene-source failure", async () => {
  await withFixture(
    (req, res) => {
      const url = new URL(req.url ?? "/", "http://fixture");
      if (url.pathname === "/3/genre/movie/list")
        sendJson(res, 200, { genres: [] });
      else {
        const page = Number(url.searchParams.get("page"));
        sendJson(res, 200, {
          page,
          total_pages: 3,
          total_results: 60,
          results: Array.from({ length: 20 }, (_, i) => ({
            id: (page - 1) * 20 + i + 1,
            title: "Fixture " + i,
            adult: true,
          })),
        });
      }
    },
    async (fixture) => {
      const previous = process.env.TMDB_BASE_URL;
      process.env.TMDB_BASE_URL = fixture.origin;
      try {
        const ctx = fresh({
          ...base,
          providers: { tmdbReadToken: "fixture-metadata-token" },
        });
        storage.saveContentPreferences(owner.id, { browseRowLimit: 15 });
        resetMetaCache();
        const response = await browseRoute(
          new Request("http://localhost/api/browse?grouped=1&movieSource=tmdb"),
          ctx,
        );
        const body = await response.json();
        assert.equal(response.status, 200);
        assert.equal(body.rowLimit, 15);
        assert.equal(body.groups[0].source, "tmdb");
        assert.equal(body.groups[0].items.length, 15);
        assert.ok(
          body.groups[0].items.every((item: { adult: boolean }) => item.adult),
        );
        assert.equal(body.groups[1].source, "stashdb");
        assert.ok(body.groups[1].error);
        await assert.rejects(
          browseRoute(
            new Request("http://localhost/api/browse?grouped=1&rowLimit=101"),
            ctx,
          ),
        );
      } finally {
        if (previous === undefined) delete process.env.TMDB_BASE_URL;
        else process.env.TMDB_BASE_URL = previous;
        resetMetaCache();
      }
    },
  );
});

test("standard matching disables AI even when a stored cloud credential remains", async () => {
  const settings = {
    judgmentProvider: "none" as const,
    typesafeApiKey: "fixture-key-that-must-not-be-used",
  };
  assert.equal(judgmentConfiguration(settings).configured, false);
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("AI must remain disabled");
  };
  try {
    assert.equal(
      await sameWork({ title: "First" }, { title: "First variant" }, settings),
      false,
    );
    assert.equal(calls, 0);
    const ctx = fresh({ ...base, providers: settings });
    assert.equal(ctx.config.providers?.judgmentProvider, "none");
  } finally {
    globalThis.fetch = original;
  }
});

test("TMDB cast and studio choices use native IDs and title searches verify both constraints", async () => {
  const calls: string[] = [];
  const read = async <T>(path: string): Promise<T> => {
    calls.push(path);
    const url = new URL(path, "http://fixture");
    let value: unknown;
    if (path.startsWith("/3/search/person"))
      value = { results: [{ id: 5, name: "Fixture cast" }] };
    else if (path.startsWith("/3/search/company"))
      value = { results: [{ id: 8, name: "Fixture studio" }] };
    else if (path.startsWith("/3/genre/movie/list")) value = { genres: [] };
    else if (/^\/3\/movie\/[12]\?/.test(path)) {
      const movieId = Number(url.pathname.split("/").pop());
      value = {
        id: movieId,
        credits: {
          cast: [{ id: movieId === 1 ? 5 : 6, name: "Fixture cast" }],
        },
        production_companies: [
          { id: movieId === 1 ? 8 : 9, name: "Fixture studio" },
        ],
      };
    } else
      value = {
        page: 1,
        total_pages: 1,
        total_results: 2,
        results: [
          { id: 1, title: "Matched", adult: true },
          { id: 2, title: "Different cast and studio", adult: true },
        ],
      };
    return value as T;
  };
  assert.deepEqual(await searchTmdbFacets(read, "performer", "Fixture"), [
    { id: "5", name: "Fixture cast" },
  ]);
  assert.deepEqual(await searchTmdbFacets(read, "studio", "Fixture"), [
    { id: "8", name: "Fixture studio" },
  ]);
  const filtered = await searchTmdb(read, {
    provider: "tmdb",
    kind: "movie",
    query: "Fixture",
    cast: "5",
    company: "8",
  });
  assert.deepEqual(
    filtered.items.map((movie) => movie.reference.id),
    ["1"],
  );
  await searchTmdb(read, {
    provider: "tmdb",
    kind: "movie",
    cast: "5",
    company: "8",
  });
  assert.ok(
    calls.some(
      (path) =>
        path.includes("with_cast=5") && path.includes("with_companies=8"),
    ),
  );
  const before = calls.length;
  await assert.rejects(
    searchTmdb(read, { provider: "tmdb", kind: "movie", cast: "0" }),
  );
  assert.equal(
    calls.length,
    before,
    "invalid facet IDs are refused before any provider read",
  );
});
