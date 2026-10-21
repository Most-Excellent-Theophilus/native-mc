// src/lib/bucketFiles.ts
// Lists one "folder" of the selected bucket. Non-recursive, so big buckets stay
// fast: the sidebar asks for a folder only when the user opens it.

import { Command } from "@tauri-apps/plugin-shell";
import { appLocalDataDir, join } from "@tauri-apps/api/path";
import { ensureMc } from "$lib/comands";
import { settings } from "$lib/store/settings.svelte";
import { listBuckets } from "$lib/buckets";

export type Entry = {
  name: string;
  path: string; // key inside the bucket; folders end with "/"
  dir: boolean;
  size: number;
  modified?: string; // lastModified from mc
};

let scopePromise: Promise<string> | null = null;
const getScope = () => (scopePromise ??= ensureMc({ localOnly: true }));

/** alias/<path>. Paths start with the bucket name, e.g. "common/Screenshots/a.png". */
async function remote(path: string): Promise<string | null> {
  await settings.hydrated;
  const alias = settings.data.s3Alias;
  return alias && path ? `${alias}/${path}` : null;
}

/** The top level: one folder per available bucket. The private bucket opens straight
 *  into your own folder, because the policy only lets you list <personal>/<your user>/. */
async function listRoot(): Promise<Entry[]> {
  await settings.hydrated;
  const { s3Alias, s3AccessKey, personalBucket, backupBuckets } = settings.data;
  if (!s3Alias) return [];
  const names = await listBuckets();
  // Keep the saved list current, but only write when it changed.
  if (names.join("|") !== (backupBuckets ?? []).join("|")) {
    await settings.set("backupBuckets", names);
  }
  return names.map((name) => {
    const own = name === personalBucket && !!s3AccessKey;
    return {
      name: own ? `${name}/${s3AccessKey}` : name, // show the user path, don't hide it
      dir: true,
      size: 0,
      path: own ? `${name}/${s3AccessKey}/` : `${name}/`,
    };
  });
}

async function mc(args: string[]) {
  return Command.create(await getScope(), args).execute();
}

/** Every JSON object mc printed, on either stream. */
function jsonLines(text: string): any[] {
  const out: any[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* ignore */
    }
  }
  return out;
}

const failureOf = (r: { stdout: string; stderr: string }, fallback: string) =>
  jsonLines(`${r.stdout}\n${r.stderr}`).find((o) => o.status === "error")?.error?.message ??
  (r.stderr.trim().slice(0, 200) || fallback);

/** @param path "" for all buckets, or a folder such as "common/Screenshots/" */
export async function listDir(path = ""): Promise<Entry[]> {
  if (path === "") return listRoot();
  const target = await remote(path);
  if (!target) return [];

  const r = await mc(["ls", "--json", target]);

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
        entries.push({
          name,
          path: dir ? `${path}${name}/` : `${path}${name}`,
          dir,
          size: Number(o.size) || 0,
          modified: String(o.lastModified ?? ""),
        });
      }
    } catch {
      /* ignore non-JSON lines */
    }
  }

  if (r.code !== 0) throw new Error(failure || r.stderr.trim().slice(0, 200) || "Could not list the bucket");

  // Folders first, then A-Z.
  return entries.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
}

export type FileInfo = { size: number; contentType: string };

/** Files in the common bucket are shared. */
export const inCommon = (path: string) => path.startsWith(`${settings.data.commonBucket}/`);

/**
 * Everything in the common bucket lives under a folder named after the user who uploaded it
 * ("common/<user>/..."), so the uploader is read from the path: no extra request per file.
 * Returns "" for anything outside the common bucket or directly in its root.
 */
export function uploaderOf(path: string): string {
  if (!inCommon(path)) return "";
  const [, user, ...rest] = path.split("/");
  return user && (rest.length > 0 || path.endsWith("/")) ? user : "";
}

/** Size and content type of one object. */
export async function statFile(path: string): Promise<FileInfo> {
  const target = await remote(path);
  if (!target) throw new Error("Nothing selected");
  const r = await mc(["stat", "--json", target]);
  if (r.code !== 0) throw new Error(failureOf(r, "Could not read the file"));
  const o = jsonLines(r.stdout)[0] ?? {};
  const meta = o.metadata ?? {};
  return {
    size: Number(o.size) || 0,
    contentType: String(meta["Content-Type"] ?? meta["content-type"] ?? ""),
  };
}

/**
 * Copy an object into the app's cache folder with mc and return the local path.
 * mc already talks to your server successfully (ls/stat), so this avoids signed
 * links, CORS and proxy quirks. The caller deletes the file when it is done.
 */
export async function fetchToCache(path: string): Promise<string> {
  const target = await remote(path);
  if (!target) throw new Error("Nothing selected");
  const base = path.split("/").pop() || "file";
  const safe = base.replace(/[^A-Za-z0-9._-]/g, "_").slice(-80);
  const dest = await join(await appLocalDataDir(), "preview-cache", `${Date.now()}-${safe}`);
  await downloadTo(path, dest);
  return dest;
}

/** Copy an object to a local file path. */
export async function downloadTo(path: string, dest: string): Promise<void> {
  const target = await remote(path);
  if (!target) throw new Error("Nothing selected");
  const r = await mc(["cp", "--json", target, dest]);
  if (r.code !== 0) throw new Error(failureOf(r, "Download failed"));
}