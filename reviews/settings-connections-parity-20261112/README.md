# Connections and Metadata settings parity — November 12, 2026

- Before: fork main `bd8fd20abf14687a48d826c34ae8a50f8513eef6`, whose application tree matches upstream `adf0191663a34650f806bdf87fc600ce59c85658` (v0.41.0).
- After: feature branch `wee/settings-connections-parity`, commit `61d56c32fbc30ed45b5eca7636b0ae6cacf30edb`.
- Production Next.js build; Node 24.21.0 and Bun 1.3.14.
- Desktop viewport: 1440 × 1200. Mobile viewport: 390 × 844. Captures show full pages; fixed navigation is positioned at the viewport boundary in tall captures.
- All service URLs, users, accounts, and credentials are synthetic. Responses come from an isolated local fixture. These checks establish UI behavior, not live provider connectivity.
- Validation: 731 tests, formatting, types, dependency audit, production build, and 12 browser scenarios passed. Browser checks reported no page errors. [GitHub CI](https://github.com/scottgigawatt/velvarr/actions/runs/43329099323) also passed application and container build/readiness/restart/non-root/read-only-code checks. Image publication was skipped.

## Captures

- [Connections before](connections-before-desktop.jpg)
- [Connections after](connections-after-desktop.jpg)
- [Metadata provider reference](metadata-after-desktop.jpg)
- [Connections on mobile](connections-after-mobile.jpg)
- [Editors on desktop](connections-editors-desktop.jpg)
- [Editors on mobile](connections-editors-mobile.jpg)
- [Successful save followed by a failed connection check](connections-failed-check.jpg)

[Browser scenarios and results](browser-results.json).
