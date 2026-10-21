mod backup;
mod filters;
mod tray;

use tauri::{Manager, RunEvent, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;

/// Argument the autostart entry passes, so a login launch goes straight to the tray.
const HIDDEN_ARG: &str = "--hidden";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_upload::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![HIDDEN_ARG]),
        ))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .manage(backup::Engine::default())
        .invoke_handler(tauri::generate_handler![
            backup::backup_start,
            backup::backup_stop,
            backup::backup_state
        ])
        .setup(|app| {
            // A missing tray (Linux without AppIndicator) must never stop the app or the backup.
            if let Err(e) = tray::init(app.handle()) {
                eprintln!("Tray unavailable: {e}");
            }

            // The window starts hidden (see tauri.conf.json); show it unless this is a login launch.
            if !std::env::args().any(|a| a == HIDDEN_ARG) {
                tray::show_main(app.handle());
            }

            // Continue a backup that was running when the app last quit.
            backup::resume(app.handle());
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window while a backup runs hides it to the tray; the
            // engine lives in this process, so it keeps going.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" && window.state::<backup::Engine>().is_running() {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                app.state::<backup::Engine>().shutdown();
            }
        });
}
