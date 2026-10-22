// lib/stores/tauri-store.svelte.ts
import { load, type Store } from '@tauri-apps/plugin-store';

export function createTypedStore<Schema extends Record<string, unknown>>(
  filename: string,
  defaults: Schema,
) {
  type Key = keyof Schema & string;

  let data = $state<Schema>(structuredClone(defaults));
  let ready = $state(false);

  const storeReady: Promise<Store> = load(filename, {
    autoSave: false,
    defaults,
  });

  // Writes that land before hydration finishes must not be clobbered when
  // hydrate() later overwrites `data` wholesale. Track them and replay them
  // over the hydrated snapshot.
  const pendingWrites = new Map<Key, Schema[Key]>();

  async function hydrate(): Promise<void> {
    const store = await storeReady;
    const next = structuredClone(defaults);

    for (const key of Object.keys(defaults) as Key[]) {
      if (await store.has(key)) {
        next[key] = (await store.get<Schema[Key]>(key)) as Schema[Key];
      }
    }

    // Anything set() while we were hydrating wins over what was on disk.
    for (const [key, value] of pendingWrites) {
      next[key] = value;
    }
    pendingWrites.clear();

    data = next;
    ready = true;
  }

  // Exposed so callers that must not proceed on stale defaults (root layout,
  // anything reading serverIp before first render) can `await`.
  const hydrated: Promise<void> = hydrate();

  async function set<K extends Key>(key: K, value: Schema[K]): Promise<void> {
    data = { ...data, [key]: value };
    if (!ready) pendingWrites.set(key, value);

    const store = await storeReady;
    await store.set(key, value);
    await store.save();
  }

  async function update<K extends Key>(
    key: K,
    updater: (current: Schema[K]) => Schema[K],
  ): Promise<void> {
    await set(key, updater(data[key]));
  }

  async function del<K extends Key>(key: K): Promise<void> {
    const store = await storeReady;
    await store.delete(key);
    await store.save();
    pendingWrites.delete(key);
    data = { ...data, [key]: structuredClone(defaults[key]) };
  }

  async function clear(): Promise<void> {
    const store = await storeReady;
    await store.clear();
    await store.save();
    pendingWrites.clear();
    data = structuredClone(defaults);
  }

  return {
    get data() {
      return data;
    },
    get ready() {
      return ready;
    },
    hydrated,

    get<K extends Key>(key: K): Schema[K] {
      return data[key];
    },

    set,
    update,
    delete: del,
    clear,
    hydrate,
  };
}

/** Small stable hash, so two ids that sanitize alike still get different files. */
function hash32(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** `settings-user-<safe name>-<hash>.json`; never contains path characters. */
export function userFileName(userId: string): string {
  const safe = userId.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 40) || "guest";
  return `settings-user-${safe}-${hash32(userId)}.json`;
}

/**
 * Settings split in two:
 *  - device: shared by everyone on this computer (server address, who is signed in)
 *  - user:   private to the signed-in user, kept in their own file
 *
 * Reads and writes look like one flat store. The user part follows
 * `device[userIdKey]`: sign in as someone else and you get their settings, sign
 * out and you get the (empty) "guest" ones. Nobody sees another user's folders,
 * buckets or options.
 */
export function createScopedStore<
  D extends Record<string, unknown>,
  U extends Record<string, unknown>,
>(opts: { deviceFile: string; device: D; user: U; userIdKey: keyof D & string }) {
  type DKey = keyof D & string;
  type UKey = keyof U & string;
  type All = D & U;
  type Key = DKey | UKey;

  const GUEST = "guest";
  const deviceStore = createTypedStore(opts.deviceFile, opts.device);
  const userStores = new Map<string, ReturnType<typeof createTypedStore<U>>>();
  const userKeys = Object.keys(opts.user) as UKey[];
  const isUserKey = (k: string): k is UKey => k in opts.user;

  const idNow = () => String(deviceStore.data[opts.userIdKey] ?? "");

  function storeFor(userId: string) {
    const scope = userId || GUEST;
    let st = userStores.get(scope);
    if (!st) {
      st = createTypedStore(userFileName(scope), opts.user);
      userStores.set(scope, st);
    }
    return st;
  }
  const current = () => storeFor(idNow());

  /**
   * Earlier versions kept everything in one file. Hand the personal keys to the
   * user who was signed in at upgrade time, then remove them from the shared file
   * so nobody else inherits them.
   */
  async function migrateLegacy(userId: string): Promise<void> {
    if (!userId) return;
    const raw = await load(opts.deviceFile, { autoSave: false, defaults: {} });
    const found: Partial<U> = {};
    for (const k of userKeys) {
      if (await raw.has(k)) found[k] = (await raw.get(k)) as U[UKey];
    }
    const present = userKeys.filter((k) => k in found);
    if (present.length === 0) return;

    const target = storeFor(userId);
    await target.hydrated;
    for (const k of present) await target.set(k, found[k] as U[typeof k]);
    for (const k of present) await raw.delete(k);
    await raw.save();
  }

  // Resolves once the device settings AND the signed-in user's settings are loaded.
  const hydrated: Promise<void> = (async () => {
    await deviceStore.hydrated;
    await migrateLegacy(idNow());
    await current().hydrated;
  })();

  async function set<K extends Key>(key: K, value: All[K]): Promise<void> {
    if (key === opts.userIdKey) {
      // Load the new user's settings first, so the switch never flashes defaults.
      await storeFor(String(value ?? "")).hydrated;
      return deviceStore.set(key as DKey, value as D[DKey]);
    }
    if (isUserKey(key)) return current().set(key, value as U[UKey]);
    return deviceStore.set(key as DKey, value as D[DKey]);
  }

  return {
    /** Device settings merged with the signed-in user's settings. */
    get data(): All {
      return { ...deviceStore.data, ...current().data } as All;
    },
    get ready(): boolean {
      return deviceStore.ready && current().ready;
    },
    /** Id of the user whose private settings are active ("" = guest). */
    get userId(): string {
      return idNow();
    },
    hydrated,

    get<K extends Key>(key: K): All[K] {
      return (isUserKey(key) ? current().data[key] : deviceStore.data[key as DKey]) as All[K];
    },
    set,
    async update<K extends Key>(key: K, updater: (cur: All[K]) => All[K]): Promise<void> {
      await set(key, updater(this.get(key)));
    },
    async delete<K extends Key>(key: K): Promise<void> {
      if (isUserKey(key)) return current().delete(key);
      return deviceStore.delete(key as DKey);
    },
    /** Resets the device settings and the signed-in user's settings. */
    async clear(): Promise<void> {
      await current().clear();
      await deviceStore.clear();
    },
    async hydrate(): Promise<void> {
      await deviceStore.hydrate();
      await current().hydrate();
    },
  };
}
