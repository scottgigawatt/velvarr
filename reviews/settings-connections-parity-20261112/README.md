# Connections and Metadata settings parity — November 12, 2026

- Before: fork main `bd8fd20abf14687a48d826c34ae8a50f8513eef6`, whose application tree matches upstream `adf0191663a34650f806bdf87fc600ce59c85658` (v0.41.0).
- After: feature branch `wee/settings-connections-parity`, commit `70e928a3229ac416f1178c8058ce29c3ac2335f4`.
- Production Next.js build; Node 24.21.0 and Bun 1.3.14.
- Desktop viewport: 1440 × 1200. Mobile viewport: 390 × 844. Captures show full pages; fixed navigation is positioned at the viewport boundary in tall captures.
- All service URLs, users, accounts, and credentials are synthetic. Responses come from an isolated local fixture. These checks establish UI behavior, not live provider connectivity.
- Validation: 731 tests, formatting, types, dependency audit, production build, and 16 browser scenarios passed. Browser checks reported no page errors. [GitHub CI](https://github.com/scottgigawatt/velvarr/actions/runs/43333404872) also passed application and container build/readiness/restart/non-root/read-only-code checks. Image publication was skipped.

## Captures

- [Connections before](connections-before-desktop.jpg)
- [Connections after](connections-after-desktop.jpg)
- [Metadata provider reference](metadata-after-desktop.jpg)
- [Connections on mobile](connections-after-mobile.jpg)
- [Editors on desktop](connections-editors-desktop.jpg)
- [Editors on mobile](connections-editors-mobile.jpg)
- [Successful save followed by a failed connection check](connections-failed-check.jpg)

[Browser scenarios and results](browser-results.json).

## Follow-up: picker spacing and upstream feedback

Both Root folder and Quality profile now use the existing settings picker styling: a 14px arrow inset and 40px text padding. The underlying controls remain labeled native selects. Connection save feedback appears immediately after Save/Cancel, before destructive controls.

- [Picker close-up](whisparr-picker-spacing.jpg)
- [Whisparr editor on desktop](whisparr-pickers-desktop.jpg)
- [Whisparr editor on mobile](whisparr-pickers-mobile.jpg)
- [Audit of all 15 findings and follow-up items from upstream PRs #1 and #2](upstream-review-audit.json)

The audit includes the original discussions, review submissions, inline comments, and later confirmations. All listed regressions were checked against this source. No upstream comments or review-thread states were changed.

## Final consistency review

The [refreshed review audit](final-consistency-audit.json) covers source commit
`8b75efd07620714cba0921aab70266ab62d2926b`, all 15 findings/follow-ups from upstream
PRs #1 and #2, shared-code ownership, and the consistency fixes.

[CI passed](https://github.com/scottgigawatt/velvarr/actions/runs/43353367539):
765 unit/API tests, 41 production-build browser cases, and all build/container
checks. Each test suite runs once per CI run. Screenshot capture provenance
above continues to describe the original image captures.

## Upstream PR screenshot pair

- **Before:** [Connections on current upstream main](connections-before-desktop.jpg),
  source `adf0191663a34650f806bdf87fc600ce59c85658` (captured from the identical
  application tree on fork main `bd8fd20`).
- **After:** [Connections with this change](upstream-after-desktop.jpg), captured
  freshly from the reviewed production build at `8b75efd`. Its source tree is
  identical to clean upstream head `82ccacb8bca64c4761c0cafc2f7a062d88ab0ce3`
  and merged fork main `52c4c12`.

Both are full-page desktop captures at a 1440 × 1200 viewport using synthetic
services and credentials. [Machine-readable provenance](upstream-screenshots.json).
These images stay on the consolidated asset branch and are not in the source PR.
