// src/lib/overview.ts
// Data for the home page overview cards.
//
// Only the local settings are real today. Role, rights, activity, deleted files
// and mirrors need your backend: replace the body of loadOverview() with your
// API call(s) and keep returning this shape. `source` flips the "Sample data"
// badge off once the data is live.

import { settings } from "$lib/store/settings.svelte";

export type Role = "admin" | "user";

export type Right = { key: string; label: string; granted: boolean };

export type Activity = {
  id: string;
  action: "upload" | "download" | "delete" | "mirror" | "login" | "settings";
  target: string;
  at: string; // ISO date
};

export type DeletedFile = {
  id: string;
  name: string;
  size: number; // bytes
  deletedAt: string; // ISO date
  isMirror: boolean; // the deleted file was a mirror copy
};

export type Mirror = {
  id: string;
  source: string;
  target: string;
  status: "synced" | "running" | "failed";
  lastRun: string; // ISO date
  files: number;
};

export type Overview = {
  source: "sample" | "live";
  user: {
    name: string;
    role: Role;
    createdAt: string;
    lastLogin: string;
  };
  rights: Right[];
  activity: Activity[];
  deleted: DeletedFile[];
  mirrors: Mirror[];
};

export async function loadOverview(): Promise<Overview> {
  await settings.hydrated;

  // TODO: replace everything below with your API call(s), e.g. an oRPC
  // `overview.get()` that returns the signed-in user's role, rights, recent
  // actions, deleted files and mirror jobs.
  const now = Date.now();
  const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

  return {
    source: "sample",
    user: {
      name: settings.data.s3AccessKey || "user",
      role: "admin",
      createdAt: ago(60 * 24 * 90),
      lastLogin: ago(12),
    },
    rights: [
      { key: "read", label: "View files", granted: true },
      { key: "write", label: "Upload files", granted: true },
      { key: "delete", label: "Delete files", granted: true },
      { key: "mirror", label: "Manage mirrors", granted: true },
      { key: "users", label: "Manage users", granted: true },
      { key: "settings", label: "Change server settings", granted: false },
    ],
    activity: [
      { id: "a1", action: "upload", target: "reports/q3-summary.pdf", at: ago(8) },
      { id: "a2", action: "mirror", target: "documents → backup-site", at: ago(55) },
      { id: "a3", action: "delete", target: "tmp/old-export.csv", at: ago(190) },
      { id: "a4", action: "download", target: "photos/team.zip", at: ago(60 * 26) },
      { id: "a5", action: "login", target: "Signed in", at: ago(60 * 27) },
    ],
    deleted: [
      { id: "d1", name: "tmp/old-export.csv", size: 1_840_000, deletedAt: ago(190), isMirror: false },
      { id: "d2", name: "backup-site/documents/draft.docx", size: 92_000, deletedAt: ago(60 * 30), isMirror: true },
      { id: "d3", name: "backup-site/photos/img-0042.jpg", size: 4_200_000, deletedAt: ago(60 * 52), isMirror: true },
    ],
    mirrors: [
      { id: "m1", source: "documents", target: "backup-site/documents", status: "synced", lastRun: ago(55), files: 1284 },
      { id: "m2", source: "photos", target: "backup-site/photos", status: "running", lastRun: ago(3), files: 8421 },
      { id: "m3", source: "archive", target: "cold-storage/archive", status: "failed", lastRun: ago(60 * 9), files: 312 },
    ],
  };
}