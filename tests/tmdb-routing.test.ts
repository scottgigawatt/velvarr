import { createRequestRoute } from "../src/app/api/[...path]/routes/requests.ts";
// Real HTTP and SQLite fixtures exercise provider boundaries and independent delivery destinations.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  Account,
  ExternalUser,
  IntegrationConfig,
  MediaReference,
} from "../src/lib/contracts.ts";
import { isCatalogId } from "../src/lib/contracts.ts";
import {
  mediaFromBody,
  parseCatalogReference,
} from "../src/app/api/[...path]/parse.ts";
import { AppError } from "../src/server/http.ts";
import * as storage from "../src/server/storage.ts";
import {
  searchCatalog,
  getCatalogDetail,
  getProviderStatus,
  resetMetaCache,
} from "../src/server/providers.ts";
import { browseTitles, parseBrowseQuery } from "../src/server/browse.ts";
import { runDueWork } from "../src/server/acquisition.ts";
import {
  findWhisparrItemByPath,
  resolveWhisparrItem,
} from "../src/server/whisparr.ts";
import {
  updateWhisparrConnections,
  routes as adminRoutes,
} from "../src/app/api/[...path]/routes/admin.ts";

process.env.VELVARR_SECRET_KEY = "12".repeat(32);
delete process.env.TMDB_READ_TOKEN;
const dataDir = mkdtempSync(join(tmpdir(), "velvarr-tmdb-routing-"));
process.env.VELVARR_DATA_DIR = dataDir;
const ownerUser: ExternalUser = {
  id: "a".repeat(32),
  name: "Fixture admin",
  isDisabled: false,
  enableRemoteAccess: true,
  enableMediaPlayback: true,
  isAdministrator: true,
};
const requesterUser = {
  ...ownerUser,
  id: "b".repeat(32),
  name: "Fixture requester",
  isAdministrator: false,
};
const uuid = "00000000-1111-4222-8333-444444444444";
const movie: MediaReference = { provider: "tpdb", kind: "movie", id: uuid };
const tmdb: MediaReference = { provider: "tmdb", kind: "movie", id: "123" };
const scene: MediaReference = { provider: "stashdb", kind: "scene", id: uuid };
let owner: Account;
let requester: Account;
const tmdbCalls: { url: URL; authorization: string | undefined }[] = [];
let wrongDetail = false;
let emptyAdult = false;
let tmdbUnavailable = false;
const metadata = createServer((req, res) => {
  const url = new URL(req.url!, "http://localhost");
  tmdbCalls.push({ url, authorization: req.headers.authorization });
  res.setHeader("content-type", "application/json");
  if (tmdbUnavailable) {
    res.statusCode = 503;
    res.end("{}");
    return;
  }
  const json = (body: unknown) => res.end(JSON.stringify(body));
  if (url.pathname === "/3/authentication") {
    json({ success: true });
    return;
  }
  if (url.pathname === "/3/genre/movie/list") {
    json({ genres: [{ id: 18, name: "Drama" }] });
    return;
  }
  if (
    url.pathname === "/3/search/movie" ||
    url.pathname === "/3/discover/movie"
  ) {
    const page = Number(url.searchParams.get("page"));
    json({
      page,
      total_pages: emptyAdult ? 100 : 3,
      total_results: emptyAdult ? 2000 : 60,
      results: Array.from({ length: 20 }, (_, i) => ({
        id: (page - 1) * 20 + i + 1,
        title: `Fixture ${page}-${i}`,
        adult: !emptyAdult && i % 10 === 0,
        genre_ids: [18],
        release_date: "2026-01-01",
        poster_path: "/poster.jpg",
      })),
    });
    return;
  }
  if (/^\/3\/movie\/\d+\/keywords$/.test(url.pathname)) {
    json({ keywords: [] });
    return;
  }
  if (url.pathname === "/3/movie/404") {
    res.statusCode = 404;
    json({});
    return;
  }
  if (url.pathname === "/3/movie/123") {
    json({
      id: wrongDetail ? 124 : 123,
      title: "Fixture movie",
      overview: "Fixture description",
      adult: true,
      runtime: 90,
      release_date: "2026-01-01",
      genres: [{ id: 18, name: "Drama" }],
      credits: { cast: [{ id: 5, name: "Fixture cast" }] },
      external_ids: { imdb_id: "tt123" },
      recommendations: { results: [{ id: 124 }] },
    });
    return;
  }
  res.statusCode = 404;
  json({});
});
await new Promise<void>((r) => metadata.listen(0, "127.0.0.1", r));
process.env.TMDB_BASE_URL = `http://127.0.0.1:${(metadata.address() as AddressInfo).port}`;

type Stored = Record<string, unknown>;
async function whisparrFixture(key: string) {
  const items = new Map<string, Stored>();
  const adds: Stored[] = [];
  let unavailable = false;
  const server = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    const json = (body: unknown) => res.end(JSON.stringify(body));
    if (req.headers["x-api-key"] !== key) {
      res.statusCode = 401;
      json({});
      return;
    }
    if (unavailable) {
      res.statusCode = 503;
      json({});
      return;
    }
    const url = new URL(req.url!, "http://localhost");
    if (url.pathname.endsWith("system/status")) {
      json({ appName: "Whisparr", version: "fixture" });
      return;
    }
    if (url.pathname.endsWith("rootfolder")) {
      json([
        { id: 1, path: "/data/movies" },
        { id: 2, path: "/data/scenes" },
      ]);
      return;
    }
    if (url.pathname.endsWith("qualityprofile")) {
      json([{ id: 1, name: "Fixture quality" }]);
      return;
    }
    if (url.pathname.includes("lookup")) {
      const provider = url.pathname.endsWith("tmdb")
        ? "tmdb"
        : url.pathname.endsWith("tpdb")
          ? "tpdb"
          : "stashdb";
      const id =
        url.searchParams.get("tmdbId") ??
        url.searchParams.get("tpdbId") ??
        url.searchParams.get("term")!.replace("stash:", "");
      json([
        {
          itemType: provider === "stashdb" ? "scene" : "movie",
          foreignId: provider === "tpdb" ? `tpdbId:${id}` : id,
          ...(provider === "tpdb" ? { tpdbId: id } : {}),
          tmdbId: provider === "tmdb" ? Number(id) : 0,
          title: "Whisparr fixture",
        },
      ]);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/v3/movie") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const payload = JSON.parse(body) as Stored;
      adds.push(payload);
      const item = {
        ...payload,
        id: 1,
        itemType:
          String(payload.foreignId).includes("tpdbId:") ||
          Number(payload.tmdbId) > 0
            ? "movie"
            : "scene",
        path: `${payload.rootFolderPath}/fixture`,
        hasFile: false,
      };
      items.set(String(payload.foreignId), item);
      res.statusCode = 201;
      json(item);
      return;
    }
    const itemId = /^\/api\/v3\/movie\/(\d+)$/.exec(url.pathname);
    if (itemId) {
      const item = [...items.values()].find(
        (entry) => entry.id === Number(itemId[1]),
      );
      if (!item) res.statusCode = 404;
      json(item ?? {});
      return;
    }
    if (url.pathname === "/api/v3/movie") {
      const ref = url.searchParams.get("tpdbId")
        ? `tpdbId:${url.searchParams.get("tpdbId")}`
        : (url.searchParams.get("tmdbId") ?? url.searchParams.get("stashId"));
      json(
        ref === null
          ? [...items.values()]
          : items.has(ref)
            ? [items.get(ref)]
            : [],
      );
      return;
    }
    json({ records: [] });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    server,
    items,
    adds,
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    key,
    down: (v: boolean) => {
      unavailable = v;
    },
  };
}
const main = await whisparrFixture("fixture-main-key");
const alternate = await whisparrFixture("fixture-alternate-key");
const config: IntegrationConfig = {
  jellyfin: {
    url: "http://127.0.0.1:8096",
    externalUrl: "http://127.0.0.1:8096",
    apiKey: "fixture-jellyfin-key",
    serverId: "c".repeat(32),
    libraryIds: [],
  },
  whisparr: {
    url: main.url,
    apiKey: main.key,
    delivery: {
      enabled: true,
      rootFolderPath: "/data/movies",
      qualityProfileId: 1,
      searchOnAdd: false,
    },
  },
  providers: { tmdbReadToken: "fixture-tmdb-token" },
};
storage.bootstrap(config, ownerUser, "fixture-jellyfin-session");
owner = storage.getAccount(ownerUser.id)!;
storage.importAccounts([requesterUser]);
requester = storage.updateAccount(requesterUser.id, {
  enabled: true,
  role: "requester",
  libraryIds: [],
});
const legacyId = storage.getConfig()!.whisparr!.instanceId!;
const enabled = (root: string) => ({
  enabled: true,
  rootFolderPath: root,
  qualityProfileId: 1,
  searchOnAdd: false,
});
function modernConfig(): IntegrationConfig {
  return {
    ...storage.getConfig()!,
    whisparrInstances: [
      {
        instanceId: legacyId,
        name: "Main",
        movieProvider: "tpdb",
        sceneDefault: true,
        url: main.url,
        apiKey: main.key,
        delivery: enabled("/data/movies"),
        sceneDelivery: enabled("/data/scenes"),
        pathMappings: [
          {
            whisparrPrefix: "/data/movies",
            jellyfinPrefix: "/library/main-movies",
          },
          {
            whisparrPrefix: "/data/scenes",
            jellyfinPrefix: "/library/main-scenes",
          },
        ],
      },
      {
        name: "Alternate",
        movieProvider: "tmdb",
        sceneDefault: false,
        url: alternate.url,
        apiKey: alternate.key,
        delivery: enabled("/data/movies"),
        sceneDelivery: enabled("/data/scenes"),
        pathMappings: [
          {
            whisparrPrefix: "/data/movies",
            jellyfinPrefix: "/library/alternate-movies",
          },
          {
            whisparrPrefix: "/data/scenes",
            jellyfinPrefix: "/library/alternate-scenes",
          },
        ],
      },
    ],
  };
}
after(async () => {
  storage.closeStorage();
  await Promise.all(
    [metadata, main.server, alternate.server].map(
      (s) => new Promise<void>((r) => s.close(() => r())),
    ),
  );
  rmSync(dataDir, { recursive: true, force: true });
});

test("numeric TMDB IDs are scoped to movies and UUID providers remain strict", () => {
  assert.deepEqual(parseCatalogReference("tmdb", "movie", "123"), tmdb);
  assert.deepEqual(mediaFromBody({ media: tmdb }), tmdb);
  assert.throws(() => mediaFromBody({ media: { ...tmdb, kind: "scene" } }));
  assert.throws(() => mediaFromBody({ media: { ...tmdb, id: "00123" } }));
  for (const bad of ["0", "001", "1.2", "-1", "1e3", "2147483648", uuid])
    assert.equal(isCatalogId("tmdb", bad), false);
  assert.throws(() => parseCatalogReference("tmdb", "scene", "123"));
  assert.throws(() => parseCatalogReference("tpdb", "movie", "123"));
});

test("TMDB uses bearer reads, cached native pages, and full catalog title/year search", async () => {
  assert.equal((await getProviderStatus("tmdb")).configured, true);
  const query = {
    provider: "tmdb" as const,
    kind: "movie" as const,
    query: "Fixture",
    year: 2026,
    perPage: 24,
  };
  const results = await searchCatalog(query);
  assert.equal(results.items.length, 24);
  assert.equal(results.hasMore, true);
  assert.equal(results.total, 60);
  assert.equal(results.items[1]!.adult, false);
  assert.equal(results.items[0]!.tags[0]!.name, "Drama");
  const before = tmdbCalls.length;
  await searchCatalog(query);
  assert.equal(
    tmdbCalls.length,
    before,
    "credential-scoped metadata cache avoids repeated page reads",
  );
  const searches = tmdbCalls.filter(
    (c) => c.url.pathname === "/3/search/movie",
  );
  assert.equal(searches.length, 2);
  for (const c of searches) {
    assert.equal(c.url.searchParams.get("include_adult"), "true");
    assert.equal(c.url.searchParams.get("primary_release_year"), "2026");
    assert.equal(c.authorization, "Bearer fixture-tmdb-token");
  }
  assert.equal(
    tmdbCalls.some((c) => /^\/3\/movie\//.test(c.url.pathname)),
    false,
    "search never hydrates every result",
  );
});

test("adult-only scans across sparse pages without claiming an unfiltered total", async () => {
  const results = await searchCatalog({
    provider: "tmdb",
    kind: "movie",
    query: "Adult fixture",
    adultOnly: true,
    perPage: 3,
    page: 2,
  });
  assert.deepEqual(
    results.items.map((i) => i.reference.id),
    ["31", "41", "51"],
  );
  assert.equal(results.totalCountKnown, false);
  assert.equal(results.total, undefined);
  assert.equal(results.hasMore, false);
  emptyAdult = true;
  await assert.rejects(
    searchCatalog({
      provider: "tmdb",
      kind: "movie",
      query: "Empty adult fixture",
      adultOnly: true,
    }),
    (err: unknown) => err instanceof AppError && err.code === "query_too_broad",
  );
  emptyAdult = false;
});

test("TMDB details validate identity and surface outages; scene calls never leave the app", async () => {
  const result = await getCatalogDetail(tmdb);
  assert.equal(result!.durationSeconds, 5400);
  assert.equal(result!.links[0]!.label, "Fixture cast");
  assert.equal(result!.related[0]!.provider, "tmdb");
  assert.equal(await getCatalogDetail({ ...tmdb, id: "404" }), null);
  wrongDetail = true;
  resetMetaCache();
  await assert.rejects(
    getCatalogDetail(tmdb),
    (err: unknown) =>
      err instanceof AppError && err.code === "upstream_bad_response",
  );
  wrongDetail = false;
  resetMetaCache();
  tmdbUnavailable = true;
  await assert.rejects(getProviderStatus("tmdb"));
  tmdbUnavailable = false;
  const before = tmdbCalls.length;
  await assert.rejects(
    searchCatalog({ provider: "tmdb", kind: "scene" } as never),
  );
  assert.equal(tmdbCalls.length, before);
  const visible = await browseTitles(
    parseBrowseQuery(
      new URLSearchParams("type=movie&movieSource=tmdb&q=Fixture&perPage=3"),
    ),
    [{ name: "Drama" }],
  );
  assert.equal(
    visible.items.length,
    0,
    "personal hidden labels also filter TMDB genres",
  );
});

test("legacy approvals and claims survive a real schema-11 upgrade and keep Main identity", () => {
  const request = storage.createRequest(requester.id, movie);
  storage.decideRequest(owner, request.id, "approved");
  const acquisition = storage.getAcquisitionByReference(movie)!;
  const claimed = storage.claimAcquisition(acquisition.id);
  storage.closeStorage();
  const dbPath = join(dataDir, "velvarr.sqlite");
  const db = new DatabaseSync(dbPath);
  // Remove the new column/index to reconstruct the pre-feature requests shape.
  db.exec(
    "ALTER TABLE accounts DROP COLUMN personal_settings; DROP INDEX requests_target; ALTER TABLE requests DROP COLUMN target_instance_id; PRAGMA user_version = 11;",
  );
  db.close();
  storage.initializeStorage();
  assert.equal(
    storage.getAcquisition(acquisition.id)!.claimToken,
    claimed.claimToken,
  );
  storage.releaseAcquisitionClaim(acquisition.id, claimed.claimToken);
  storage.saveConfig(modernConfig());
  assert.equal(
    storage.getConfig()!.whisparrInstances![0]!.instanceId,
    legacyId,
  );
  assert.equal(
    storage.getRequest(request.id, owner).targetInstanceId,
    legacyId,
  );
  assert.equal(storage.getAcquisitionByReference(movie)!.id, acquisition.id);
});

test("provider routing and staff scene overrides use distinct keys and per-kind roots", async () => {
  const alternateId = storage.getConfig()!.whisparrInstances![1]!.instanceId!;
  const movieRequest = storage.createRequest(requester.id, tmdb);
  assert.equal(
    storage.decideRequest(owner, movieRequest.id, "approved").targetInstanceId,
    alternateId,
  );
  const sceneRequest = storage.createRequest(requester.id, scene);
  assert.throws(
    () =>
      storage.decideRequest(
        { ...requester, autoApprove: true },
        sceneRequest.id,
        "approved",
        alternateId,
      ),
    (err: unknown) => err instanceof AppError && err.code === "invalid_target",
  );
  assert.equal(
    storage.decideRequest(owner, sceneRequest.id, "approved", alternateId)
      .targetInstanceId,
    alternateId,
  );
  const defaultScene = storage.createRequest(owner.id, scene);
  assert.equal(
    storage.decideRequest(owner, defaultScene.id, "approved").targetInstanceId,
    legacyId,
  );
  const summary = await runDueWork(Date.now() + 1);
  assert.equal(summary.delivered, 4);
  assert.deepEqual(main.adds.map((p) => p.rootFolderPath).sort(), [
    "/data/movies",
    "/data/scenes",
  ]);
  assert.deepEqual(alternate.adds.map((p) => p.rootFolderPath).sort(), [
    "/data/movies",
    "/data/scenes",
  ]);
  const payload = alternate.adds.find((p) => p.tmdbId === 123)!;
  assert.equal(payload.foreignId, "123");
  assert.equal(payload.tpdbId, undefined);
  assert.equal(storage.getAcquisitionByReference(tmdb)!.whisparrId, 1);
  assert.equal(storage.getAcquisitionByReference(movie)!.whisparrId, 1);
  assert.deepEqual(
    await findWhisparrItemByPath(storage.getConfig()!, [
      "/library/alternate-movies/fixture/file.mkv",
    ]),
    tmdb,
  );
});

test("the request HTTP route accepts TMDB movies and ignores requester-supplied destinations", async () => {
  const config = storage.getConfig()!;
  const alternateId = config.whisparrInstances![1]!.instanceId!;
  const existing = storage.getAcquisitionByReference(tmdb, alternateId)!.id;
  const response = await createRequestRoute(
    new Request("http://localhost/api/requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ media: tmdb, targetInstanceId: legacyId }),
    }),
    {
      config,
      account: owner,
      token: "fixture-jellyfin-session",
      rawSessionToken: "fixture-session-token",
    },
  );
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.request.media.provider, "tmdb");
  assert.equal(result.request.targetInstanceId, alternateId);
  assert.equal(
    storage.getAcquisitionByReference(tmdb, alternateId)!.id,
    existing,
    "a second requester shares the existing destination's acquisition",
  );
});

test("withdrawing unsent work is scoped to the selected instance", () => {
  const media = { ...scene, id: "22222222-1111-4222-8333-444444444444" };
  const mainRequest = storage.createRequest(owner.id, media);
  const alternateRequest = storage.createRequest(requester.id, media);
  const altId = storage.getConfig()!.whisparrInstances![1]!.instanceId!;
  storage.decideRequest(owner, mainRequest.id, "approved");
  storage.decideRequest(owner, alternateRequest.id, "approved", altId);
  storage.cancelRequest(requester, alternateRequest.id);
  assert.equal(storage.getAcquisitionByReference(media, altId), null);
  assert.ok(storage.getAcquisitionByReference(media, legacyId));
  storage.cancelRequest(owner, mainRequest.id);
  assert.equal(storage.getAcquisitionByReference(media, legacyId), null);
});

test("sent work remains observable on its selected connection with movie delivery disabled", async () => {
  const observedMain = await whisparrFixture("fixture-observation-main");
  const observedAlternate = await whisparrFixture(
    "fixture-observation-alternate",
  );
  const isolatedDir = mkdtempSync(
    join(tmpdir(), "velvarr-disabled-observation-"),
  );
  storage.closeStorage();
  process.env.VELVARR_DATA_DIR = isolatedDir;
  try {
    // Independent endpoints and storage keep this lifecycle test out of the routing fixture's history.
    const isolated = modernConfigForObservation();
    storage.bootstrap(isolated, ownerUser, "fixture-observation-session");
    const admin = storage.getAccount(ownerUser.id)!;
    storage.decideRequest(
      admin,
      storage.createRequest(admin.id, tmdb).id,
      "approved",
    );
    await runDueWork(Date.now() + 1);
    const sent = storage.getAcquisitionByReference(tmdb)!;
    assert.equal(sent.state, "monitoring");
    const item = observedAlternate.items.get(tmdb.id)!;
    item.hasFile = true;
    item.movieFileId = 1;
    item.sizeOnDisk = 1024;
    const disabled = storage.getConfig()!;
    disabled.whisparrInstances![1]!.delivery!.enabled = false;
    storage.saveConfig(disabled);

    await runDueWork(Date.now() + 60_000);
    assert.equal(storage.getAcquisition(sent.id)!.state, "imported");
    assert.equal(
      observedMain.adds.length,
      0,
      "Main must not receive Alternate's work",
    );
    assert.equal(
      observedAlternate.adds.length,
      1,
      "observation must not issue another add",
    );
    storage.closeStorage();
    storage.initializeStorage();
    assert.equal(storage.getAcquisition(sent.id)!.state, "imported");
    assert.equal(storage.listDueAcquisitions(Date.now() + 60_000).length, 0);
  } finally {
    storage.closeStorage();
    process.env.VELVARR_DATA_DIR = dataDir;
    await Promise.all(
      [observedMain.server, observedAlternate.server].map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
    );
    rmSync(isolatedDir, { recursive: true, force: true });
  }

  function modernConfigForObservation(): IntegrationConfig {
    return {
      ...config,
      whisparrInstances: [
        {
          name: "Main",
          movieProvider: "tpdb",
          sceneDefault: true,
          url: observedMain.url,
          apiKey: observedMain.key,
          delivery: enabled("/data/movies"),
          sceneDelivery: enabled("/data/scenes"),
        },
        {
          name: "Alternate",
          movieProvider: "tmdb",
          sceneDefault: false,
          url: observedAlternate.url,
          apiKey: observedAlternate.key,
          delivery: enabled("/data/movies"),
          sceneDelivery: enabled("/data/scenes"),
        },
      ],
    };
  }
});

test("editing routes does not replay approvals; an unavailable Main cannot block Alternate", async () => {
  const before = storage.getRequest(
    storage.listRequests(owner).find((r) => r.media.provider === "tmdb")!.id,
    owner,
  ).targetInstanceId;
  const updated = storage.getConfig()!;
  updated.whisparrInstances![0]!.movieProvider = "tmdb";
  updated.whisparrInstances![1]!.movieProvider = "tpdb";
  storage.saveConfig(updated);
  assert.equal(
    storage.listRequests(owner).find((r) => r.media.provider === "tmdb")!
      .targetInstanceId,
    before,
  );
  const another: MediaReference = {
    ...movie,
    id: "11111111-1111-4222-8333-444444444444",
  };
  storage.decideRequest(
    owner,
    storage.createRequest(requester.id, another).id,
    "approved",
  );
  main.down(true);
  await runDueWork(Date.now() + 1);
  main.down(false);
  assert.equal(
    alternate.adds.some((p) => p.tpdbId === another.id),
    true,
  );
  await assert.rejects(
    resolveWhisparrItem(storage.getConfig()!, { ...tmdb, id: "0123" }),
  );
});

test("connection API keeps secrets private, preserves Ollama settings, validates roots, and retires moved endpoints", async () => {
  const current = storage.getConfig()!;
  current.providers = {
    ...current.providers,
    judgmentProvider: "ollama",
    ollamaUrl: "http://127.0.0.1:11434",
    ollamaModel: "nimble",
  };
  storage.saveConfig(current);
  assert.ok(
    adminRoutes
      .filter((r) => r.segments.includes("connections"))
      .every((r) => r.auth === "admin"),
  );
  const ctx = {
    config: storage.getConfig()!,
    account: owner,
    token: "fixture-jellyfin-session",
    rawSessionToken: "fixture-session-token",
  };
  const connections = ctx.config.whisparrInstances!.map((c) => ({
    ...c,
    apiKey: "",
  }));
  const makeRequest = (value: unknown) =>
    new Request("http://localhost/api/admin/whisparr/connections", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ connections: value }),
    });
  const response = await updateWhisparrConnections(
    ctx,
    makeRequest(connections),
  );
  const output = JSON.stringify(await response.json());
  assert.equal(output.includes(main.key), false);
  assert.equal(output.includes(alternate.key), false);
  assert.equal(storage.getConfig()!.providers!.ollamaModel, "nimble");
  const bad = structuredClone(connections);
  bad[1]!.delivery!.rootFolderPath = "/wrong-root";
  await assert.rejects(
    updateWhisparrConnections(
      { ...ctx, config: storage.getConfig()! },
      makeRequest(bad),
    ),
  );
  const moved = structuredClone(connections);
  moved[1]!.url += "/moved";
  moved[1]!.apiKey = alternate.key;
  moved[1]!.delivery!.enabled = false;
  moved[1]!.sceneDelivery!.enabled = false;
  const oldId = moved[1]!.instanceId;
  await updateWhisparrConnections(
    { ...ctx, config: storage.getConfig()! },
    makeRequest(moved),
  );
  assert.notEqual(
    storage.getConfig()!.whisparrInstances![1]!.instanceId,
    oldId,
  );
  assert.equal(
    storage
      .listDueAcquisitions(Date.now() + 100000)
      .some((a) => a.instanceId === oldId),
    false,
  );
});
