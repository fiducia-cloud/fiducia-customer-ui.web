import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const testsDir = dirname(fileURLToPath(import.meta.url));
const customerRepo = resolve(testsDir, "..");
const backendRepo = resolve(customerRepo, "../fiducia-backend.rs");

export function chromeExecutablePath() {
  const candidates = [
    process.env.CHROME_BIN,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].filter(Boolean);

  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error("No Chrome/Chromium executable found. Set CHROME_BIN to run browser tests.");
  }

  return found;
}

export async function startCustomerPortal() {
  if (process.env.FIDUCIA_CUSTOMER_TEST_URL) {
    return {
      url: process.env.FIDUCIA_CUSTOMER_TEST_URL.replace(/\/$/, ""),
      stop: async () => {}
    };
  }

  const port = 19000 + Math.floor(Math.random() * 1000);
  const url = `http://127.0.0.1:${port}`;
  const logs = [];
  const child = spawn("cargo", ["run"], {
    cwd: backendRepo,
    env: {
      ...process.env,
      CUSTOMER_STATIC_DIR: "../fiducia-customer-ui.web/dist",
      FIDUCIA_SITE_MODE: "customer",
      PORT: String(port),
      STATIC_DIR: "../fiducia-ui.web/dist"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr.on("data", (chunk) => logs.push(String(chunk)));

  try {
    await waitForHttp(`${url}/app`, child, logs);
  } catch (error) {
    child.kill("SIGTERM");
    throw error;
  }

  return {
    url,
    stop: async () => {
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }

      child.kill("SIGTERM");
      await Promise.race([
        new Promise((resolveStop) => child.once("exit", resolveStop)),
        delay(2500).then(() => {
          if (child.exitCode === null && child.signalCode === null) {
            child.kill("SIGKILL");
          }
        })
      ]);
    }
  };
}

async function waitForHttp(url, child, logs) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`backend exited before ${url} was ready:\n${logs.join("")}`);
    }

    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until the backend listener is ready.
    }

    await delay(250);
  }

  throw new Error(`timed out waiting for ${url}:\n${logs.join("")}`);
}
