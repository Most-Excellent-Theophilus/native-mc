// src/lib/bucketFiles.ts
// Lists one "folder" of the selected bucket. Non-recursive, so big buckets stay
// fast: the sidebar asks for a folder only when the user opens it.

import { Command } from "@tauri-apps/plugin-shell";
import { ensureMc } from "$lib/comands";
import { settings } from "$lib/store/settings.svelte";

export type Entry = {
  name: string;
  path: string; // key inside the bucket; folders end with "/"
  dir: boolean;
  size: number;
};

let scopePromise: Promise<string> | null = null;
const getScope = () => (scopePromise ??= ensureMc({ localOnly: true }));

/** @param path "" for the bucket root, or a folder key such as "Screenshots/" */
export async function listDir(path = ""): Promise<Entry[]> {
  const { s3Alias: alias, backupBucket: bucket } = settings.data;
  if (!alias || !bucket) return [];

  const scope = await getScope();
  const r = await Command.create(scope, ["ls", "--json", `${alias}/${bucket}/${path}`]).execute();

  const entries: Entry[] = [];
  let failure = "";
  for (const line of `${r.stdout}\n${r.stderr}`.split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const o = JSON.parse(line);
      if (o.status === "error") {
        failure = o.error?.message ?? "Listing failed";
      } else if (o.status === "success" && o.key) {
        const dir = o.type === "folder" || String(o.key).endsWith("/");
        const name = String(o.key).replace(/\/$/, "");
        entries.push({ name, path: dir ? `${path}${name}/` : `${path}${name}`, dir, size: Number(o.size) || 0 });
      }
    } catch {
      /* ignore non-JSON lines */
    }
  }

  if (r.code !== 0) throw new Error(failure || r.stderr.trim().slice(0, 200) || "Could not list the bucket");

  // Folders first, then A-Z.
  return entries.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
}