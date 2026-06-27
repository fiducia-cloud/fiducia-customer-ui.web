import "./styles.css";
import htmx from "htmx.org";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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
  customerHost: string;
  regions: FiduciaRegion[];
  supabaseUrl?: string;
  supabaseAnonKey?: string;
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

declare global {
  interface Window {
    FIDUCIA_CUSTOMER_CONFIG?: CustomerConfig;
    htmx?: typeof htmx;
  }
}

window.htmx = htmx;

const defaultConfig: CustomerConfig = {
  apiBase: "",
  customerHost: "app.fiducia.cloud",
  regions: ["auto", "iad1", "sfo1", "ams1", "fra1", "sin1", "syd1"]
};

const config = {
  ...defaultConfig,
  ...(window.FIDUCIA_CUSTOMER_CONFIG ?? {})
};

const statusEl = document.querySelector<HTMLElement>("[data-supabase-status]");
const eventsEl = document.querySelector<HTMLElement>("#realtime-events");
const freshnessEls = document.querySelectorAll<HTMLElement>("[data-freshness-clock]");

setRealtimeStatus(hasSupabaseConfig(config) ? "connecting" : "offline");
startFreshnessClock();
startRealtime(config);

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

function startRealtime(value: CustomerConfig) {
  if (!hasSupabaseConfig(value)) {
    return;
  }

  const client: SupabaseClient = createClient(value.supabaseUrl, value.supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

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
  htmx.trigger(document.body, "fiducia:refresh");
  appendEvent({
    topic,
    verb,
    at: new Date().toISOString(),
    value: coercePortalEvent(value)
  });
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
