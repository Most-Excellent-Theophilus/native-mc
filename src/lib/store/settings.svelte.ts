import { createTypedStore } from "./configs/tauri-store.svelte";

export const settings = createTypedStore("settings.json", {
  serverIp: "",
  s3Endpoint: "",
  s3AccessKey: "",
  s3Alias: "",
});
