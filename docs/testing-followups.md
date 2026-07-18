# Customer portal — browser test follow-ups

State of the E2E browser coverage (`tests/customer-*.test.mjs`, both Playwright
and Puppeteer under `node --test`) and what still needs shoring up. Each item is
**Open** (coverage/fix we still owe) or **Deployment** (wiring that activates once
prod exists).

## 1. Deployed smoke has no target yet

The k8s-cluster runner smoke (`k8s-cluster/remote/tests/fiducia-customer-portal-smoke.mjs`,
script `test:ui:fiducia-customer`, workflow `fiducia-customer-portal-smoke.yml`)
drives a **deployed** portal through both engines, but **skips cleanly** until
`FIDUCIA_CUSTOMER_TEST_URL` is set. It asserts only the static shell landmarks
(the deployed build's BFF is real, so it can't drive mutations blindly).

**Deployment:** once a portal is deployed to one of the clusters, set the
`FIDUCIA_CUSTOMER_TEST_URL` repo variable (and/or pass it to `workflow_dispatch`)
to turn the smoke into a live gate. This is downstream of the cloud provisioning
blockers (`fiducia-infra/docs/provisioning-status.md`).

## 2. Features only asserted at the GATING level (need a Supabase test double)

Every Supabase-backed control is currently tested only in its **disabled/gated**
state, because the test config intentionally has no Supabase project. The happy
paths below are therefore uncovered:

- **TOTP 2FA enrollment** — QR reveal, secret display, code verify
  (`data-mfa-*`). We assert the controls stay disabled and the QR/secret stay
  hidden; the actual enroll→verify flow is untested.
- **Passkey register / passkey sign-in** (`data-passkey-action`) — gating only.
- **Password / magic-link auth and the post-login identity** (`data-auth-email`,
  `data-auth-status`) — the signed-out state is asserted; the signed-in
  transition is not.

**Open:** stand up a Supabase test double (or a fixture-server auth stub) so the
mock backend can return an authenticated session, then cover enroll→verify,
passkey registration, and the signed-in header/email/status transition.

## 3. Untested non-auth features

- **Organization panel / org switch** (`data-org-panel`, `data-org-select`) — the
  panel is `hidden` until a multi-org user is signed in, so it needs the §2
  auth double to render at all.
- **Backend realtime stream status** (`data-backend-stream-status`, WS then SSE
  fallback) — the fixture serves no `/app/ws` or `/app/events`, so the connecting
  → open/error transitions aren't exercised. Add fixture WS/SSE endpoints to
  cover the status-pill state machine and the `#realtime-events` rendering.
- **API-key `sync` snapshot path** (`/api/customer/sync/api_keys`) — the mock
  serves it and the app has a fetch fallback, but the local-sync store code path
  isn't asserted distinctly from the fallback.

## 4. Runner browser install (note, not a bug)

The deployed smoke launches Playwright's Chromium for both engines: the workflow
installs it once (`playwright install --with-deps chromium`) and the Puppeteer
leg **falls back to that binary** (Puppeteer's own Chrome is not downloaded).
This is intentional (one download, two engines) and mirrors the DD `ui-*-smoke`
scripts. If you want Puppeteer on its *own* bundled Chrome, add
`pnpm exec puppeteer browsers install chrome` to the workflow.

## 5. CI matrix — keep engine parity

`ci.yml` runs `browser-e2e` as a `[playwright, puppeteer]` matrix
(`fail-fast: false`). When adding a test, add or mirror it in **both** engine
files where the assertion is engine-agnostic — the cross-engine check is the
point (a regression one driver misses still fails CI). File naming drives the
lanes: `*-playwright.test.mjs` / `*-puppeteer.test.mjs`.
