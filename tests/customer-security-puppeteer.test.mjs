// Puppeteer E2E — the Security surface (mock backend path). A second-engine
// cross-check that every step-up control (TOTP enroll/verify, passkey
// registration) stays disabled until Supabase is configured, that the TOTP QR
// and secret are not revealed before enrollment, and that trusted sessions
// render as provider-managed (non-revocable) when the backend reports
// revoke_supported: false.
import assert from "node:assert/strict";
import { test } from "node:test";
import puppeteer from "puppeteer";
import { installPuppeteerCustomerApiMock } from "./customer-api-mock.mjs";
import { chromeExecutablePath, startCustomerPortal } from "./customer-browser-harness.mjs";

// Boots the portal on /app/security. When `withMock` is true the browser-level
// API mock (revoke_supported: false) is installed; when false the app talks to
// the fixture server (revoke_supported: true), exercising the revocable path.
async function openSecurity(t, { withMock = true } = {}) {
  const server = await startCustomerPortal();
  t.after(() => server.stop());
  const browser = await puppeteer.launch({
    args: process.env.CI === "true" ? ["--no-sandbox", "--disable-setuid-sandbox"] : [],
    executablePath: chromeExecutablePath(),
    headless: "new",
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setViewport({ height: 900, width: 1440 });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  if (withMock) await installPuppeteerCustomerApiMock(page);
  await page.goto(`${server.url}/app/security`, { waitUntil: "networkidle0" });
  return { browser, page, pageErrors };
}

const count = (page, selector) => page.$$eval(selector, (nodes) => nodes.length);
const pageText = (page) => page.$eval("body", (body) => body.textContent ?? "");

test("puppeteer keeps TOTP enroll and verify gated behind Supabase", async (t) => {
  const { page, pageErrors } = await openSecurity(t);

  assert.equal(await count(page, "[data-mfa-action]"), 2, "enroll + verify controls present");
  assert.equal(await count(page, "[data-mfa-action]:disabled"), 2, "both gated until Supabase");
  assert.match(await pageText(page), /Two-factor authentication/);
  assert.match(await page.$eval("[data-mfa-state]", (el) => el.textContent ?? ""), /not enrolled/);

  assert.deepEqual(pageErrors, []);
});

test("puppeteer does not reveal the TOTP QR or secret before enrollment", async (t) => {
  const { page, pageErrors } = await openSecurity(t);

  // The QR image and shared secret are one-time reveals that must stay hidden
  // until an enrollment actually happens (which cannot, without Supabase).
  assert.equal(await page.$eval("[data-mfa-qr]", (el) => el.hidden), true, "QR hidden pre-enroll");
  assert.equal(await page.$eval("[data-mfa-secret]", (el) => el.hidden), true, "secret hidden pre-enroll");

  assert.deepEqual(pageErrors, []);
});

test("puppeteer keeps passkey registration gated behind Supabase", async (t) => {
  const { page, pageErrors } = await openSecurity(t);

  assert.equal(await count(page, "[data-passkey-action]"), 2, "passkey sign-in + register present");
  assert.equal(await count(page, "[data-passkey-action]:disabled"), 2, "both gated until Supabase");
  assert.match(await pageText(page), /Register passkey/);

  assert.deepEqual(pageErrors, []);
});

test("puppeteer renders provider-managed sessions as non-revocable", async (t) => {
  const { page, pageErrors } = await openSecurity(t);

  // The mock reports revoke_supported: false, so the app must render the
  // session as provider-managed rather than offering an (unsupported) revoke.
  await page.waitForFunction(() => document.body.textContent?.includes("Provider managed"));
  const body = await pageText(page);
  assert.match(body, /Safari on iPhone/, "session device rendered");
  assert.match(body, /Chicago, US/, "session location rendered");
  assert.match(body, /Trusted sessions/);
  assert.equal(
    await count(page, "[data-session-action='revoke']:enabled"),
    0,
    "no enabled revoke control when revoke is unsupported",
  );

  assert.deepEqual(pageErrors, []);
});

test("puppeteer revokes a trusted session when the backend supports revocation", async (t) => {
  // Fixture path (no mock): the fixture server reports revoke_supported: true
  // and two active sessions, so the revoke control is live.
  const { page, pageErrors } = await openSecurity(t, { withMock: false });

  await page.waitForFunction(
    () => document.querySelectorAll("[data-session-action='revoke']").length >= 1,
  );
  assert.ok((await count(page, "[data-session-action='revoke']")) >= 1, "revoke control offered");

  await page.click("[data-session-action='revoke']");
  // On success the row's status flips to revoked and the control becomes an
  // inert "Revoked" marker.
  await page.waitForFunction(() => document.body.textContent?.includes("Revoked"));
  assert.match(await pageText(page), /Revoked/);

  assert.deepEqual(pageErrors, []);
});
