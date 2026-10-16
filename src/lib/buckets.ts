
import { Command } from "@tauri-apps/plugin-shell";
import { ensureMc } from "$lib/comands";
import { settings } from "$lib/store/settings.svelte";
import { policyBuckets } from "$lib/policyRights";
import policy from "$lib/backup-policy.json";

export async function listBuckets(): Promise<string[]> {
  await settings.hydrated;
  const alias = settings.data.s3Alias;
  if (!alias) return [];

  const scope = await ensureMc({ localOnly: true });
  try {
    const r = await Command.create(scope, ["ls", "--json", alias]).execute();
    if (r.code === 0) {
      const names: string[] = [];
      for (const line of r.stdout.split("\n")) {
        if (!line.trim()) continue;
        try {
          const o = JSON.parse(line);
          if (o.status === "success" && o.key) names.push(String(o.key).replace(/\/$/, ""));
        } catch {
          /* ignore non-JSON lines */
        }
      }
      if (names.length) return names.sort();
    }
  } catch {
    /* fall through to the policy */
  }
  return policyBuckets(policy).sort();
}