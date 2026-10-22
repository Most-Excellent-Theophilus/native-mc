import { createScopedStore } from "./configs/tauri-store.svelte";

/** Where a folder is backed up to. */
export type BackupTarget = "personal" | "common";

/** One folder in the backup list. */
export type BackupSource = {
  id: string;
  folder: string;
  target: BackupTarget;
  /** Folder name used inside the bucket, unique per target. */
  prefix: string;
  /** Per-folder options. Missing = use the defaults below (older entries). */
  watch?: boolean;
  removeDeleted?: boolean;
  settleMinutes?: number;
};

/** Shared by everyone who uses this computer: which server, and who is signed in. */
const DEVICE = {
  serverIp: "",
  s3Endpoint: "",
  s3AccessKey: "",
  s3Alias: "",
};

/** Private to the signed-in user (stored in their own file, see tauri-store). */
const USER = {
  // Backup card
  backupSources: [] as BackupSource[],
  personalBucket: "personal", // private files: <bucket>/<your user>/<folder>
  commonBucket: "common", // shared files: <bucket>/<folder>
  backupFolder: "", // legacy single folder, migrated into backupSources
  backupBucket: "", // legacy
  backupWatch: true, // keep watching after the first sync
  backupRemoveDeleted: false, // also delete from the bucket what you delete locally
  backupSettleMinutes: 15, // a file is uploaded only after it has been unchanged this long (0 = at once)

  // File browser
  viewMode: "grid" as "grid" | "list",

  // Sidebar
  sidebarWidth: 288, // px, set by dragging the sidebar edge
};

export const settings = createScopedStore({
  deviceFile: "settings.json",
  device: DEVICE,
  user: USER,
  userIdKey: "s3AccessKey", // whoever is signed in owns the "user" part
});
