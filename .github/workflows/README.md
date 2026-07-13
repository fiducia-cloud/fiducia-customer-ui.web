# workflows

GitHub Actions CI for the customer portal.

`ci.yml` runs on pushes to `main`, pull requests, and manual dispatch. It has
two gating jobs:

- **build** — checks out the exact audited `fiducia-test-config` revision needed
  by the local `file:../` harness dependency, installs the lockfile with package
  lifecycle scripts disabled, then typechecks and builds the preserved SPA.
- **browser-e2e** — drives Chrome against the repository's isolated customer
  fixture. It does not check out or boot the customer backend, operator app,
  sync service, interfaces repo, or marketing site, and a regression fails CI.

Every third-party action is pinned by commit. The archived SPA is intentionally
kept outside the production customer/admin authorization boundary.
