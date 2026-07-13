# tests

End-to-end browser tests for the customer portal, run via `node --test` (`npm run test:browser`).

- `customer-browser-harness.mjs` — shared boot recipe. Reuses Chrome discovery and the server lifecycle from `@fiducia/test-config`, and exposes `startCustomerPortal()`, which boots this repo's built `dist` with the local customer-API fixture.
- `customer-fixture-server.mjs` — static SPA server plus in-memory customer API responses for browser isolation tests; it never supplies production auth behavior.
- `customer-api-mock.mjs` — browser-level sanitized BFF contract mock; it never seeds or reads raw credential rows.
- `customer-standalone.test.mjs` — boots this repo's own `dist/` with Vite preview and proves the independently deployed login, API-key, and security shell works without backend-rendered HTML.
- `customer-playwright.test.mjs` — Playwright specs driving API-key create/rotate/revoke, provider-managed sessions, preferences, and auth/passkey/2FA gating.
- `customer-puppeteer.test.mjs` — the same critical flows re-checked with a second engine (Puppeteer).

Specs require only the built `dist/`. Real auth/KV integration belongs to the
`fiducia-auth.rs` contract suite, not a customer-Postgres fixture.
