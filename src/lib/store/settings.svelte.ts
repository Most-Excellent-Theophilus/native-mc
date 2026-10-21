import { createTypedStore } from "./configs/tauri-store.svelte";

/** Where a folder is backed up to. */
export type BackupTarget = "personal" | "common";

/** One folder in the backup list. */
export type BackupSource = {
  id: string;
  folder: string;
  target: BackupTarget;
  /** Folder name used inside the bucket, unique per target. */
  prefix: string;
};

export const settings = createTypedStore("settings.json", {
  serverIp: "",
  s3Endpoint: "",
  s3AccessKey: "",
  s3Alias: "",

  // Backup card
  backupSources: [] as BackupSource[],
  personalBucket: "personal", // private files: <bucket>/<your user>/<folder>
  commonBucket: "common", // shared files: <bucket>/<folder>
  backupFolder: "", // legacy single folder, migrated into backupSources
  backupBuckets: [""] as string[], // legacy
  backupWatch: true, // keep watching after the first sync
  backupRemoveDeleted: false, // also delete from the bucket what you delete locally
  backupSettleMinutes: 15, // a file is uploaded only after it has been unchanged this long (0 = at once)

  // File browser
  viewMode: "grid" as "grid" | "list",

  // Sidebar
  sidebarWidth: 288, // px, set by dragging the sidebar edge
});
