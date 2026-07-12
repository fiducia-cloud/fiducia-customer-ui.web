// Playwright E2E (mock backend path): drives API-key create/rotate, session
// revoke, and preferences, and asserts password/passkey/2FA controls share the
// same Supabase-not-configured gating.
import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { chromeExecutablePath, startCustomerPortal } from "./customer-browser-harness.mjs";

test("playwright drives API keys and preferences through the customer portal", async (t) => {
  const server = await startCustomerPortal();
  t.after(() => server.stop());

  const browser = await chromium.launch({
    executablePath: chromeExecutablePath(),
    headless: true
  });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { height: 900, width: 1440 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(`${server.url}/app`, { waitUntil: "networkidle" });
  await assertVisibleText(page, "Dashboard");
  await assertVisibleText(page, "Supabase Auth");
  await assertVisibleText(page, "API Keys");

  await page.getByRole("link", { name: /API Keys/ }).click();
  await page.getByLabel("Name").fill("Playwright issued key");
  await page.getByLabel("Scopes").selectOption("requests:write");
  await page.getByRole("button", { name: "Create key" }).click();
  await assertVisibleText(page, "Playwright issued key created. Secret is shown once:");
  await assertVisibleText(page, "Playwright issued key");

  await page.getByRole("row", { name: /Playwright issued key/ }).getByRole("button", { name: "Rotate" }).click();
  await assertVisibleText(page, "rotated with 900s overlap");

  await page.getByRole("link", { name: /Security/ }).click();
  const safariRow = page.getByRole("row", { name: /Safari on iPhone/ });
  await safariRow.getByRole("button", { name: "Revoke" }).click();
  await assertVisibleText(page, "Revoked");

  await page.getByRole("link", { name: /Settings/ }).click();
  await page.getByLabel("Dashboard density").selectOption("compact");
  await page.getByRole("button", { name: "Save preferences" }).click();
  await assertVisibleText(page, "Preferences saved.");

  assert.deepEqual(pageErrors, []);
});

test("playwright verifies password, passkey, and 2FA controls share Supabase gating", async (t) => {
  const server = await startCustomerPortal();
  t.after(() => server.stop());

  const browser = await chromium.launch({
    executablePath: chromeExecutablePath(),
    headless: true
  });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { height: 900, width: 1440 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(`${server.url}/app/auth`, { waitUntil: "networkidle" });
  await assertVisibleText(page, "Login");
  await assertVisibleText(page, "Sign up");
  await assertVisibleText(page, "Sign in with passkey");
  assert.equal(await page.locator("[data-auth-form] input:disabled").count(), 7);
  assert.equal(await page.locator("[data-passkey-action]").count(), 1);
  assert.equal(await page.locator("[data-passkey-action]:disabled").count(), 1);

  await page.goto(`${server.url}/app/security`, { waitUntil: "networkidle" });
  await assertVisibleText(page, "Two-factor authentication");
  await assertVisibleText(page, "Register passkey");
  assert.equal(await page.locator("[data-mfa-action]:disabled").count(), 2);
  assert.equal(await page.locator("[data-passkey-action]").count(), 2);
  assert.equal(await page.locator("[data-passkey-action]:disabled").count(), 2);

  assert.deepEqual(pageErrors, []);
});

async function assertVisibleText(page, text) {
  await page.getByText(text).first().waitFor({ state: "visible" });
}
