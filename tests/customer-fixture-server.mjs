import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../dist");
const port = Number.parseInt(process.env.PORT ?? "0", 10);
const apiKeys = [];
const sessions = [
  { device: "Chrome on macOS", location: "Lima", last_seen: "now", status: "active" },
  { device: "Safari on iPhone", location: "Lima", last_seen: "1h", status: "active" },
];

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (url.pathname === "/api/customer/api-keys" && request.method === "GET") {
    return json(response, 200, {
      api_keys: apiKeys,
      allowed_environments: ["live", "test"],
      allowed_scopes: ["requests:write", "kv:write"],
      default_require_idempotency: true,
    });
  }
  if (url.pathname === "/api/customer/api-keys" && request.method === "POST") {
    const payload = await readJson(request);
    const key = {
      id: `key-${apiKeys.length + 1}`,
      version: 1,
      name: payload.name ?? "New key",
      prefix: `fid_test_${apiKeys.length + 1}`,
      scopes: payload.scope ?? "requests:write",
      last_used: "never",
      status: "active",
    };
    apiKeys.push(key);
    return json(response, 200, { ok: true, api_key: key, secret: "fixture-secret", secret_once: true });
  }
  if (url.pathname === "/api/customer/api-keys/rotate" && request.method === "POST") {
    const payload = await readJson(request);
    return json(response, 200, { ok: true, prefix: payload.prefix, overlap_seconds: 900 });
  }
  if (url.pathname === "/api/customer/preferences" && request.method === "PUT") {
    const preferences = await readJson(request);
    return json(response, 200, { ok: true, preferences, saved_at_ms: Date.now() });
  }
  if (url.pathname === "/api/customer/security/sessions" && request.method === "GET") {
    return json(response, 200, { revoke_supported: true, sessions });
  }
  if (url.pathname === "/api/customer/security/sessions/revoke" && request.method === "POST") {
    const payload = await readJson(request);
    const session = sessions.find((item) => item.device === payload.device);
    if (session) session.status = "revoked";
    return json(response, 200, { ok: true, device: payload.device, status: "revoked" });
  }

  const assets = new Map([
    ["/assets/customer.js", ["assets/customer.js", "application/javascript; charset=utf-8"]],
    ["/assets/customer.css", ["assets/customer.css", "text/css; charset=utf-8"]],
    ["/config.js", ["config.js", "application/javascript; charset=utf-8"]],
  ]);
  const asset = assets.get(url.pathname);
  const [path, contentType] = asset ?? ["index.html", "text/html; charset=utf-8"];
  try {
    const body = await readFile(resolve(root, path));
    response.writeHead(200, { "content-type": contentType, "cache-control": "no-store" });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("not found");
  }
});

server.listen(port, "127.0.0.1");

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function json(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}
