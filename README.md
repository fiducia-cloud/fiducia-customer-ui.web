# fiducia-customer-ui.web

The independently deployable customer web application for Fiducia. It owns the
customer login, signup, account security, API-key, session, preference, and
customer realtime experiences. It does not contain admin routes or admin-plane
credentials. Its complete Vite `dist/` can run at the customer hostname; during
migration, `fiducia-backend.rs` may also serve the same bundle inside its
customer-only shell. Neither mode shares routes, cookies, browser storage, or
UI code with `fiducia-admin.rs`.

## Authentication boundary

The browser signs in with the configured Supabase project and receives a normal
Supabase access token. The portal then:

1. verifies the token with `fiducia-auth` `GET /v1/me` when `authBase` is set;
2. sends that bearer token to the customer API for every protected request; and
3. relies on the customer API to verify the same identity through
   `fiducia-auth` and scope data to the caller's organization.

The Supabase anon key is browser-public. Never put a Supabase service-role key,
an internal service secret, or an admin credential in this app.

## Run and build

```sh
npm ci
npm run check
npm run dev
npm run build
```

`dist/` is a complete static site containing `index.html`, `config.js`, and the
versioned application assets. The included Dockerfile serves it with nginx.

## Customer contracts

The UI declares only its sanitized customer-facing response shapes and the
local `@fiducia/sync` browser-store surface. Cluster/operator interface types are
not dependencies of the customer bundle.

## Runtime configuration

Deployments replace `/config.js` without rebuilding the image:

```js
window.FIDUCIA_CUSTOMER_CONFIG = {
  apiBase: "https://api.fiducia.cloud",
  authBase: "https://auth.fiducia.cloud",
  backendEventsPath: "/app/events",
  backendWsPath: "/app/ws",
  customerHost: "app.fiducia.cloud",
  supabaseUrl: "https://example.supabase.co",
  supabaseAnonKey: "public-anon-key",
  syncModuleUrl: ""
};
```

`apiBase` controls HTTP, WebSocket, and SSE traffic, so the static app and API
may run on different origins. `authBase` enables the explicit browser-side
`/v1/me` verification. Both services must allow the customer origin through
their CORS policy.

`syncModuleUrl` is optional. When supplied, it must resolve to the customer
application's own origin; the portal refuses to execute a cross-origin runtime
module. A missing SDK never blocks the build or the authoritative customer API
fallback.

The old backend-rendered shell remains compatible with `assets/customer.js` and
`assets/customer.css` during migration, but new deployments should serve this
repo's `dist/` directly at the customer hostname.

## Supabase Auth and refresh transport

The UI uses only customer-safe response shapes. Network payloads and auth
behavior remain defined by the customer BFF and `fiducia-auth`; presentation
and deployment remain isolated from `fiducia-admin.rs`.

The browser opens one non-sensitive heartbeat stream to
`fiducia-backend.rs`:

- WebSocket: `/app/ws`
- SSE fallback: `/app/events`

The backend stream carries generic refresh frames and customer-shell summary
fragments only; it never transports customer rows or API-key metadata. Customer
API-key records reconcile only through authenticated catch-up requests. The
browser does not subscribe to Postgres changes directly: row-level security
cannot hide server-only columns such as secret hashes, and cluster-wide locks,
requests, KV, and service discovery belong only in the operator admin app.
IndexedDB databases are namespaced by the authenticated Supabase user and the
explicitly selected, verified organization, so neither another browser account
nor another tenant can render cached rows. Local preference fallbacks are also
namespaced by the authenticated user. The manual refresh button and
`fiducia:refresh` HTMX event remain available as fallback paths.

## Tests

`npm run test:browser` exercises the standalone customer app against a local API
fixture and browser-level sanitized BFF mocks. Real auth/KV integration belongs
to the `fiducia-auth.rs` contract suite, not a customer-Postgres fixture.

`fiducia-auth` is the sole API-key authority. The customer BFF verifies the
Supabase bearer, verifies the explicit organization selection, forwards
create/list/rotate/revoke operations plus mutation idempotency keys to that
service, and returns only the sanitized customer display contract. The browser
never writes credential rows directly.

## Security posture

- **Client-safe vs server-only secrets.** Only the Supabase URL and anon key
  reach the browser. Supabase Row Level Security guards the public anon key. A
  service-role key is server-only and must never appear in `config.js`.
- **Per-user and per-org local state.** Optional IndexedDB databases are
  namespaced by the verified Supabase user and selected organization and closed
  whenever either changes. Preference fallbacks are user-namespaced. One
  account or tenant cannot render another account's cached customer state.
- **Authenticated reconciliation.** Customer records reconcile through bearer-
  authenticated BFF catch-up requests. The backend WS/SSE channel is only a
  heartbeat/refresh signal and never transports API-key rows.
- **Same-origin executable code.** The optional runtime sync module must resolve
  to the portal origin, and the standalone nginx CSP permits scripts only from
  `'self'`.
- **Structured runtime config.** The portal consumes
  `window.FIDUCIA_CUSTOMER_CONFIG` as data and never interpolates its values into
  HTML.
- **Stream fragments are trusted, server-rendered HTML.** The single
  `applyStreamFragments()` `innerHTML` sink consumes HTML fragments rendered by
  the customer backend through Maud; that service is the escaping boundary. All
  customer/API-key values render through `textContent`/`createElement`.
- **HTTP security headers** (CSP, `X-Content-Type-Options`,
  `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`) are set by the static
  hosting edge or by `fiducia-backend.rs` in compatibility mode. This SPA ships
  no application cookies; Supabase browser storage and bearer tokens remain
  isolated from the admin app's HttpOnly cookie.
