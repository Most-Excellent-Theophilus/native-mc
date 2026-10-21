//! System tray: status line, start/stop, open, quit, plus progress.
//!
//! Created in Rust at startup, so it exists before (and independently of) the
//! webview, and keeps working while the window is hidden.
//!
//! Per platform:
//!   Windows  tooltip shows the status; left click opens the window, right click the menu.
//!            The taskbar button also shows a progress bar.
//!   macOS    the percentage appears next to the icon in the menu bar; the Dock icon
//!            shows a progress bar.
//!   Linux    no tooltip or click events: the menu's first (disabled) item carries the
//!            status. Needs an AppIndicator-capable shell.

use std::sync::Mutex;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::window::{ProgressBarState, ProgressBarStatus};
use tauri::{AppHandle, Manager, Wry};

use crate::backup::{Engine, Phase, Snapshot};

const TRAY_ID: &str = "backup-tray";

struct TrayState {
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    tray: TrayIcon,
    status: MenuItem<Wry>,
    toggle: MenuItem<Wry>,
    /// Last values pushed, so unchanged values cost no IPC.
    last_text: Mutex<(String, bool)>,
    last_bar: Mutex<(u8, u64)>,
}

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let status = MenuItem::with_id(app, "status", "Backup idle", false, None::<&str>)?;
    let toggle = MenuItem::with_id(app, "toggle", "Start backup", true, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "Open", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&status, &sep, &toggle, &open, &quit])?;

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::AssetNotFound("window icon".into()))?;

    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .menu(&menu)
        .tooltip("Backup")
        // Windows: left click opens the app. macOS/Linux: left click opens the menu.
        .show_menu_on_left_click(!cfg!(windows))
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle" => app.state::<Engine>().toggle(app),
            "open" => show_main(app),
            "quit" => {
                app.state::<Engine>().shutdown();
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if cfg!(windows) {
                    show_main(tray.app_handle());
                }
            }
        })
        .build(app)?;

    app.manage(TrayState {
        tray,
        status,
        toggle,
        last_text: Mutex::new((String::new(), false)),
        last_bar: Mutex::new((255, u64::MAX)),
    });
    Ok(())
}

fn status_text(s: &Snapshot) -> String {
    let text = match s.phase {
        Phase::Idle => "Backup idle".to_string(),
        Phase::Starting => "Backup: starting…".to_string(),
        Phase::Scanning => "Backup: checking folder…".to_string(),
        Phase::Syncing => format!(
            "Backing up {}% · {}/{} files",
            s.percent, s.files_done, s.files_total
        ),
        Phase::Restoring => format!(
            "Restoring {}% · {}/{} files",
            s.percent, s.files_done, s.files_total
        ),
        Phase::Watching if !s.error.is_empty() => format!("Backup problem: {}", s.error),
        Phase::Watching if s.pending > 0 => format!(
            "Up to date · {} file{} waiting ({} min delay)",
            s.pending,
            if s.pending == 1 { "" } else { "s" },
            s.settle_minutes
        ),
        Phase::Watching => "Watching for changes".to_string(),
        Phase::Done if s.pending > 0 => format!("Backup complete · {} skipped (changing)", s.pending),
        Phase::Done => "Backup complete".to_string(),
        Phase::Error => format!("Backup error: {}", s.error),
    };
    // Windows caps tooltips at 127 characters.
    if text.chars().count() > 120 {
        let cut: String = text.chars().take(119).collect();
        format!("{cut}…")
    } else {
        text
    }
}

/// Pushes the snapshot to the tray menu, tooltip, menu-bar title and taskbar.
pub fn update(app: &AppHandle, snap: &Snapshot) {
    let Some(st) = app.try_state::<TrayState>() else {
        return; // no tray (e.g. Linux without AppIndicator): the backup still runs
    };

    let text = status_text(snap);
    let running = snap.is_active();
    {
        let mut last = st.last_text.lock().unwrap();
        if last.0 != text || last.1 != running {
            let _ = st.status.set_text(&text);
            let _ = st
                .toggle
                .set_text(if running { "Stop backup" } else { "Start backup" });
            #[cfg(not(target_os = "linux"))]
            let _ = st.tray.set_tooltip(Some(&text));
            #[cfg(target_os = "macos")]
            let _ = st.tray.set_title(if matches!(snap.phase, Phase::Syncing | Phase::Restoring) {
                Some(format!("{}%", snap.percent))
            } else {
                None
            });
            *last = (text, running);
        }
    }

    // Taskbar / Dock progress, driven by the same snapshot as everything else.
    let (status, progress, code) = match snap.phase {
        Phase::Syncing | Phase::Restoring => (ProgressBarStatus::Normal, snap.percent as u64, 1u8),
        Phase::Starting | Phase::Scanning => (ProgressBarStatus::Indeterminate, 0, 2),
        _ => (ProgressBarStatus::None, 0, 0),
    };
    let mut last = st.last_bar.lock().unwrap();
    if *last != (code, progress) {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.set_progress_bar(ProgressBarState {
                status: Some(status),
                progress: Some(progress),
            });
        }
        *last = (code, progress);
    }
}
