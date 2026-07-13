// Runtime configuration for the independently deployed customer portal.
// Replace this file at deploy time; no rebuild is required. The Supabase anon
// key is intentionally browser-public. Never put service-role keys here.
window.FIDUCIA_CUSTOMER_CONFIG = {
  apiBase: "",
  authBase: "",
  backendEventsPath: "/app/events",
  backendWsPath: "/app/ws",
  customerHost: window.location.host,
  supabaseUrl: "",
  supabaseAnonKey: "",
  syncModuleUrl: ""
};
