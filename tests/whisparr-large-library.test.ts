// Large-library regressions use synthetic records and loopback fixtures only.
// No operator titles, paths, API keys, or library responses enter these tests.

import assert from "node:assert/strict";
import { test } from "node:test";
import { gzipSync } from "node:zlib";

import { requestJson } from "../src/server/http.ts";
import {
  findWhisparrItemByPath,
  prefetchWhisparrMovieList,
  resolveIdentitiesByPath,
} from "../src/server/whisparr.ts";
import {
  WH_KEY,
  appError,
  pathOf,
  sendJson,
  whisparrConfig,
  withFixture,
} from "./fixture.ts";

const MIB = 1024 * 1024;
const LIMIT_KEY = "VELVARR_WHISPARR_LIBRARY_LIMIT_MIB";
const PATH = "/library/movies/feature-42/movie.mkv";
const identity = (id: number) =>
  `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`;
const REFERENCE = { provider: "tpdb", kind: "movie", id: identity(42) };
const ROWS = Array.from({ length: 2500 }, (_, index) => ({
  id: index + 1,
  itemType: "movie",
  tpdbId: identity(index + 1),
  path: `/library/movies/feature-${index + 1}`,
  // Collection size comes from metadata the path resolver does not need.
  overview: "x".repeat(1024),
}));
const BODY = Buffer.from(JSON.stringify(ROWS));
assert.ok(BODY.byteLength > 2 * MIB && BODY.byteLength < 4 * MIB);

/** Restore the caller's configuration even when a fixture assertion fails. */
async function withLimit(
  value: string | undefined,
  run: () => Promise<void>,
): Promise<void> {
  const previous = process.env[LIMIT_KEY];
  if (value === undefined) delete process.env[LIMIT_KEY];
  else process.env[LIMIT_KEY] = value;
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env[LIMIT_KEY];
    else process.env[LIMIT_KEY] = previous;
  }
}

test("large collections resolve details and list items through one shared fetch", async () => {
  await withLimit(undefined, async () => {
    await withFixture(
      (req, res) => {
        assert.equal(req.method, "GET");
        assert.equal(pathOf(req.url ?? ""), "/api/v3/movie");
        assert.equal(req.headers["x-api-key"], WH_KEY);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(BODY);
      },
      async (fx) => {
        const config = whisparrConfig(fx.origin);
        prefetchWhisparrMovieList(config);
        const [first, second, list] = await Promise.all([
          findWhisparrItemByPath(config, [PATH]),
          findWhisparrItemByPath(config, [PATH]),
          resolveIdentitiesByPath(config, [
            { id: "library-item", paths: [PATH] },
          ]),
        ]);
        assert.deepEqual(first, REFERENCE);
        assert.deepEqual(second, REFERENCE);
        assert.deepEqual(list.get("library-item"), REFERENCE);
        assert.equal(fx.log.length, 1);
      },
    );
  });
});

test("the collection allowance does not relax ordinary Jellyfin or Whisparr JSON", async () => {
  await withLimit("4", async () => {
    await withFixture(
      (_req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(BODY);
      },
      async (fx) => {
        assert.deepEqual(
          await findWhisparrItemByPath(whisparrConfig(fx.origin), [PATH]),
          REFERENCE,
        );
        for (const service of ["jellyfin", "whisparr"] as const) {
          await assert.rejects(
            requestJson(fx.origin, "/ordinary", WH_KEY, { service }),
            appError(502, "upstream_bad_response"),
          );
        }
      },
    );
  });
});

test("the collection cap applies to decoded gzip bytes and rejects excess data", async () => {
  const compressed = gzipSync(BODY);
  assert.ok(compressed.byteLength < 2 * MIB);
  await withLimit("2", async () => {
    await withFixture(
      (_req, res) => {
        res.writeHead(200, {
          "content-type": "application/json",
          "content-encoding": "gzip",
        });
        res.end(compressed);
      },
      async (fx) => {
        await assert.rejects(
          findWhisparrItemByPath(whisparrConfig(fx.origin), [PATH]),
          appError(502, "upstream_bad_response"),
        );
      },
    );
  });
});

test("invalid allowances fail before contacting Whisparr", async () => {
  await withFixture(
    (_req, res) => sendJson(res, 200, []),
    async (fx) => {
      for (const invalid of ["", "0", "1", "257", "2.5", "NaN", "Infinity"]) {
        await withLimit(invalid, async () => {
          await assert.rejects(
            findWhisparrItemByPath(whisparrConfig(fx.origin), [PATH]),
            appError(500, "bad_whisparr_config"),
          );
        });
      }
      assert.equal(fx.log.length, 0);
    },
  );
});

test("a stricter allowance cannot reuse a previously accepted large collection", async () => {
  await withFixture(
    (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(BODY);
    },
    async (fx) => {
      const config = whisparrConfig(fx.origin);
      await withLimit("4", async () => {
        assert.deepEqual(
          await findWhisparrItemByPath(config, [PATH]),
          REFERENCE,
        );
      });
      await withLimit("2", async () => {
        await assert.rejects(
          findWhisparrItemByPath(config, [PATH]),
          appError(502, "upstream_bad_response"),
        );
      });
      assert.equal(fx.log.length, 2);
    },
  );
});

test("changing credentials cannot reuse another key's cached collection", async () => {
  await withLimit(undefined, async () => {
    await withFixture(
      (req, res) => {
        if (req.headers["x-api-key"] !== WH_KEY) return sendJson(res, 401, {});
        sendJson(res, 200, [ROWS[41]]);
      },
      async (fx) => {
        const config = whisparrConfig(fx.origin);
        assert.deepEqual(
          await findWhisparrItemByPath(config, [PATH]),
          REFERENCE,
        );
        await assert.rejects(
          findWhisparrItemByPath(
            {
              ...config,
              whisparr: { url: fx.origin, apiKey: "different-key" },
            },
            [PATH],
          ),
          appError(401, "upstream_auth"),
        );
        assert.equal(fx.log.length, 2);
      },
    );
  });
});

test("an oversized failed fetch is evicted and the next lookup can recover", async () => {
  let requests = 0;
  await withLimit("2", async () => {
    await withFixture(
      (_req, res) => {
        requests += 1;
        if (requests === 1) {
          res.writeHead(200, { "content-type": "application/json" });
          return res.end(BODY);
        }
        sendJson(res, 200, [ROWS[41]]);
      },
      async (fx) => {
        const config = whisparrConfig(fx.origin);
        await assert.rejects(
          findWhisparrItemByPath(config, [PATH]),
          appError(502, "upstream_bad_response"),
        );
        assert.deepEqual(
          await findWhisparrItemByPath(config, [PATH]),
          REFERENCE,
        );
        assert.equal(requests, 2);
      },
    );
  });
});

test("compacting a large collection preserves ambiguous path detection", async () => {
  await withLimit(undefined, async () => {
    await withFixture(
      (_req, res) => {
        sendJson(res, 200, [
          ...ROWS,
          {
            ...ROWS[41],
            tpdbId: identity(99999),
            path: "/library/movies/feature-42",
          },
        ]);
      },
      async (fx) => {
        await assert.rejects(
          findWhisparrItemByPath(whisparrConfig(fx.origin), [PATH]),
          appError(409, "ambiguous_identity"),
        );
      },
    );
  });
});

test("compacted records retain both explicit and legacy scene identities", async () => {
  await withLimit("256", async () => {
    await withFixture(
      (_req, res) =>
        sendJson(res, 200, [
          ...ROWS,
          {
            itemType: "scene",
            stashId: identity(3000),
            path: "/library/scenes/explicit",
          },
          {
            itemType: "scene",
            foreignId: identity(3001),
            tmdbId: 0,
            path: "/library/scenes/legacy",
          },
        ]),
      async (fx) => {
        const config = whisparrConfig(fx.origin);
        for (const [name, id] of [
          ["explicit", 3000],
          ["legacy", 3001],
        ] as const) {
          assert.deepEqual(
            await findWhisparrItemByPath(config, [
              `/library/scenes/${name}/scene.mkv`,
            ]),
            { provider: "stashdb", kind: "scene", id: identity(id) },
          );
        }
        assert.equal(fx.log.length, 1);
      },
    );
  });
});
