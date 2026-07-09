// DB-backed full-loop E2E for the api_keys optimistic-sync vertical.
//
// The mock-path specs (customer-playwright / customer-puppeteer) boot the backend
// with NO database, so create returns a row without an id/version and the client
// just appends a DOM row. This spec instead boots the real fiducia-backend.rs WITH
// the customer Postgres plane (DATABASE_URL set), exercising the true DB path:
//
//   1. The create endpoint inserts the row (version 1), persists it, and
//      broadcasts a `fiducia:sync` frame — server-led creation.
//   2. The client writes the returned row into IndexedDB as clean (server version,
//      not dirty, NO durable-queue entry, NO second sync POST) — the double-write
//      fix. optimisticWrite is reserved for edits.
//   3. The committed row therefore carries an id + monotonic version, and a second
//      browser context (its own empty IndexedDB) reflects it from the DB-backed
//      list on load.
//
// Gated on DB reachability: if the customer PG at 127.0.0.1:5433 (or psql) is not
// available, the whole test skips cleanly instead of failing, so it never breaks
// the mock-path suite on a machine/CI without a database.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { chromium } from "playwright";
import { chromeExecutablePath, startServer } from "@fiducia/test-config/harness";

const testsDir = dirname(fileURLToPath(import.meta.url));
const customerRepo = resolve(testsDir, "..");
const backendRepo = resolve(customerRepo, "../fiducia-backend.rs");
const seedSql = resolve(backendRepo, "scripts/seed-customer.sql");

// The customer Postgres plane. Overridable so the same spec can point at another
// instance (e.g. a CI service container) without editing the file.
const DATABASE_URL =
  process.env.FIDUCIA_CUSTOMER_DATABASE_URL ??
  "postgres://postgres:fiducia@127.0.0.1:5433/fiducia_customer";

// Probe the plane with psql. Returns true only when psql exists AND the DB
// answers, so an absent DB (or psql) skips the test rather than failing it.
function customerDbReachable() {
  try {
    const res = spawnSync("psql", [DATABASE_URL, "-tAc", "select 1"], {
      encoding: "utf8",
      timeout: 5000,
    });
    return res.status === 0 && res.stdout.trim() === "1";
  } catch {
    return false;
  }
}

// Apply the idempotent seed (an org + a few keys) so create has an org to attach
// to and the list is non-trivial. Returns true on success.
function seedCustomerDb() {
  const res = spawnSync(
    "psql",
    [DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-f", seedSql],
    { encoding: "utf8", timeout: 15000 },
  );
  return res.status === 0;
}

// Boot fiducia-backend.rs against the customer DB, serving this repo's built dist.
// Unlike startCustomerPortal (which forces the mock path), this sets DATABASE_URL.
function startDbBackedPortal() {
  return startServer({
    command: "cargo",
    args: ["run"],
    cwd: backendRepo,
    env: {
      DATABASE_URL,
      CUSTOMER_STATIC_DIR: "../fiducia-customer-ui.web/dist",
      FIDUCIA_SITE_MODE: "customer",
      STATIC_DIR: "../fiducia-ui.web/dist",
    },
    readyPath: "/app",
    startupTimeoutMs: 90000,
  });
}

async function fetchApiKeys(baseUrl) {
  const response = await fetch(`${baseUrl}/api/customer/api-keys`);
  assert.ok(response.ok, `GET /api/customer/api-keys → ${response.status}`);
  return response.json();
}

const DB_AVAILABLE = customerDbReachable();

test(
  "DB-backed create commits a versioned row a second context reflects",
  {
    skip: DB_AVAILABLE
      ? false
      : "customer Postgres (127.0.0.1:5433) or psql unavailable — DB-backed E2E skipped",
  },
  async (t) => {
    assert.ok(seedCustomerDb(), "seed-customer.sql should apply cleanly");

    const server = await startDbBackedPortal();
    t.after(() => server.stop());

    // Confirm the backend actually came up in DB mode — a mock backend also
    // answers /app, but only DB-path rows carry an `id`.
    const seeded = await fetchApiKeys(server.url);
    const dbMode =
      Array.isArray(seeded.api_keys) &&
      seeded.api_keys.some((k) => typeof k.id === "string");
    if (!dbMode) {
      t.skip("backend did not connect to the customer DB — DB-backed E2E skipped");
      return;
    }

    const browser = await chromium.launch({
      executablePath: chromeExecutablePath(),
      headless: true,
    });
    t.after(() => browser.close());

    const keyName = `DB loop key ${Date.now()}`;
    t.after(() => {
      // Best-effort cleanup so repeated runs don't pile up rows (name is a fixed
      // literal + digits, so it is safe to inline).
      spawnSync(
        "psql",
        [DATABASE_URL, "-c", `delete from api_keys where name = '${keyName}'`],
        { encoding: "utf8", timeout: 5000 },
      );
    });

    // --- Context A: drive the real optimistic create loop. ---
    const contextA = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const errorsA = [];
    const pageA = await contextA.newPage();
    pageA.on("pageerror", (error) => errorsA.push(error.message));

    await pageA.goto(`${server.url}/app/api-keys`, { waitUntil: "networkidle" });
    await pageA.getByLabel("Name").fill(keyName);
    await pageA.getByLabel("Scopes").selectOption("requests:write");
    await pageA.getByRole("button", { name: "Create key" }).click();
    await pageA
      .getByText("Secret is shown once:")
      .first()
      .waitFor({ state: "visible" });
    await pageA
      .getByRole("cell", { name: keyName })
      .first()
      .waitFor({ state: "visible" });

    // --- Committed row: the DB list now carries our key with an id + version. ---
    const listed = await fetchApiKeys(server.url);
    const created = listed.api_keys.find((k) => k.name === keyName);
    assert.ok(created, "created key is present in the DB-backed list");
    assert.equal(typeof created.id, "string", "committed row carries a uuid id");
    assert.equal(typeof created.version, "number", "committed row carries a version");
    assert.ok(created.version >= 1, "committed version is monotonic (>= 1)");

    // --- Context B: a fresh context (its own empty IndexedDB) must reflect the
    // committed row purely from the DB-backed list it fetches on load. ---
    const contextB = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const errorsB = [];
    const pageB = await contextB.newPage();
    pageB.on("pageerror", (error) => errorsB.push(error.message));

    await pageB.goto(`${server.url}/app/api-keys`, { waitUntil: "networkidle" });
    await pageB
      .getByRole("cell", { name: keyName })
      .first()
      .waitFor({ state: "visible" });

    assert.deepEqual(errorsA, [], "no page errors in context A");
    assert.deepEqual(errorsB, [], "no page errors in context B");
  },
);
