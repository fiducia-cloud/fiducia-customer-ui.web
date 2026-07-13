// Puppeteer E2E (mock backend path): a second-engine cross-check of auth/2FA
// gating, session revoke, and API-key create/rotate against the customer portal.
import assert from "node:assert/strict";
import { test } from "node:test";
import puppeteer from "puppeteer";
import { installPuppeteerCustomerApiMock } from "./customer-api-mock.mjs";
import { chromeExecutablePath, startCustomerPortal } from "./customer-browser-harness.mjs";

test("puppeteer verifies auth gating, 2FA gating, and API-key backend actions", async (t) => {
  const server = await startCustomerPortal();
  t.after(() => server.stop());

  const browser = await puppeteer.launch({
    executablePath: chromeExecutablePath(),
    headless: "new"
  });
  t.after(() => browser.close());

  const page = await browser.newPage();
  await page.setViewport({ height: 900, width: 1440 });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await installPuppeteerCustomerApiMock(page);

  await page.goto(`${server.url}/app/auth`, { waitUntil: "networkidle0" });
  assert.equal(await disabledCount(page, "[data-auth-form] input:disabled"), 7);
  assert.match(await pageText(page), /Supabase Auth is not configured\./);

  await page.goto(`${server.url}/app/security`, { waitUntil: "networkidle0" });
  assert.equal(await disabledCount(page, "[data-mfa-action]:disabled"), 2);
  assert.match(await pageText(page), /Trusted sessions/);
  await page.waitForFunction(() => document.body.textContent?.includes("Provider managed"));

  await page.goto(`${server.url}/app/api-keys`, { waitUntil: "networkidle0" });
  await page.type("input[name='name']", "Puppeteer issued key");
  await page.select("select[name='scope']", "kv:write");
  await Promise.all([
    page.click("[data-api-key-form] button[type='submit']"),
    page.waitForFunction(() =>
      document.querySelector("[data-api-key-message]")?.textContent?.includes("Puppeteer issued key created")
    )
  ]);
  assert.match(await pageText(page), /Puppeteer issued key/);

  await Promise.all([
    page.click("[data-api-key-action='rotate']"),
    page.waitForFunction(() =>
      document.querySelector("[data-api-key-message]")?.textContent?.includes("rotated with 60s overlap")
    )
  ]);

  await Promise.all([
    page.click("[data-api-key-action='revoke']"),
    page.waitForFunction(() =>
      document.querySelector("[data-api-key-message]")?.textContent?.includes("revoked")
    )
  ]);

  assert.deepEqual(pageErrors, []);
});

async function disabledCount(page, selector) {
  return page.$$eval(selector, (nodes) => nodes.length);
}

async function pageText(page) {
  return page.$eval("body", (body) => body.textContent ?? "");
}
