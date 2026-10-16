// src/lib/ensureMc.ts
// npm i @tauri-apps/plugin-shell @tauri-apps/plugin-os @tauri-apps/api
// Rust side: .plugin(tauri_plugin_shell::init()).plugin(tauri_plugin_os::init())
//
// NOTE: dl.min.io no longer serves mc (HTTP 410). MinIO's last community
// release is pinned below and fetched from GitHub releases. Verify the asset
// names on https://github.com/minio/mc/releases/tag/<MC_VERSION> (expand "Assets").

import { Command } from "@tauri-apps/plugin-shell";
import { platform, arch } from "@tauri-apps/plugin-os";
import { appLocalDataDir, join } from "@tauri-apps/api/path";

const MC_VERSION = "RELEASE.2025-08-13T08-35-41Z";
const BASE_URL = `https://github.com/minio/mc/releases/download/${MC_VERSION}`;

/** Map OS/arch to the GitHub asset name, local file name and scope name. */
function target(): { asset: string; file: string; scope: string } {
  const os = platform();
  const cpu = arch();
  const key = `${os}/${cpu}`;
  const plat: Record<string, string> = {
    "windows/x86_64": "windows-amd64",
    "linux/x86_64": "linux-amd64",
    "linux/aarch64": "linux-arm64",
    "macos/x86_64": "darwin-amd64",
    "macos/aarch64": "darwin-arm64",
  };
  const p = plat[key];
  if (!p) throw new Error(`No MinIO client build for ${key}`);

  const isWin = os === "windows";
  return {
    asset: `mc.${p}.${MC_VERSION}${isWin ? ".exe" : ""}`,
    file: isWin ? "mc.exe" : "mc",
    scope: isWin ? "mc-local-win" : "mc-local",
  };
}

/** Run `--version` through a scoped command and confirm it is the MinIO client.
 *  On Linux `mc` is often Midnight Commander, so check the output text. */
async function isMinioMc(scopeName: string): Promise<boolean> {
  try {
    const out = await Command.create(scopeName, ["--version"]).execute();
    return out.code === 0 && out.stdout.includes("mc version");
  } catch {
    return false; // not found, or blocked by scope
  }
}

/** Returns a scope name you can pass to Command.create() to run mc. */
export async function ensureMc(opts: { localOnly?: boolean } = {}): Promise<string> {
  // 1. Already on PATH? Skipped with localOnly: the "mc" scope only allows a few
  //    fixed commands (see mc-installer.json), so the backup code needs the
  //    downloaded copy, whose scope accepts any arguments.
  if (!opts.localOnly && (await isMinioMc("mc"))) return "mc";

  const { asset, file, scope } = target();

  // 2. Installed by a previous run?
  if (await isMinioMc(scope)) return scope;

  // 3. Download (curl ships with Windows 10+, macOS and most Linux distros).
  //    GitHub redirects to a CDN, which curl -L follows.
  const dest = await join(await appLocalDataDir(), "bin", file);
  const dl = await Command.create("curl-mc", [
    "-fsSL",
    "--create-dirs",
    `${BASE_URL}/${asset}`,
    "-o",
    dest,
  ]).execute();
  if (dl.code !== 0) throw new Error(`Download failed: ${dl.stderr}`);

  // 4. Make executable on Unix.
  if (file === "mc") {
    const ch = await Command.create("chmod-mc", ["+x", dest]).execute();
    if (ch.code !== 0) throw new Error(`chmod failed: ${ch.stderr}`);
  }

  // 5. Verify.
  if (!(await isMinioMc(scope))) {
    throw new Error("Downloaded file did not run as the MinIO client");
  }
  return scope;
}