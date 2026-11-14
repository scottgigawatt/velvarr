# Velvarr review assets

One permanent, asset-only branch for screenshots and review provenance. Do not merge this branch into application branches.

## Reviews

- [Settings parity after upstream sync, November 14](reviews/settings-connections-parity-20261114/README.md).

- [Settings parity after upstream sync, November 13](reviews/settings-connections-parity-20261113/README.md).

- [Connections and Metadata parity, November 12](reviews/settings-connections-parity-20261112/README.md).

- [Settings connections](reviews/settings-connections/): earlier Connections layout.
- [Provider credentials, November 8](reviews/provider-credentials-20261108/README.md).
- [Provider credentials, November 9](reviews/provider-credentials-20261109/README.md).
- [Legacy development captures](reviews/legacy-dev/provider-credentials/).

`manifest.json` records each original commit, path, and unchanged image blob. The application work remains on main, dev, and feature branches.

## Adding captures

Add a dated folder under `reviews/`, using synthetic services and credentials. Include a README with the source commits, build type, viewport, and mocked scenarios. Use commit-pinned raw image URLs in PR descriptions so later updates cannot change past reviews. Keep this branch limited to review assets; never create a new screenshot branch for each review.
