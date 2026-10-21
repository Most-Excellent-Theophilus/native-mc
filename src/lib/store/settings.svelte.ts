import { createTypedStore } from "./configs/tauri-store.svelte";

export const settings = createTypedStore("settings.json", {
  serverIp: "",
  s3Endpoint: "",
  s3AccessKey: "",
  s3Alias: "",

  // Backup card
  backupFolder: "",
  backupBucket: "",
  backupWatch: true, // keep watching after the first sync
  backupRemoveDeleted: false, // also delete from the bucket what you delete locally
  backupSettleMinutes: 15, // a file is uploaded only after it has been unchanged this long (0 = at once)

  // File browser
  viewMode: "grid" as "grid" | "list",

  // Sidebar
  sidebarWidth: 288, // px, set by dragging the sidebar edge
});