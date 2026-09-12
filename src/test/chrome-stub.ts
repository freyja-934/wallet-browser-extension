/**
 * In-memory `chrome` for node-environment unit tests. Tests call
 * `installChromeStub()` in `beforeEach`; nothing here is wired up globally.
 */

type Listener<Args extends unknown[]> = (...args: Args) => void;

export interface StubEvent<Args extends unknown[]> {
  addListener(listener: Listener<Args>): void;
  removeListener(listener: Listener<Args>): void;
  hasListener(listener: Listener<Args>): boolean;
  /** Test helper: invoke every registered listener. */
  emit(...args: Args): void;
  /** Test helper: registered listeners, in order. */
  listeners(): Listener<Args>[];
}

function makeEvent<Args extends unknown[]>(): StubEvent<Args> {
  const listeners = new Set<Listener<Args>>();
  return {
    addListener: (listener) => {
      listeners.add(listener);
    },
    removeListener: (listener) => {
      listeners.delete(listener);
    },
    hasListener: (listener) => listeners.has(listener),
    emit: (...args) => {
      for (const listener of [...listeners]) listener(...args);
    },
    listeners: () => [...listeners],
  };
}

export interface StorageChange {
  oldValue?: unknown;
  newValue?: unknown;
}

export type StorageChanges = Record<string, StorageChange>;

export interface StubStorageArea {
  get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  clear(): Promise<void>;
  onChanged: StubEvent<[StorageChanges]>;
  /** Test helper: a copy of everything stored. */
  snapshot(): Record<string, unknown>;
}

export interface CreatedWindow {
  id: number;
  options: Record<string, unknown>;
}

export interface SentTabMessage {
  tabId: number;
  message: unknown;
}

export interface ChromeStub {
  storage: {
    local: StubStorageArea;
    session: StubStorageArea;
    onChanged: StubEvent<[StorageChanges, string]>;
  };
  alarms: {
    create(name: string, info: Record<string, unknown>): Promise<void>;
    clear(name: string): Promise<boolean>;
    onAlarm: StubEvent<[{ name: string }]>;
    /** Test helper: alarms currently scheduled, by name. */
    scheduled(): Record<string, Record<string, unknown>>;
  };
  windows: {
    create(options: Record<string, unknown>): Promise<{ id: number }>;
    onRemoved: StubEvent<[number]>;
    /** Test helper: every `create` call so far, in order. */
    created(): CreatedWindow[];
  };
  tabs: {
    sendMessage(tabId: number, message: unknown): Promise<undefined>;
    onRemoved: StubEvent<[number]>;
    /** Test helper: every `sendMessage` call so far, in order. */
    sent(): SentTabMessage[];
  };
  runtime: {
    id: string;
    getURL(path: string): string;
    lastError: undefined;
    onMessage: StubEvent<[unknown, unknown, (response: unknown) => void]>;
    onConnect: StubEvent<[unknown]>;
    sendMessage(message: unknown): Promise<undefined>;
    /** Test helper: every `sendMessage` call so far, in order. */
    sent(): unknown[];
  };
  /** Wipe storage, alarms, and recorded calls; listeners stay registered. */
  reset(): void;
}

export const STUB_EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';

function makeStorageArea(areaName: string, global: StubEvent<[StorageChanges, string]>): StubStorageArea {
  let data = new Map<string, unknown>();
  const onChanged = makeEvent<[StorageChanges]>();

  const clone = <T>(value: T): T => (value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T));

  const fire = (changes: StorageChanges) => {
    if (Object.keys(changes).length === 0) return;
    onChanged.emit(changes);
    global.emit(changes, areaName);
  };

  const area: StubStorageArea = {
    async get(keys) {
      const out: Record<string, unknown> = {};
      if (keys === undefined || keys === null) {
        for (const [key, value] of data) out[key] = clone(value);
        return out;
      }
      if (typeof keys === 'string') {
        if (data.has(keys)) out[keys] = clone(data.get(keys));
        return out;
      }
      if (Array.isArray(keys)) {
        for (const key of keys) if (data.has(key)) out[key] = clone(data.get(key));
        return out;
      }
      for (const [key, fallback] of Object.entries(keys)) {
        out[key] = data.has(key) ? clone(data.get(key)) : fallback;
      }
      return out;
    },
    async set(items) {
      const changes: StorageChanges = {};
      for (const [key, value] of Object.entries(items)) {
        if (value === undefined) continue;
        const oldValue = data.get(key);
        data.set(key, clone(value));
        changes[key] = { oldValue: clone(oldValue), newValue: clone(value) };
      }
      fire(changes);
    },
    async remove(keys) {
      const changes: StorageChanges = {};
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        if (!data.has(key)) continue;
        changes[key] = { oldValue: clone(data.get(key)) };
        data.delete(key);
      }
      fire(changes);
    },
    async clear() {
      const changes: StorageChanges = {};
      for (const [key, value] of data) changes[key] = { oldValue: clone(value) };
      data = new Map();
      fire(changes);
    },
    onChanged,
    snapshot() {
      const out: Record<string, unknown> = {};
      for (const [key, value] of data) out[key] = clone(value);
      return out;
    },
  };
  return area;
}

export function createChromeStub(): ChromeStub {
  const storageChanged = makeEvent<[StorageChanges, string]>();
  const local = makeStorageArea('local', storageChanged);
  const session = makeStorageArea('session', storageChanged);

  let alarms = new Map<string, Record<string, unknown>>();
  let createdWindows: CreatedWindow[] = [];
  let sentTabMessages: SentTabMessage[] = [];
  let sentRuntimeMessages: unknown[] = [];
  let nextWindowId = 1;

  const stub: ChromeStub = {
    storage: { local, session, onChanged: storageChanged },
    alarms: {
      async create(name, info) {
        alarms.set(name, { ...info });
      },
      async clear(name) {
        return alarms.delete(name);
      },
      onAlarm: makeEvent<[{ name: string }]>(),
      scheduled: () => Object.fromEntries(alarms),
    },
    windows: {
      async create(options) {
        const id = nextWindowId;
        nextWindowId += 1;
        createdWindows.push({ id, options: { ...options } });
        return { id };
      },
      onRemoved: makeEvent<[number]>(),
      created: () => [...createdWindows],
    },
    tabs: {
      async sendMessage(tabId, message) {
        sentTabMessages.push({ tabId, message });
        return undefined;
      },
      onRemoved: makeEvent<[number]>(),
      sent: () => [...sentTabMessages],
    },
    runtime: {
      id: STUB_EXTENSION_ID,
      getURL: (path) => `chrome-extension://${STUB_EXTENSION_ID}/${path}`,
      lastError: undefined,
      onMessage: makeEvent<[unknown, unknown, (response: unknown) => void]>(),
      onConnect: makeEvent<[unknown]>(),
      async sendMessage(message) {
        sentRuntimeMessages.push(message);
        return undefined;
      },
      sent: () => [...sentRuntimeMessages],
    },
    reset() {
      void local.clear();
      void session.clear();
      alarms = new Map();
      createdWindows = [];
      sentTabMessages = [];
      sentRuntimeMessages = [];
      nextWindowId = 1;
    },
  };
  return stub;
}

/** Create a fresh stub and assign it to `globalThis.chrome`. Returns the stub for inspection. */
export function installChromeStub(): ChromeStub {
  const stub = createChromeStub();
  (globalThis as { chrome?: unknown }).chrome = stub;
  return stub;
}

/** Remove the stub from `globalThis`. */
export function uninstallChromeStub(): void {
  delete (globalThis as { chrome?: unknown }).chrome;
}
