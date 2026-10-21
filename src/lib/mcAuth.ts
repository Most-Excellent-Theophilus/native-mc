// src/lib/mcAuth.ts
// Checks whether mc is already logged in to an S3-compatible store.
// "Logged in" = an alias with real credentials whose server accepts them.

import { Command } from "@tauri-apps/plugin-shell";

export type S3Login = { alias: string; url: string };

const ALIAS_RE = /^[A-Za-z0-9_-]+$/;

/** Buckets the access policy (backup-policy.json) grants. Credentials are verified by
 *  listing one of them: `common` is listable as a whole, `personal` only under
 *  `personal/<your user>/`. Listing all buckets is not allowed (no s3:ListAllMyBuckets). */
export const COMMON_BUCKET = "common";
export const PERSONAL_BUCKET = "personal";

/** Scope names for the PATH `mc`, or the scope name returned by ensureMc(). */
function names(mcScope: string) {
  return mcScope === "mc"
    ? { list: "mc-alias-list", ls: "mc-ls", set: "mc-alias-set", remove: "mc-alias-remove" }
    : { list: mcScope, ls: mcScope, set: mcScope, remove: mcScope };
}

/** Rejects if `p` takes longer than `ms`. (The underlying process may keep running;
 *  the point is that the UI never waits on it forever.) */
export function withTimeout<T>(p: Promise<T>, ms: number, label = "operation"): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

type McResult = { code: number | null; stdout: string; stderr: string };
type Reason = "ok" | "auth" | "cert" | "network" | "denied" | "other";

/** Reads mc's JSON error line (or plain text) into one short message. */
function mcMessage(r: McResult): string {
  for (const text of [r.stdout, r.stderr]) {
    for (const line of text.split("\n").reverse()) {
      try {
        const m = JSON.parse(line)?.error?.message;
        if (typeof m === "string" && m) return m;
      } catch {
        /* not JSON */
      }
    }
  }
  return (r.stderr || r.stdout || "").trim().split("\n").pop()?.slice(0, 200) ?? "";
}

/** Tells apart wrong password, unreachable server and missing permission. */
export function classify(r: McResult): Reason {
  if (r.code === 0) return "ok";
  const t = `${r.stdout}\n${r.stderr}`.toLowerCase();
  if (/x509|certificate/.test(t)) return "cert";
  if (/invalidaccesskeyid|signaturedoesnotmatch|access key id you provided|signature we calculated|invalid access key|unable to initialize new alias/.test(t))
    return "auth";
  if (/connection refused|no such host|i\/o timeout|dial tcp|no route to host|network is unreachable|context deadline|timed out|timeout/.test(t))
    return "network";
  if (/access denied|accessdenied/.test(t)) return "denied"; // credentials were accepted
  return "other";
}

function explain(reason: Reason, r: McResult): string {
  switch (reason) {
    case "auth":
      return "Wrong username or password.";
    case "cert":
      return "The server's HTTPS certificate isn't trusted. Use an http:// address or install the certificate.";
    case "network":
      return "Can't reach the server. Check the endpoint address and your network.";
    case "denied":
      return `Your login is correct, but this account can't access the "${COMMON_BUCKET}" or "${PERSONAL_BUCKET}" bucket. Ask your administrator.`;
    default:
      return mcMessage(r) || "Login failed.";
  }
}

/** Paths this account can list under the policy. */
function probePaths(alias: string, accessKey?: string): string[] {
  const p = [`${alias}/${COMMON_BUCKET}`];
  if (accessKey) p.push(`${alias}/${PERSONAL_BUCKET}/${accessKey}`);
  return p;
}

/** Proves the credentials work: ok if ANY allowed path lists. Otherwise returns the
 *  most telling failure (bad password > unreachable > no permission). */
async function probe(
  n: ReturnType<typeof names>,
  alias: string,
  accessKey: string | undefined,
  timeoutMs: number,
): Promise<{ ok: true } | { ok: false; reason: Reason; result: McResult }> {
  const rank: Reason[] = ["auth", "cert", "network", "other", "denied"];
  // All paths at once, so a dead server costs one timeout, not one per path.
  const results = await Promise.all(
    probePaths(alias, accessKey).map(async (path) => {
      let result: McResult;
      try {
        result = await withTimeout(
          Command.create(n.ls, ["ls", "--json", path]).execute(),
          timeoutMs,
          "Server check",
        );
      } catch (e) {
        result = { code: -1, stdout: "", stderr: e instanceof Error ? e.message : String(e) };
      }
      return { reason: classify(result), result };
    }),
  );
  if (results.some((r) => r.reason === "ok")) return { ok: true };
  results.sort((x, y) => rank.indexOf(x.reason) - rank.indexOf(y.reason));
  return { ok: false, ...results[0] };
}

export type SavedLogin = S3Login & { accessKey: string };

/**
 * Saved aliases that have real credentials. Local and fast: it only reads mc's
 * config, never touches the network, so it is safe to await at startup.
 * @param opts.ignore aliases to skip (default: MinIO's public "play" server)
 */
export async function localLogins(
  mcScope: string,
  opts: { ignore?: string[]; timeoutMs?: number } = {},
): Promise<SavedLogin[]> {
  const { ignore = ["play"], timeoutMs = 8_000 } = opts;
  const n = names(mcScope);

  // Output is one JSON object per line (includes secrets, so keep only
  // alias + url + access key and never log the raw output).
  const list = await withTimeout(
    Command.create(n.list, ["alias", "list", "--json"]).execute(),
    timeoutMs,
    "Reading saved logins",
  );
  if (list.code !== 0) return [];

  const out: SavedLogin[] = [];
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
        out.push({ alias: a.alias, url: a.URL, accessKey: a.accessKey });
      }
    } catch {
      /* ignore non-JSON lines */
    }
  }
  return out;
}

/**
 * Asks the server whether a saved login still works.
 *  "ok"          the server accepted it
 *  "invalid"     the server rejected the username/password: sign in again
 *  "unverified"  couldn't tell (offline, timeout, no bucket permission): keep the login
 */
export async function verifyLogin(
  mcScope: string,
  login: SavedLogin,
  timeoutMs = 8_000,
): Promise<"ok" | "invalid" | "unverified"> {
  const r = await probe(names(mcScope), login.alias, login.accessKey, timeoutMs);
  if (r.ok) return "ok";
  return r.reason === "auth" ? "invalid" : "unverified";
}

/** Every saved alias whose credentials the server accepts (network required). */
export async function findS3Logins(
  mcScope: string,
  opts: { ignore?: string[]; timeoutMs?: number } = {},
): Promise<S3Login[]> {
  const saved = await localLogins(mcScope, opts);
  const checked = await Promise.all(
    saved.map(async (c) =>
      (await verifyLogin(mcScope, c, opts.timeoutMs)) === "ok"
        ? { alias: c.alias, url: c.url }
        : null,
    ),
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
  // Pasted credentials often carry a stray space/newline; a trailing "/" breaks the URL.
  endpoint = endpoint.trim().replace(/\/+$/, "");
  accessKey = accessKey.trim();
  secretKey = secretKey.trim();

  const set = await Command.create(n.set, [
    "alias",
    "set",
    alias,
    endpoint,
    accessKey,
    secretKey,
  ]).execute();
  if (set.code !== 0) {
    throw new Error(explain(classify(set), set));
  }

  const r = await probe(n, alias, accessKey, 10_000);
  if (!r.ok) {
    // Don't leave a half-working alias behind.
    await Command.create(n.remove, ["alias", "remove", alias]).execute().catch(() => {});
    throw new Error(explain(r.reason, r.result));
  }
}
