// Ambient types for the untyped `@fiducia/sync` SDK (plain .mjs with JSDoc). Just
// enough surface for the api_keys local-first vertical to typecheck under strict.
declare module "@fiducia/sync" {
  export interface SyncStore {
    get(table: string, id: string): Promise<unknown>;
    meta(table: string, id: string): Promise<{ version: number; dirty: boolean } | null>;
    put(
      table: string,
      id: string,
      row: unknown,
      meta: { version: number; dirty?: boolean }
    ): Promise<void>;
    setMeta(table: string, id: string, meta: { version?: number; dirty?: boolean }): Promise<boolean>;
    del(table: string, id: string): Promise<void>;
    all(table: string): Promise<unknown[]>;
    close(): void;
  }

  export interface SyncQueue {
    enqueue(write: unknown): Promise<number>;
    list(): Promise<unknown[]>;
    remove(seq: number): Promise<void>;
    bumpAttempts(seq: number): Promise<number>;
  }

  export interface SyncChange {
    table: string;
    op: "upsert" | "delete";
    id: string;
    version: number;
    row?: unknown;
    at_ms?: number;
  }

  export interface SyncAck {
    id: string;
    committed_version: number;
  }

  export interface SyncClient {
    applyChange(event: SyncChange): Promise<string>;
    optimisticWrite(
      table: string,
      id: string,
      row: unknown,
      send: (write: unknown) => Promise<SyncAck>
    ): Promise<{ status: string; version?: number; error?: string }>;
    flushQueue(send: (write: unknown) => Promise<SyncAck>): Promise<void>;
  }

  export function openStore(dbName: string, tables: string[]): Promise<SyncStore>;
  export function makeQueue(store: SyncStore): SyncQueue;
  export function loadBrowserCore(): Promise<unknown>;
  export function makeSyncClient(deps: {
    store: SyncStore;
    queue: SyncQueue;
    core: unknown;
  }): SyncClient;
  export function connectBackend(opts: {
    baseUrl: string;
    wsPath?: string;
    ssePath?: string;
    onChanges: (changes: SyncChange[]) => void;
    getToken?: () => string | Promise<string | null>;
    onStatus?: (status: string) => void;
  }): { stop(): void };
  export function backendSend(
    baseUrl: string,
    write: unknown,
    opts?: { pathPrefix?: string; getToken?: () => string | Promise<string | null>; idempotencyKey?: string }
  ): Promise<SyncAck>;
  export function subscribeSupabase(opts: {
    client: unknown;
    tables: string[];
    onChange: (change: SyncChange) => void;
    channelName?: string;
    filter?: string | Record<string, string>;
    onStatus?: (status: string, err?: Error) => void;
  }): { stop(): void };
}
