// Repo-local boot recipe for the customer portal E2E.
//
// The genuinely-shared pieces (Chrome discovery + the server lifecycle) come
// from @fiducia/test-config; only the customer-specific boot arguments live
// here, next to the app they boot. Specs stay in this repo's tests/.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "@fiducia/test-config/harness";

export { chromeExecutablePath, launchOptions } from "@fiducia/test-config/harness";

const testsDir = dirname(fileURLToPath(import.meta.url));
const customerRepo = resolve(testsDir, "..");
// Boots this repo's complete static app with a customer-API fixture. Frontend
// tests intentionally do not depend on another application's HTML or startup
// requirements. Set FIDUCIA_CUSTOMER_TEST_URL to reuse a deployed test portal.
export function startCustomerPortal() {
  return startServer({
    command: process.execPath,
    args: ["tests/customer-fixture-server.mjs"],
    cwd: customerRepo,
    readyPath: "/app",
    reuseUrlEnv: "FIDUCIA_CUSTOMER_TEST_URL",
    startupTimeoutMs: 45000,
  });
}

// Boots this repository's own static application. This catches accidental
// regressions where only the legacy backend-rendered shell remains usable.
export function startStandaloneCustomerPortal() {
  return startServer({
    command: "npm",
    args: ["run", "preview", "--"],
    cwd: customerRepo,
    portArgs: (port) => ["--port", String(port)],
    readyPath: "/",
    reuseUrlEnv: "FIDUCIA_CUSTOMER_STANDALONE_TEST_URL",
    startupTimeoutMs: 30000,
  });
}
