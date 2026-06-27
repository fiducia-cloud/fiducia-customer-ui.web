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
passes them to the browser and subscribes through Supabase realtime:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

The current client listens for changes on:

- `public.fiducia_locks`
- `public.fiducia_requests`
- `public.fiducia_kv`
- `public.fiducia_services`
