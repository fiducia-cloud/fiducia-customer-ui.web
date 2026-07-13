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

`npm run test:browser` exercises the customer flows against the real customer
backend. The database-backed spec skips only when its external Postgres
dependency is unavailable.
