// Entry point for the Fiducia customer portal browser bundle: wires Supabase auth
// (password/passkey/2FA), the api_keys local-first sync vertical, preferences and
// session controls, and a non-sensitive backend WS/SSE refresh signal into the
// independently deployed customer SPA (and the legacy backend-rendered
// compatibility shell during migration). Operator data never enters this app.
import "./styles.css";
import htmx from "htmx.org";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import type { SyncClient, SyncQueue, SyncStore } from "@fiducia/sync";

type FiduciaRegion =
  | "auto"
  | "ams1"
  | "ash1"
  | "fra1"
  | "iad1"
  | "sfo1"
  | "sin1"
  | "syd1";

type CustomerConfig = {
  apiBase: string;
  authBase?: string;
  backendEventsPath: string;
  backendWsPath: string;
  customerHost: string;
  regions: FiduciaRegion[];
  syncModuleUrl?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
};

type CustomerApiKey = {
  name: string;
  prefix: string;
  scopes: string;
  last_used: string;
  status: string;
  // Assigned by the authoritative fiducia-auth key record.
  id: string;
  version: number;
};

type ApiKeyListResponse = {
  api_keys: CustomerApiKey[];
  allowed_environments: string[];
  allowed_scopes: string[];
  default_require_idempotency: boolean;
};

type CreateApiKeyResponse = {
  ok: boolean;
  api_key?: CustomerApiKey & {
    environment?: string;
    require_idempotency?: boolean;
  };
  error?: string;
  secret?: string;
  secret_once?: boolean;
};

type RotateApiKeyResponse = {
  ok: boolean;
  api_key?: CustomerApiKey;
  error?: string;
  overlap_seconds?: number;
  prefix?: string;
  replacement_secret?: string;
};

type RevokeApiKeyResponse = {
  error?: string;
  ok: boolean;
  prefix?: string;
  status?: string;
};

type CustomerContextResponse = {
  user: {
    email?: string;
    orgs: string[];
    user_id: string;
  };
};

type CustomerPreferences = {
  density: string;
  notify_key_rotation: boolean;
  notify_lock_contention: boolean;
  notify_mfa: boolean;
  region: string;
  timezone: string;
};

type SavePreferencesResponse = {
  ok: boolean;
  error?: string;
  preferences?: CustomerPreferences;
  saved_at_ms?: number;
};

type CustomerSession = {
  device: string;
  last_seen: string;
  location: string;
  status: string;
};

type SessionListResponse = {
  revoke_supported: boolean;
  sessions: CustomerSession[];
};

type RevokeSessionResponse = {
  device?: string;
  error?: string;
  ok: boolean;
  status?: string;
};

type StreamFragments = Partial<Record<"summary", string>>;

type BackendStreamMessage = {
  kind: "connected" | "refresh" | "pong";
  sequence: number;
  transport: "websocket" | "sse";
  event: "fiducia:refresh";
  at_ms: number;
  fragments?: StreamFragments;
};

declare global {
  interface Window {
    FIDUCIA_CUSTOMER_CONFIG?: CustomerConfig;
    htmx?: typeof htmx;
  }
}

window.htmx = htmx;

const defaultConfig: CustomerConfig = {
  apiBase: import.meta.env.VITE_FIDUCIA_CUSTOMER_API_BASE ?? "",
  authBase: import.meta.env.VITE_FIDUCIA_AUTH_BASE ?? "",
  backendEventsPath: "/app/events",
  backendWsPath: "/app/ws",
  customerHost: "app.fiducia.cloud",
  regions: ["auto", "iad1", "sfo1", "ams1", "fra1", "sin1", "syd1"],
  syncModuleUrl: import.meta.env.VITE_FIDUCIA_SYNC_MODULE_URL ?? ""
};

const config = {
  ...defaultConfig,
  ...(window.FIDUCIA_CUSTOMER_CONFIG ?? {})
};

const supabaseClient = createSupabaseCustomerClient(config);
const statusEl = document.querySelector<HTMLElement>("[data-supabase-status]");
const backendStatusEl = document.querySelector<HTMLElement>("[data-backend-stream-status]");
const freshnessEls = document.querySelectorAll<HTMLElement>("[data-freshness-clock]");
const authStatusEls = document.querySelectorAll<HTMLElement>("[data-auth-status]");
const authEmailEls = document.querySelectorAll<HTMLElement>("[data-auth-email]");
const authMessageEl = document.querySelector<HTMLElement>("[data-auth-message]");
const orgPanelEl = document.querySelector<HTMLElement>("[data-org-panel]");
const orgSelectEl = document.querySelector<HTMLSelectElement>("[data-org-select]");
const orgMessageEl = document.querySelector<HTMLElement>("[data-org-message]");
const apiKeyMessageEl = document.querySelector<HTMLElement>("[data-api-key-message]");
const preferenceMessageEl = document.querySelector<HTMLElement>("[data-preference-message]");
const mfaMessageEl = document.querySelector<HTMLElement>("[data-mfa-message]");
const mfaStateEls = document.querySelectorAll<HTMLElement>("[data-mfa-state]");
const mfaQrEl = document.querySelector<HTMLImageElement>("[data-mfa-qr]");
const mfaSecretEl = document.querySelector<HTMLElement>("[data-mfa-secret]");
const mfaCodeEl = document.querySelector<HTMLInputElement>("[data-mfa-code]");
const streamTargets: Record<keyof StreamFragments, string> = {
  summary: "#summary"
};

let pendingMfaFactorId: string | null = null;

// The local-first api_keys sync handle. Null until (and unless) the wasm reconcile
// core + IndexedDB store come up; when null the view falls back to the fetch path.
type ApiKeySyncHandle = { store: SyncStore; client: SyncClient };
let apiKeySync: ApiKeySyncHandle | null = null;
let activeSyncUserId: string | null | undefined;
let activeSyncOrgId: string | null = null;
let availableOrgIds: string[] = [];
let syncGeneration = 0;

type SyncModule = {
  loadBrowserCore(): Promise<unknown>;
  makeQueue(store: SyncStore): SyncQueue;
  makeSyncClient(deps: { store: SyncStore; queue: SyncQueue; core: unknown }): SyncClient;
  openStore(dbName: string, tables: string[]): Promise<SyncStore>;
};

setBackendStatus("connecting");
setRealtimeStatus(supabaseClient ? "configured" : "offline");
initializeAuth(supabaseClient);
bindOrganizationControls();
bindApiKeyControls();
bindPreferenceControls();
bindSecuritySessionControls();
startFreshnessClock();
startBackendStream(config);

document.body.addEventListener("htmx:afterSwap", (event) => {
  const target = event.target;
  if (target instanceof HTMLElement) {
    target.dataset.lastSwapAt = new Date().toISOString();
  }
});

function hasSupabaseConfig(value: CustomerConfig): value is CustomerConfig & {
  supabaseUrl: string;
  supabaseAnonKey: string;
} {
  return Boolean(value.supabaseUrl && value.supabaseAnonKey);
}

function createSupabaseCustomerClient(value: CustomerConfig): SupabaseClient | null {
  if (!hasSupabaseConfig(value)) {
    return null;
  }

  return createClient(value.supabaseUrl, value.supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      experimental: {
        passkey: true
      },
      persistSession: true
    }
  });
}

function initializeAuth(client: SupabaseClient | null) {
  bindAuthForms(client);
  bindPasskeyControls(client);
  bindSignOutControls(client);
  bindMfaControls(client);

  if (!client) {
    renderAuthSession(null);
    setAuthMessage("Supabase Auth is not configured.");
    setMfaMessage("Supabase Auth is not configured.");
    disableSupabaseControls();
    return;
  }

  void client.auth.getSession().then(({ data, error }) => {
    if (error) {
      setAuthMessage(error.message);
      return;
    }

    void acceptAuthSession(data.session ?? null);
  });

  client.auth.onAuthStateChange((_event, session) => {
    void acceptAuthSession(session);
  });
}

async function acceptAuthSession(session: Session | null) {
  if (!session) {
    renderAuthSession(null);
    await activateCustomerSession(null);
    return;
  }

  if (config.authBase) {
    renderAuthSession(session, "verifying");
    try {
      const response = await fetch(resolveAuthUrl("/v1/me"), {
        headers: { authorization: `Bearer ${session.access_token}` }
      });
      if (!response.ok) {
        throw new Error(`fiducia-auth rejected the session (${response.status})`);
      }
      renderAuthSession(session, "verified");
    } catch (error) {
      renderAuthSession(null);
      await activateCustomerSession(null);
      setAuthMessage(errorMessage(error));
      return;
    }
  } else {
    renderAuthSession(session);
  }

  await activateCustomerSession(session);
}

async function activateCustomerSession(session: Session | null) {
  const nextUserId = session?.user.id ?? null;
  if (activeSyncUserId === nextUserId) {
    return;
  }

  activeSyncUserId = nextUserId;
  activeSyncOrgId = null;
  availableOrgIds = [];
  ++syncGeneration;
  apiKeySync?.store.close();
  apiKeySync = null;
  configureOrganizationSelector(nextUserId, []);
  hydratePreferencesForUser(nextUserId);

  const body = apiKeyTableBody();
  if (body) {
    body.textContent = "";
  }
  if (!nextUserId) {
    setApiKeyMessage("Sign in to load customer API keys.");
    return;
  }

  try {
    const context = await getJson<CustomerContextResponse>("/api/customer/context");
    const orgs = Array.from(
      new Set(context.user.orgs.filter((orgId) => typeof orgId === "string" && orgId.trim()))
    );
    configureOrganizationSelector(nextUserId, orgs);
    const selected = preferredOrganization(nextUserId, orgs);
    if (selected) {
      if (orgSelectEl) {
        orgSelectEl.value = selected;
      }
      await switchCustomerOrganization(selected);
    } else {
      setApiKeyMessage("Select an organization to load customer API keys.");
    }
  } catch (error) {
    setOrgMessage(errorMessage(error));
    setApiKeyMessage("Could not load verified organization membership.");
  }
}

function bindOrganizationControls() {
  orgSelectEl?.addEventListener("change", () => {
    void switchCustomerOrganization(orgSelectEl.value);
  });
}

function configureOrganizationSelector(userId: string | null, orgs: string[]) {
  availableOrgIds = orgs;
  if (!orgPanelEl || !orgSelectEl) {
    return;
  }
  orgPanelEl.hidden = !userId;
  orgSelectEl.textContent = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = orgs.length ? "Select an organization" : "No organizations available";
  orgSelectEl.append(placeholder);
  for (const orgId of orgs) {
    const option = document.createElement("option");
    option.value = orgId;
    option.textContent = orgId;
    orgSelectEl.append(option);
  }
  orgSelectEl.disabled = !orgs.length;
  setOrgMessage(
    orgs.length > 1
      ? "Choose the organization whose credentials you want to manage."
      : orgs.length === 1
        ? "Organization membership verified."
        : userId
          ? "No verified organization membership."
          : ""
  );
}

function preferredOrganization(userId: string, orgs: string[]) {
  if (orgs.length === 1) {
    return orgs[0];
  }
  const saved = window.localStorage.getItem(organizationStorageKey(userId));
  return saved && orgs.includes(saved) ? saved : null;
}

async function switchCustomerOrganization(orgId: string) {
  const userId = activeSyncUserId;
  if (!userId || !availableOrgIds.includes(orgId)) {
    activeSyncOrgId = null;
    setOrgMessage(orgId ? "That organization is not in the verified membership list." : "Select an organization.");
    return;
  }

  const generation = ++syncGeneration;
  apiKeySync?.store.close();
  apiKeySync = null;
  activeSyncOrgId = orgId;
  window.localStorage.setItem(organizationStorageKey(userId), orgId);
  const body = apiKeyTableBody();
  if (body) {
    body.textContent = "";
  }
  setOrgMessage(`Using organization ${orgId}.`);
  await setupApiKeySync(userId, orgId, generation);
  if (generation === syncGeneration) {
    await hydrateApiKeys();
  }
}

function organizationStorageKey(userId: string) {
  return `fiducia.customer.organization.${userId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function bindAuthForms(client: SupabaseClient | null) {
  document.querySelectorAll<HTMLFormElement>("[data-auth-form]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();

      if (!client) {
        setAuthMessage("Supabase Auth is not configured.");
        return;
      }

      void handleAuthSubmit(client, form);
    });
  });
}

async function handleAuthSubmit(client: SupabaseClient, form: HTMLFormElement) {
  const intent = form.dataset.authForm;
  const data = new FormData(form);

  try {
    setAuthMessage("Working...");

    if (intent === "sign-in") {
      await signInWithPassword(client, data);
      setAuthMessage("Signed in.");
      form.reset();
      return;
    }

    if (intent === "sign-up") {
      await signUpWithPassword(client, data);
      setAuthMessage("Account created. Check email confirmation if your Supabase project requires it.");
      form.reset();
      return;
    }

    if (intent === "magic-link") {
      await sendMagicLink(client, data);
      setAuthMessage("Magic link sent.");
      form.reset();
      return;
    }

    throw new Error(`Unknown auth form: ${intent ?? "unknown"}`);
  } catch (error) {
    setAuthMessage(errorMessage(error));
  }
}

async function signInWithPassword(client: SupabaseClient, data: FormData) {
  const email = readFormString(data, "email");
  const password = readFormString(data, "password", false);

  if (!email || !password) {
    throw new Error("Email and password are required.");
  }

  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    throw error;
  }
}

async function signUpWithPassword(client: SupabaseClient, data: FormData) {
  const email = readFormString(data, "email");
  const password = readFormString(data, "password", false);
  const fullName = readFormString(data, "full_name");
  const companyName = readFormString(data, "company_name");

  if (!email || !password || !fullName) {
    throw new Error("Email, full name, and password are required.");
  }

  const { error } = await client.auth.signUp({
    email,
    password,
    options: {
      data: {
        company_name: companyName,
        full_name: fullName
      },
      emailRedirectTo: customerRedirectUrl()
    }
  });

  if (error) {
    throw error;
  }
}

async function sendMagicLink(client: SupabaseClient, data: FormData) {
  const email = readFormString(data, "email");

  if (!email) {
    throw new Error("Email is required.");
  }

  const { error } = await client.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: customerRedirectUrl()
    }
  });

  if (error) {
    throw error;
  }
}

function bindSignOutControls(client: SupabaseClient | null) {
  document.querySelectorAll<HTMLButtonElement>("[data-auth-action='sign-out']").forEach((button) => {
    button.addEventListener("click", () => {
      if (!client) {
        setAuthMessage("Supabase Auth is not configured.");
        return;
      }

      void client.auth
        .signOut()
        .then(({ error }) => {
          if (error) {
            throw error;
          }
          setAuthMessage("Signed out.");
        })
        .catch((error) => setAuthMessage(errorMessage(error)));
    });
  });
}

function renderAuthSession(session: Session | null, verification?: "verifying" | "verified") {
  const signedIn = Boolean(session);
  const label = verification ?? (signedIn ? "signed in" : "signed out");
  const email = session?.user.email ?? "No customer signed in";
  document.body.dataset.authenticated = signedIn ? "true" : "false";
  setRealtimeStatus(signedIn ? "authenticated" : supabaseClient ? "configured" : "offline");

  authStatusEls.forEach((el) => {
    el.textContent = label;
    el.dataset.status = signedIn ? "active" : "offline";
  });

  authEmailEls.forEach((el) => {
    el.textContent = email;
  });
}

function bindMfaControls(client: SupabaseClient | null) {
  document.querySelectorAll<HTMLButtonElement>("[data-mfa-action]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!client) {
        setMfaMessage("Supabase Auth is not configured.");
        return;
      }

      const action = button.dataset.mfaAction;
      if (action === "enroll-totp") {
        void enrollTotp(client);
      } else if (action === "verify-totp") {
        void verifyTotp(client);
      }
    });
  });
}

function bindPasskeyControls(client: SupabaseClient | null) {
  document.querySelectorAll<HTMLButtonElement>("[data-passkey-action]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!client) {
        setAuthMessage("Supabase Auth is not configured.");
        return;
      }

      void handlePasskeyAction(client, button.dataset.passkeyAction ?? "", button);
    });
  });
}

async function handlePasskeyAction(client: SupabaseClient, action: string, button: HTMLButtonElement) {
  try {
    button.disabled = true;
    if (action === "sign-in") {
      await signInWithPasskey(client);
      return;
    }

    if (action === "register") {
      await registerPasskey(client);
      return;
    }

    throw new Error(`Unknown passkey action: ${action || "unknown"}`);
  } catch (error) {
    setAuthMessage(errorMessage(error));
  } finally {
    button.disabled = false;
  }
}

async function signInWithPasskey(client: SupabaseClient) {
  setAuthMessage("Starting passkey sign-in...");
  const { error } = await client.auth.signInWithPasskey();
  if (error) {
    throw error;
  }
  setAuthMessage("Signed in with passkey.");
}

async function registerPasskey(client: SupabaseClient) {
  setAuthMessage("Starting passkey registration...");
  const { data, error: userError } = await client.auth.getUser();
  if (userError || !data.user) {
    throw userError ?? new Error("Sign in before registering a passkey.");
  }

  const { error } = await client.auth.registerPasskey();
  if (error) {
    throw error;
  }
  setAuthMessage("Passkey registered.");
}

async function enrollTotp(client: SupabaseClient) {
  try {
    setMfaMessage("Starting 2FA enrollment...");
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData.user) {
      throw userError ?? new Error("Sign in before enrolling 2FA.");
    }

    const { data, error } = await client.auth.mfa.enroll({ factorType: "totp" });
    if (error) {
      throw error;
    }

    pendingMfaFactorId = data.id;
    if (mfaQrEl && data.totp.qr_code) {
      mfaQrEl.src = qrImageSource(data.totp.qr_code);
      mfaQrEl.hidden = false;
    }
    if (mfaSecretEl && data.totp.secret) {
      mfaSecretEl.textContent = data.totp.secret;
      mfaSecretEl.hidden = false;
    }

    setMfaState("pending verification");
    setMfaMessage("Scan the QR code and enter the authenticator code.");
  } catch (error) {
    setMfaMessage(errorMessage(error));
  }
}

async function verifyTotp(client: SupabaseClient) {
  try {
    const code = mfaCodeEl?.value.trim() ?? "";
    if (!pendingMfaFactorId) {
      throw new Error("Enroll TOTP before verification.");
    }
    if (!code) {
      throw new Error("Authenticator code is required.");
    }

    setMfaMessage("Verifying 2FA...");
    const challenge = await client.auth.mfa.challenge({ factorId: pendingMfaFactorId });
    if (challenge.error) {
      throw challenge.error;
    }

    const challengeId = challenge.data.id;
    const verification = await client.auth.mfa.verify({
      challengeId,
      code,
      factorId: pendingMfaFactorId
    });

    if (verification.error) {
      throw verification.error;
    }

    setMfaState("verified");
    setMfaMessage("2FA verified.");
    pendingMfaFactorId = null;
  } catch (error) {
    setMfaMessage(errorMessage(error));
  }
}

function bindApiKeyControls() {
  const form = document.querySelector<HTMLFormElement>("[data-api-key-form]");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    void createApiKey(form);
  });

  document.querySelectorAll<HTMLButtonElement>("[data-api-key-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const prefix = button.dataset.keyPrefix ?? "selected key";
      if (button.dataset.apiKeyAction === "revoke") {
        void revokeApiKey(prefix, button);
      } else {
        void rotateApiKey(prefix, button);
      }
    });
  });
}

// Bring up the @fiducia/sync stack for api_keys: the wasm reconcile core, a
// per-user IndexedDB store, and the sync client. Authoritative rows arrive only
// through the authenticated customer catch-up API. We deliberately do not
// subscribe the browser to raw api_keys CDC: RLS filters rows, not columns, and
// the database record contains server-only fields that are not part of the
// customer display contract. Best-effort: any failure (no wasm, no IndexedDB)
// leaves `apiKeySync` null and the view falls back to the plain fetch path.
async function setupApiKeySync(userId: string, orgId: string, generation: number): Promise<void> {
  if (!config.syncModuleUrl) {
    return;
  }

  try {
    const sync = (await import(/* @vite-ignore */ config.syncModuleUrl)) as SyncModule;
    const core = await sync.loadBrowserCore();
    const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const safeOrgId = orgId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const store = await sync.openStore(`fiducia-customer-${safeUserId}-${safeOrgId}`, ["api_keys"]);
    if (generation !== syncGeneration) {
      store.close();
      return;
    }
    const queue = sync.makeQueue(store);
    const client = sync.makeSyncClient({ store, queue, core });
    apiKeySync = { store, client };
  } catch (error) {
    apiKeySync = null;
    console.debug("api_keys sync unavailable; using fetch fallback:", errorMessage(error));
  }
}

// Guards against overlapping hydrations (initial load + a racing WS "open").
let hydratingApiKeys = false;

// The indexed catch-up endpoint (GET /api/customer/sync/api_keys?since=0 → the
// full authoritative snapshot). `since=0` so we get every row and can prune; the
// server orders by version and the query is index-backed. Returns null on any
// failure so the caller degrades gracefully.
async function fetchApiKeyCatchup(): Promise<CustomerApiKey[] | null> {
  try {
    const response = await fetch(resolveApiUrl("/api/customer/sync/api_keys?since=0"), {
      headers: await authHeaders()
    });
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as { rows?: CustomerApiKey[] };
    return Array.isArray(body.rows) ? body.rows : [];
  } catch {
    return null;
  }
}

// Render the table straight from IndexedDB (the local-first source of truth).
// Returns false when there is nothing stored yet, so callers can fall back.
async function renderApiKeysFromStore(): Promise<boolean> {
  if (!apiKeySync) {
    return false;
  }

  const body = apiKeyTableBody();
  if (!body) {
    return false;
  }

  const rows = (await apiKeySync.store.all("api_keys")) as CustomerApiKey[];
  if (!rows.length) {
    return false;
  }

  body.textContent = "";
  rows
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((row) => appendApiKeyRow(row, "append"));
  return true;
}

// Cold-start / reconnect hydration. The BFF returns a complete sanitized
// fiducia-auth snapshot; `prune: true` removes clean local rows absent from it.
async function hydrateApiKeys() {
  const body = apiKeyTableBody();
  if (!body || hydratingApiKeys) {
    return;
  }
  hydratingApiKeys = true;

  try {
    // Local-first: reconcile the authoritative snapshot through the sync client.
    if (apiKeySync) {
      const rows = await fetchApiKeyCatchup();
      if (rows) {
        await apiKeySync.client.hydrate("api_keys", rows, { prune: true });
        if (await renderApiKeysFromStore()) {
          setApiKeyMessage(`Loaded ${rows.length} customer API keys (local-first).`);
          return;
        }
      }
    }

    // If local sync is unavailable, render the same authoritative auth metadata
    // directly from the list endpoint.
    const listed = await getJson<ApiKeyListResponse>("/api/customer/api-keys");
    body.textContent = "";
    listed.api_keys.forEach((row) => appendApiKeyRow(row, "append"));
    setApiKeyMessage(`Loaded ${listed.api_keys.length} customer API keys.`);
  } catch (error) {
    setApiKeyMessage(`${errorMessage(error)} Showing server-rendered keys.`);
  } finally {
    hydratingApiKeys = false;
  }
}

async function createApiKey(form: HTMLFormElement) {
  const data = new FormData(form);
  const name = readFormString(data, "name") || "New key";
  const environment = readFormString(data, "environment") || "live";
  const scope = readFormString(data, "scope") || "requests:write";
  const requiresIdempotency = data.has("require_idempotency");

  try {
    setApiKeyMessage("Creating API key...");
    // The create endpoint mints + shows the secret once (and, DB-backed, persists
    // the row + returns its id/version).
    const created = await postJson<CreateApiKeyResponse>(
      "/api/customer/api-keys",
      {
        environment,
        name,
        require_idempotency: requiresIdempotency,
        scope
      },
      mutationIdempotencyKey("create-key")
    );

    if (!created.ok || !created.api_key) {
      throw new Error(created.error ?? "api_key_create_failed");
    }

    const key = created.api_key;
    // Creation is server-led by fiducia-auth. Store the returned sanitized row as
    // clean; the browser never writes the credential table directly.
    let rendered = false;
    if (apiKeySync) {
      try {
        await apiKeySync.store.put("api_keys", key.id, key, {
          version: key.version,
          dirty: false
        });
        rendered = await renderApiKeysFromStore();
      } catch (error) {
        console.debug("clean api_key store write failed:", errorMessage(error));
      }
    }
    if (!rendered) {
      appendApiKeyRow(key);
    }

    setApiKeyMessage(
      `${key.name} created. Secret is shown once: ${created.secret ?? "not returned"}.`
    );
    form.reset();
  } catch (error) {
    setApiKeyMessage(errorMessage(error));
  }
}

async function rotateApiKey(prefix: string, button: HTMLButtonElement) {
  try {
    button.disabled = true;
    setApiKeyMessage(`Rotating ${prefix}...`);
    const rotated = await postJson<RotateApiKeyResponse>(
      "/api/customer/api-keys/rotate",
      { prefix },
      mutationIdempotencyKey(`rotate-${prefix}`)
    );

    if (!rotated.ok) {
      throw new Error(rotated.error ?? "api_key_rotation_failed");
    }

    if (rotated.api_key && apiKeySync) {
      await apiKeySync.store.put("api_keys", rotated.api_key.id, rotated.api_key, {
        version: rotated.api_key.version,
        dirty: false
      });
      await renderApiKeysFromStore();
    } else if (rotated.api_key) {
      const row = button.closest("tr");
      row?.replaceWith(buildApiKeyRow(rotated.api_key));
    }

    const replacement = rotated.replacement_secret
      ? ` New secret (shown once): ${rotated.replacement_secret}.`
      : "";
    setApiKeyMessage(
      `${prefix} rotated with ${rotated.overlap_seconds ?? 0}s overlap.${replacement}`
    );
  } catch (error) {
    setApiKeyMessage(errorMessage(error));
  } finally {
    button.disabled = false;
  }
}

async function revokeApiKey(prefix: string, button: HTMLButtonElement) {
  try {
    button.disabled = true;
    setApiKeyMessage(`Revoking ${prefix}...`);
    const revoked = await postJson<RevokeApiKeyResponse>(
      "/api/customer/api-keys/revoke",
      { prefix },
      mutationIdempotencyKey(`revoke-${prefix}`)
    );
    if (!revoked.ok) {
      throw new Error(revoked.error ?? "api_key_revoke_failed");
    }
    if (apiKeySync) {
      await hydrateApiKeys();
    } else {
      const row = button.closest("tr");
      const status = row?.querySelector<HTMLElement>("[data-api-key-status]");
      if (status) {
        status.textContent = "revoked";
        status.className = "tag tag--error";
      }
      row?.querySelector<HTMLElement>("[data-api-key-actions]")?.replaceChildren(
        sessionMutedAction("Revoked")
      );
    }
    setApiKeyMessage(`${prefix} revoked.`);
  } catch (error) {
    button.disabled = false;
    setApiKeyMessage(errorMessage(error));
  }
}

function bindPreferenceControls() {
  const form = document.querySelector<HTMLFormElement>("[data-preference-form]");
  if (!form) {
    return;
  }

  hydratePreferences(form, null);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void savePreferences(form);
  });
}

async function savePreferences(form: HTMLFormElement) {
  const preferences = readPreferenceForm(form);
  const storageKey = preferenceStorageKey(activeSyncUserId ?? null);

  try {
    setPreferenceMessage("Saving preferences...");
    const saved = await putJson<SavePreferencesResponse>("/api/customer/preferences", preferences);
    if (!saved.ok || !saved.preferences) {
      throw new Error(saved.error ?? "preferences_save_failed");
    }

    window.localStorage.setItem(storageKey, JSON.stringify(saved.preferences));
    setPreferenceMessage("Preferences saved.");
  } catch (error) {
    window.localStorage.setItem(storageKey, JSON.stringify(preferences));
    setPreferenceMessage(`${errorMessage(error)} Local preference fallback saved.`);
  }
}

function readPreferenceForm(form: HTMLFormElement): CustomerPreferences {
  const data = new FormData(form);
  return {
    density: readFormString(data, "density"),
    notify_key_rotation: data.has("notify_key_rotation"),
    notify_lock_contention: data.has("notify_lock_contention"),
    notify_mfa: data.has("notify_mfa"),
    region: readFormString(data, "region"),
    timezone: readFormString(data, "timezone")
  };
}

function bindSecuritySessionControls() {
  const body = securitySessionTableBody();
  if (!body) {
    return;
  }

  void hydrateSecuritySessions();
  body.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || target.dataset.sessionAction !== "revoke") {
      return;
    }

    void revokeSecuritySession(target.dataset.sessionDevice ?? "", target);
  });
}

async function hydrateSecuritySessions() {
  const body = securitySessionTableBody();
  if (!body) {
    return;
  }

  try {
    const listed = await getJson<SessionListResponse>("/api/customer/security/sessions");
    body.textContent = "";
    listed.sessions.forEach((session) => appendSecuritySessionRow(session, listed.revoke_supported));
  } catch {
    // Keep the server-rendered fallback rows if the JSON endpoint is unavailable.
  }
}

async function revokeSecuritySession(device: string, button: HTMLButtonElement) {
  if (!device) {
    return;
  }

  try {
    button.disabled = true;
    const revoked = await postJson<RevokeSessionResponse>("/api/customer/security/sessions/revoke", { device });
    if (!revoked.ok) {
      throw new Error(revoked.error ?? "session_revoke_failed");
    }

    const row = button.closest("tr");
    const status = row?.querySelector<HTMLElement>("[data-session-status]");
    if (status) {
      status.textContent = revoked.status ?? "revoked";
      status.className = "tag tag--error";
    }
    button.replaceWith(sessionMutedAction("Revoked"));
  } catch (error) {
    button.disabled = false;
    button.textContent = errorMessage(error);
  }
}

function appendSecuritySessionRow(session: CustomerSession, revokeSupported: boolean) {
  const body = securitySessionTableBody();
  if (!body) {
    return;
  }

  const tr = document.createElement("tr");
  tr.append(
    tableCell(session.device),
    tableCell(session.location),
    tableCell(session.last_seen),
    statusCellWithHook(session.status, "sessionStatus"),
    sessionActionCell(session, revokeSupported)
  );
  body.append(tr);
}

function securitySessionTableBody() {
  return document.querySelector<HTMLTableSectionElement>("[data-security-sessions-table] tbody");
}

function sessionActionCell(session: CustomerSession, revokeSupported: boolean) {
  const cell = document.createElement("td");
  if (session.status === "verified") {
    cell.append(sessionMutedAction("Current"));
    return cell;
  }
  if (!revokeSupported) {
    cell.append(sessionMutedAction("Provider managed"));
    return cell;
  }

  const button = document.createElement("button");
  button.className = "table-action";
  button.dataset.sessionAction = "revoke";
  button.dataset.sessionDevice = session.device;
  button.type = "button";
  button.textContent = "Revoke";
  cell.append(button);
  return cell;
}

function sessionMutedAction(label: string) {
  const span = document.createElement("span");
  span.className = "muted";
  span.textContent = label;
  return span;
}

function hydratePreferencesForUser(userId: string | null) {
  const form = document.querySelector<HTMLFormElement>("[data-preference-form]");
  if (form) {
    hydratePreferences(form, userId);
  }
}

function hydratePreferences(form: HTMLFormElement, userId: string | null) {
  form.reset();
  const storageKey = preferenceStorageKey(userId);
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) {
    return;
  }

  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    setSelectValue(form, "region", value.region);
    setSelectValue(form, "timezone", value.timezone);
    setSelectValue(form, "density", value.density);
    setCheckboxValue(form, "notify_lock_contention", value.notify_lock_contention);
    setCheckboxValue(form, "notify_key_rotation", value.notify_key_rotation);
    setCheckboxValue(form, "notify_mfa", value.notify_mfa);
  } catch {
    window.localStorage.removeItem(storageKey);
  }
}

function preferenceStorageKey(userId: string | null) {
  const subject = userId?.replace(/[^a-zA-Z0-9_-]/g, "_") ?? "anonymous";
  return `fiducia.customer.preferences.${subject}`;
}

function setSelectValue(form: HTMLFormElement, name: string, value: unknown) {
  if (typeof value !== "string") {
    return;
  }

  const field = form.elements.namedItem(name);
  if (field instanceof HTMLSelectElement) {
    field.value = value;
  }
}

function setCheckboxValue(form: HTMLFormElement, name: string, value: unknown) {
  const field = form.elements.namedItem(name);
  if (field instanceof HTMLInputElement && typeof value === "boolean") {
    field.checked = value;
  }
}

// Attach the caller's Supabase session as a bearer token. The customer backend
// gates every /api/customer/* route on a verified session (fiducia-auth GET
// /v1/me) and scopes mutations to the caller's org, so these calls must carry it.
async function authHeaders(base: Record<string, string> = {}): Promise<Record<string, string>> {
  const headers = { ...base };
  if (activeSyncOrgId) {
    headers["x-fiducia-org-id"] = activeSyncOrgId;
  }
  if (supabaseClient) {
    try {
      const { data } = await supabaseClient.auth.getSession();
      const token = data.session?.access_token;
      if (token) {
        headers.authorization = `Bearer ${token}`;
      }
    } catch {
      // No session — send the request unauthenticated and let the server 401.
    }
  }
  return headers;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(resolveApiUrl(path), { headers: await authHeaders() });
  const value = (await response.json()) as T;

  if (!response.ok) {
    const error = isRecord(value) && typeof value.error === "string" ? value.error : response.statusText;
    throw new Error(error);
  }

  return value;
}

async function postJson<T>(path: string, payload: unknown, idempotencyKey?: string): Promise<T> {
  return requestJson<T>("POST", path, payload, idempotencyKey);
}

async function putJson<T>(path: string, payload: unknown): Promise<T> {
  return requestJson<T>("PUT", path, payload);
}

async function requestJson<T>(
  method: "POST" | "PUT",
  path: string,
  payload: unknown,
  idempotencyKey?: string
): Promise<T> {
  const baseHeaders: Record<string, string> = { "content-type": "application/json" };
  if (idempotencyKey) {
    baseHeaders["idempotency-key"] = idempotencyKey;
  }
  const response = await fetch(resolveApiUrl(path), {
    body: JSON.stringify(payload),
    headers: await authHeaders(baseHeaders),
    method
  });
  const value = (await response.json()) as T;

  if (!response.ok) {
    const error = isRecord(value) && typeof value.error === "string" ? value.error : response.statusText;
    throw new Error(error);
  }

  return value;
}

function mutationIdempotencyKey(operation: string) {
  const random = globalThis.crypto.randomUUID();
  return `customer-${operation.replace(/[^a-zA-Z0-9_-]/g, "_")}-${random}`;
}

function appendApiKeyRow(row: CustomerApiKey, mode: "append" | "prepend" = "prepend") {
  const body = apiKeyTableBody();
  if (!body) {
    return;
  }

  const tr = buildApiKeyRow(row);

  if (mode === "append") {
    body.append(tr);
  } else {
    body.prepend(tr);
  }
}

function buildApiKeyRow(row: CustomerApiKey) {
  const tr = document.createElement("tr");
  tr.append(
    tableCell(row.name),
    tableCell(row.prefix, "mono"),
    tableCell(row.scopes, "mono"),
    tableCell(row.last_used),
    statusCell(row.status),
    apiKeyActionCell(row.prefix, row.status === "active")
  );
  return tr;
}

function apiKeyTableBody() {
  return document.querySelector<HTMLTableSectionElement>("[data-api-keys-table] tbody");
}

function tableCell(text: string, className?: string) {
  const cell = document.createElement("td");
  cell.textContent = text;
  if (className) {
    cell.className = className;
  }
  return cell;
}

function statusCell(status: string) {
  return statusCellWithHook(status, "apiKeyStatus");
}

function statusCellWithHook(status: string, hook: "apiKeyStatus" | "sessionStatus") {
  const cell = document.createElement("td");
  const tag = document.createElement("span");
  tag.className = statusTagClass(status);
  tag.dataset[hook] = "";
  tag.textContent = status;
  cell.append(tag);
  return cell;
}

function statusTagClass(status: string) {
  if (["active", "rotated", "verified"].includes(status)) {
    return "tag tag--ok";
  }
  if (["revoked", "expired"].includes(status)) {
    return "tag tag--error";
  }
  return "tag tag--warn";
}

function apiKeyActionCell(prefix: string, canRotate: boolean) {
  const cell = document.createElement("td");
  cell.dataset.apiKeyActions = "";
  if (!canRotate) {
    cell.textContent = "—";
    return cell;
  }
  const rotateButton = document.createElement("button");
  rotateButton.className = "table-action";
  rotateButton.dataset.apiKeyAction = "rotate";
  rotateButton.dataset.keyPrefix = prefix;
  rotateButton.type = "button";
  rotateButton.textContent = "Rotate";
  rotateButton.addEventListener("click", () => {
    void rotateApiKey(prefix, rotateButton);
  });

  const revokeButton = document.createElement("button");
  revokeButton.className = "table-action";
  revokeButton.dataset.apiKeyAction = "revoke";
  revokeButton.dataset.keyPrefix = prefix;
  revokeButton.type = "button";
  revokeButton.textContent = "Revoke";
  revokeButton.addEventListener("click", () => {
    void revokeApiKey(prefix, revokeButton);
  });
  cell.append(rotateButton, document.createTextNode(" "), revokeButton);
  return cell;
}

function startBackendStream(value: CustomerConfig) {
  if ("WebSocket" in window) {
    startBackendWebSocket(value);
    return;
  }

  startBackendEventSource(value);
}

function startBackendWebSocket(value: CustomerConfig) {
  const socket = new WebSocket(resolveWebSocketUrl(value.backendWsPath));

  socket.addEventListener("open", () => {
    setBackendStatus("websocket");
  });

  socket.addEventListener("message", (event) => {
    handleBackendStreamMessage(event.data, "websocket");
  });

  socket.addEventListener("close", () => {
    setBackendStatus("reconnecting");
    window.setTimeout(() => startBackendEventSource(value), 1200);
  });

  socket.addEventListener("error", () => {
    setBackendStatus("error");
    socket.close();
  });
}

function startBackendEventSource(value: CustomerConfig) {
  if (!("EventSource" in window)) {
    setBackendStatus("offline");
    return;
  }

  const source = new EventSource(resolveHttpUrl(value.backendEventsPath));

  source.addEventListener("open", () => {
    setBackendStatus("sse");
  });

  source.addEventListener("fiducia-refresh", (event) => {
    handleBackendStreamMessage((event as MessageEvent).data, "sse");
  });

  source.addEventListener("error", () => {
    setBackendStatus("reconnecting");
  });
}

function handleBackendStreamMessage(data: unknown, transport: BackendStreamMessage["transport"]) {
  const parsed = parseBackendMessage(data);
  if (!parsed) {
    return;
  }

  setBackendStatus(transport === "websocket" ? "websocket" : "sse");
  applyStreamFragments(parsed.fragments);
  if (parsed.kind === "refresh" && activeSyncUserId && activeSyncOrgId) {
    void hydrateApiKeys();
  }
}

function parseBackendMessage(data: unknown): BackendStreamMessage | null {
  if (typeof data !== "string") {
    return null;
  }

  try {
    const value = JSON.parse(data) as BackendStreamMessage;
    if (isRecord(value) && value.event === "fiducia:refresh" && typeof value.sequence === "number") {
      return value;
    }
  } catch {
    return null;
  }

  return null;
}

function applyStreamFragments(fragments: StreamFragments | undefined) {
  if (!fragments) {
    return;
  }

  for (const [name, selector] of Object.entries(streamTargets)) {
    const html = fragments[name as keyof StreamFragments];
    const target = document.querySelector<HTMLElement>(selector);
    if (!html || !target) {
      continue;
    }

    target.innerHTML = html;
    target.dataset.lastSwapAt = new Date().toISOString();
    htmx.process(target);
  }
}

function readFormString(data: FormData, key: string, trim = true) {
  const value = data.get(key);
  if (typeof value !== "string") {
    return "";
  }

  return trim ? value.trim() : value;
}

function customerRedirectUrl() {
  return new URL("/", window.location.origin).toString();
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function disableSupabaseControls() {
  document.querySelectorAll<HTMLElement>("[data-requires-supabase]").forEach((el) => {
    if (
      el instanceof HTMLButtonElement ||
      el instanceof HTMLInputElement ||
      el instanceof HTMLSelectElement ||
      el instanceof HTMLTextAreaElement
    ) {
      el.disabled = true;
    }
  });
}

function setAuthMessage(message: string) {
  if (authMessageEl) {
    authMessageEl.textContent = message;
  }
}

function setOrgMessage(message: string) {
  if (orgMessageEl) {
    orgMessageEl.textContent = message;
  }
}

function setApiKeyMessage(message: string) {
  if (apiKeyMessageEl) {
    apiKeyMessageEl.textContent = message;
  }
}

function setPreferenceMessage(message: string) {
  if (preferenceMessageEl) {
    preferenceMessageEl.textContent = message;
  }
}

function setMfaMessage(message: string) {
  if (mfaMessageEl) {
    mfaMessageEl.textContent = message;
  }
}

function setMfaState(state: string) {
  mfaStateEls.forEach((el) => {
    el.textContent = state;
    el.dataset.status = state;
  });
}

function qrImageSource(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith("<svg")) {
    return `data:image/svg+xml;utf8,${encodeURIComponent(trimmed)}`;
  }

  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function setRealtimeStatus(status: string) {
  if (!statusEl) {
    return;
  }

  statusEl.textContent = status;
  statusEl.dataset.status = status;
}

function setBackendStatus(status: string) {
  if (!backendStatusEl) {
    return;
  }

  backendStatusEl.textContent = status;
  backendStatusEl.dataset.status = status;
}

function startFreshnessClock() {
  if (freshnessEls.length === 0) {
    return;
  }

  const tick = () => {
    const now = Date.now();
    freshnessEls.forEach((el) => {
      const at = el.dataset.freshnessClock;
      if (!at) {
        el.textContent = "fresh";
        return;
      }

      const age = Math.max(0, Math.round((now - Date.parse(at)) / 1000));
      el.textContent = age < 2 ? "fresh" : `${age}s`;
    });
  };

  tick();
  window.setInterval(tick, 1000);
}

function resolveHttpUrl(path: string) {
  return new URL(path, config.apiBase || window.location.origin).toString();
}

function resolveApiUrl(path: string) {
  return new URL(path, config.apiBase || window.location.origin).toString();
}

function resolveAuthUrl(path: string) {
  return new URL(path, config.authBase || config.apiBase || window.location.origin).toString();
}

function resolveWebSocketUrl(path: string) {
  const url = new URL(path, config.apiBase || window.location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}
