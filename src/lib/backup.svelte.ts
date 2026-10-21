// src/lib/backup.svelte.ts
// Thin client for the Rust backup engine (src-tauri/src/backup.rs).
//
// The engine, the tray and the taskbar progress all live in the Rust process, so
// the backup keeps running when the window is hidden or closed to the tray. This
// module only starts/stops it and mirrors its snapshot into reactive state.
//
// Progress: totals are fixed when a round starts, so the bar only moves forward.
// It advances when each file finishes (mc does not report bytes mid-file).

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ensureMc, localMcPath } from "$lib/comands";
import { settings } from "$lib/store/settings.svelte";

export type Phase =
  | "idle"
  | "starting"
  | "scanning"
  | "syncing"
  | "watching"
  | "done"
  | "error";

export type Change = {
  id: number;
  kind: "upload" | "remove" | "error";
  path: string; // relative to the backed-up folder
  size: number;
  at: number; // epoch ms
};

export type StartOptions = {
  folder: string;
  alias: string;
  bucket: string;
  watch: boolean;
  removeDeleted: boolean;
  /** Minutes a file must stay unchanged before it is uploaded. */
  settleMinutes: number;
};

/** Mirrors `Snapshot` in backup.rs (camelCase). */
type Snapshot = {
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
  failedTotal: 0,
  changes: [],
};

let snap = $state<Snapshot>({ ...EMPTY });
let starting: Promise<void> | null = null;

const isRunning = () =>
  snap.phase === "starting" ||
  snap.phase === "scanning" ||
  snap.phase === "syncing" ||
  snap.phase === "watching";

/** Folder name as a safe object prefix, so different folders don't mix in one bucket. */
function prefixFor(folder: string): string {
  const name = (folder.split(/[\\/]/).filter(Boolean).pop() ?? "")
    .replace(/[^A-Za-z0-9._-]/g, "_");
  return name || "backup";
}

/** Call once when the UI loads: subscribe to the engine and fetch its current state. */
function init(): Promise<void> {
  starting ??= (async () => {
    await listen<Snapshot>("backup-state", (e) => (snap = e.payload));
    snap = await invoke<Snapshot>("backup_state");
  })();
  return starting;
}

async function start(o: StartOptions): Promise<void> {
  if (isRunning()) return;
  try {
    await init();
    await settings.hydrated;
    await ensureMc({ localOnly: true }); // make sure the local mc exists
    const destination = `${o.alias}/${o.bucket}/${settings.data.s3AccessKey}/${prefixFor(o.folder)}`;
    await invoke("backup_start", {
      config: {
        folder: o.folder,
        destination,
        mcPath: await localMcPath(),
        watch: o.watch,
        removeDeleted: o.removeDeleted,
        settleMinutes: Math.max(0, Math.round(o.settleMinutes)),
      },
    });
  } catch (e) {
    snap = {
      ...snap,
      phase: "error",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function stop(): Promise<void> {
  await invoke("backup_stop");
}

/** Start with whatever the card last saved. */
async function startFromSettings(): Promise<void> {
  await settings.hydrated;
  const s = settings.data;
  if (!s.backupFolder || !s.backupBucket || !s.s3Alias) return;
  await start({
    folder: s.backupFolder,
    alias: s.s3Alias,
    bucket: s.backupBucket,
    watch: s.backupWatch,
    removeDeleted: s.backupRemoveDeleted,
    settleMinutes: s.backupSettleMinutes,
  });
}

export const backup = {
  get phase() {
    return snap.phase;
  },
  get running() {
    return isRunning();
  },
  get error() {
    return snap.error;
  },
  get progress() {
    return {
      files: snap.filesDone,
      totalFiles: snap.filesTotal,
      bytes: snap.bytesDone,
      totalBytes: snap.bytesTotal,
      failed: snap.failed,
    };
  },
  get percent() {
    return snap.percent;
  },
  get changes() {
    return snap.changes;
  },
  get counts() {
    return {
      uploaded: snap.uploaded,
      removed: snap.removed,
      failed: snap.failedTotal,
    };
  },
  get destination() {
    return snap.destination;
  },
  /** Files waiting out the settle delay. */
  get pending() {
    return snap.pending;
  },
  /** Epoch ms when the first waiting file becomes eligible, or null. */
  get nextReadyAt() {
    return snap.nextReadyAt;
  },
  /** Files being uploaded right now. */
  get current() {
    return snap.current;
  },
  init,
  start,
  stop,
  startFromSettings,
};
