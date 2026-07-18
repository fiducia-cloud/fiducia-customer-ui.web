// Playwright E2E — customer Settings / preferences (mock backend path). Covers
// the full preferences round-trip (region, timezone, density, notification
// toggles), the option contract the form exposes, and that notification
// preferences default on and persist through a save.
import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { installPlaywrightCustomerApiMock } from "./customer-api-mock.mjs";
import { chromeExecutablePath, startCustomerPortal } from "./customer-browser-harness.mjs";

async function openSettings(t) {
  const server = await startCustomerPortal();
  t.after(() => server.stop());
  const browser = await chromium.launch({ executablePath: chromeExecutablePath(), headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { height: 900, width: 1440 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await installPlaywrightCustomerApiMock(page);
  await page.goto(`${server.url}/app/settings`, { waitUntil: "networkidle" });
  return { page, pageErrors };
}

const optionValues = (page, selector) =>
  page.locator(`${selector} option`).evaluateAll((options) => options.map((o) => o.value));

test("playwright saves region, timezone, and density preferences together", async (t) => {
  const { page, pageErrors } = await openSettings(t);

  await page.locator("[data-preference-form] select[name='region']").selectOption("iad1");
  await page.locator("[data-preference-form] select[name='timezone']").selectOption("utc");
  await page.locator("[data-preference-form] select[name='density']").selectOption("compact");
  await page.getByRole("button", { name: "Save preferences" }).click();

  await page.getByText("Preferences saved.").first().waitFor({ state: "visible" });
  // The selections are what the app will PUT and re-render, so they must stick.
  assert.equal(await page.locator("[data-preference-form] select[name='density']").inputValue(), "compact");
  assert.equal(await page.locator("[data-preference-form] select[name='region']").inputValue(), "iad1");

  assert.deepEqual(pageErrors, []);
});

test("playwright exposes the full region, timezone, and density option contract", async (t) => {
  const { page, pageErrors } = await openSettings(t);

  assert.deepEqual(await optionValues(page, "[data-preference-form] select[name='region']"), [
    "auto",
    "iad1",
    "sfo1",
    "ams1",
    "fra1",
    "sin1",
    "syd1",
  ]);
  assert.deepEqual(await optionValues(page, "[data-preference-form] select[name='timezone']"), [
    "browser",
    "utc",
    "america-lima",
  ]);
  assert.deepEqual(await optionValues(page, "[data-preference-form] select[name='density']"), [
    "comfortable",
    "compact",
  ]);

  assert.deepEqual(pageErrors, []);
});

test("playwright defaults notification toggles on and persists a change", async (t) => {
  const { page, pageErrors } = await openSettings(t);

  // All three notification classes are opt-out (checked by default).
  for (const name of ["notify_lock_contention", "notify_key_rotation", "notify_mfa"]) {
    assert.equal(
      await page.locator(`[data-preference-form] input[name='${name}']`).isChecked(),
      true,
      `${name} defaults on`,
    );
  }

  await page.locator("[data-preference-form] input[name='notify_lock_contention']").uncheck();
  await page.getByRole("button", { name: "Save preferences" }).click();
  await page.getByText("Preferences saved.").first().waitFor({ state: "visible" });
  assert.equal(
    await page.locator("[data-preference-form] input[name='notify_lock_contention']").isChecked(),
    false,
    "unchecked toggle persists through save",
  );

  assert.deepEqual(pageErrors, []);
});
