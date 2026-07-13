# tests

End-to-end browser tests for the customer portal, run via `node --test` (`npm run test:browser`).

- `customer-browser-harness.mjs` — shared boot recipe. Reuses Chrome discovery and the server lifecycle from `@fiducia/test-config`, and exposes `startCustomerPortal()`, which boots this repo's built `dist` with the local customer-API fixture.
- `customer-fixture-server.mjs` — static SPA server plus in-memory customer API responses for browser isolation tests; it never supplies production auth behavior.
- `customer-standalone.test.mjs` — boots this repo's own `dist/` with Vite preview and proves the independently deployed login, API-key, and security shell works without backend-rendered HTML.
- `customer-playwright.test.mjs` — Playwright specs driving API-key create/rotate, session revoke, preferences, and auth/passkey/2FA gating.
- `customer-puppeteer.test.mjs` — the same critical flows re-checked with a second engine (Puppeteer).
- `customer-sync-db.test.mjs` — DB-backed full-loop test of the api_keys optimistic-sync vertical. Boots the backend against the customer Postgres plane and verifies a committed, versioned row is reflected in a fresh browser context. Skips cleanly when the DB (or `psql`) is unavailable.

Specs require the built `dist/`; only the DB spec requires an external customer Postgres.
