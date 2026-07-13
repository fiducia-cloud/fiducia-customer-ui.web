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
- `fiducia-auth.rs` remains the sole API-key authority; the customer BFF forwards
  authenticated, tenant-scoped lifecycle requests and never stores raw secrets.

The canonical static `.web` repository is
[`fiducia-ui.web`](https://github.com/fiducia-cloud/fiducia-ui.web), the Astro
marketing site only. The operator application remains the separate Rust MASH
server in `fiducia-admin.rs`; customer and admin routes, cookies, browser state,
databases, and authorization rules are not shared.

## Preserved legacy implementation

This repository is retained temporarily to preserve implementation history,
migration evidence, and the incoming SPA security hardening. Its code is not a
deployment target. The Rust customer server does not load this repository's
JavaScript, runtime config, browser auth, or build artifacts.

For archival verification only:

```sh
npm ci
npm run check
npm run test:browser
npm run build
```

CI resolves the sole sibling test dependency, `fiducia-test-config`, at commit
`4f8a4fa9c8115e1de69d58ec312cb3e17e05864f`. It does not compose this retired
client with the backend, operator app, sync service, interfaces repository, or
marketing site. Dependency installation is lockfile-only with lifecycle scripts
disabled, and the optional archival container serves on port 8080 as an
unprivileged nginx user. That image is verification evidence, not a supported
deployment artifact.

The preserved SPA contains customer-only contracts, same-origin executable-code
checks, per-user/per-org browser storage isolation, CSP-oriented static hosting,
and sanitized refresh transport. Those controls remain useful historical
evidence, but they do not supersede the server-mediated Supabase session,
HttpOnly customer cookie, Maud escaping boundary, or SeaORM data plane in
`fiducia-backend.rs`.

Archive this repository only after deployment manifests and monorepo submodule
references have been independently verified to contain no remaining dependency.
