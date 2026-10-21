//! Folder backup engine.
//!
//! Runs in the Rust process (not in the webview), so it keeps working while the
//! window is hidden or closed to the tray.
//!
//! How it works
//! ------------
//! * Every `SCAN_SECS` the folder is scanned. Temporary files (see `filters`)
//!   are ignored.
//! * A file is uploaded only after it has been *quiet* for `settle_minutes`:
//!   `now >= max(modified, created) + settle`. Using the creation time as well
//!   means a file copied into the folder (which keeps its old modified time)
//!   still waits. Every new edit pushes the upload back again.
//! * Deletions are mirrored (if enabled) only after the file has been missing
//!   for the same delay, so "delete + rename" saves by Office do not remove the
//!   remote copy.
//! * Uploads use `mc cp`, 4 at a time. Totals are fixed when a round starts, so
//!   progress only ever moves forward, and the same snapshot feeds the window,
//!   the tray tooltip/menu and the taskbar.
//! * What was uploaded is remembered in `backup-index.json`, so restarts do not
//!   upload everything again.
//! * Several folders can be backed up at once. Each is its own job (own index,
//!   own progress); the tray and taskbar show the combined state.
//! * The jobs are saved to `backup-jobs.json`; the ones that were running when
//!   the app quit resume on the next launch (the app autostarts hidden at login).
//! * Restore: a job can be switched to a download. `Missing` brings back only
//!   what the folder lacks; `Full` also replaces files that differ from the
//!   backup. The folder's backup is paused meanwhile and resumes afterwards.

use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use walkdir::WalkDir;

use crate::{filters, tray};

const SCAN_SECS: u64 = 30;
const WORKERS: usize = 4;
const MAX_CHANGES: usize = 50;
const EMIT_EVERY: Duration = Duration::from_millis(150);
/// A modified time further in the future than this is treated as bogus.
const MAX_FUTURE_MS: u64 = 24 * 3_600_000;
pub const STATE_EVENT: &str = "backup-state";

// ---------------------------------------------------------------- types ----

fn default_settle() -> u32 {
    15
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct JobConfig {
    /// Stable id of the folder entry in the UI.
    pub id: String,
    pub folder: String,
    /// `alias/bucket/prefix`, no trailing slash needed.
    pub destination: String,
    /// Absolute path of the `mc` binary.
    pub mc_path: String,
    pub watch: bool,
    pub remove_deleted: bool,
    /// Minutes a file must stay unchanged before it is uploaded. 0 = no wait.
    #[serde(default = "default_settle")]
    pub settle_minutes: u32,
}

#[derive(Clone, Serialize, Deserialize)]
struct StoredJob {
    config: JobConfig,
    active: bool,
}

#[derive(Clone, Copy, Serialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Idle,
    Starting,
    Scanning,
    Syncing,
    Restoring,
    Watching,
    Done,
    Error,
}

impl Default for Phase {
    fn default() -> Self {
        Phase::Idle
    }
}

#[derive(Clone, Serialize)]
pub struct Change {
    pub id: u64,
    /// "upload" | "remove" | "restore" | "error"
    pub kind: &'static str,
    pub path: String,
    pub size: u64,
    pub at: u64,
}

/// Everything the UI, tray and taskbar show. One source of truth.
#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub phase: Phase,
    pub error: String,
    pub destination: String,
    pub settle_minutes: u32,

    // Current round. Totals are fixed when the round starts.
    pub files_done: u64,
    pub files_total: u64,
    pub bytes_done: u64,
    pub bytes_total: u64,
    pub failed: u64,
    pub percent: u8,
    pub current: Vec<String>,

    // Files waiting out the settle delay, and when the first one is due.
    pub pending: u64,
    pub next_ready_at: Option<u64>,

    // Session totals.
    pub uploaded: u64,
    pub removed: u64,
    pub restored: u64,
    pub failed_total: u64,

    pub changes: Vec<Change>,
}

impl Snapshot {
    pub fn is_active(&self) -> bool {
        matches!(
            self.phase,
            Phase::Starting | Phase::Scanning | Phase::Syncing | Phase::Restoring | Phase::Watching
        )
    }

    fn recompute_percent(&mut self) {
        self.percent = if self.bytes_total > 0 {
            ((self.bytes_done as f64 / self.bytes_total as f64) * 100.0).min(100.0) as u8
        } else if self.files_total > 0 {
            ((self.files_done as f64 / self.files_total as f64) * 100.0).min(100.0) as u8
        } else {
            0
        };
    }
}

struct Shared {
    id: String,
    snap: Mutex<Snapshot>,
    last_emit: Mutex<Option<Instant>>,
    next_id: AtomicU64,
}

impl Shared {
    fn new(id: &str) -> Self {
        Shared {
            id: id.to_string(),
            snap: Mutex::new(Snapshot::default()),
            last_emit: Mutex::new(None),
            next_id: AtomicU64::new(0),
        }
    }
}

/// What the UI receives: a job's snapshot tagged with the job id.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct JobEvent<'a> {
    id: &'a str,
    #[serde(flatten)]
    snap: &'a Snapshot,
}

struct Run {
    stop: Arc<AtomicBool>,
    handle: JoinHandle<()>,
}

struct Job {
    shared: Arc<Shared>,
    run: Option<Run>,
}

#[derive(Default)]
pub struct Engine {
    jobs: Mutex<HashMap<String, Job>>,
}

// -------------------------------------------------------------- helpers ----

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn to_ms(t: SystemTime) -> u64 {
    t.duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn data_dir(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_local_data_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn write_atomic(path: &Path, bytes: &[u8]) {
    let tmp = path.with_extension("json.tmp");
    if std::fs::write(&tmp, bytes).is_ok() {
        let _ = std::fs::rename(&tmp, path);
    }
}

/// Applies `f` to the snapshot and publishes it to the UI and the tray.
/// Does nothing once `stop` is set, so a run that is winding down cannot
/// overwrite the state of the next one.
fn update(
    app: &AppHandle,
    shared: &Shared,
    stop: &AtomicBool,
    force: bool,
    f: impl FnOnce(&mut Snapshot),
) {
    if stop.load(Ordering::SeqCst) {
        return;
    }
    let snap = {
        let mut s = shared.snap.lock().unwrap();
        f(&mut s);
        s.recompute_percent();
        s.clone()
    };
    publish(app, shared, &snap, force);
}

fn publish(app: &AppHandle, shared: &Shared, snap: &Snapshot, force: bool) {
    {
        let mut last = shared.last_emit.lock().unwrap();
        if !force {
            if let Some(t) = *last {
                if t.elapsed() < EMIT_EVERY {
                    return;
                }
            }
        }
        *last = Some(Instant::now());
    }
    let _ = app.emit(
        STATE_EVENT,
        JobEvent {
            id: &shared.id,
            snap,
        },
    );
    // The tray and taskbar show all jobs together.
    let combined = app.state::<Engine>().aggregate();
    tray::update(app, &combined);
}

fn push_change(shared: &Shared, s: &mut Snapshot, kind: &'static str, path: &str, size: u64) {
    let id = shared.next_id.fetch_add(1, Ordering::SeqCst) + 1;
    s.changes.insert(
        0,
        Change {
            id,
            kind,
            path: path.to_string(),
            size,
            at: now_ms(),
        },
    );
    s.changes.truncate(MAX_CHANGES);
}

// ---------------------------------------------------------------- index ----

#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Debug)]
struct Entry {
    mtime: u64,
    size: u64,
}

/// What has already been uploaded, so restarts only send what changed.
#[derive(Default, Serialize, Deserialize)]
struct Index {
    #[serde(default)]
    id: String,
    folder: String,
    destination: String,
    files: HashMap<String, Entry>,
    /// Files that disappeared locally, and when we first noticed.
    #[serde(default)]
    missing: HashMap<String, u64>,
}

impl Index {
    fn path(dir: &Path, id: &str) -> PathBuf {
        dir.join(format!("backup-index-{id}.json"))
    }

    fn load(dir: &Path, cfg: &JobConfig) -> Index {
        let loaded: Option<Index> = std::fs::read(Self::path(dir, &cfg.id))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok());
        match loaded {
            Some(i) if i.folder == cfg.folder && i.destination == cfg.destination => Index {
                id: cfg.id.clone(),
                ..i
            },
            _ => Index {
                id: cfg.id.clone(),
                folder: cfg.folder.clone(),
                destination: cfg.destination.clone(),
                ..Default::default()
            },
        }
    }

    fn save(&self, dir: &Path) {
        if let Ok(bytes) = serde_json::to_vec(self) {
            write_atomic(&Self::path(dir, &self.id), &bytes);
        }
    }
}

// ----------------------------------------------------------------- scan ----

#[derive(Clone, Debug)]
struct Local {
    /// Path relative to the backed-up folder, always with `/`.
    rel: String,
    abs: PathBuf,
    size: u64,
    mtime: u64,
    /// Epoch ms at which the settle delay is over.
    eligible_at: u64,
}

fn scan(root: &Path, settle_ms: u64, now: u64, stop: &AtomicBool) -> Vec<Local> {
    let mut out = Vec::new();
    let walker = WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            if e.depth() == 0 || !e.file_type().is_dir() {
                return true;
            }
            !filters::is_ignored_dir(&e.file_name().to_string_lossy())
        });

    for (n, entry) in walker.enumerate() {
        if n % 500 == 0 && stop.load(Ordering::SeqCst) {
            break;
        }
        let Ok(entry) = entry else { continue }; // unreadable entry: skip it
        if !entry.file_type().is_file() {
            continue;
        }
        if filters::is_temp_name(&entry.file_name().to_string_lossy()) {
            continue;
        }
        let Ok(md) = entry.metadata() else { continue };
        let Ok(modified) = md.modified() else { continue };
        let mtime = to_ms(modified);

        // "Added to the folder" time: a copy keeps its old modified time but gets
        // a fresh creation time, so the later of the two decides.
        let mut effective = mtime.max(md.created().map(to_ms).unwrap_or(0));
        if effective > now + MAX_FUTURE_MS {
            effective = 0; // clock skew or a bogus date: do not hold the file back forever
        }

        let Ok(rel) = entry.path().strip_prefix(root) else {
            continue;
        };
        let rel = rel
            .components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join("/");

        out.push(Local {
            rel,
            abs: entry.path().to_path_buf(),
            size: md.len(),
            mtime,
            eligible_at: effective + settle_ms,
        });
    }
    out
}

struct Classified {
    ready: Vec<Local>,
    pending: u64,
    next_at: Option<u64>,
    /// Files that the bucket already has (first run only): record, do not upload.
    already_remote: Vec<Local>,
}

/// Splits scanned files into "upload now" and "still settling".
fn classify(
    local: &[Local],
    index: &HashMap<String, Entry>,
    remote: Option<&HashMap<String, (u64, u64)>>,
    now: u64,
) -> Classified {
    let mut c = Classified {
        ready: Vec::new(),
        pending: 0,
        next_at: None,
        already_remote: Vec::new(),
    };
    for l in local {
        let here = Entry {
            mtime: l.mtime,
            size: l.size,
        };
        if index.get(&l.rel) == Some(&here) {
            continue; // already backed up
        }
        if let Some((rsize, rmtime)) = remote.and_then(|r| r.get(&l.rel)) {
            // Uploaded after its last change and same size: the bucket is current.
            if *rsize == l.size && *rmtime >= l.mtime {
                c.already_remote.push(l.clone());
                continue;
            }
        }
        if now >= l.eligible_at {
            c.ready.push(l.clone());
        } else {
            c.pending += 1;
            c.next_at = Some(c.next_at.map_or(l.eligible_at, |n| n.min(l.eligible_at)));
        }
    }
    c
}

// ------------------------------------------------------------ mc process ----

struct McOut {
    code: i32,
    stdout: String,
    stderr: String,
}

fn run_mc(mc: &str, args: &[String], stop: &AtomicBool) -> Result<McOut, String> {
    let mut cmd = Command::new(mc);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console flash
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Could not start the storage client ({mc}): {e}"))?;

    // Drain both pipes on threads so a large listing cannot fill the pipe and stall mc.
    let mut so = child.stdout.take().ok_or("no stdout")?;
    let mut se = child.stderr.take().ok_or("no stderr")?;
    let t_out = thread::spawn(move || {
        let mut b = Vec::new();
        let _ = so.read_to_end(&mut b);
        String::from_utf8_lossy(&b).into_owned()
    });
    let t_err = thread::spawn(move || {
        let mut b = Vec::new();
        let _ = se.read_to_end(&mut b);
        String::from_utf8_lossy(&b).into_owned()
    });

    let code = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.code().unwrap_or(-1),
            Ok(None) => {
                if stop.load(Ordering::SeqCst) {
                    let _ = child.kill();
                    let _ = child.wait();
                    // Do not join the readers: a grandchild that inherited the pipes
                    // would keep them open. They end on their own when the pipes close.
                    return Err("stopped".into());
                }
                thread::sleep(Duration::from_millis(100));
            }
            Err(e) => return Err(e.to_string()),
        }
    };
    Ok(McOut {
        code,
        stdout: t_out.join().unwrap_or_default(),
        stderr: t_err.join().unwrap_or_default(),
    })
}

/// Pulls the human message out of mc's JSON error line, else the last text line.
fn mc_message(out: &McOut) -> String {
    for text in [&out.stdout, &out.stderr] {
        for line in text.lines().rev() {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(line.trim()) {
                if let Some(m) = v.pointer("/error/message").and_then(|m| m.as_str()) {
                    return m.to_string();
                }
            }
        }
    }
    out.stderr
        .lines()
        .chain(out.stdout.lines())
        .rev()
        .find(|l| !l.trim().is_empty())
        .map(|l| l.trim().to_string())
        .unwrap_or_else(|| format!("mc exited with code {}", out.code))
}

fn remote_path(dest: &str, rel: &str) -> String {
    format!("{}/{}", dest.trim_end_matches('/'), rel)
}

fn upload_one(cfg: &JobConfig, item: &Local, stop: &AtomicBool) -> Result<(), String> {
    let args = vec![
        "cp".to_string(),
        "--json".to_string(),
        item.abs.to_string_lossy().into_owned(),
        remote_path(&cfg.destination, &item.rel),
    ];
    let out = run_mc(&cfg.mc_path, &args, stop)?;
    if out.code == 0 {
        Ok(())
    } else {
        Err(mc_message(&out))
    }
}

fn remove_one(cfg: &JobConfig, rel: &str, stop: &AtomicBool) -> Result<(), String> {
    let args = vec![
        "rm".to_string(),
        "--json".to_string(),
        "--force".to_string(),
        remote_path(&cfg.destination, rel),
    ];
    let out = run_mc(&cfg.mc_path, &args, stop)?;
    if out.code == 0 {
        Ok(())
    } else {
        Err(mc_message(&out))
    }
}

/// key -> (size, last modified ms) of what the bucket already holds.
fn list_remote(
    cfg: &JobConfig,
    stop: &AtomicBool,
) -> Result<HashMap<String, (u64, u64)>, String> {
    let args = vec![
        "ls".to_string(),
        "--recursive".to_string(),
        "--json".to_string(),
        format!("{}/", cfg.destination.trim_end_matches('/')),
    ];
    let out = run_mc(&cfg.mc_path, &args, stop)?;
    if out.code != 0 {
        return Err(mc_message(&out));
    }
    let mut map = HashMap::new();
    for line in out.stdout.lines() {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line.trim()) else {
            continue;
        };
        if v.get("type").and_then(|t| t.as_str()) == Some("folder") {
            continue;
        }
        let (Some(key), Some(size), Some(when)) = (
            v.get("key").and_then(|k| k.as_str()),
            v.get("size").and_then(|s| s.as_u64()),
            v.get("lastModified")
                .and_then(|m| m.as_str())
                .and_then(parse_rfc3339_ms),
        ) else {
            continue;
        };
        map.insert(key.to_string(), (size, when));
    }
    Ok(map)
}

/// `2024-05-01T10:00:00.123Z` or with a `+02:00` offset -> epoch ms.
fn parse_rfc3339_ms(s: &str) -> Option<u64> {
    let b = s.as_bytes();
    if b.len() < 19 {
        return None;
    }
    let num = |a: usize, z: usize| s.get(a..z)?.parse::<i64>().ok();
    let (y, mo, d) = (num(0, 4)?, num(5, 7)?, num(8, 10)?);
    let (h, mi, se) = (num(11, 13)?, num(14, 16)?, num(17, 19)?);

    let mut i = 19;
    let mut ms = 0i64;
    if b.get(i) == Some(&b'.') {
        let start = i + 1;
        i = start;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        let frac = &s[start..i];
        ms = format!("{:0<3}", &frac[..frac.len().min(3)]).parse().ok()?;
    }
    let offset_secs = match b.get(i) {
        None | Some(b'Z') => 0,
        Some(&c) if c == b'+' || c == b'-' => {
            let sign = if c == b'+' { 1 } else { -1 };
            let oh = s.get(i + 1..i + 3)?.parse::<i64>().ok()?;
            let om = s.get(i + 4..i + 6)?.parse::<i64>().ok()?;
            sign * (oh * 60 + om) * 60
        }
        _ => return None,
    };

    // Days since 1970-01-01 (Howard Hinnant's civil-date algorithm).
    let yy = if mo <= 2 { y - 1 } else { y };
    let era = if yy >= 0 { yy } else { yy - 399 } / 400;
    let yoe = yy - era * 400;
    let doy = (153 * (if mo > 2 { mo - 3 } else { mo + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;

    let secs = days * 86_400 + h * 3_600 + mi * 60 + se - offset_secs;
    (secs >= 0).then(|| secs as u64 * 1000 + ms as u64)
}

// --------------------------------------------------------------- upload ----

struct Outcome {
    item: Local,
    result: Result<(), String>,
}

/// Uploads `items` with `WORKERS` parallel `mc cp` processes, updating progress
/// after every file.
fn upload_round(
    app: &AppHandle,
    shared: &Shared,
    cfg: &JobConfig,
    stop: &AtomicBool,
    items: Vec<Local>,
) -> Vec<Outcome> {
    let next = AtomicUsize::new(0);
    let results: Mutex<Vec<Outcome>> = Mutex::new(Vec::with_capacity(items.len()));

    thread::scope(|scope| {
        for _ in 0..WORKERS.min(items.len()) {
            scope.spawn(|| loop {
                if stop.load(Ordering::SeqCst) {
                    return;
                }
                let i = next.fetch_add(1, Ordering::SeqCst);
                let Some(item) = items.get(i) else { return };

                update(app, shared, stop, false, |s| s.current.push(item.rel.clone()));
                let result = upload_one(cfg, item, stop);
                if matches!(&result, Err(e) if e == "stopped") {
                    return;
                }

                update(app, shared, stop, false, |s| {
                    s.current.retain(|c| c != &item.rel);
                    match &result {
                        Ok(()) => {
                            s.files_done += 1;
                            s.bytes_done += item.size;
                            s.uploaded += 1;
                            s.error.clear();
                            push_change(shared, s, "upload", &item.rel, item.size);
                        }
                        Err(msg) => {
                            s.failed += 1;
                            s.failed_total += 1;
                            s.error = msg.clone();
                            push_change(shared, s, "error", &item.rel, item.size);
                        }
                    }
                });
                results.lock().unwrap().push(Outcome {
                    item: item.clone(),
                    result,
                });
            });
        }
    });
    results.into_inner().unwrap()
}

// ------------------------------------------------------------------ run ----

fn sleep_unless_stopped(stop: &AtomicBool, total: Duration) {
    let end = Instant::now() + total;
    while Instant::now() < end && !stop.load(Ordering::SeqCst) {
        thread::sleep(Duration::from_millis(250));
    }
}

fn fail(app: &AppHandle, shared: &Shared, stop: &AtomicBool, msg: String) {
    update(app, shared, stop, true, |s| {
        s.phase = Phase::Error;
        s.error = msg;
        s.current.clear();
    });
    save_job(app, None, &shared.id, false);
}

fn run(
    app: AppHandle,
    shared: Arc<Shared>,
    cfg: JobConfig,
    stop: Arc<AtomicBool>,
    previous: Option<JoinHandle<()>>,
) {
    // A previous run that is still winding down must be finished first.
    if let Some(p) = previous {
        let _ = p.join();
    }
    let (app, shared, stop) = (&app, &*shared, &*stop);
    let root = PathBuf::from(&cfg.folder);
    let settle_ms = cfg.settle_minutes as u64 * 60_000;
    let dir = data_dir(app);

    // Fail early and clearly if mc cannot run at all.
    match run_mc(&cfg.mc_path, &["--version".to_string()], stop) {
        Ok(o) if o.code == 0 => {}
        Ok(o) => return fail(app, shared, stop, mc_message(&o)),
        Err(e) if e == "stopped" => return,
        Err(e) => return fail(app, shared, stop, e),
    }

    let mut index = dir
        .as_deref()
        .map(|d| Index::load(d, &cfg))
        .unwrap_or_default();
    let save_index = |index: &Index| {
        if let Some(d) = &dir {
            index.save(d);
        }
    };

    // First run: see what the bucket already has so it is not uploaded twice.
    let mut remote = None;
    if index.files.is_empty() {
        update(app, shared, stop, true, |s| s.phase = Phase::Scanning);
        remote = list_remote(&cfg, stop).ok();
    }

    let mut fail_streak: u32 = 0;
    while !stop.load(Ordering::SeqCst) {
        let now = now_ms();

        if !root.is_dir() {
            // Drive unplugged or folder moved: do nothing, and above all do not
            // treat everything as deleted.
            update(app, shared, stop, true, |s| {
                s.phase = if cfg.watch { Phase::Watching } else { Phase::Error };
                s.error = format!("Folder not found: {}", cfg.folder);
            });
            if !cfg.watch {
                break;
            }
            sleep_unless_stopped(stop, Duration::from_secs(SCAN_SECS));
            continue;
        }

        update(app, shared, stop, true, |s| {
            if s.phase != Phase::Syncing {
                s.phase = Phase::Scanning;
            }
        });
        let local = scan(&root, settle_ms, now, stop);
        if stop.load(Ordering::SeqCst) {
            break;
        }

        let mut c = classify(&local, &index.files, remote.as_ref(), now);
        remote = None;
        for l in &c.already_remote {
            index.files.insert(
                l.rel.clone(),
                Entry {
                    mtime: l.mtime,
                    size: l.size,
                },
            );
        }

        // Deletions.
        let seen: HashSet<&str> = local.iter().map(|l| l.rel.as_str()).collect();
        index.missing.retain(|k, _| !seen.contains(k.as_str()));
        let gone: Vec<String> = index
            .files
            .keys()
            .filter(|k| !seen.contains(k.as_str()))
            .cloned()
            .collect();
        let mut to_remove: Vec<String> = Vec::new();
        if !cfg.remove_deleted {
            for k in &gone {
                index.files.remove(k); // forget it; if it comes back it is uploaded again
            }
        } else if !local.is_empty() {
            for k in gone {
                let since = *index.missing.entry(k.clone()).or_insert(now);
                if now.saturating_sub(since) >= settle_ms {
                    to_remove.push(k);
                } else {
                    c.pending += 1;
                    let due = since + settle_ms;
                    c.next_at = Some(c.next_at.map_or(due, |n| n.min(due)));
                }
            }
        } // else: folder looks empty (unmounted?): never mass-delete the backup

        // Upload and remove.
        let mut round_failed_all = false;
        if !c.ready.is_empty() || !to_remove.is_empty() {
            let total_bytes: u64 = c.ready.iter().map(|l| l.size).sum();
            let total_files = (c.ready.len() + to_remove.len()) as u64;
            update(app, shared, stop, true, |s| {
                s.phase = Phase::Syncing;
                s.files_done = 0;
                s.files_total = total_files;
                s.bytes_done = 0;
                s.bytes_total = total_bytes;
                s.failed = 0;
                s.current.clear();
                s.pending = c.pending;
                s.next_ready_at = c.next_at;
            });

            let n_ready = c.ready.len();
            let outcomes = upload_round(app, shared, &cfg, stop, std::mem::take(&mut c.ready));
            let mut ok = 0usize;
            for o in &outcomes {
                if o.result.is_ok() {
                    ok += 1;
                    index.files.insert(
                        o.item.rel.clone(),
                        Entry {
                            mtime: o.item.mtime,
                            size: o.item.size,
                        },
                    );
                }
            }
            round_failed_all = n_ready > 0 && ok == 0 && !stop.load(Ordering::SeqCst);

            for rel in to_remove {
                if stop.load(Ordering::SeqCst) {
                    break;
                }
                match remove_one(&cfg, &rel, stop) {
                    Ok(()) => {
                        index.files.remove(&rel);
                        index.missing.remove(&rel);
                        update(app, shared, stop, false, |s| {
                            s.files_done += 1;
                            s.removed += 1;
                            push_change(shared, s, "remove", &rel, 0);
                        });
                    }
                    Err(e) if e == "stopped" => break,
                    Err(e) => update(app, shared, stop, false, |s| {
                        s.failed += 1;
                        s.failed_total += 1;
                        s.error = e;
                        push_change(shared, s, "error", &rel, 0);
                    }),
                }
            }
        }
        save_index(&index);
        if stop.load(Ordering::SeqCst) {
            break;
        }

        fail_streak = if round_failed_all { fail_streak + 1 } else { 0 };

        if !cfg.watch {
            update(app, shared, stop, true, |s| {
                s.phase = Phase::Done;
                s.pending = c.pending;
                s.next_ready_at = None;
                s.current.clear();
            });
            save_job(app, None, &shared.id, false);
            return;
        }

        update(app, shared, stop, true, |s| {
            s.phase = Phase::Watching;
            s.pending = c.pending;
            s.next_ready_at = c.next_at;
            s.current.clear();
        });

        // Next scan: normally every SCAN_SECS; sooner when a file is about to
        // become eligible; backing off while uploads keep failing (offline).
        let mut wait = if fail_streak > 0 {
            (SCAN_SECS << fail_streak.min(5)).min(600)
        } else {
            SCAN_SECS
        };
        if let Some(at) = c.next_at {
            let until = at.saturating_sub(now_ms()) / 1000 + 1;
            wait = wait.min(until.max(2));
        }
        sleep_unless_stopped(stop, Duration::from_secs(wait));
    }
}

// -------------------------------------------------------------- restore ----

/// How much of the bucket copy to bring back.
#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum RestoreMode {
    /// Only download what is in the bucket but missing locally. Never touches existing files.
    Missing,
    /// Make the folder match the bucket: also replace files that differ from the backup
    /// (different size, or edited after the backup was made).
    Full,
}

/// A bucket key is only restored if it stays inside the folder.
fn safe_rel(rel: &str) -> bool {
    !rel.is_empty()
        && rel.split('/').all(|p| {
            !p.is_empty()
                && p != "."
                && p != ".."
                && !p.contains('\\')
                && !(cfg!(windows) && p.contains(':'))
        })
}

fn safe_join(root: &Path, rel: &str) -> PathBuf {
    rel.split('/').fold(root.to_path_buf(), |p, c| p.join(c))
}

/// `(key, size, bucket modified ms)` of every file that has to be downloaded.
/// `remote` and `local` map key -> (size, modified ms).
fn plan_restore(
    remote: &HashMap<String, (u64, u64)>,
    local: &HashMap<String, (u64, u64)>,
    mode: RestoreMode,
) -> Vec<(String, u64, u64)> {
    let mut out: Vec<(String, u64, u64)> = remote
        .iter()
        .filter(|(k, _)| safe_rel(k.as_str()))
        .filter(|(k, (rsize, rmtime))| match local.get(k.as_str()) {
            None => true,
            Some((lsize, lmtime)) => mode == RestoreMode::Full && (lsize != rsize || lmtime > rmtime),
        })
        .map(|(k, (s, m))| (k.clone(), *s, *m))
        .collect();
    out.sort();
    out
}

fn download_one(
    cfg: &JobConfig,
    root: &Path,
    rel: &str,
    remote_mtime: u64,
    stop: &AtomicBool,
) -> Result<(), String> {
    if !safe_rel(rel) {
        return Err(format!("Unsafe file name in the bucket: {rel}"));
    }
    let dest = safe_join(root, rel);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    }
    let args = vec![
        "cp".to_string(),
        "--json".to_string(),
        remote_path(&cfg.destination, rel),
        dest.to_string_lossy().into_owned(),
    ];
    let out = run_mc(&cfg.mc_path, &args, stop)?;
    if out.code != 0 {
        return Err(mc_message(&out));
    }
    // Stamp the file with the backup time, so a later "full restore" sees it as identical
    // and the backup does not treat it as a fresh edit.
    if let Ok(f) = std::fs::OpenOptions::new().write(true).open(&dest) {
        let _ = f.set_modified(UNIX_EPOCH + Duration::from_millis(remote_mtime));
    }
    Ok(())
}

/// Downloads `items` with `WORKERS` parallel `mc cp` processes. Returns those that succeeded.
fn download_round(
    app: &AppHandle,
    shared: &Shared,
    cfg: &JobConfig,
    stop: &AtomicBool,
    root: &Path,
    items: &[(String, u64, u64)],
) -> Vec<(String, u64, u64)> {
    let next = AtomicUsize::new(0);
    let done: Mutex<Vec<(String, u64, u64)>> = Mutex::new(Vec::new());

    thread::scope(|scope| {
        for _ in 0..WORKERS.min(items.len()) {
            scope.spawn(|| loop {
                if stop.load(Ordering::SeqCst) {
                    return;
                }
                let i = next.fetch_add(1, Ordering::SeqCst);
                let Some((rel, size, mtime)) = items.get(i) else { return };

                update(app, shared, stop, false, |s| s.current.push(rel.clone()));
                let result = download_one(cfg, root, rel, *mtime, stop);
                if matches!(&result, Err(e) if e == "stopped") {
                    return;
                }
                update(app, shared, stop, false, |s| {
                    s.current.retain(|c| c != rel);
                    match &result {
                        Ok(()) => {
                            s.files_done += 1;
                            s.bytes_done += *size;
                            s.restored += 1;
                            s.error.clear();
                            push_change(shared, s, "restore", rel, *size);
                        }
                        Err(msg) => {
                            s.failed += 1;
                            s.failed_total += 1;
                            s.error = msg.clone();
                            push_change(shared, s, "error", rel, *size);
                        }
                    }
                });
                if result.is_ok() {
                    done.lock().unwrap().push((rel.clone(), *size, *mtime));
                }
            });
        }
    });
    done.into_inner().unwrap()
}

fn restore_run(
    app: AppHandle,
    shared: Arc<Shared>,
    cfg: JobConfig,
    mode: RestoreMode,
    stop: Arc<AtomicBool>,
    previous: Option<JoinHandle<()>>,
    resume_after: bool,
) {
    // The backup of this folder was stopped by `restore`; wait until it is really gone.
    if let Some(p) = previous {
        let _ = p.join();
    }
    let (app_ref, sh, st) = (&app, &*shared, &*stop);
    let root = PathBuf::from(&cfg.folder);
    let dir = data_dir(app_ref);

    match run_mc(&cfg.mc_path, &["--version".to_string()], st) {
        Ok(o) if o.code == 0 => {}
        Ok(o) => return fail(app_ref, sh, st, mc_message(&o)),
        Err(e) if e == "stopped" => return,
        Err(e) => return fail(app_ref, sh, st, e),
    }

    let remote = match list_remote(&cfg, st) {
        Ok(m) => m,
        Err(e) if e == "stopped" => return,
        Err(e) => return fail(app_ref, sh, st, e),
    };
    if remote.is_empty() {
        return fail(
            app_ref,
            sh,
            st,
            "There is nothing in the bucket for this folder yet.".into(),
        );
    }
    // The folder may be gone entirely (that is the point of a full restore).
    if let Err(e) = std::fs::create_dir_all(&root) {
        return fail(app_ref, sh, st, format!("Could not create {}: {e}", cfg.folder));
    }

    let local: HashMap<String, (u64, u64)> = scan(&root, 0, now_ms(), st)
        .into_iter()
        .map(|l| (l.rel, (l.size, l.mtime)))
        .collect();
    if st.load(Ordering::SeqCst) {
        return;
    }

    let todo = plan_restore(&remote, &local, mode);
    let total_bytes: u64 = todo.iter().map(|t| t.1).sum();
    update(app_ref, sh, st, true, |s| {
        s.phase = Phase::Restoring;
        s.files_total = todo.len() as u64;
        s.bytes_total = total_bytes;
        s.files_done = 0;
        s.bytes_done = 0;
        s.failed = 0;
        s.current.clear();
        s.error.clear();
    });

    let restored = download_round(app_ref, sh, &cfg, st, &root, &todo);

    // Tell the backup index what is now in sync, so the watcher does not upload it again.
    if let Some(d) = &dir {
        let mut index = Index::load(d, &cfg);
        for (rel, size, mtime) in &restored {
            index.files.insert(
                rel.clone(),
                Entry {
                    mtime: *mtime,
                    size: *size,
                },
            );
            index.missing.remove(rel);
        }
        for (rel, (lsize, lmtime)) in &local {
            if let Some((rsize, rmtime)) = remote.get(rel) {
                if rsize == lsize && rmtime >= lmtime {
                    index.files.entry(rel.clone()).or_insert(Entry {
                        mtime: *lmtime,
                        size: *lsize,
                    });
                }
            }
        }
        index.save(d);
    }
    if st.load(Ordering::SeqCst) {
        return;
    }

    let failed = sh.snap.lock().unwrap().failed;
    update(app_ref, sh, st, true, |s| {
        s.phase = Phase::Done;
        s.current.clear();
        s.error = if failed > 0 {
            format!("{failed} file(s) could not be restored")
        } else {
            String::new()
        };
    });

    // If the folder was being backed up before the restore, carry on with it.
    if resume_after && !st.load(Ordering::SeqCst) {
        let _ = app_ref.state::<Engine>().start(app_ref, cfg);
    }
}

// ------------------------------------------------------------ job store ----

static STORE_LOCK: Mutex<()> = Mutex::new(());

fn jobs_path(app: &AppHandle) -> Option<PathBuf> {
    Some(data_dir(app)?.join("backup-jobs.json"))
}

fn load_jobs(app: &AppHandle) -> Vec<StoredJob> {
    jobs_path(app)
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn store_jobs(app: &AppHandle, jobs: &[StoredJob]) {
    let Some(path) = jobs_path(app) else { return };
    if let Ok(bytes) = serde_json::to_vec(jobs) {
        write_atomic(&path, &bytes);
    }
}

/// Saves a job so it can resume after a restart. `config = None` keeps the
/// stored config and only flips `active`.
fn save_job(app: &AppHandle, config: Option<&JobConfig>, id: &str, active: bool) {
    let _guard = STORE_LOCK.lock().unwrap();
    let mut jobs = load_jobs(app);
    let pos = jobs.iter().position(|j| j.config.id == id);
    match (pos, config) {
        (Some(i), Some(c)) => {
            jobs[i].config = c.clone();
            jobs[i].active = active;
        }
        (Some(i), None) => jobs[i].active = active,
        (None, Some(c)) => jobs.push(StoredJob {
            config: c.clone(),
            active,
        }),
        (None, None) => return,
    }
    store_jobs(app, &jobs);
}

fn remove_job(app: &AppHandle, id: &str) {
    let _guard = STORE_LOCK.lock().unwrap();
    let mut jobs = load_jobs(app);
    jobs.retain(|j| j.config.id != id);
    store_jobs(app, &jobs);
}

// --------------------------------------------------------------- engine ----

fn clean_id(id: &str) -> String {
    let id: String = id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    if id.is_empty() { "job".into() } else { id }
}

fn normalize(mut config: JobConfig) -> Result<JobConfig, String> {
    if config.folder.is_empty() || config.destination.is_empty() {
        return Err("Choose a folder and a bucket first".into());
    }
    config.id = clean_id(&config.id);
    Ok(config)
}

struct Prepared {
    shared: Arc<Shared>,
    previous: Option<JoinHandle<()>>,
    stop: Arc<AtomicBool>,
    /// The job was backing up (or watching) when this call came in.
    was_active: bool,
}

fn publish_current(app: &AppHandle, shared: &Shared) {
    let snap = shared.snap.lock().unwrap().clone();
    publish(app, shared, &snap, true);
}

impl Engine {
    /// True while any folder is being backed up or restored.
    pub fn is_running(&self) -> bool {
        self.jobs
            .lock()
            .unwrap()
            .values()
            .any(|j| j.shared.snap.lock().unwrap().is_active())
    }

    fn shared_of(&self, id: &str) -> Option<Arc<Shared>> {
        self.jobs.lock().unwrap().get(id).map(|j| j.shared.clone())
    }

    pub fn snapshots(&self) -> HashMap<String, Snapshot> {
        let all: Vec<Arc<Shared>> = self
            .jobs
            .lock()
            .unwrap()
            .values()
            .map(|j| j.shared.clone())
            .collect();
        all.into_iter()
            .map(|sh| (sh.id.clone(), sh.snap.lock().unwrap().clone()))
            .collect()
    }

    /// One combined snapshot of every job, for the tray and the taskbar.
    pub fn aggregate(&self) -> Snapshot {
        let all: Vec<Arc<Shared>> = self
            .jobs
            .lock()
            .unwrap()
            .values()
            .map(|j| j.shared.clone())
            .collect();
        let rank = |p: Phase| match p {
            Phase::Restoring | Phase::Syncing => 6u8,
            Phase::Scanning => 5,
            Phase::Starting => 4,
            Phase::Watching => 3,
            Phase::Error => 2,
            Phase::Done => 1,
            Phase::Idle => 0,
        };
        let mut agg = Snapshot::default();
        let mut best = 0u8;
        for sh in all {
            let s = sh.snap.lock().unwrap();
            if rank(s.phase) > best {
                best = rank(s.phase);
                agg.phase = s.phase;
            }
            if matches!(s.phase, Phase::Syncing | Phase::Restoring) {
                agg.files_done += s.files_done;
                agg.files_total += s.files_total;
                agg.bytes_done += s.bytes_done;
                agg.bytes_total += s.bytes_total;
            }
            agg.pending += s.pending;
            agg.uploaded += s.uploaded;
            agg.removed += s.removed;
            agg.restored += s.restored;
            agg.failed_total += s.failed_total;
            agg.settle_minutes = agg.settle_minutes.max(s.settle_minutes);
            if agg.error.is_empty() && !s.error.is_empty() {
                agg.error = s.error.clone();
            }
            agg.next_ready_at = match (agg.next_ready_at, s.next_ready_at) {
                (Some(a), Some(b)) => Some(a.min(b)),
                (a, b) => a.or(b),
            };
        }
        agg.recompute_percent();
        agg
    }

    /// Registers the job, stops whatever it was doing and resets its snapshot to `phase`.
    fn prepare(&self, config: &JobConfig, phase: Phase) -> Result<Prepared, String> {
        let mut jobs = self.jobs.lock().unwrap();
        let job = jobs.entry(config.id.clone()).or_insert_with(|| Job {
            shared: Arc::new(Shared::new(&config.id)),
            run: None,
        });
        let mut s = job.shared.snap.lock().unwrap();
        let was_active = s.is_active();
        if phase == Phase::Restoring {
            if s.phase == Phase::Restoring {
                return Err("This folder is already being restored".into());
            }
        } else if was_active {
            return Err("This folder is already being backed up or restored".into());
        }

        let previous = job.run.take().map(|r| {
            r.stop.store(true, Ordering::SeqCst);
            r.handle
        });
        let keep = std::mem::take(&mut s.changes);
        *s = Snapshot {
            phase,
            destination: config.destination.clone(),
            settle_minutes: config.settle_minutes,
            changes: keep,
            ..Default::default()
        };
        drop(s);
        Ok(Prepared {
            shared: job.shared.clone(),
            previous,
            stop: Arc::new(AtomicBool::new(false)),
            was_active,
        })
    }

    fn set_run(&self, id: &str, run: Run) {
        if let Some(job) = self.jobs.lock().unwrap().get_mut(id) {
            job.run = Some(run);
        }
    }

    /// Non-blocking: safe to call from the tray menu / main thread.
    pub fn start(&self, app: &AppHandle, config: JobConfig) -> Result<(), String> {
        let config = normalize(config)?;
        let Prepared {
            shared,
            previous,
            stop,
            ..
        } = self.prepare(&config, Phase::Starting)?;

        save_job(app, Some(&config), &config.id, true);
        publish_current(app, &shared);

        let (app2, sh2, stop2, id) = (app.clone(), shared, stop.clone(), config.id.clone());
        let handle = thread::spawn(move || run(app2, sh2, config, stop2, previous));
        self.set_run(&id, Run { stop, handle });
        Ok(())
    }

    /// Stops this folder's backup, downloads from the bucket, then carries on with the
    /// backup if it was running. Non-blocking.
    pub fn restore(
        &self,
        app: &AppHandle,
        config: JobConfig,
        mode: RestoreMode,
    ) -> Result<(), String> {
        let config = normalize(config)?;
        let Prepared {
            shared,
            previous,
            stop,
            was_active,
        } = self.prepare(&config, Phase::Restoring)?;

        // If the app quits half way, it must not resume a half-restored backup.
        save_job(app, Some(&config), &config.id, false);
        publish_current(app, &shared);

        let (app2, sh2, stop2, id) = (app.clone(), shared, stop.clone(), config.id.clone());
        let handle = thread::spawn(move || {
            restore_run(app2, sh2, config, mode, stop2, previous, was_active)
        });
        self.set_run(&id, Run { stop, handle });
        Ok(())
    }

    /// Non-blocking: the worker notices within ~100 ms and kills its `mc` children.
    pub fn stop(&self, app: &AppHandle, id: &str) {
        let shared = {
            let jobs = self.jobs.lock().unwrap();
            let Some(job) = jobs.get(id) else { return };
            if let Some(run) = &job.run {
                run.stop.store(true, Ordering::SeqCst);
            }
            job.shared.clone()
        };
        let snap = {
            let mut s = shared.snap.lock().unwrap();
            s.phase = Phase::Idle;
            s.error.clear();
            s.current.clear();
            s.files_done = 0;
            s.files_total = 0;
            s.bytes_done = 0;
            s.bytes_total = 0;
            s.failed = 0;
            s.pending = 0;
            s.next_ready_at = None;
            s.recompute_percent();
            s.clone()
        };
        save_job(app, None, id, false);
        publish(app, &shared, &snap, true);
    }

    pub fn stop_all(&self, app: &AppHandle) {
        let ids: Vec<String> = self.jobs.lock().unwrap().keys().cloned().collect();
        for id in ids {
            self.stop(app, &id);
        }
    }

    /// The folder was removed from the list: stop it and drop everything stored for it.
    pub fn forget(&self, app: &AppHandle, id: &str) {
        self.stop(app, id);
        self.jobs.lock().unwrap().remove(id);
        remove_job(app, id);
        if let Some(d) = data_dir(app) {
            let _ = std::fs::remove_file(Index::path(&d, id));
        }
        tray::update(app, &self.aggregate());
    }

    /// App is exiting: stop the workers and kill their `mc` children, but keep the
    /// saved jobs active so they resume on the next launch.
    pub fn shutdown(&self) {
        for job in self.jobs.lock().unwrap().values() {
            if let Some(run) = &job.run {
                run.stop.store(true, Ordering::SeqCst);
            }
        }
        let end = Instant::now() + Duration::from_secs(1);
        while Instant::now() < end {
            let all_done = self
                .jobs
                .lock()
                .unwrap()
                .values()
                .all(|j| j.run.as_ref().map_or(true, |r| r.handle.is_finished()));
            if all_done {
                break;
            }
            thread::sleep(Duration::from_millis(50));
        }
    }

    /// Tray "Start/Stop": stop everything, or start every saved folder again.
    pub fn toggle(&self, app: &AppHandle) {
        if self.is_running() {
            self.stop_all(app);
            return;
        }
        for job in load_jobs(app) {
            let id = clean_id(&job.config.id);
            if let Err(e) = self.start(app, job.config) {
                if let Some(sh) = self.shared_of(&id) {
                    sh.snap.lock().unwrap().error = e;
                }
            }
        }
    }
}

/// Called once at launch: continue the backups that were running when the app quit.
pub fn resume(app: &AppHandle) {
    let engine = app.state::<Engine>();
    for job in load_jobs(app) {
        if job.active {
            let _ = engine.start(app, job.config);
        }
    }
}

// ------------------------------------------------------------- commands ----

#[tauri::command]
pub fn backup_start(
    app: AppHandle,
    engine: State<'_, Engine>,
    config: JobConfig,
) -> Result<(), String> {
    engine.start(&app, config)
}

#[tauri::command]
pub fn backup_restore(
    app: AppHandle,
    engine: State<'_, Engine>,
    config: JobConfig,
    mode: RestoreMode,
) -> Result<(), String> {
    engine.restore(&app, config, mode)
}

#[tauri::command]
pub fn backup_stop(app: AppHandle, engine: State<'_, Engine>, id: String) {
    engine.stop(&app, &clean_id(&id));
}

#[tauri::command]
pub fn backup_forget(app: AppHandle, engine: State<'_, Engine>, id: String) {
    engine.forget(&app, &clean_id(&id));
}

#[tauri::command]
pub fn backup_state(engine: State<'_, Engine>) -> HashMap<String, Snapshot> {
    engine.snapshots()
}

// ---------------------------------------------------------------- tests ----

#[cfg(test)]
mod tests {
    use super::*;

    const MIN: u64 = 60_000;

    fn local(rel: &str, size: u64, mtime: u64, settle: u64) -> Local {
        Local {
            rel: rel.into(),
            abs: PathBuf::from(rel),
            size,
            mtime,
            eligible_at: mtime + settle,
        }
    }

    #[test]
    fn file_waits_for_the_settle_delay() {
        let now = 100 * MIN;
        let files = vec![
            local("old.txt", 1, now - 20 * MIN, 15 * MIN), // quiet for 20 min
            local("fresh.txt", 1, now - 2 * MIN, 15 * MIN), // edited 2 min ago
            local("edge.txt", 1, now - 15 * MIN, 15 * MIN), // exactly 15 min
        ];
        let c = classify(&files, &HashMap::new(), None, now);
        let ready: Vec<_> = c.ready.iter().map(|l| l.rel.as_str()).collect();
        assert_eq!(ready, ["old.txt", "edge.txt"]);
        assert_eq!(c.pending, 1);
        assert_eq!(c.next_at, Some(now - 2 * MIN + 15 * MIN));
    }

    #[test]
    fn zero_delay_uploads_immediately() {
        let now = 100 * MIN;
        let files = vec![local("a.txt", 1, now, 0)];
        let c = classify(&files, &HashMap::new(), None, now);
        assert_eq!(c.ready.len(), 1);
        assert_eq!(c.pending, 0);
    }

    #[test]
    fn unchanged_files_are_not_uploaded_again() {
        let now = 100 * MIN;
        let f = local("a.txt", 5, now - 30 * MIN, 15 * MIN);
        let mut idx = HashMap::new();
        idx.insert(
            "a.txt".to_string(),
            Entry {
                mtime: f.mtime,
                size: f.size,
            },
        );
        let c = classify(&[f.clone()], &idx, None, now);
        assert!(c.ready.is_empty() && c.pending == 0);

        // edited again: size changed, so it is a candidate (and now waits)
        let edited = local("a.txt", 9, now - MIN, 15 * MIN);
        let c = classify(&[edited], &idx, None, now);
        assert!(c.ready.is_empty());
        assert_eq!(c.pending, 1);
    }

    #[test]
    fn files_already_in_the_bucket_are_not_reuploaded() {
        let now = 100 * MIN;
        let f = local("a.txt", 5, now - 30 * MIN, 15 * MIN);
        let mut remote = HashMap::new();
        remote.insert("a.txt".to_string(), (5u64, now - 10 * MIN)); // uploaded after last edit
        let c = classify(&[f], &HashMap::new(), Some(&remote), now);
        assert!(c.ready.is_empty());
        assert_eq!(c.already_remote.len(), 1);

        let g = local("b.txt", 5, now - 5 * MIN - 30 * MIN, 15 * MIN);
        remote.insert("b.txt".to_string(), (5u64, now - 60 * MIN)); // bucket copy is older
        let c = classify(&[g], &HashMap::new(), Some(&remote), now);
        assert_eq!(c.ready.len(), 1);
    }

    #[test]
    fn restore_paths_must_stay_inside_the_folder() {
        assert!(safe_rel("a.txt"));
        assert!(safe_rel("sub/dir/a.txt"));
        assert!(!safe_rel(""));
        assert!(!safe_rel("../a.txt"));
        assert!(!safe_rel("sub/../../a.txt"));
        assert!(!safe_rel("/etc/passwd"));
        assert!(!safe_rel("sub//a.txt"));
        assert!(!safe_rel("sub\\a.txt"));
    }

    #[test]
    fn restore_plan_missing_vs_full() {
        let mut remote = HashMap::new();
        remote.insert("gone.txt".to_string(), (5u64, 1000u64));
        remote.insert("same.txt".to_string(), (5, 1000));
        remote.insert("edited.txt".to_string(), (5, 1000)); // local edited after the backup
        remote.insert("resized.txt".to_string(), (5, 1000)); // local has another size
        remote.insert("../evil.txt".to_string(), (5, 1000));

        let mut local = HashMap::new();
        local.insert("same.txt".to_string(), (5u64, 900u64));
        local.insert("edited.txt".to_string(), (5, 2000));
        local.insert("resized.txt".to_string(), (9, 900));
        local.insert("only-local.txt".to_string(), (1, 1));

        let names = |v: Vec<(String, u64, u64)>| v.into_iter().map(|t| t.0).collect::<Vec<_>>();
        assert_eq!(
            names(plan_restore(&remote, &local, RestoreMode::Missing)),
            ["gone.txt"]
        );
        assert_eq!(
            names(plan_restore(&remote, &local, RestoreMode::Full)),
            ["edited.txt", "gone.txt", "resized.txt"]
        );
    }

    #[test]
    fn rfc3339_parsing() {
        assert_eq!(parse_rfc3339_ms("2024-05-01T10:00:00Z"), Some(1_714_557_600_000));
        assert_eq!(
            parse_rfc3339_ms("2024-05-01T10:00:00.123Z"),
            Some(1_714_557_600_123)
        );
        assert_eq!(
            parse_rfc3339_ms("2024-05-01T12:00:00+02:00"),
            Some(1_714_557_600_000)
        );
        assert_eq!(parse_rfc3339_ms("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_rfc3339_ms("garbage"), None);
    }

    /// Writes a fake `mc` shell script and returns a config that uses it.
    #[cfg(unix)]
    fn fake_mc(body: &str) -> (PathBuf, JobConfig) {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("onebackup-fakemc-{}-{}", now_ms(), body.len()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("mc");
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        let cfg = JobConfig {
            id: "t".into(),
            folder: dir.to_string_lossy().into_owned(),
            destination: "alias/bucket/prefix".into(),
            mc_path: path.to_string_lossy().into_owned(),
            watch: true,
            remove_deleted: false,
            settle_minutes: 15,
        };
        (dir, cfg)
    }

    #[cfg(unix)]
    #[test]
    fn upload_passes_the_right_arguments_and_reports_errors() {
        let stop = AtomicBool::new(false);
        // Succeeds only when called as: cp --json <file> alias/bucket/prefix/sub/a.txt
        let (dir, cfg) = fake_mc(
            r#"[ "$1" = cp ] && [ "$2" = --json ] && [ "$4" = alias/bucket/prefix/sub/a.txt ] && exit 0
echo '{"status":"error","error":{"message":"Access Denied."}}'; exit 1"#,
        );
        let item = local("sub/a.txt", 1, 0, 0);
        assert_eq!(upload_one(&cfg, &item, &stop), Ok(()));
        let bad = local("sub/other.txt", 1, 0, 0);
        assert_eq!(upload_one(&cfg, &bad, &stop), Err("Access Denied.".to_string()));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn remote_listing_is_parsed_and_folders_ignored() {
        let stop = AtomicBool::new(false);
        let (dir, cfg) = fake_mc(
            r#"echo '{"status":"success","type":"file","lastModified":"2024-05-01T10:00:00.000Z","size":42,"key":"sub/a.txt"}'
echo '{"status":"success","type":"folder","lastModified":"2024-05-01T10:00:00.000Z","size":0,"key":"sub/"}'"#,
        );
        let map = list_remote(&cfg, &stop).unwrap();
        assert_eq!(map.len(), 1);
        assert_eq!(map["sub/a.txt"], (42, 1_714_557_600_000));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn stop_kills_a_running_upload_quickly() {
        let stop = Arc::new(AtomicBool::new(false));
        let (dir, cfg) = fake_mc("sleep 30");
        let s2 = stop.clone();
        let t = thread::spawn(move || {
            thread::sleep(Duration::from_millis(300));
            s2.store(true, Ordering::SeqCst);
        });
        let started = Instant::now();
        let r = upload_one(&cfg, &local("a.txt", 1, 0, 0), &stop);
        t.join().unwrap();
        assert_eq!(r, Err("stopped".to_string()));
        assert!(started.elapsed() < Duration::from_secs(3));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn scan_skips_temp_files_and_reports_relative_paths() {
        let dir = std::env::temp_dir().join(format!("onebackup-scan-{}", now_ms()));
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::create_dir_all(dir.join("$RECYCLE.BIN")).unwrap();
        for f in [
            "report.docx",
            "~$report.docx",
            "sub/data.xlsx",
            "sub/A1B2C3D0",
            "sub/~WRL0001.tmp",
            "$RECYCLE.BIN/x.txt",
        ] {
            std::fs::write(dir.join(f), b"x").unwrap();
        }
        let mut found: Vec<String> = scan(&dir, 15 * MIN, now_ms(), &AtomicBool::new(false))
            .into_iter()
            .map(|l| l.rel)
            .collect();
        found.sort();
        std::fs::remove_dir_all(&dir).unwrap();
        assert_eq!(found, ["report.docx", "sub/data.xlsx"]);
    }
}
