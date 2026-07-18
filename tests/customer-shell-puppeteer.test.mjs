// Puppeteer E2E — the portal shell (mock backend path). Cross-engine coverage
// that the workspace renders every navigation section, presents a signed-out
// identity until Supabase authenticates, and raises no uncaught page errors as
// a customer walks the whole portal.
import assert from "node:assert/strict";
import { test } from "node:test";
import puppeteer from "puppeteer";
import { installPuppeteerCustomerApiMock } from "./customer-api-mock.mjs";
import { chromeExecutablePath, startCustomerPortal } from "./customer-browser-harness.mjs";

async function openPortal(t) {
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
  await installPuppeteerCustomerApiMock(page);
  return { page, pageErrors, server };
}

const count = (page, selector) => page.$$eval(selector, (nodes) => nodes.length);
const pageText = (page) => page.$eval("body", (body) => body.textContent ?? "");

test("puppeteer renders every navigation section of the workspace", async (t) => {
  const { page, pageErrors, server } = await openPortal(t);
  await page.goto(`${server.url}/app`, { waitUntil: "networkidle0" });

  const body = await pageText(page);
  for (const heading of [
    "Customer workspace",
    "API keys",
    "Security",
    "Two-factor authentication",
    "Trusted sessions",
    "Settings",
    "Realtime events",
  ]) {
    assert.match(body, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `section "${heading}" present`);
  }
  // The realtime panel starts in its empty state until a customer-scoped event.
  assert.match(body, /Waiting for customer-scoped updates\./);

  assert.deepEqual(pageErrors, []);
});

test("puppeteer presents a signed-out identity until Supabase authenticates", async (t) => {
  const { page, pageErrors, server } = await openPortal(t);
  await page.goto(`${server.url}/app`, { waitUntil: "networkidle0" });

  assert.match(await page.$eval("[data-auth-email]", (el) => el.textContent ?? ""), /No customer signed in/);
  // Sign-out is a Supabase-gated action, so it must be disabled while offline.
  assert.equal(await count(page, "[data-auth-action='sign-out']:disabled"), 1, "sign-out gated while offline");
  assert.match(await page.$eval("[data-supabase-status]", (el) => el.textContent ?? ""), /offline/);

  assert.deepEqual(pageErrors, []);
});

test("puppeteer raises no uncaught page errors across the whole portal", async (t) => {
  const { page, pageErrors, server } = await openPortal(t);

  for (const path of ["/app", "/app/api-keys", "/app/security", "/app/settings"]) {
    await page.goto(`${server.url}${path}`, { waitUntil: "networkidle0" });
    // Let deferred hydration (sync fallback, stream wiring) settle.
    await page.waitForFunction(() => document.readyState === "complete");
  }

  assert.deepEqual(pageErrors, [], "no uncaught exceptions on any portal route");
});
