# Testing

Use Node 24.21 or later and the pinned Bun version from `package.json`.

## Standard checks

```sh
bun install --frozen-lockfile
bun run format:check
bun run check
bun run test
bun run build
```

`bun run test` runs every `tests/*.test.ts` unit/API test once, including both
settings tabs. `bun run test:ui` runs every `tests/ui/*.spec.mjs` browser test
once. CI runs these two suites; there is no separate connection-only test or
coverage rerun. The suites check different layers: application logic and API
behavior versus interactions with the rendered UI.

## Settings browser regressions

The same Playwright suite covers **Connections** and **Metadata providers**.
`tests/ui/connections.spec.mjs` covers connections and cross-tab behavior;
`tests/ui/metadata-providers.spec.mjs` covers the credential and AI editors. Both
reuse the same isolated fixture and test harness, and both run in the existing
CI gate.

Build the production application before running these tests:

```sh
bunx playwright install chromium
bun run build
bun run test:ui
```

On Linux, use `bunx playwright install --with-deps chromium` to install the
browser's system dependencies as well. CI runs these browser tests after the
production build, before container validation.

The test server uses temporary storage, generated secrets, and synthetic service
responses. It serves the actual production UI on loopback ports 16740 and 16741,
cleans up its temporary data on shutdown, and never edits the operator's
configuration. Run tests serially because the fixture state is shared.

To use an installed Chrome locally instead of downloading Chromium, set
`PLAYWRIGHT_CHANNEL=chrome` when running `bun run test:ui`. Failed runs leave a
screenshot and trace in the ignored `test-results/` directory.

## Test files and their scope

| File | Scope | Purpose |
| --- | --- | --- |
| `tests/ui/connections.spec.mjs` | Connections and cross-tab behavior | 21 browser cases for Jellyfin/Whisparr editors, dropdown spacing, and shared settings behavior |
| `tests/ui/metadata-providers.spec.mjs` | Metadata providers and cross-tab parity | 17 browser cases for TPDB, StashDB, TypeSafe, Ollama, and matching card/status/action layout across both tabs |
| `tests/ui/settings-fixture.mjs` | Shared by both tabs | Starts the real production UI with isolated synthetic service responses; not a test suite |
| `tests/ui/settings-harness.mjs` | Shared by both tabs | Resets state, supplies browser helpers, and checks page errors; not a test suite |
| `tests/connection-settings.test.ts` | Connections | Unit tests for connection drafts, patches, and validation |
| `tests/api.test.ts` | Both tabs and other application APIs | Server authorization, validation, persistence, and preservation of unrelated settings |
| `tests/provider-settings.test.ts`, `tests/provider-card.test.ts` | Metadata providers and shared settings operations | Provider credential behavior, status handling, and the save/probe queue used by both tabs |
| `tests/judgment-editor.test.ts`, `tests/ollama.test.ts`, `tests/integrations.test.ts` | Metadata providers and integrations | AI editor behavior, Ollama, upstream error classification, and integration requests |

The connection-only unit file is intentionally narrower than the browser suite.
Metadata provider logic is covered by the existing provider and AI unit files;
it does not need a duplicate unit file to match the Connections filename.

## Coverage map for both settings tabs

| Covered behavior | Automated regression coverage |
| --- | --- |
| Independent Jellyfin and Whisparr drafts, blank-key preservation, normalization, and validation | `tests/connection-settings.test.ts`; settings browser suite |
| Whisparr-only saves, preservation of Jellyfin/provider settings, failed validation, and removal | `tests/api.test.ts`; settings browser suite |
| Session, administrator, origin, and malformed-field guards on connection-only requests | `tests/api.test.ts` |
| Shared headings, button/status placement, unique IDs, live regions, sibling forms, and focus entry/return | `tests/ui/connections.spec.mjs`, `tests/ui/metadata-providers.spec.mjs` |
| Save failures retain drafts; feedback stays beside Save/Cancel; successful saves remain distinct from failed probes | `tests/ui/connections.spec.mjs`, `tests/ui/metadata-providers.spec.mjs` |
| Status cards remain mounted during loading, failure, retry, and saves | `tests/ui/connections.spec.mjs`, `tests/ui/metadata-providers.spec.mjs` |
| Settings-wide save/probe ordering across tabs and recovery after failure | `tests/provider-settings.test.ts`; settings browser suite |
| Existing provider error classification, AI normalization, and saved probe results survive the shared-component refactor | `tests/integrations.test.ts`, `tests/judgment-editor.test.ts`, `tests/provider-card.test.ts`; settings browser suite |
| First-time/manual Whisparr delivery settings, stale saved choices, path-mapping limits, and removal confirmation | Pure/API regressions; `tests/ui/connections.spec.mjs` |
| Both picker arrows retain their inset and text padding; editors fit mobile widths | `tests/ui/connections.spec.mjs`, `tests/ui/metadata-providers.spec.mjs` |
| TPDB and StashDB independent saves, blank-key behavior, peer drafts, failed saves/probes, and credential source | `tests/provider-card.test.ts`, `tests/provider-settings.test.ts`; `tests/ui/metadata-providers.spec.mjs` |
| Credential-clear confirmations and environment fallback for TPDB, StashDB, and TypeSafe | Provider/API regressions; `tests/ui/metadata-providers.spec.mjs` |
| Standard/no-AI selection, TypeSafe key preservation, Ollama validation, and confirmed AI environment reset | `tests/judgment-editor.test.ts`, `tests/ollama.test.ts`; `tests/ui/metadata-providers.spec.mjs` |
| Metadata loading/retry, pending checks, permission messages, focus, headings, forms, and mobile layout | `tests/ui/metadata-providers.spec.mjs` |

The browser fixture checks user interactions and request boundaries. It does not
substitute for server-side authorization/persistence tests or live Jellyfin,
Whisparr, and metadata-provider connectivity checks.
