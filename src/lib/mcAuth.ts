// src/lib/mcAuth.ts
// Checks whether mc is already logged in to an S3-compatible store.
// "Logged in" = an alias with real credentials whose server accepts them.

import { Command } from "@tauri-apps/plugin-shell";

export type S3Login = { alias: string; url: string };

const ALIAS_RE = /^[A-Za-z0-9_-]+$/;

/** Bucket the backup policy allows. Credentials are verified against it,
 *  because the policy doesn't grant s3:ListAllMyBuckets (so `mc ls <alias>` fails). */
export const BACKUP_BUCKET = "backups";

/** Scope names for the PATH `mc`, or the scope name returned by ensureMc(). */
function names(mcScope: string) {
  return mcScope === "mc"
    ? { list: "mc-alias-list", ls: "mc-ls", set: "mc-alias-set", remove: "mc-alias-remove" }
    : { list: mcScope, ls: mcScope, set: mcScope, remove: mcScope };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timed out")), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

/**
 * Returns every saved alias that has credentials AND can list buckets.
 * @param mcScope value returned by ensureMc()
 * @param opts.ignore aliases to skip (default: MinIO's public "play" server)
 */
export async function findS3Logins(
  mcScope: string,
  opts: { ignore?: string[]; timeoutMs?: number } = {},
): Promise<S3Login[]> {
  const { ignore = ["play"], timeoutMs = 10_000 } = opts;
  const n = names(mcScope);

  // 1. Saved aliases. Output is one JSON object per line (includes secrets,
  //    so we keep only alias + url and never log the raw output).
  const list = await Command.create(n.list, ["alias", "list", "--json"]).execute();
  if (list.code !== 0) return [];

  const candidates: S3Login[] = [];
  for (const line of list.stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const a = JSON.parse(line);
      const hasKeys =
        a.accessKey && a.secretKey && !/^YOUR-/i.test(a.accessKey); // skip default placeholders
      if (
        a.status === "success" &&
        ALIAS_RE.test(a.alias ?? "") &&
        hasKeys &&
        !ignore.includes(a.alias)
      ) {
        candidates.push({ alias: a.alias, url: a.URL });
      }
    } catch {
      /* ignore non-JSON lines */
    }
  }

  // 2. Prove the credentials work: listing buckets exits 0 only on success.
  const checked = await Promise.all(
    candidates.map(async (c) => {
      try {
        const r = await withTimeout(
          Command.create(n.ls, ["ls", "--json", `${c.alias}/${BACKUP_BUCKET}`]).execute(),
          timeoutMs,
        );
        return r.code === 0 ? c : null;
      } catch {
        return null; // unreachable, bad creds, or timed out
      }
    }),
  );
  return checked.filter((c): c is S3Login => c !== null);
}

export async function isLoggedIn(mcScope: string): Promise<boolean> {
  return (await findS3Logins(mcScope)).length > 0;
}

/** Log out: remove the saved alias (and its credentials) from mc. */
export async function removeAlias(mcScope: string, alias: string): Promise<void> {
  const n = names(mcScope);
  const r = await Command.create(n.remove, ["alias", "remove", alias]).execute();
  if (r.code !== 0) {
    throw new Error((r.stderr || r.stdout || "Sign out failed").trim().slice(0, 200));
  }
}

/**
 * Log in: save an alias in mc, then prove the credentials work by listing
 * buckets. Throws an Error with mc's message on failure.
 */
export async function setAlias(
  mcScope: string,
  alias: string,
  endpoint: string,
  accessKey: string,
  secretKey: string,
): Promise<void> {
  const n = names(mcScope);

  const set = await Command.create(n.set, [
    "alias",
    "set",
    alias,
    endpoint,
    accessKey,
    secretKey,
  ]).execute();
  if (set.code !== 0) {
    throw new Error((set.stderr || set.stdout || "Login failed").trim().slice(0, 200));
  }

  const ls = await withTimeout(
    Command.create(n.ls, ["ls", "--json", `${alias}/${BACKUP_BUCKET}`]).execute(),
    10_000,
  );
  if (ls.code !== 0) {
    throw new Error("The server rejected these credentials");
  }
}