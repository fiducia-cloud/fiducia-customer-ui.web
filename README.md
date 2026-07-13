# fiducia-customer-ui.web

> [!WARNING]
> **Deprecated. Do not add features or deploy this SPA.**

The canonical customer application is the Rust MASH server in
[`fiducia-backend.rs`](https://github.com/fiducia-cloud/fiducia-backend.rs):

- Maud renders customer HTML.
- Axum owns routes, server-mediated Supabase login, and the isolated customer
  cookie.
- SeaORM owns the customer Postgres plane defined by
  `fiducia-interfaces/sql/customer.sql`.
- HTMX drives customer forms and authenticated fragments.

The canonical static `.web` repository is
[`fiducia-ui.web`](https://github.com/fiducia-cloud/fiducia-ui.web), the Astro
marketing site only.

This repository is retained temporarily to preserve implementation history and
migration evidence. Its former CSS was incorporated into the Rust server, and
the server no longer loads this repository's JavaScript, runtime config, or
build artifacts. Archive it only after deployment manifests and submodule
references have been independently verified to contain no remaining dependency.
