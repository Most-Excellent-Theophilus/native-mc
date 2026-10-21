// src/lib/backup.svelte.ts
// Thin client for the Rust backup engine (src-tauri/src/backup.rs).
//
// The engine, the tray and the taskbar progress all live in the Rust process, so
// backups keep running when the window is hidden or closed to the tray. Each folder
// in the list is its own job in the engine; this module starts/stops/restores them
// and mirrors their snapshots into reactive state, keyed by the folder's id.
//
// Progress: totals are fixed when a round starts, so the bar only moves forward.
// It advances when each file finishes (mc does not report bytes mid-file).

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ensureMc, localMcPath } from "$lib/comands";
import {
  settings,
  type BackupSource,
  type BackupTarget,
} from "$lib/store/settings.svelte";
import { rightsFromPolicy } from "$lib/policyRights";
import policy from "$lib/backup-policy.json";

export type Phase =
  | "idle"
  | "starting"
  | "scanning"
  | "syncing"
  | "restoring"
  | "watching"
  | "done"
  | "error";

/** missing: only bring back what the folder lacks. full: make the folder match the backup. */
export type RestoreMode = "missing" | "full";

export type Change = {
  id: number;
  kind: "upload" | "remove" | "restore" | "error";
  path: string; // relative to the backed-up folder
  size: number;
  at: number; // epoch ms
};

export type RunOptions = {
  watch: boolean;
  removeDeleted: boolean;
  /** Minutes a file must stay unchanged before it is uploaded. */
  settleMinutes: number;
};

/** Mirrors `Snapshot` in backup.rs (camelCase). */
export type Snapshot = {
  phase: Phase;
  error: string;
  destination: string;
  settleMinutes: number;
  filesDone: number;
  filesTotal: number;
  bytesDone: number;
  bytesTotal: number;
  failed: number;
  percent: number;
  current: string[];
  pending: number;
  nextReadyAt: number | null;
  uploaded: number;
  removed: number;
  restored: number;
  failedTotal: number;
  changes: Change[];
};

const EMPTY: Snapshot = {
  phase: "idle",
  error: "",
  destination: "",
  settleMinutes: 0,
  filesDone: 0,
  filesTotal: 0,
  bytesDone: 0,
  bytesTotal: 0,
  failed: 0,
  percent: 0,
  current: [],
  pending: 0,
  nextReadyAt: null,
  uploaded: 0,
  removed: 0,
  restored: 0,
  failedTotal: 0,
  changes: [],
};

let jobs = $state<Record<string, Snapshot>>({});
let starting: Promise<void> | null = null;

const of = (id: string): Snapshot => jobs[id] ?? EMPTY;

const isActive = (s: Snapshot) =>
  s.phase === "starting" ||
  s.phase === "scanning" ||
  s.phase === "syncing" ||
  s.phase === "restoring" ||
  s.phase === "watching";

/** Folder name as a safe object prefix. */
function prefixFor(folder: string): string {
  const name = (folder.split(/[\\/]/).filter(Boolean).pop() ?? "").replace(
    /[^A-Za-z0-9._-]/g,
    "_",
  );
  return name || "backup";
}

/** A prefix not yet used by another folder going to the same bucket. */
export function uniquePrefix(
  folder: string,
  target: BackupTarget,
  sources: BackupSource[],
): string {
  const base = prefixFor(folder);
  const taken = new Set(
    sources.filter((s) => s.target === target).map((s) => s.prefix),
  );
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/**
 * Where a folder lands:
 *   private  <alias>/<personal bucket>/<your user>/<folder>   (the server only lets you into your own folder)
 *   common   <alias>/<common bucket>/<your user>/<folder>     (shared; the user folder shows who uploaded it)
 */
export function destinationFor(src: BackupSource): string {
  const s = settings.data;
  const base =
    src.target === "personal"
      ? `${s.s3Alias}/${s.personalBucket}/${s.s3AccessKey}`
      : `${s.s3Alias}/${s.commonBucket}/${s.s3AccessKey}`;
  return `${base}/${src.prefix}`;
}

/** Whether the signed-in account may delete from the buckets (read from the policy). */
export const canDelete =
  rightsFromPolicy(policy).find((r) => r.key === "delete")?.granted ?? false;

function currentOptions(): RunOptions {
  const s = settings.data;
  return {
    watch: s.backupWatch,
    removeDeleted: s.backupRemoveDeleted && canDelete,
    settleMinutes: s.backupSettleMinutes,
  };
}

/** Call once when the UI loads: subscribe to the engine and fetch its current state. */
function init(): Promise<void> {
  starting ??= (async () => {
    await listen<Snapshot & { id: string }>("backup-state", (e) => {
      const { id, ...snap } = e.payload;
      jobs[id] = snap;
    });
    jobs = await invoke<Record<string, Snapshot>>("backup_state");
  })();
  return starting;
}

async function toConfig(src: BackupSource, o: RunOptions) {
  return {
    id: src.id,
    folder: src.folder,
    destination: destinationFor(src),
    mcPath: await localMcPath(),
    watch: o.watch,
    removeDeleted: o.removeDeleted,
    settleMinutes: Math.max(0, Math.round(o.settleMinutes)),
  };
}

function setError(id: string, e: unknown) {
  jobs[id] = {
    ...of(id),
    phase: "error",
    error: e instanceof Error ? e.message : String(e),
  };
}

async function start(src: BackupSource, o: RunOptions = currentOptions()) {
  if (isActive(of(src.id))) return;
  try {
    await init();
    await settings.hydrated;
    await ensureMc({ localOnly: true }); // make sure the local mc exists
    await invoke("backup_start", { config: await toConfig(src, o) });
  } catch (e) {
    setError(src.id, e);
  }
}

/** Download from the bucket into the folder. The folder's backup pauses meanwhile. */
async function restore(
  src: BackupSource,
  mode: RestoreMode,
  o: RunOptions = currentOptions(),
) {
  try {
    await init();
    await settings.hydrated;
    await ensureMc({ localOnly: true });
    await invoke("backup_restore", { config: await toConfig(src, o), mode });
  } catch (e) {
    setError(src.id, e);
  }
}

async function stop(id: string): Promise<void> {
  await invoke("backup_stop", { id });
}

/** Take a folder out of the engine (the files in the bucket stay where they are). */
async function forget(id: string): Promise<void> {
  await invoke("backup_forget", { id });
  delete jobs[id];
}

async function startAll(): Promise<void> {
  await settings.hydrated;
  for (const src of settings.data.backupSources) await start(src);
}

async function stopAll(): Promise<void> {
  for (const src of settings.data.backupSources) {
    if (isActive(of(src.id))) await stop(src.id);
  }
}

/** Start every folder in the list with the saved options. */
async function startFromSettings(): Promise<void> {
  const s = settings.data;
  if (!s.s3Alias) return;
  await startAll();
}

const PHASE_RANK: Record<Phase, number> = {
  restoring: 6,
  syncing: 6,
  scanning: 5,
  starting: 4,
  watching: 3,
  error: 2,
  done: 1,
  idle: 0,
};

export const backup = {
  /** Snapshot of one folder's job. */
  of,
  isRunning: (id: string) => isActive(of(id)),
  /** Any folder backing up or restoring. */
  get running() {
    return Object.values(jobs).some(isActive);
  },
  /** The busiest phase across all folders. */
  get phase(): Phase {
    let best: Phase = "idle";
    for (const s of Object.values(jobs)) {
      if (PHASE_RANK[s.phase] > PHASE_RANK[best]) best = s.phase;
    }
    return best;
  },
  get error() {
    return Object.values(jobs).find((s) => s.error)?.error ?? "";
  },
  get percent() {
    const busy = Object.values(jobs).filter(
      (s) => s.phase === "syncing" || s.phase === "restoring",
    );
    const bytes = busy.reduce((n, s) => n + s.bytesTotal, 0);
    if (bytes > 0) {
      return Math.min(
        100,
        Math.round((busy.reduce((n, s) => n + s.bytesDone, 0) / bytes) * 100),
      );
    }
    const files = busy.reduce((n, s) => n + s.filesTotal, 0);
    return files > 0
      ? Math.min(
          100,
          Math.round((busy.reduce((n, s) => n + s.filesDone, 0) / files) * 100),
        )
      : 0;
  },
  /** Recent changes from every folder, newest first. `jobId` keeps keys unique across folders. */
  get changes(): (Change & { jobId: string })[] {
    return Object.entries(jobs)
      .flatMap(([jobId, s]) => s.changes.map((c) => ({ ...c, jobId })))
      .sort((a, b) => b.at - a.at)
      .slice(0, 50);
  },
  get counts() {
    const all = Object.values(jobs);
    return {
      uploaded: all.reduce((n, s) => n + s.uploaded, 0),
      removed: all.reduce((n, s) => n + s.removed, 0),
      restored: all.reduce((n, s) => n + s.restored, 0),
      failed: all.reduce((n, s) => n + s.failedTotal, 0),
    };
  },
  init,
  start,
  stop,
  restore,
  forget,
  startAll,
  stopAll,
  startFromSettings,
};