// invoke-extractor.ts — synchronous cross-Lambda invoke of the Python
// ticket-extractor, used in the single-function (Function URL) deployment where
// there is no S3 ObjectCreated trigger to drive extraction automatically.
//
// In the full multi-Lambda AWS design, uploading the raw file to S3 fires the
// extractor via an S3 event. In the student-sandbox single-function deployment
// we have no triggers, so `upload-confirm` calls this helper to invoke the
// extractor directly with a SYNTHETIC S3 event of exactly the shape the
// extractor already parses (handler.py reads record.s3.bucket.name /
// .object.key). The extractor does its normal GetObject → Aztec/PDF-text →
// DDB-write and returns a summary; we ignore the summary and re-read the ticket.
//
// Gated on RAILBACK_EXTRACTOR_FUNCTION: if unset (local/dev/memory, or a deploy
// that has no extractor slot), this is a no-op and extraction stays "async"
// (the ticket sits in its current extraction_status and the caller can retry).
// Best-effort: an invoke failure NEVER fails the upload-confirm — it's logged
// and swallowed so the user isn't blocked; the ticket simply isn't extracted yet.

import { log } from "@railback/lib/http/logging";

export interface InvokeExtractorArgs {
  bucket: string;
  key: string;
}

/** True when a dedicated extractor function is configured for this deploy. */
export function extractorConfigured(): boolean {
  return typeof process.env["RAILBACK_EXTRACTOR_FUNCTION"] === "string"
    && process.env["RAILBACK_EXTRACTOR_FUNCTION"]!.length > 0;
}

/**
 * Synchronously invoke the ticket-extractor with a synthetic S3 event.
 * Returns true if the invoke succeeded (extractor ran without a function
 * error), false otherwise. Never throws — extraction is best-effort.
 */
export async function invokeExtractor(args: InvokeExtractorArgs): Promise<boolean> {
  const fn = process.env["RAILBACK_EXTRACTOR_FUNCTION"];
  if (!fn) return false;
  const region = process.env["RAILBACK_AWS_REGION"] ?? "eu-north-1";

  // Synthetic S3 ObjectCreated event — exactly what handler.py:92-93 reads.
  const payload = {
    Records: [
      { s3: { bucket: { name: args.bucket }, object: { key: args.key } } },
    ],
  };

  try {
    // Dynamic import so the AWS SDK dependency only loads on the real invoke
    // path (kept out of the memory-mode test path). The Node 20 Lambda runtime
    // provides @aws-sdk/client-lambda; the bundler marks it external.
    const { LambdaClient, InvokeCommand } = await import("@aws-sdk/client-lambda");
    const client = new LambdaClient({ region });
    const res = await client.send(
      new InvokeCommand({
        FunctionName: fn,
        InvocationType: "RequestResponse", // synchronous — wait for extraction
        Payload: Buffer.from(JSON.stringify(payload)),
      }),
    );
    if (res.FunctionError) {
      const body = res.Payload ? Buffer.from(res.Payload).toString("utf8") : "";
      log.warn("extractor.invoke.function_error", { fn, error: res.FunctionError, body: body.slice(0, 500) });
      return false;
    }
    log.info("extractor.invoke.ok", { fn, key: args.key });
    return true;
  } catch (err) {
    log.error("extractor.invoke.failed", {
      fn,
      key: args.key,
      message: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
