# src

Archived browser source for the retired standalone Fiducia customer portal,
bundled by Vite into a complete static verification site in `dist/`. Production
customer routes are rendered by `fiducia-backend.rs`; this bundle is not loaded
by either the customer or operator server.

- `main.ts` — the single entry point. Wires Supabase auth (password, passkey, TOTP 2FA), optional `fiducia-auth` session verification, verified organization selection, the API-key create/rotate/revoke flow, user-namespaced preferences, and security-session controls into the static app shell. The customer API WS/SSE stream is a non-sensitive refresh heartbeat; credential metadata is fetched through authenticated, organization-scoped BFF routes.
- `fiducia-sync.d.ts` — ambient TypeScript declarations for the untyped `@fiducia/sync` SDK, giving the api_keys local-first vertical (wasm reconcile core + IndexedDB store + sync client) enough surface to typecheck under strict mode.
- `styles.css` — all portal styling: app shell, sidebar, dashboard panels, forms, tables, status pills, and the realtime event stream.

The preserved shell degrades gracefully: when Supabase or the optional sync
stack is unavailable it falls back to plain fetch and static markup. This legacy
behavior is test evidence, not the production session or authorization model.
