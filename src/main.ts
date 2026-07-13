// Entry point for the Fiducia customer portal browser bundle: wires Supabase auth
// (password/passkey/2FA), the api_keys local-first sync vertical, preferences and
// session controls, and the backend WS/SSE + Supabase realtime event streams into
// the server-rendered HTMX shell.
import "./styles.css";
import htmx from "htmx.org";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import {
  connectBackend,
  loadBrowserCore,
  makeQueue,
  makeSyncClient,
  openStore,
  subscribeSupabase,
  type SyncChange,
  type SyncClient,
  type SyncStore
} from "@fiducia/sync";
import type {
  ElectionGetResponse,
  KvGetResponse,
  LockGrant,
  ProposeOutcome,
  ServiceListResponse
} from "@fiducia/interfaces/typescript";

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
  backendEventsPath: string;
  backendWsPath: string;
  customerHost: string;
  regions: FiduciaRegion[];
  supabaseUrl?: string;
  supabaseAnonKey?: string;
};

type CustomerApiKey = {
  name: string;
  prefix: string;
  scopes: string;
  last_used: string;
  status: string;
  // Assigned by PostgreSQL and used by the local-first sync store.
  id?: string;
  version?: number;
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
  error?: string;
  overlap_seconds?: number;
  prefix?: string;
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

type LockEvent = {
  kind: "lock";
  key: string;
  tenant: string;
  region: FiduciaRegion;
  grant: LockGrant;
  outcome?: ProposeOutcome;
};

type RequestEvent = {
  kind: "request";
  path: string;
  method: string;
  shard: number;
  region: FiduciaRegion;
  status: "committed" | "redirected" | "rejected";
  outcome?: ProposeOutcome;
};

type KvEvent = {
  kind: "kv";
  key: string;
  response: KvGetResponse;
};

type ServiceEvent = {
  kind: "service";
  response: ServiceListResponse;
};

type LeadershipEvent = {
  kind: "leadership";
  response: ElectionGetResponse;
};

type PortalEvent = LockEvent | RequestEvent | KvEvent | ServiceEvent | LeadershipEvent;

type StreamFragments = Partial<Record<"summary" | "locks" | "requests" | "kv" | "services", string>>;

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
  apiBase: "",
  backendEventsPath: "/app/events",
  backendWsPath: "/app/ws",
  customerHost: "app.fiducia.cloud",
  regions: ["auto", "iad1", "sfo1", "ams1", "fra1", "sin1", "syd1"]
};

const config = {
  ...defaultConfig,
  ...(window.FIDUCIA_CUSTOMER_CONFIG ?? {})
};

const supabaseClient = createSupabaseCustomerClient(config);
const statusEl = document.querySelector<HTMLElement>("[data-supabase-status]");
const backendStatusEl = document.querySelector<HTMLElement>("[data-backend-stream-status]");
const eventsEl = document.querySelector<HTMLElement>("#realtime-events");
const freshnessEls = document.querySelectorAll<HTMLElement>("[data-freshness-clock]");
const authStatusEls = document.querySelectorAll<HTMLElement>("[data-auth-status]");
const authEmailEls = document.querySelectorAll<HTMLElement>("[data-auth-email]");
const authMessageEl = document.querySelector<HTMLElement>("[data-auth-message]");
const apiKeyMessageEl = document.querySelector<HTMLElement>("[data-api-key-message]");
const preferenceMessageEl = document.querySelector<HTMLElement>("[data-preference-message]");
const mfaMessageEl = document.querySelector<HTMLElement>("[data-mfa-message]");
const mfaStateEls = document.querySelectorAll<HTMLElement>("[data-mfa-state]");
const mfaQrEl = document.querySelector<HTMLImageElement>("[data-mfa-qr]");
const mfaSecretEl = document.querySelector<HTMLElement>("[data-mfa-secret]");
const mfaCodeEl = document.querySelector<HTMLInputElement>("[data-mfa-code]");
const streamTargets: Record<keyof StreamFragments, string> = {
  summary: "#summary",
  locks: "#locks-panel",
  requests: "#requests-panel",
  kv: "#kv-panel",
  services: "#services-panel"
};

let backendStreamReady = false;
let pendingMfaFactorId: string | null = null;

// The local-first api_keys sync handle. Null until (and unless) the wasm reconcile
// core + IndexedDB store come up; when null the view falls back to the fetch path.
type ApiKeySyncHandle = { store: SyncStore; client: SyncClient };
let apiKeySync: ApiKeySyncHandle | null = null;

setBackendStatus("connecting");
setRealtimeStatus(supabaseClient ? "connecting" : "offline");
initializeAuth(supabaseClient);
bindApiKeyControls();
bindPreferenceControls();
bindSecuritySessionControls();
startFreshnessClock();
startBackendStream(config);
startRealtime(supabaseClient);

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

    renderAuthSession(data.session ?? null);
  });

  client.auth.onAuthStateChange((_event, session) => {
    renderAuthSession(session);
  });
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

function renderAuthSession(session: Session | null) {
  const signedIn = Boolean(session);
  const label = signedIn ? "signed in" : "signed out";
  const email = session?.user.email ?? "No customer signed in";
  document.body.dataset.authenticated = signedIn ? "true" : "false";

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
  // Bring up the local-first sync stack (best-effort) before the first hydrate so
  // the table can render from IndexedDB when the DB-backed path is live. Only when
  // the api-keys table is actually on the page.
  const ready = apiKeyTableBody() ? setupApiKeySync() : Promise.resolve();
  void ready.then(() => hydrateApiKeys());

  const form = document.querySelector<HTMLFormElement>("[data-api-key-form]");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    void createApiKey(form);
  });

  document.querySelectorAll<HTMLButtonElement>("[data-api-key-action='rotate']").forEach((button) => {
    button.addEventListener("click", () => {
      const prefix = button.dataset.keyPrefix ?? "selected key";
      void rotateApiKey(prefix, button);
    });
  });
}

// Bring up the @fiducia/sync stack for api_keys: the wasm reconcile core, a
// per-plane IndexedDB store, the sync client, and the backend WS/SSE subscription
// that folds committed `fiducia:sync` changes into the store. Best-effort: any
// failure (no wasm, no IndexedDB) leaves `apiKeySync` null and the view falls back
// to the plain fetch path, so the portal degrades gracefully and never throws.
async function setupApiKeySync(): Promise<void> {
  try {
    const core = await loadBrowserCore();
    const store = await openStore("fiducia-customer", ["api_keys"]);
    const queue = makeQueue(store);
    const client = makeSyncClient({ store, queue, core });
    apiKeySync = { store, client };

    // Transport 1: the backend WS/SSE (always available, carries `version`).
    // Re-hydrate on every (re)connect so a reconnect catches up on anything the
    // streams missed while the socket was down.
    connectBackend({
      baseUrl: location.origin,
      onChanges: (changes) => {
        void applyApiKeyChanges(changes);
      },
      onStatus: (status) => {
        if (status === "open") {
          void hydrateApiKeys();
        }
      }
    });

    // Transport 2: Supabase realtime, folded into the SAME reconcile client. Both
    // transports converge because reconcile is idempotent (a re-seen version is
    // ignored), so this is pure resilience — sync no longer depends on one channel.
    // Requires the synced tables to be in the supabase_realtime publication +
    // REPLICA IDENTITY FULL (see fiducia-interfaces sql/customer.sql).
    if (supabaseClient) {
      subscribeSupabase({
        client: supabaseClient,
        tables: ["api_keys"],
        onChange: (change) => {
          void applyApiKeyChanges([change]);
        }
      });
    }
    // The initial catch-up hydration is kicked off by the caller (bindApiKeyControls)
    // once setup resolves; reconnects re-hydrate via the WS onStatus "open" above.
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

// Fold committed changes (from the backend WS/SSE) into the local store, then
// re-render the table from the store. Guarded so a bad frame never surfaces as a
// page error.
async function applyApiKeyChanges(changes: SyncChange[]) {
  if (!apiKeySync) {
    return;
  }

  try {
    let touched = false;
    for (const change of changes) {
      if (change?.table !== "api_keys") {
        continue;
      }
      await apiKeySync.client.applyChange(change);
      touched = true;
    }
    if (touched) {
      await renderApiKeysFromStore();
    }
  } catch (error) {
    console.debug("applying api_keys changes failed:", errorMessage(error));
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

// Cold-start / reconnect catch-up. Runs on initial load and on every WS reconnect
// so changes that landed while this client was away show up immediately. Reentry
// is guarded (the initial call can race the first WS "open").
async function hydrateApiKeys() {
  const body = apiKeyTableBody();
  if (!body || hydratingApiKeys) {
    return;
  }
  hydratingApiKeys = true;

  try {
    // Local-first: reconcile the authoritative snapshot from the INDEXED catch-up
    // endpoint THROUGH the sync client. Unlike a raw store.put seed this goes via
    // reconcile — so un-acked optimistic edits survive, and `prune: true` drops
    // rows deleted server-side while we were away.
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

    // If IndexedDB/wasm sync is unavailable, render the authoritative HTTP list
    // directly; the server still reads PostgreSQL and fails closed on outages.
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
    const created = await postJson<CreateApiKeyResponse>("/api/customer/api-keys", {
      environment,
      name,
      require_idempotency: requiresIdempotency,
      scope
    });

    if (!created.ok || !created.api_key) {
      throw new Error(created.error ?? "api_key_create_failed");
    }

    const key = created.api_key;
    // Creation is server-led: the create endpoint already minted the row (version 1),
    // persisted it, and broadcast a `fiducia:sync` frame. So creation must NOT go
    // through optimisticWrite — that would upsert + broadcast a *second* time (the
    // create double-write). Instead, when the row is synced (has an id), write the
    // returned row straight into the local store as clean: the server-assigned
    // version, not dirty, and with no durable-queue entry. Then re-render from the
    // store. optimisticWrite stays reserved for future EDITS (rename, scope changes),
    // where the client leads the write. If the local sync stack is unavailable,
    // render the server-committed response directly.
    let rendered = false;
    if (apiKeySync && key.id) {
      try {
        await apiKeySync.store.put("api_keys", key.id, key, {
          version: key.version ?? 0,
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
    const rotated = await postJson<RotateApiKeyResponse>("/api/customer/api-keys/rotate", { prefix });

    if (!rotated.ok) {
      throw new Error(rotated.error ?? "api_key_rotation_failed");
    }

    const row = button.closest("tr");
    const status = row?.querySelector<HTMLElement>("[data-api-key-status]");
    if (status) {
      status.textContent = "rotated";
      status.className = "tag tag--ok";
    }

    setApiKeyMessage(`${prefix} rotated with ${rotated.overlap_seconds ?? 900}s overlap.`);
  } catch (error) {
    setApiKeyMessage(errorMessage(error));
  } finally {
    button.disabled = false;
  }
}

function bindPreferenceControls() {
  const form = document.querySelector<HTMLFormElement>("[data-preference-form]");
  if (!form) {
    return;
  }

  hydratePreferences(form);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void savePreferences(form);
  });
}

async function savePreferences(form: HTMLFormElement) {
  const preferences = readPreferenceForm(form);

  try {
    setPreferenceMessage("Saving preferences...");
    const saved = await putJson<SavePreferencesResponse>("/api/customer/preferences", preferences);
    if (!saved.ok || !saved.preferences) {
      throw new Error(saved.error ?? "preferences_save_failed");
    }

    window.localStorage.setItem("fiducia.customer.preferences", JSON.stringify(saved.preferences));
    setPreferenceMessage("Preferences saved.");
  } catch (error) {
    window.localStorage.setItem("fiducia.customer.preferences", JSON.stringify(preferences));
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
    listed.sessions.forEach((session) => appendSecuritySessionRow(session));
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

function appendSecuritySessionRow(session: CustomerSession) {
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
    sessionActionCell(session)
  );
  body.append(tr);
}

function securitySessionTableBody() {
  return document.querySelector<HTMLTableSectionElement>("[data-security-sessions-table] tbody");
}

function sessionActionCell(session: CustomerSession) {
  const cell = document.createElement("td");
  if (session.status === "verified") {
    cell.append(sessionMutedAction("Current"));
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

function hydratePreferences(form: HTMLFormElement) {
  const raw = window.localStorage.getItem("fiducia.customer.preferences");
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
    window.localStorage.removeItem("fiducia.customer.preferences");
  }
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

async function postJson<T>(path: string, payload: unknown): Promise<T> {
  return requestJson<T>("POST", path, payload);
}

async function putJson<T>(path: string, payload: unknown): Promise<T> {
  return requestJson<T>("PUT", path, payload);
}

async function requestJson<T>(method: "POST" | "PUT", path: string, payload: unknown): Promise<T> {
  const response = await fetch(resolveApiUrl(path), {
    body: JSON.stringify(payload),
    headers: await authHeaders({ "content-type": "application/json" }),
    method
  });
  const value = (await response.json()) as T;

  if (!response.ok) {
    const error = isRecord(value) && typeof value.error === "string" ? value.error : response.statusText;
    throw new Error(error);
  }

  return value;
}

function appendApiKeyRow(row: CustomerApiKey, mode: "append" | "prepend" = "prepend") {
  const body = apiKeyTableBody();
  if (!body) {
    return;
  }

  const tr = document.createElement("tr");
  tr.append(
    tableCell(row.name),
    tableCell(row.prefix, "mono"),
    tableCell(row.scopes, "mono"),
    tableCell(row.last_used),
    statusCell(row.status),
    apiKeyActionCell(row.prefix)
  );

  if (mode === "append") {
    body.append(tr);
  } else {
    body.prepend(tr);
  }
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

function apiKeyActionCell(prefix: string) {
  const cell = document.createElement("td");
  const button = document.createElement("button");
  button.className = "table-action";
  button.dataset.apiKeyAction = "rotate";
  button.dataset.keyPrefix = prefix;
  button.type = "button";
  button.textContent = "Rotate";
  button.addEventListener("click", () => {
    void rotateApiKey(prefix, button);
  });
  cell.append(button);
  return cell;
}

function startRealtime(client: SupabaseClient | null) {
  if (!client) {
    return;
  }

  client
    .channel("fiducia-customer-portal")
    .on("postgres_changes", { event: "*", schema: "public", table: "fiducia_locks" }, (payload) => {
      pushRealtimeEvent("Lock", payload.eventType, payload.new ?? payload.old);
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "fiducia_requests" }, (payload) => {
      pushRealtimeEvent("Request", payload.eventType, payload.new ?? payload.old);
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "fiducia_kv" }, (payload) => {
      pushRealtimeEvent("KV", payload.eventType, payload.new ?? payload.old);
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "fiducia_services" }, (payload) => {
      pushRealtimeEvent("Service", payload.eventType, payload.new ?? payload.old);
    })
    .subscribe((status) => {
      setRealtimeStatus(status.toLowerCase());
    });
}

function pushRealtimeEvent(topic: string, verb: string, value: unknown) {
  setRealtimeStatus("live");
  if (!backendStreamReady) {
    htmx.trigger(document.body, "fiducia:refresh");
  }
  appendEvent({
    topic,
    verb,
    at: new Date().toISOString(),
    value: coercePortalEvent(value)
  });
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
    backendStreamReady = true;
    setBackendStatus("websocket");
  });

  socket.addEventListener("message", (event) => {
    handleBackendStreamMessage(event.data, "websocket");
  });

  socket.addEventListener("close", () => {
    backendStreamReady = false;
    setBackendStatus("reconnecting");
    window.setTimeout(() => startBackendEventSource(value), 1200);
  });

  socket.addEventListener("error", () => {
    backendStreamReady = false;
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
    backendStreamReady = true;
    setBackendStatus("sse");
  });

  source.addEventListener("fiducia-refresh", (event) => {
    handleBackendStreamMessage((event as MessageEvent).data, "sse");
  });

  source.addEventListener("error", () => {
    backendStreamReady = false;
    setBackendStatus("reconnecting");
  });
}

function handleBackendStreamMessage(data: unknown, transport: BackendStreamMessage["transport"]) {
  const parsed = parseBackendMessage(data);
  if (!parsed) {
    return;
  }

  backendStreamReady = true;
  setBackendStatus(transport === "websocket" ? "websocket" : "sse");
  applyStreamFragments(parsed.fragments);
  appendEvent({
    topic: "Backend Stream",
    verb: parsed.kind,
    at: new Date(parsed.at_ms).toISOString(),
    value: {
      sequence: parsed.sequence,
      transport: parsed.transport,
      fragments: Object.keys(parsed.fragments ?? {})
    }
  });
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

function appendEvent(event: { topic: string; verb: string; at: string; value: unknown }) {
  if (!eventsEl) {
    return;
  }

  const item = document.createElement("article");
  item.className = "event-item";

  const meta = document.createElement("div");
  meta.className = "event-item__meta";
  meta.textContent = `${event.topic} ${event.verb} - ${formatClock(event.at)}`;

  const body = document.createElement("pre");
  body.textContent = JSON.stringify(event.value, null, 2);

  item.append(meta, body);
  eventsEl.prepend(item);

  while (eventsEl.children.length > 18) {
    eventsEl.lastElementChild?.remove();
  }
}

function coercePortalEvent(value: unknown): PortalEvent | unknown {
  if (!isRecord(value)) {
    return value;
  }

  if (value.kind === "lock" && typeof value.key === "string") {
    return value as LockEvent;
  }

  if (value.kind === "request" && typeof value.path === "string") {
    return value as RequestEvent;
  }

  if (value.kind === "kv" && typeof value.key === "string") {
    return value as KvEvent;
  }

  if (value.kind === "service") {
    return value as ServiceEvent;
  }

  if (value.kind === "leadership") {
    return value as LeadershipEvent;
  }

  return value;
}

function readFormString(data: FormData, key: string, trim = true) {
  const value = data.get(key);
  if (typeof value !== "string") {
    return "";
  }

  return trim ? value.trim() : value;
}

function customerRedirectUrl() {
  return new URL("/app", window.location.origin).toString();
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

function formatClock(iso: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(iso));
}

function resolveHttpUrl(path: string) {
  return new URL(path, window.location.origin).toString();
}

function resolveApiUrl(path: string) {
  return new URL(path, config.apiBase || window.location.origin).toString();
}

function resolveWebSocketUrl(path: string) {
  const url = new URL(path, window.location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}
