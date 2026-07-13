const jsonHeaders = { "content-type": "application/json" };

export async function installPlaywrightCustomerApiMock(page) {
  const api = createCustomerApiMock();
  await page.route("**/api/customer/**", async (route) => {
    const response = api(
      route.request().method(),
      route.request().url(),
      route.request().postData(),
      route.request().headers()
    );
    await route.fulfill({
      body: JSON.stringify(response.body),
      contentType: "application/json",
      status: response.status,
    });
  });
}

export async function installPuppeteerCustomerApiMock(page) {
  const api = createCustomerApiMock();
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/customer/")) {
      void request.continue();
      return;
    }
    const response = api(request.method(), request.url(), request.postData(), request.headers());
    void request.respond({
      body: JSON.stringify(response.body),
      headers: jsonHeaders,
      status: response.status,
    });
  });
}

function createCustomerApiMock() {
  let sequence = 1;
  const keys = [];
  const sessions = [
    {
      device: "Safari on iPhone",
      last_seen: "2026-07-12T20:00:00Z",
      location: "Chicago, US",
      status: "active",
    },
  ];

  return (method, rawUrl, rawBody, headers = {}) => {
    const url = new URL(rawUrl);
    const body = rawBody ? JSON.parse(rawBody) : {};

    if (method === "GET" && url.pathname === "/api/customer/context") {
      return ok({
        user: { email: "customer@example.test", orgs: ["org_test"], user_id: "user_test" },
      });
    }
    if (method === "GET" && url.pathname === "/api/customer/api-keys") {
      return ok(keyList(keys));
    }
    if (method === "GET" && url.pathname === "/api/customer/sync/api_keys") {
      return ok({ requested_since: 0, rows: keys, snapshot: true, table: "api_keys" });
    }
    if (method === "POST" && url.pathname === "/api/customer/api-keys") {
      if (!headers["idempotency-key"]) return badRequest("idempotency_key_required");
      const id = `mock-${sequence++}`;
      const key = {
        environment: body.environment,
        id,
        last_used: "never",
        name: body.name,
        prefix: `fdc_${body.environment}_${id}`,
        require_idempotency: body.require_idempotency,
        scopes: body.scope,
        status: "active",
        version: 1,
      };
      keys.push(key);
      return created({
        api_key: key,
        ok: true,
        secret: `${key.prefix}.shown-once`,
        secret_once: true,
      });
    }
    if (method === "POST" && url.pathname === "/api/customer/api-keys/rotate") {
      if (!headers["idempotency-key"]) return badRequest("idempotency_key_required");
      const key = keys.find((candidate) => candidate.prefix === body.prefix);
      if (!key || key.status !== "active") {
        return notFound("key_not_found");
      }
      key.version += 1;
      return ok({
        api_key: key,
        ok: true,
        overlap_seconds: 60,
        prefix: key.prefix,
        replacement_secret: `${key.prefix}.replacement-shown-once`,
      });
    }
    if (method === "POST" && url.pathname === "/api/customer/api-keys/revoke") {
      if (!headers["idempotency-key"]) return badRequest("idempotency_key_required");
      const key = keys.find((candidate) => candidate.prefix === body.prefix);
      if (!key) return notFound("key_not_found");
      key.status = "revoked";
      key.version += 1;
      return ok({ ok: true, prefix: key.prefix, status: "revoked" });
    }
    if (method === "GET" && url.pathname === "/api/customer/security/sessions") {
      return ok({ revoke_supported: false, sessions });
    }
    if (method === "POST" && url.pathname === "/api/customer/security/sessions/revoke") {
      return {
        body: { error: "provider_session_revocation_not_configured", ok: false },
        status: 501,
      };
    }
    if (method === "PUT" && url.pathname === "/api/customer/preferences") {
      return ok({ ok: true, preferences: body, saved_at_ms: Date.now() });
    }
    return notFound("mock_route_not_found");
  };
}

function keyList(keys) {
  return {
    allowed_environments: ["live", "test"],
    allowed_scopes: ["requests:write", "kv:write"],
    api_keys: keys,
    default_require_idempotency: true,
  };
}

function ok(body) {
  return { body, status: 200 };
}

function created(body) {
  return { body, status: 201 };
}

function badRequest(error) {
  return { body: { error, ok: false }, status: 400 };
}

function notFound(error) {
  return { body: { error, ok: false }, status: 404 };
}
