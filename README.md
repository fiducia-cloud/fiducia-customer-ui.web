# fiducia-customer-ui.web

HTMX customer portal assets for `fiducia-backend.rs`.

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

## Shared Interfaces

The UI imports typed contracts from the local interface package:

```ts
import type { LockGrant, KvGetResponse } from "@fiducia/interfaces/typescript";
```

The dependency is local in `package.json`:

```json
"@fiducia/interfaces": "file:../fiducia-interfaces"
```

## Realtime

If these variables are provided to `fiducia-backend.rs`, the rendered portal
passes them to the browser and subscribes through Supabase realtime. That is the
browser's single Supabase WebSocket:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

The current client listens for changes on:

- `public.fiducia_locks`
- `public.fiducia_requests`
- `public.fiducia_kv`
- `public.fiducia_services`

The browser also opens one non-sensitive heartbeat stream to
`fiducia-backend.rs`:

- WebSocket: `/app/ws`
- SSE fallback: `/app/events`

The backend stream carries generic refresh frames and rendered public shell
fragments only; it never transports customer rows or API-key metadata. Customer
records reconcile through authenticated catch-up requests or Supabase RLS.
IndexedDB databases are namespaced by the authenticated Supabase user so one
browser account cannot render another account's cached rows. The manual refresh
button and `fiducia:refresh` HTMX event remain available as fallback paths.

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
  `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`) and cookie flags
  (`HttpOnly`/`Secure`/`SameSite` on the backend session cookie) are set by
  `fiducia-backend.rs`; this Vite build ships no cookies of its own.
