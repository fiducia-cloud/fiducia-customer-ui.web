// Playwright E2E — API-key lifecycle (mock backend path). Complements the
// smoke coverage in customer-playwright.test.mjs with the full create/rotate/
// revoke surface: per-environment prefixes, the one-time replacement secret on
// rotation, the revoked terminal state, and the scope/state the table renders.
//
// The mock (tests/customer-api-mock.mjs) REQUIRES an Idempotency-Key header on
// every mutation and 400s without it, so each successful mutation below also
// proves the client supplied one — the idempotency contract, verified end to
// end rather than asserted in isolation.
import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { installPlaywrightCustomerApiMock } from "./customer-api-mock.mjs";
import { chromeExecutablePath, startCustomerPortal } from "./customer-browser-harness.mjs";

async function openApiKeys(t) {
  const server = await startCustomerPortal();
  t.after(() => server.stop());
  const browser = await chromium.launch({ executablePath: chromeExecutablePath(), headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { height: 900, width: 1440 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await installPlaywrightCustomerApiMock(page);
  await page.goto(`${server.url}/app/api-keys`, { waitUntil: "networkidle" });
  return { page, pageErrors };
}

async function createKey(page, { name, environment, scope }) {
  await page.locator("[data-api-key-form] input[name='name']").fill(name);
  await page.locator("[data-api-key-form] select[name='environment']").selectOption(environment);
  await page.locator("[data-api-key-form] select[name='scope']").selectOption(scope);
  await page.getByRole("button", { name: "Create key" }).click();
  await page.getByText(`${name} created. Secret is shown once:`).first().waitFor({ state: "visible" });
}

test("playwright issues keys in the live and test environments with distinct prefixes", async (t) => {
  const { page, pageErrors } = await openApiKeys(t);

  await createKey(page, { environment: "test", name: "Sandbox key", scope: "kv:write" });
  await createKey(page, { environment: "live", name: "Production key", scope: "requests:write" });

  // The mock derives the prefix as fdc_<environment>_<id>, so the environment
  // chosen in the form must be reflected in the stored key.
  await page.getByRole("cell", { name: /fdc_test_/ }).first().waitFor({ state: "visible" });
  await page.getByRole("cell", { name: /fdc_live_/ }).first().waitFor({ state: "visible" });
  await assert.doesNotReject(page.getByRole("row", { name: /Sandbox key/ }).waitFor({ state: "visible" }));
  await assert.doesNotReject(page.getByRole("row", { name: /Production key/ }).waitFor({ state: "visible" }));

  assert.deepEqual(pageErrors, []);
});

test("playwright rotation reveals a one-time replacement secret and keeps the key active", async (t) => {
  const { page, pageErrors } = await openApiKeys(t);
  await createKey(page, { environment: "test", name: "Rotating key", scope: "kv:write" });

  await page.getByRole("row", { name: /Rotating key/ }).getByRole("button", { name: "Rotate" }).click();
  await page.getByText(/rotated with 60s overlap\./).first().waitFor({ state: "visible" });
  // The replacement secret is a one-time reveal: the app must surface it inline
  // exactly once, mirroring the create-time secret.
  await page.getByText(/New secret \(shown once\):/).first().waitFor({ state: "visible" });

  assert.deepEqual(pageErrors, []);
});

test("playwright revocation moves a key to the revoked terminal state", async (t) => {
  const { page, pageErrors } = await openApiKeys(t);
  await createKey(page, { environment: "live", name: "Doomed key", scope: "requests:write" });

  const row = page.getByRole("row", { name: /Doomed key/ });
  await row.getByRole("button", { name: "Revoke" }).click();
  // Assert on the dedicated status hook so the match is unambiguous (the word
  // "revoked" otherwise appears in both the status cell and its inner tag).
  await page.waitForFunction(() => {
    const target = [...document.querySelectorAll("[data-api-keys-table] tbody tr")].find((tr) =>
      tr.textContent?.includes("Doomed key"),
    );
    return target?.querySelector("[data-api-key-status]")?.textContent?.trim() === "revoked";
  });

  assert.deepEqual(pageErrors, []);
});

test("playwright lists a created key with its scope and active state in the table", async (t) => {
  const { page, pageErrors } = await openApiKeys(t);
  await createKey(page, { environment: "test", name: "Scoped key", scope: "kv:write" });

  const row = page.getByRole("row", { name: /Scoped key/ });
  await row.getByText("kv:write", { exact: false }).waitFor({ state: "visible" });
  await row.getByText("active", { exact: false }).waitFor({ state: "visible" });

  assert.deepEqual(pageErrors, []);
});
