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
