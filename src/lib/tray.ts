// src/lib/tray.ts
// System tray: status line, start/stop, open, quit, plus hide-to-tray while a
// backup is running.
//
// Per platform:
//   Windows  tooltip shows the status; left click opens the window, right click the menu.
//   macOS    the status text appears next to the icon in the menu bar (setTitle) and in the menu.
//   Linux    no tooltip, no click events: the menu is the only surface, so the status
//            lives in its first (disabled) item. Needs an AppIndicator-capable shell
//            (Ubuntu's default GNOME session has it).

import { TrayIcon } from "@tauri-apps/api/tray";
import { Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { defaultWindowIcon } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { platform } from "@tauri-apps/plugin-os";

const TRAY_ID = "backup-tray";

let tray: TrayIcon | null = null;
let statusItem: MenuItem | null = null;
let toggleItem: MenuItem | null = null;

export type TrayOptions = {
  /** Called when the window is closed: return true to hide to the tray instead. */
  shouldHide: () => boolean;
  /** Tray "Start/Stop backup" item. */
  onToggle: () => void;
};

export type TrayStatus = {
  text: string; // menu line + Windows tooltip
  title: string; // macOS menu-bar text, e.g. "42%" ("" clears it)
  running: boolean;
};

async function showWindow() {
  const w = getCurrentWindow();
  await w.show();
  await w.unminimize();
  await w.setFocus();
}

export async function initTray(opts: TrayOptions): Promise<void> {
  if (tray) return;
  const win = getCurrentWindow();
  const os = platform();

  // Dev hot reloads would otherwise stack up duplicate tray icons.
  (await TrayIcon.getById(TRAY_ID))?.close();

  await win.onCloseRequested(async (e) => {
    if (opts.shouldHide()) {
      e.preventDefault();
      await win.hide();
    }
  });

  statusItem = await MenuItem.new({ id: "status", text: "Backup idle", enabled: false });
  toggleItem = await MenuItem.new({ id: "toggle", text: "Start backup", action: () => opts.onToggle() });
  const openItem = await MenuItem.new({ id: "open", text: "Open", action: () => void showWindow() });
  const quitItem = await MenuItem.new({ id: "quit", text: "Quit", action: () => void win.destroy() });
  const sep = await PredefinedMenuItem.new({ item: "Separator" });

  const menu = await Menu.new({ items: [statusItem, sep, toggleItem, openItem, quitItem] });

  const icon = await defaultWindowIcon();
  if (!icon) throw new Error("No window icon configured, so the tray has nothing to show");

  tray = await TrayIcon.new({
    id: TRAY_ID,
    icon,
    menu,
    tooltip: "Backup",
    // Windows: left click opens the app. macOS/Linux: left click opens the menu.
    showMenuOnLeftClick: os !== "windows",
    action: (ev) => {
      if (os === "windows" && ev.type === "Click" && ev.button === "Left" && ev.buttonState === "Up") {
        void showWindow();
      }
    },
  });
}

export async function setTrayStatus(s: TrayStatus): Promise<void> {
  if (!tray) return;
  const os = platform();
  await statusItem?.setText(s.text);
  await toggleItem?.setText(s.running ? "Stop backup" : "Start backup");
  if (os === "macos") await tray.setTitle(s.title || null);
  if (os !== "linux") await tray.setTooltip(s.text.slice(0, 120)); // Windows caps tooltips at 127 chars
}