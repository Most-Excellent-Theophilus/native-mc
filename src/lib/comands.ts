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
import { download } from "@tauri-apps/plugin-upload";
import { mkdir } from "@tauri-apps/plugin-fs";
/** Rejects if `p` takes longer than `ms`, so a stuck process can't freeze startup. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

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
    const out = await withTimeout(
      Command.create(scopeName, ["--version"]).execute(),
      8_000,
      "Client check",
    );
    return out.code === 0 && out.stdout.includes("mc version");
  } catch {
    return false; // not found, or blocked by scope
  }
}



/** Absolute path of the mc binary that ensureMc({ localOnly: true }) installs.
 *  The Rust backup engine runs this directly. */
export async function localMcPath(): Promise<string> {
  const { file } = target();
  return join(await appLocalDataDir(), "bin", file);
}

type Opts = {
  localOnly?: boolean;
  /** 0-100, or null when the server doesn't send a content length */
  onProgress?: (pct: number | null) => void;
};

export async function ensureMc(opts: Opts = {}): Promise<string> {
  if (!opts.localOnly && (await isMinioMc("mc"))) return "mc";

  const { asset, file, scope } = target();
  if (await isMinioMc(scope)) return scope;

  // 3. Download with progress
  const dir = await join(await appLocalDataDir(), "bin");
  await mkdir(dir, { recursive: true });
  const dest = await join(dir, file);

  opts.onProgress?.(0);

  // Stall watchdog: fail if nothing arrives for 45 s (no network, GitHub blocked...),
  // instead of showing the loading screen forever. Any progress resets the clock.
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  let fail: (e: Error) => void = () => {};
  const stalled = new Promise<never>((_, reject) => (fail = reject));
  const arm = () => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(
      () =>
        fail(
          new Error(
            "Couldn't download the storage client (no data for 45 s). Check your internet connection, or that github.com is reachable.",
          ),
        ),
      45_000,
    );
  };
  arm();
  try {
    await Promise.race([
      download(`${BASE_URL}/${asset}`, dest, ({ progressTotal, total }) => {
        arm();
        opts.onProgress?.(
          total > 0 ? Math.min(100, Math.round((progressTotal / total) * 100)) : null,
        );
      }),
      stalled,
    ]);
  } finally {
    clearTimeout(stallTimer);
  }

  // 4. chmod and 5. verify stay the same
  if (file === "mc") {
    const ch = await withTimeout(
      Command.create("chmod-mc", ["+x", dest]).execute(),
      8_000,
      "Setting permissions",
    );
    if (ch.code !== 0) throw new Error(`chmod failed: ${ch.stderr}`);
  }
  if (!(await isMinioMc(scope))) {
    throw new Error("Downloaded file did not run as the MinIO client");
  }
  return scope;
}