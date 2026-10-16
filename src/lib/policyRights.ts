// src/lib/policyRights.ts
// Turns an S3 / IAM-style policy (like backup-policy.json) into the "Rights"
// list shown on the home page.
//
// Usage:
//   import policy from "$lib/backup-policy.json";
//   const rights = rightsFromPolicy(policy);

import type { Right } from "$lib/overview";

type Statement = {
  Effect: string; // "Allow" | "Deny" (plain string so a JSON import type-checks)
  Action: string | string[];
  Resource?: string | string[];
};
type Policy = { Statement: Statement[] };

const toArray = <T>(v: T | T[] | undefined): T[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];

/** Match an action pattern such as "s3:Get*" or "s3:*" against an action. */
function matches(pattern: string, action: string): boolean {
  const re = new RegExp(
    "^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$",
    "i",
  );
  return re.test(action);
}

/** True if some Allow covers the action and no Deny does. */
function allows(policy: Policy, action: string): boolean {
  let allowed = false;
  for (const s of policy.Statement) {
    const hit = toArray(s.Action).some((p) => matches(p, action));
    if (!hit) continue;
    if (s.Effect === "Deny") return false;
    allowed = true;
  }
  return allowed;
}

const RIGHTS: { key: string; label: string; actions: string[] }[] = [
  { key: "list", label: "List files", actions: ["s3:ListBucket"] },
  { key: "read", label: "Download files", actions: ["s3:GetObject"] },
  { key: "write", label: "Upload files", actions: ["s3:PutObject"] },
  { key: "delete", label: "Delete files", actions: ["s3:DeleteObject"] },
  {
    key: "versions",
    label: "Read & delete file versions",
    actions: ["s3:GetObjectVersion", "s3:DeleteObjectVersion"],
  },
  {
    key: "multipart",
    label: "Large (multipart) uploads",
    actions: ["s3:ListMultipartUploadParts", "s3:AbortMultipartUpload"],
  },
  // Not granted by the backup policy; shown as "No access".
  { key: "buckets", label: "Create or delete buckets", actions: ["s3:CreateBucket", "s3:DeleteBucket"] },
];

export function rightsFromPolicy(policy: Policy): Right[] {
  return RIGHTS.map((r) => ({
    key: r.key,
    label: r.label,
    granted: r.actions.every((a) => allows(policy, a)),
  }));
}

/** Buckets the policy touches, e.g. ["backups"]. */
export function policyBuckets(policy: Policy): string[] {
  const out = new Set<string>();
  for (const s of policy.Statement) {
    for (const res of toArray(s.Resource)) {
      const m = /^arn:aws:s3:::([^/*]+)/.exec(res);
      if (m) out.add(m[1]);
    }
  }
  return [...out];
}