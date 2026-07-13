# fiducia-customer-ui.web

The customer web application for Fiducia. It owns customer sign-up/sign-in,
account security, preferences, and customer API-key workflows. It does not
contain operator controls; those live in the separately deployed
`fiducia-admin.rs` application.

The current production shell is rendered by the customer-facing
`fiducia-backend.rs` service and enhanced by this Vite bundle. Sharing that
customer BFF does not share browser state, routes, cookies, storage, or UI code
with the admin application.

The backend renders the portal shell with Axum + Maud and serves this Vite build
from `CUSTOMER_STATIC_DIR`:

```sh
npm install
npm run build
CUSTOMER_STATIC_DIR=../fiducia-customer-ui.web/dist cargo run
```

`app.fiducia.cloud` should route to `fiducia-backend.rs`. Requests with
`Host: app.fiducia.cloud` render the portal at `/`; the same portal is always
available at `/app`.

## Customer contracts

The UI declares only its sanitized customer-facing response shapes and the
local `@fiducia/sync` browser-store surface. Cluster/operator interface types are
not dependencies of the customer bundle.

## Supabase Auth and refresh transport

If these variables are provided to `fiducia-backend.rs`, the rendered portal
passes them to the browser for Supabase login and session management:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

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
IndexedDB databases are namespaced by the authenticated Supabase user so one
browser account cannot render another account's cached rows. The manual refresh
button and `fiducia:refresh` HTMX event remain available as fallback paths.

`fiducia-auth` is the sole API-key authority. The customer BFF verifies the
Supabase bearer, forwards create/list/rotate operations to that service, and
returns only the sanitized customer display contract. The browser never writes
credential rows directly.

## Security posture

- **Client-safe vs server-only secrets.** Only `SUPABASE_URL` and
  `SUPABASE_ANON_KEY` reach the browser — the anon key is designed to be public
  and is guarded by Supabase Row Level Security. The `SUPABASE_SERVICE_ROLE` key
  is **server-only** and must never be shipped to the client or placed in
  `FIDUCIA_CUSTOMER_CONFIG`. `npm audit --omit=dev` reports 0 vulnerabilities.
- **Config injection is not XSS-able from the client.** The portal reads
  `window.FIDUCIA_CUSTOMER_CONFIG` as a structured object merged over defaults;
  its values are never interpolated into HTML. (The backend that serializes that
  object into the inline `<script>` owns escaping it safely.)
- **Stream fragments are trusted, server-rendered HTML.** The single
  `applyStreamFragments()` `innerHTML` sink consumes HTML fragments rendered by
  `fiducia-backend.rs` (Axum + Maud) over the authenticated same-origin panel
  stream — the backend is the escaping boundary; the stream never carries
  customer rows or API-key metadata. All customer/API-key values render through
  `textContent`/`createElement`, never `innerHTML`.
- **HTTP security headers** (CSP, `X-Content-Type-Options`,
  `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`) are set by
  `fiducia-backend.rs`. Authentication is a Supabase browser session whose
  access token is sent as a bearer credential to customer APIs; the customer
  and admin applications do not share an application cookie.
