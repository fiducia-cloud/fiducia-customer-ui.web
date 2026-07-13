import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import {
  chromeExecutablePath,
  startStandaloneCustomerPortal,
} from "./customer-browser-harness.mjs";

test("the customer repo serves a complete standalone application shell", async (t) => {
  const server = await startStandaloneCustomerPortal();
  t.after(() => server.stop());

  const browser = await chromium.launch({
    executablePath: chromeExecutablePath(),
    headless: true,
  });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { height: 900, width: 1440 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(server.url, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Customer workspace" }).waitFor();
  await page.getByRole("heading", { name: "Login", exact: true }).waitFor();
  await page.getByRole("heading", { name: "API keys" }).waitFor();
  await page.getByRole("heading", { name: "Security" }).waitFor();
  assert.equal(await page.locator("[data-auth-form]").count(), 3);
  assert.equal(await page.locator("[data-auth-form] input:disabled").count(), 7);
  assert.deepEqual(pageErrors, []);
});
