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
const backendRepo = resolve(customerRepo, "../fiducia-backend.rs");

// Boots the real fiducia-backend.rs (axum + Maud) serving this repo's built
// Vite assets, exactly as production does. Set FIDUCIA_CUSTOMER_TEST_URL to run
// the suite against an already-running portal (e.g. in CI) instead of spawning.
export function startCustomerPortal() {
  return startServer({
    command: "cargo",
    args: ["run"],
    cwd: backendRepo,
    env: {
      CUSTOMER_STATIC_DIR: "../fiducia-customer-ui.web/dist",
      FIDUCIA_E2E_ALLOW_NO_DATABASE: "1",
      FIDUCIA_E2E_STATIC_CUSTOMER_AUTH: "1",
      FIDUCIA_SITE_MODE: "customer",
      STATIC_DIR: "../fiducia-ui.web/dist",
    },
    readyPath: "/app",
    reuseUrlEnv: "FIDUCIA_CUSTOMER_TEST_URL",
    startupTimeoutMs: 45000,
  });
}
