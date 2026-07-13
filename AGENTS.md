# Branch and Worktree Policy

## Deprecated repository

- This standalone customer SPA is deprecated and must not receive new feature work.
- The canonical customer web application is the Rust MASH server in
  `fiducia-customer.rs` (Maud, Axum, SeaORM, and HTMX).
- The canonical static web repository is `fiducia-marketing.web`, which is the marketing
  site only.
- Preserve this repository and its history until deployment references have been
  removed and archival is independently verified.

- Work directly on the `main` branch for now.
- Before making changes, confirm that `main` is the checked-out branch.
- Do not create or use feature branches.
- Do not create or use Git worktrees.
- Merge any existing non-`main` branch into `main` with an intent-preserving merge, resolve conflicts semantically, and continue work on `main`.
- Push completed work to `origin/main`.
- Preserve existing uncommitted work and stop for operator guidance if moving to
  `main` cannot be done safely.
