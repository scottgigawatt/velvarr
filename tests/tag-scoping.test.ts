// Provider-tag regression tests: identical labels and native IDs must not
// turn one provider's saved preference into a filter on another provider.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  tagAppliesToProvider,
  tagSelectionKey,
  type CatalogDetail,
  type CatalogProvider,
} from "../src/lib/contracts.ts";
import { tagMatches, isHiddenTitle } from "../src/server/catalog-visibility.ts";
import { scopeBrowseTags, countActiveFilters } from "../src/lib/browse-url.ts";
import { scopeTagSelections } from "../src/lib/contracts.ts";
import { parseTagSelections } from "../src/server/storage.ts";

const providers: CatalogProvider[] = ["tmdb", "tpdb", "stashdb"];
for (const selectedProvider of providers) {
  for (const resultProvider of providers) {
    test(`${selectedProvider} tags affect only ${selectedProvider}, not ${resultProvider}`, () => {
      const selection = { name: "Same label", [selectedProvider]: "44" };
      const detail: CatalogDetail = {
        reference: {
          provider: resultProvider,
          kind: resultProvider === "stashdb" ? "scene" : "movie",
          id: "1",
        },
        title: "Fixture",
        tags: [{ id: "44", name: "Same label" }],
        credits: [],
        related: [],
        links: [],
        aliases: [],
      };
      const ownProvider = selectedProvider === resultProvider;
      assert.equal(
        tagAppliesToProvider(selection, resultProvider),
        ownProvider,
      );
      for (const mode of ["exact", "family", "substring"] as const) {
        assert.equal(tagMatches(detail, selection, mode), ownProvider);
      }
      assert.equal(isHiddenTitle(detail, [selection]), ownProvider);
      assert.equal(tagMatches(detail, { name: "Same label" }, "exact"), true);
    });
  }
}

test("same-named picked tags stay separate from other providers and free text", () => {
  const uuid = "00000000-0000-4000-8000-000000000001";
  const selections = [
    { name: "Same", tmdb: "44" },
    { name: "Same", tpdb: uuid },
    { name: "Same", stashdb: uuid },
    { name: "Same" },
  ];
  assert.equal(new Set(selections.map(tagSelectionKey)).size, 4);
  const parsed = parseTagSelections([
    ...selections,
    { name: "SAME", tmdb: "44" },
  ]);
  assert.equal(parsed.length, 4);
  assert.deepEqual(
    parsed.map(tagSelectionKey),
    selections.map(tagSelectionKey),
  );
});

test("a TMDB trending link and stale mixed-provider URL show only the active TMDB tag", () => {
  const tags = [
    { name: "gay pornography", tmdb: "44" },
    { name: "Gay", tpdb: "00000000-0000-4000-8000-000000000033" },
    { name: "Gay", stashdb: "00000000-0000-4000-8000-000000000044" },
  ];
  assert.deepEqual(scopeBrowseTags(tags, "movie", "tmdb"), [tags[0]]);
  assert.deepEqual(scopeBrowseTags(tags, "movie", "tpdb"), [tags[1]]);
  assert.deepEqual(scopeBrowseTags(tags, "scene", "tmdb"), [tags[2]]);
  assert.deepEqual(scopeBrowseTags(tags, "all", "tmdb"), [tags[0], tags[2]]);
  assert.equal(
    countActiveFilters({
      include: scopeBrowseTags(tags, "movie", "tmdb"),
      sort: "trending",
      movieSource: "tmdb",
    }),
    3,
  );
  assert.equal(tags.length, 3, "saved preferences must remain intact");
  assert.deepEqual(
    scopeTagSelections(
      [
        {
          name: "Explicit pair",
          tmdb: "44",
          tpdb: "00000000-0000-4000-8000-000000000033",
        },
      ],
      ["tmdb"],
    ),
    [{ name: "Explicit pair", tmdb: "44" }],
  );
});
