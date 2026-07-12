# src

Browser source for the Fiducia customer portal, bundled by Vite into `dist/` and
served by `fiducia-backend.rs` under `/_customer/`.

- `main.ts` — the single entry point. Wires Supabase auth (password, passkey, TOTP 2FA), the API-key create/rotate flow, preferences, and security-session controls into the server-rendered HTMX shell. Also drives two live-update channels: the backend WS/SSE stream (rendered HTML fragments) and Supabase realtime (`fiducia_*` table changes).
- `fiducia-sync.d.ts` — ambient TypeScript declarations for the untyped `@fiducia/sync` SDK, giving the api_keys local-first vertical (wasm reconcile core + IndexedDB store + sync client) enough surface to typecheck under strict mode.
- `styles.css` — all portal styling: app shell, sidebar, dashboard panels, forms, tables, status pills, and the realtime event stream.

The app degrades gracefully: when Supabase or the sync stack is unavailable it falls back to plain fetch and server-rendered markup.
