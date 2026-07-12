# tests

End-to-end browser tests for the customer portal, run via `node --test` (`npm run test:browser`).

- `customer-browser-harness.mjs` — shared boot recipe. Reuses Chrome discovery and the server lifecycle from `@fiducia/test-config`, and exposes `startCustomerPortal()`, which boots the real `fiducia-backend.rs` (mock path, no DB) serving this repo's built `dist`.
- `customer-playwright.test.mjs` — Playwright specs driving API-key create/rotate, session revoke, preferences, and auth/passkey/2FA gating.
- `customer-puppeteer.test.mjs` — the same critical flows re-checked with a second engine (Puppeteer).
- `customer-sync-db.test.mjs` — DB-backed full-loop test of the api_keys optimistic-sync vertical. Boots the backend against the customer Postgres plane and verifies a committed, versioned row is reflected in a fresh browser context. Skips cleanly when the DB (or `psql`) is unavailable.

Specs require the built `dist/` and the sibling `fiducia-backend.rs` (and, for the DB spec, a reachable customer Postgres).
