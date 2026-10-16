// src/lib/backup.svelte.ts
// Runs `mc mirror` (optionally --watch) as a child process and turns its JSON
// output into reactive state for the card and the tray.
//
// State lives at module level, so it survives navigating between pages and the
// backup keeps running while the card is not on screen.
//
// Progress granularity: `mc mirror --json` prints one line per finished object,
// so progress moves per file, not per byte (a single huge file jumps at the end).

import { Command, type Child } from "@tauri-apps/plugin-shell";
import { ensureMc } from "$lib/comands";
import { settings } from "$lib/store/settings.svelte";
import { initTray, setTrayStatus } from "$lib/tray";

export type Phase =
  | "idle"
  | "starting"
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
};

const MAX_CHANGES = 50;
const FIRST_IDLE_MS = 4000; // no output after start: nothing to copy, go straight to watching
const IDLE_MS = 1500; // quiet this long after a burst: the burst is finished

const ZERO = { files: 0, totalFiles: 0, bytes: 0, totalBytes: 0, failed: 0 };

let phase = $state<Phase>("idle");
let error = $state("");
let progress = $state({ ...ZERO });
let changes = $state<Change[]>([]);
let counts = $state({ uploaded: 0, removed: 0, failed: 0 });
let destination = $state("");

let child: Child | null = null;
let stopping = false;
let watching = false;
let folderRoot = "";
let lastStderr = "";
let nextId = 1;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let trayTimer: ReturnType<typeof setTimeout> | undefined;
let trayAt = 0;
let trayStarted: Promise<void> | null = null;
let resumed = false;

const isRunning = () =>
  phase === "starting" || phase === "syncing" || phase === "watching";

function percent(): number {
  const p = progress;
  if (p.totalBytes > 0)
    return Math.min(100, Math.round((p.bytes / p.totalBytes) * 100));
  if (p.totalFiles > 0)
    return Math.min(100, Math.round((p.files / p.totalFiles) * 100));
  return 0;
}

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** Folder name as a safe object prefix, so different folders don't mix in one bucket. */
function prefixFor(folder: string): string {
  const name = baseName(folder).replace(/[^A-Za-z0-9._-]/g, "_");
  return name || "backup";
}

/** Strip the local folder or the remote destination so the card shows short paths. */
function relative(path: string): string {
  for (const root of [folderRoot, destination]) {
    if (root && path.startsWith(root))
      return path.slice(root.length).replace(/^[\\/]+/, "") || baseName(path);
  }
  return path;
}

// ---------- tray ----------

function trayText(): string {
  const last = changes[0];
  switch (phase) {
    case "starting":
      return "Backup: starting…";
    case "syncing":
      return `Backing up ${percent()}% (${progress.files}/${progress.totalFiles} files)`;
    case "watching":
      return last
        ? `Watching · last: ${baseName(last.path)}`
        : "Watching for changes";
    case "done":
      return "Backup complete";
    case "error":
      return "Backup error";
    default:
      return "Backup idle";
  }
}

function syncTray(force = false) {
  const now = Date.now();
  // Throttle: a burst of files would otherwise flood the tray with IPC calls.
  if (!force && now - trayAt < 400) {
    trayTimer ??= setTimeout(() => {
      trayTimer = undefined;
      syncTray(true);
    }, 400);
    return;
  }
  trayAt = now;
  setTrayStatus({
    text: trayText(),
    title: phase === "syncing" ? `${percent()}%` : "",
    running: isRunning(),
  }).catch(() => {});
}

function setPhase(p: Phase) {
  phase = p;
  syncTray(true);
}

function ensureTray(): Promise<void> {
  // A missing tray (e.g. Linux without AppIndicator) must never block the backup.
  trayStarted ??= initTray({
    shouldHide: () => isRunning(),
    onToggle: () => (isRunning() ? void stop() : void startFromSettings()),
  }).catch((e) => console.warn("Tray unavailable:", e));
  return trayStarted;
}

// ---------- mc output ----------

function armIdle(ms: number) {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!watching) return;
    const settled = progress.files + progress.failed >= progress.totalFiles;
    if (phase === "starting" || (phase === "syncing" && settled)) {
      progress = { ...ZERO };
      setPhase("watching");
    }
  }, ms);
}

function pushChange(kind: Change["kind"], path: string, size = 0) {
  changes = [
    { id: nextId++, kind, path: relative(path), size, at: Date.now() },
    ...changes,
  ].slice(0, MAX_CHANGES);
}

function onLine(raw: string) {
  const line = raw.trim();
  if (!line.startsWith("{")) {
    if (line) lastStderr = line;
    return;
  }
  let m: any;
  try {
    m = JSON.parse(line);
  } catch {
    return;
  }

  if (m.status === "error") {
    const msg = m.error?.message ?? "Unknown error";
    counts.failed++;
    progress.failed++;
    progress.totalFiles = Math.max(
      progress.totalFiles,
      progress.files + progress.failed,
    );
    pushChange("error", m.source ?? m.target ?? msg);
    lastStderr = msg;
  } else if (m.status === "success") {
    if (phase === "starting" || phase === "watching") setPhase("syncing");

    if (m.source) {
      // Copied an object.
      const size = Number(m.size) || 0;
      progress.files++;
      progress.bytes += size;
      counts.uploaded++;
      pushChange("upload", m.source, size);
    } else if (m.target) {
      // No source: a deletion mirrored to the bucket (--remove).
      counts.removed++;
      pushChange("remove", m.target);
    }
    progress.totalFiles = Math.max(
      Number(m.totalCount) || 0,
      progress.totalFiles,
      progress.files + progress.failed,
    );
    progress.totalBytes = Math.max(
      Number(m.totalSize) || 0,
      progress.totalBytes,
      progress.bytes,
    );
  } else {
    return;
  }

  syncTray();
  armIdle(IDLE_MS);
}

function fail(message: string) {
  clearTimeout(idleTimer);
  error = message;
  child = null;
  setPhase("error");
  void settings.set("backupActive", false);
}

function onClose(code: number | null) {
  clearTimeout(idleTimer);
  child = null;
  if (stopping) return;
  if (code === 0 && !watching) {
    progress.files = progress.totalFiles = Math.max(
      progress.files,
      progress.totalFiles,
    );
    setPhase("done");
    void settings.set("backupActive", false);
  } else {
    fail(lastStderr || `mc exited with code ${code}`);
  }
}

// ---------- public API ----------

async function start(o: StartOptions): Promise<void> {
  if (child || phase === "starting") return;

  error = "";
  lastStderr = "";
  stopping = false;
  progress = { ...ZERO };
  changes = [];
  counts = { uploaded: 0, removed: 0, failed: 0 };
  watching = o.watch;
  folderRoot = o.folder;
  setPhase("starting");

  try {
    void ensureTray();
    await settings.hydrated;
    const scope = await ensureMc({ localOnly: true }); // the local scope accepts any mc arguments
    destination = `${o.alias}/${o.bucket}/${settings.data.s3AccessKey}/${prefixFor(o.folder)}`;

    const args = ["mirror", "--json", "--overwrite"];
    if (o.watch) args.push("--watch");
    if (o.removeDeleted) args.push("--remove");
    args.push(o.folder, destination);

    const cmd = Command.create(scope, args);
    cmd.stdout.on("data", onLine);
    cmd.stderr.on("data", onLine); // mc may report errors on either stream
    cmd.on("close", ({ code }) => onClose(code));
    cmd.on("error", (e) => fail(String(e)));

    child = await cmd.spawn();
    await settings.set("backupActive", true);
    armIdle(FIRST_IDLE_MS);
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
  }
}

async function stop(): Promise<void> {
  stopping = true;
  clearTimeout(idleTimer);
  const c = child;
  child = null;
  try {
    await c?.kill();
  } catch {
    /* already gone */
  }
  progress = { ...ZERO };
  setPhase("idle");
  await settings.set("backupActive", false);
}

/** Start with whatever the card last saved. Used by the tray and by resume(). */
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
  });
}

/** Call once when the app UI loads: creates the tray and resumes a backup that was running. */
async function init(): Promise<void> {
  await ensureTray();
  if (resumed) return;
  resumed = true;
  await settings.hydrated;
  if (settings.data.backupActive) await startFromSettings();
}

export const backup = {
  get phase() {
    return phase;
  },
  get running() {
    return isRunning();
  },
  get error() {
    return error;
  },
  get progress() {
    return progress;
  },
  get percent() {
    return percent();
  },
  get changes() {
    return changes;
  },
  get counts() {
    return counts;
  },
  get destination() {
    return destination;
  },
  init,
  start,
  stop,
  startFromSettings,
};
