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