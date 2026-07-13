# fiducia-customer-ui.web

The independently deployable customer web application for Fiducia. It owns the
customer login, signup, account security, API-key, session, preference, and
customer realtime experiences. It does not contain admin routes or admin-plane
credentials.

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

`syncModuleUrl` is optional. When supplied, the portal loads the local-first
sync SDK as a runtime enhancement. A missing SDK never blocks the build or the
authoritative customer API fallback.

The old backend-rendered shell remains compatible with `assets/customer.js` and
`assets/customer.css` during migration, but new deployments should serve this
repo's `dist/` directly at the customer hostname.

## Shared interfaces

The UI imports customer-safe types from `fiducia-interfaces`. Network payloads
and auth behavior remain defined by shared contracts; presentation and
deployment remain isolated from `fiducia-admin.rs`.

## Tests

`npm run test:browser` exercises the standalone customer app against a local API
fixture. The database-backed spec skips only when its external Postgres
dependency is unavailable.

## Security posture

- **Client-safe vs server-only secrets.** Only the Supabase URL and anon key
  reach the browser. Supabase Row Level Security guards the public anon key. A
  service-role key is server-only and must never appear in `config.js`.
- **Per-user local state.** Optional IndexedDB databases are namespaced by the
  verified Supabase user and closed whenever the active identity changes. One
  browser account cannot render another account's cached API-key rows.
- **Authenticated reconciliation.** Customer records reconcile through bearer-
  authenticated catch-up requests or Supabase RLS. The backend WS/SSE channel is
  only a heartbeat/refresh signal and never transports API-key rows.
- **Structured runtime config.** The portal consumes
  `window.FIDUCIA_CUSTOMER_CONFIG` as data and never interpolates its values into
  HTML.
- **Stream fragments are trusted, server-rendered HTML.** The single
  `applyStreamFragments()` `innerHTML` sink consumes HTML fragments rendered by
  the customer backend through Maud; that service is the escaping boundary. All
  customer/API-key values render through `textContent`/`createElement`.
- **HTTP security headers** (CSP, `X-Content-Type-Options`,
  `frame-ancestors`, `Referrer-Policy`) belong at the static hosting edge. This
  SPA ships no application cookies; Supabase browser storage and bearer tokens
  remain isolated from the admin app's HttpOnly cookie.
