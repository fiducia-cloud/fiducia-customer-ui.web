// Guards the runtime config contract: /config.js is served publicly and is
// replaced at deploy time, so it must only ever contain browser-public values
// (Supabase URL + anon/publishable key, hostnames, paths). This spec fails the
// suite if a secret-shaped value or an unexpected config key ever lands in
// public/config.js or the built dist/config.js.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { test } from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The full set of keys the app reads (see CustomerConfig in src/main.ts). A new
// key must be reviewed and added here deliberately; anything else — especially
// anything secret-bearing — fails.
const ALLOWED_KEYS = new Set([
  "apiBase",
  "authBase",
  "backendEventsPath",
  "backendWsPath",
  "customerHost",
  "regions",
  "supabaseUrl",
  "supabaseAnonKey",
  "syncModuleUrl",
]);

const SECRET_VALUE_PATTERNS = [
  { name: "supabase secret key", pattern: /\bsb_secret_/ },
  { name: "supabase personal access token", pattern: /\bsbp_[0-9a-f]{40,}/ },
  { name: "PEM private key", pattern: /-----BEGIN[A-Z ]*PRIVATE KEY-----/ },
  { name: "AWS access key id", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "generic live secret", pattern: /\b(sk_live|sk_test|rk_live)_/ },
];

const configFiles = ["public/config.js", "dist/config.js"]
  .map((path) => resolve(repoRoot, path))
  .filter((path) => existsSync(path));

test("runtime config files exist to be guarded", () => {
  assert.ok(configFiles.length >= 1, "public/config.js must exist");
});

for (const file of configFiles) {
  test(`${file.slice(repoRoot.length + 1)} contains only browser-public configuration`, async () => {
    const source = await readFile(file, "utf8");
    const sandbox = { window: { location: { host: "config-guard.invalid" } } };
    runInNewContext(source, sandbox, { filename: file });

    const config = sandbox.window.FIDUCIA_CUSTOMER_CONFIG;
    assert.ok(
      config && typeof config === "object" && !Array.isArray(config),
      "config.js must assign an object to window.FIDUCIA_CUSTOMER_CONFIG"
    );

    for (const [key, value] of Object.entries(config)) {
      assert.ok(ALLOWED_KEYS.has(key), `unexpected config key "${key}" — review before allowing`);
      assert.doesNotMatch(key, /secret|service|private|password|credential/i, `suspicious config key "${key}"`);

      const values = Array.isArray(value) ? value : [value];
      for (const entry of values) {
        assert.equal(
          typeof entry,
          "string",
          `config value for "${key}" must be a string (or array of strings), got ${typeof entry}`
        );
        for (const { name, pattern } of SECRET_VALUE_PATTERNS) {
          assert.doesNotMatch(entry, pattern, `config value for "${key}" looks like a ${name}`);
        }
      }
    }

    // Legacy Supabase anon keys are JWTs whose payload role must be the
    // browser-public "anon" — a service_role JWT here is a critical leak.
    const anonKey = typeof config.supabaseAnonKey === "string" ? config.supabaseAnonKey : "";
    const jwtMatch = anonKey.match(/^eyJ[\w-]+\.(?<payload>[\w-]+)\.[\w-]+$/);
    if (jwtMatch) {
      const payload = JSON.parse(Buffer.from(jwtMatch.groups.payload, "base64url").toString("utf8"));
      assert.notEqual(payload.role, "service_role", "supabaseAnonKey is a SERVICE ROLE token — critical");
      if (payload.role !== undefined) {
        assert.equal(payload.role, "anon", `supabaseAnonKey has unexpected role "${payload.role}"`);
      }
    }
  });
}
