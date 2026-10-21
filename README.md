<p align="center">
  <img alt="Velvarr banner" src=".github/assets/banner.jpg" width="100%"/>
</p>

<h1 align="center">Velvarr – The discovery and request app for adult media</h1>

<p align="center">
  <a href="https://github.com/Skare69/velvarr/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/skare69/velvarr/actions/workflows/ci.yml/badge.svg"/></a>
  <a href="https://bun.sh"><img alt="Package manager: Bun" src="https://img.shields.io/badge/package%20manager-Bun-000000?logo=bun&logoColor=white"/></a>
  <a href="https://nodejs.org"><img alt="Runtime: Node.js 24" src="https://img.shields.io/badge/runtime-Node.js%2024-339933?logo=node.js&logoColor=white"/></a>
  <a href="https://nextjs.org"><img alt="Next.js version" src="https://img.shields.io/github/package-json/dependency-version/Skare69/velvarr/next?label=Next.js&logo=nextdotjs&logoColor=white&color=000000"/></a>
  <a href="https://react.dev"><img alt="React version" src="https://img.shields.io/github/package-json/dependency-version/Skare69/velvarr/react?label=React&logo=react&logoColor=white&color=61dafb"/></a>
  <a href="https://www.typescriptlang.org"><img alt="TypeScript version" src="https://img.shields.io/github/package-json/dependency-version/Skare69/velvarr/dev/typescript?label=TypeScript&logo=typescript&logoColor=white&color=3178c6"/></a>
  <a href="https://github.com/Skare69/velvarr/commits/main"><img alt="Last commit" src="https://img.shields.io/github/last-commit/Skare69/velvarr?logo=github"/></a>
</p>

---

**Velvarr** is a free and open source discovery and request app for adult media. Browse movies, scenes, performers, and studios from [TPDB](https://theporndb.net) and [StashDB](https://stashdb.org), request them into **[Whisparr](https://whisparr.com)** (Eros) with administrator approval, and watch in **[Jellyfin](https://jellyfin.org)** through a credential-free link.

## Features

- **Provider-backed catalogs** — movies (TPDB), scenes (TPDB + StashDB), performers (with the biography facts the provider publishes), and studios, each with the filters and sort orders that provider actually supports
- **One Browse surface** — TPDB movies and StashDB scenes in a single grid with title search, tag include/exclude (an included picked tag matches exactly and a typed include term keeps titles with any tag containing it; an exclusion, picked or typed, also drops tags that contain it as a word — Anal drops Anal Creampie, never Analingus), studio, performer, year, and date filters; every constraint rides in the URL
- **Global search** across both providers, plus unified **Studios** and **Genres** rails; results are never merged across providers and cross-provider identity comes only from links the providers publish — never name matching
- **Durable requests** with administrator or moderator approval and an optional per-account auto-approve grant; the Requests list filters by media type and status and sorts by most recent or last modified
- **Crash-safe acquisition worker** — every attempt is persisted before any network call and reconciled by exact identity after a restart; never a lost or duplicated add. A permanently unresolvable identity, or one Whisparr no longer holds, is terminal: the worker stops re-checking it and the request reads "will not be retried".
- **Per-user Jellyfin availability** and credential-free watch links
- **Performer follows** — follow a performer once to track them on both providers (Following view, a Discover rail); when the providers never linked two entries, Merge pairs the current entry with an already-followed entry on the other provider and follows the current one if needed. Failed merges leave follows unchanged.
- **Personal preferences** — per-account hidden tags (matched like exclusions) and Discover shelf ordering
- **Similar titles** on movies and scenes (shared published tags) and **Often appears with** on performers (co-appearance)
- **Update notice** — the sidebar shows a chip linking to a newer GitHub release; the server asks api.github.com at most once an hour (`VELVARR_UPDATE_CHECK=0` disables it)
- **Optional Discord notifier** posting to a private webhook, identity-only by default
- **Optional AI-assisted matching** via [TypeSafe](https://typesafe.ai) or a local [Ollama decision model](https://docs.ollama.com/capabilities/decision) — a near-miss Jellyfin title is flagged "ambiguous — administrator review", never auto-`available`; without either backend, matching is exact

## Getting started

**Docker** (recommended):

Before the first start, create `.env.local` next to `compose.yaml` with the operator secrets (what they do: [Configuration](#configuration)). Without it the container starts, but no owner account can be created because the setup gate has no secrets to check:

```sh
printf 'VELVARR_SECRET_KEY=%s\nVELVARR_SETUP_SECRET=%s\n' \
  "$(openssl rand -hex 32)" "$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')" > .env.local
```

In a source checkout, `bun run setup` writes the same file instead and never overwrites an existing one. **Back up `VELVARR_SECRET_KEY`**: losing it makes the stored database and every backup unreadable.

```sh
docker compose up -d   # pulls ghcr.io/skare69/velvarr
```

To upgrade, bump the image tag in `compose.yaml`, then `docker compose pull && docker compose up -d`.

Container images are published after CI checks pass. Stable releases provide exact tags such as `v0.37.0` and `0.37.0`, a minor alias such as `0.37`, and `latest`. Releases from version 1 onward also provide a major alias such as `1`. For development builds, use `ghcr.io/skare69/velvarr:edge`, which follows `main`. Prereleases provide exact version tags without updating stable aliases. Every published build also has a `sha-<commit>` tag.

The container health check reads `/api/status`. The container becomes `unhealthy` when Velvarr cannot open its data directory (`/data`); run `docker compose logs velvarr` to see the cause. A new instance that waits for owner setup stays healthy.

**From source** (Node 24.21+, Bun 1.3.14+):

```sh
bun install
bun run setup   # writes .env.local with fresh secrets; never overwrites existing credentials
bun run dev     # http://127.0.0.1:6699
```

## Configuration

`bun run setup` generates the required secrets. **Back up `VELVARR_SECRET_KEY`**: losing it makes the stored database and every backup unreadable.

| Variable                     | Required         | Meaning                                                                             |
| ---------------------------- | ---------------- | ----------------------------------------------------------------------------------- |
| `VELVARR_SECRET_KEY`         | yes              | 64 hex chars; decrypts credentials stored in the database. Restores need the key from backup time. |
| `VELVARR_SETUP_SECRET`       | until bootstrap  | ≥ 32 characters; gates the one-time owner setup.                                     |
| `VELVARR_ORIGIN`             | no               | Pin the public origin (e.g. behind a reverse proxy); mutations from other origins are refused, and an `https:` pin marks the session cookie `Secure` even when the proxy does not send `X-Forwarded-Proto`. Unpinned, `Secure` needs `X-Forwarded-Proto: https` (set it if your proxy terminates TLS) or a direct https request URL. Mutations are always gated on browser fetch metadata (`Sec-Fetch-Site: same-origin`) and a JSON content type, on top of the `HttpOnly` + `SameSite=Strict` session cookie. |
| `VELVARR_DATA_DIR`           | no               | Data directory; default `./data`, `/data` in the container.                          |
| `VELVARR_ALLOW_HTTP`         | no               | `1` allows plain HTTP for private/Docker-network addresses on the LAN.               |
| `VELVARR_DISCORD_WEBHOOK_URL`| no               | Private Discord webhook for notifications; https only.                               |
| `VELVARR_DISCORD_DETAIL`     | no               | `1` includes titles in notifications; off by default, messages stay identity-only.   |
| `TMDB_READ_TOKEN` | no | Optional TMDB API read access token for movie metadata; a stored token takes precedence. |
| `TYPESAFE_API_KEY`           | no               | TypeSafe key for AI-assisted matching when TypeSafe is selected; a stored key takes precedence. Tag suggestions send member search terms, so they run only with a key saved in Settings. |
| `VELVARR_JUDGMENT_PROVIDER` | no | `typesafe` (default), `ollama`, or `none`; stored AI-assisted matching settings take precedence. An environment-only choice keeps title review and related-title ranking, but tag suggestions start only after the choice is saved in Settings. |
| `OLLAMA_BASE_URL` | no | Ollama API root; default `http://localhost:11434`. |
| `OLLAMA_MODEL` | no | Downloaded decision model; default `nimble`. |
| `VELVARR_UPDATE_CHECK`       | no               | `0` disables the release check. By default the server asks GitHub (`api.github.com`) for the latest release at most once an hour — ten minutes after a failure — to show the update chip. |
| `VELVARR_WHISPARR_LIBRARY_LIMIT_MIB` | no | Maximum decoded Whisparr library-list response in MiB; default `64`, whole numbers `2` through `256`. Ordinary JSON responses retain their 2 MiB limit. |

## Local AI-assisted matching with Ollama

Use Ollama 0.35 or later with a decision model such as `nimble` or `tev1`. Ordinary chat models do not support the required `/v1/systemone` endpoint. Download the model on the machine running Ollama:

```sh
ollama pull nimble
```

In **Settings → Metadata providers → AI-assisted matching**, select **Ollama (local)**, enter its URL and the downloaded model name shown by `ollama list`, save, and use **Test saved connection**. No API key is required. Selecting Ollama never falls back to the paid TypeSafe service. Connection failures retain ordinary matching and the existing tag-based related-title order.

For Velvarr running natively on the same machine, use `http://localhost:11434`. For Velvarr in Docker Desktop on a Mac with Ollama running natively, use `http://host.docker.internal:11434` and enable **Allow private HTTP** under **Settings → Connections**. `localhost` inside a container refers to that container. For a different host, use Ollama's reachable private address and follow its [network configuration guidance](https://docs.ollama.com/faq#how-do-i-configure-ollama-server).

Alternatively, set `VELVARR_JUDGMENT_PROVIDER=ollama`, `OLLAMA_BASE_URL`, and `OLLAMA_MODEL` in the runtime environment. **Use environment settings** clears the stored selection, URL, and model. Existing TypeSafe deployments retain their behavior until Ollama is explicitly selected.

The existing matching rules remain unchanged: AI can flag a possible title match for administrator review, never mark it available or grant playback. Local tag suggestions use bounded batches because decision models limit the number of choices; large tag lists can require multiple inference calls. Related-title ranking only reorders existing candidates. Models have different accuracy and latency, so test representative naming variants and mismatches before choosing one.

## Personal browsing and appearance

**Preferences** is available in the main navigation and your profile menu. Save **Preferred tags** to apply them every time you browse; titles must match every included tag from their provider, while hidden tags take priority. Picked tags filter only results from their own provider; same-named tags from other providers stay independent. Explicit free-text filters match tag names across providers. You can pause preferred tags for one All browse or turn them off in Preferences. **Use my tag preferences** controls personalization of catalog shelves on Discover. Each account keeps its own tags, shelf order, row limit, and appearance.

Discover separates new TPDB movies, new StashDB scenes, and new TMDB movies. StashDB supplies its own scene trends. TMDB's **Recent popular** shelf uses `/discover/movie`, broad published adult keywords, US release dates within the last 30 days, and TMDB's popularity order. It does not use TMDB's mainstream trending endpoint or require the adult classification flag. Your TMDB include/exclude preferences narrow this default keyword scope. Without personal include tags, the broad adult-keyword scope still applies. Keyword IDs are resolved from TMDB rather than guessed; a failed lookup never substitutes an unfiltered movie list. Browse offers 30-, 90-, and 365-day release windows. This is recent-release popularity, not a US-specific or monthly trending score. TPDB has no supported trending signal and is labeled as new releases. Shelf links preserve their provider and criteria. Previews remain bounded to three listing pages, retain matches found, and offer a wider release window when coverage is limited.

**Appearance** offers dark, light, and system modes, five palettes, and a custom accent. Changes apply immediately and persist with your account.

Connection settings contain one Jellyfin area and one Whisparr area, with a separate status and edit form for every instance. Metadata providers have independent credential rows and checks. **AI-assisted matching** contains only the selected provider's configuration; choose **Standard matching (no AI)** to disable optional model calls.

**Allow private HTTP** in Connections saves an administrator policy without editing the container environment. It permits trusted private addresses, local names, and Docker hosts; public addresses still require HTTPS. An explicit saved choice overrides the deployment fallback. Change any saved non-loopback HTTP connection to HTTPS before disabling it, so the switch cannot cut off the Jellyfin sign-in path. Before first-time setup, `VELVARR_ALLOW_HTTP=1` remains available as a deployment fallback.

This feature advances the fork database to schema 15 (upstream discovery caching and terminal acquisition failures are added after the fork's existing migrations). Back up the data directory and retain its secret key before upgrading; older images cannot open the upgraded database.

## TMDB movies and multiple Whisparr connections

TMDB is an optional movie source. Scenes still use StashDB. Add an **API read access token** from [TMDB account settings](https://www.themoviedb.org/settings/api) under **Settings → Metadata providers**, or set `TMDB_READ_TOKEN`. TMDB requires attribution and compliance with its [API terms](https://developer.themoviedb.org/docs/faq). The app's **Credits** dialog includes its official logo and required notice.

In **Browse**, choose the movie catalog on the main page: **TPDB** or **TMDB**. **All** shows separate movie and scene rows with independent limits; **Movies** and **Scenes** open their full result grids. The default is 50 results per row, adjustable from 10 to 100 in **Preferences**. Scenes use StashDB regardless of the movie catalog.

TMDB includes its full movie catalog, including adult titles. Use include, exclude, and saved personal tags to choose your content; TMDB's adult classification never removes a title. TMDB supports title, year, release-date, keyword, cast, production-company, popularity, and recent-popular discovery. Include and exclude tags use TMDB keywords and genre labels; keyword filters hydrate bounded, cached provider pages when needed. Sparse filtered searches can ask you to narrow the query rather than claiming the catalog is empty. TMDB casts and production companies are movie filters; its cast links remain source-linked rather than adding a third performer catalog. Provider identities stay separate, and TMDB cast entries link to the source.

Use **Settings → Connections → Whisparr → Edit instance** to assign a movie provider and separate movie/scene roots and quality profiles to each instance. For a two-instance layout:

| Connection | Movie provider | Movie root inside Whisparr | Scene root inside Whisparr | Default for scenes |
| --- | --- | --- | --- | --- |
| Main | TPDB | `/data/movies` | `/data/scenes` | Yes |
| Alternate | TMDB | `/data/movies` | `/data/scenes` | No |

The two containers can use identical internal paths while mounting different host directories. Configure **path mappings separately on each connection**, using the paths Jellyfin actually reports, such as Main `/data/movies` → `/library/main-movies` and Alternate `/data/movies` → `/library/alternate-movies`. Map scenes separately too. Velvarr does not manage Whisparr's import or recycle directories.

Movies route by metadata source. Scene requests use the default instance; staff can choose another scene destination while approving a pending request. Approval pins the destination. Changing assignments later affects new approvals; moving or removing a connection retains its history and does not replay its old work against a different endpoint. API keys stay encrypted and never appear in settings responses. **Check connection** verifies the saved instance and supplies its root folders and named quality profiles; enabled delivery requires those values to exist on that instance.

Existing single-instance configurations remain usable. When adopting the connection list, Main retains its existing connection identity, credentials, roots, path mappings, and approved work. Review its scene root before enabling scene delivery, since the original single-instance settings used one root for both kinds. Back up the data directory and keep its secret key before upgrading; the schema migration preserves history, claims, and observations, but an older image cannot open the new schema.

## Large Whisparr libraries

Opening a Jellyfin library item resolves its identity against Whisparr's complete `/api/v3/movie` collection. Library details and list enrichment share the same 30-second cache, which retains only path and identity fields. This collection has a 64 MiB decoded-response allowance by default; other JSON endpoints retain the 2 MiB guard.

If the collection still exceeds the allowance, measure its decoded size and set `VELVARR_WHISPARR_LIBRARY_LIMIT_MIB` above that measurement, with headroom, up to 256 MiB. This is a response-size ceiling, not a container memory limit; parsing large JSON also consumes memory. Authentication checks, redirect restrictions, and the existing request timeout remain in place.

Pass the setting into the container's runtime environment and recreate the container after changing it. Compose `.env` files only supply interpolation values unless the chart also forwards the variable under `environment` or uses `env_file`. For the upstream chart's `.env.local`, add the setting there. No library titles, paths, API keys, or complete JSON responses are needed to diagnose the size limit.

Each failed sign-in writes one warning line to the server log: `[auth] failed sign-in attempt: account="<name>" ip="<address>"`. The password is never logged. The address is the first `X-Forwarded-For` entry, or `unknown` when no proxy sends the header. A client can set this header, so trust the address only when your proxy replaces `X-Forwarded-For` instead of appending to it.

## Phone access

Velvarr is an installable app: served over HTTPS, the browser's menu offers **Add to home screen** and Velvarr opens in its own window, with build assets cached by a service worker so reloads are fast (live data and `/api` are never cached). The install prompt needs a secure origin; the low-effort answer is [Tailscale](https://tailscale.com):

1. Enable MagicDNS and HTTPS certificates in the Tailscale admin console.
2. On the machine running Velvarr: `tailscale serve --bg 6699`.
3. Open `https://<machine>.<tailnet>.ts.net` on the phone and use **Add to home screen**.

`tailscale serve` terminates TLS with certificates the household's browsers already trust and sets `X-Forwarded-Proto: https`, which marks the session cookie `Secure`. Optionally pin `VELVARR_ORIGIN=https://<machine>.<tailnet>.ts.net` to make that origin the only one allowed to mutate, independent of proxy headers. If `VELVARR_ORIGIN` is already pinned to another address (for example your LAN origin), sign-in from the phone fails with `origin_mismatch`. Change the pin to the ts.net address, or remove the variable. Only one origin can be pinned, so LAN access and Tailscale access are mutually exclusive while a pin is set. On plain HTTP on a non-loopback address the worker does not register; everything else works. Loopback HTTP (`127.0.0.1`, `localhost`) is a secure context, so a production build registers there too. Development builds never register the worker: Turbopack keeps dev chunk URLs stable while their content changes, so a cache-first worker would pin the first dev build.

## Local AI-assisted matching with Ollama

Use Ollama 0.35 or later with a decision model such as `nimble` or `tev1`. Ordinary chat models do not support the required `/v1/systemone` endpoint. Download the model on the machine running Ollama:

```sh
ollama pull nimble
```

In **Settings → Metadata providers → AI-assisted matching**, select **Ollama (local)**, enter its URL and the downloaded model name shown by `ollama list`, save, and use **Test saved connection**. No API key is required. Selecting Ollama never falls back to the paid TypeSafe service. Connection failures retain ordinary matching and the existing tag-based related-title order.

For Velvarr running natively on the same machine, use `http://localhost:11434`. For Velvarr in Docker Desktop on a Mac with Ollama running natively, use `http://host.docker.internal:11434` and set `VELVARR_ALLOW_HTTP=1` in Velvarr's runtime environment. `localhost` inside a container refers to that container. For a different host, use Ollama's reachable private address and follow its [network configuration guidance](https://docs.ollama.com/faq#how-do-i-configure-ollama-server).

Alternatively, set `VELVARR_JUDGMENT_PROVIDER=ollama`, `OLLAMA_BASE_URL`, and `OLLAMA_MODEL` in the runtime environment. **Use environment settings** clears the stored selection, URL, and model. Environment-only Ollama serves title review and related-title ranking; tag suggestions send member search terms, so they start only after the Ollama choice is saved in Settings. Existing TypeSafe deployments retain their behavior until Ollama is explicitly selected.

The existing matching rules remain unchanged: AI can flag a possible title match for administrator review, never mark it available or grant playback. Local tag suggestions use bounded batches because decision models limit the number of choices; large tag lists can require multiple inference calls. Related-title ranking only reorders existing candidates. Models have different accuracy and latency, so test representative naming variants and mismatches before choosing one.

## Backup and recovery

```sh
bun run backup /backups/velvarr.sqlite   # consistent online snapshot; refuses to overwrite
```

To restore: start from a **fresh** data directory, copy the snapshot in as `velvarr.sqlite`, and start with the **same `VELVARR_SECRET_KEY`** as when the backup was taken. The key is never stored in the backup.

## Repository layout

| Branch / remote         | Contents                                                        |
| ----------------------- | --------------------------------------------------------------- |
| `main`                  | Clean standalone product; no inherited Seerr application         |
| `legacy/seerr-whisparr` | Seerr integration snapshot; reference only                       |
| `upstream`              | [seerr-team/seerr](https://github.com/seerr-team/seerr); not a merge source |

## License

Licensed under the [MIT License](LICENSE).
