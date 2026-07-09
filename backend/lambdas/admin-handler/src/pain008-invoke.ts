// Shared sync-invoke shim for the pain008-generator Lambda.
//
// Two call-sites use this:
//   - routes/patch-ticket.ts: invokes on the * → APPROVED state delta.
//   - routes/post-pain008-rebuild.ts: operator retry endpoint when the
//     patch-ticket invoke threw (transient S3/SES/decryption fail) and
//     the mandate row is left with no pain008_built_at.
//
// `@railback/pain008-generator` is a runtime dependency (package.json
// `dependencies`), so a real Lambda deploy bundles it. Any import failure
// — including ERR_MODULE_NOT_FOUND for our own specifier — propagates
// unchanged: a missing import is a deploy bug; we surface it as 500 not
// silently skip. Silently swallowing it would let admin APPROVE tickets
// with zero pain008 XML ever built, losing SEPA-audit data without trace.
//
// Deploy shape (locked 2026-07-09, "merge into caller"): pain008-generator is
// NOT a standalone AWS function. It is bundled INTO admin-handler by esbuild
// via this in-process dynamic import (see scripts/build-lambdas.sh), so the
// call stays in-process on AWS too — no cross-Lambda Invoke, no invoke IAM.

export async function invokePain008Generator(args: {
  email: string;
  ticketId: string;
}): Promise<void> {
  const mod: { generatePain008?: (args: { email: string; ticketId: string }) => Promise<void> } =
    await import("@railback/pain008-generator");
  if (typeof mod.generatePain008 === "function") {
    await mod.generatePain008(args);
  }
}
