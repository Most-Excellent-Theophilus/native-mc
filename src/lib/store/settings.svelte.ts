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
  backupActive: false, // was running when the app last closed, so resume on launch

  // Sidebar
  sidebarWidth: 288, // px, set by dragging the sidebar edge
});