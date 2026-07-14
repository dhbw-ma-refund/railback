// Jest globalSetup — bootstraps the DDB Local table + S3 bucket before any
// test file runs. Idempotent; safe to re-run. Both are best-effort: if the
// endpoints are unreachable the individual suites skip / fail on their own.

import { createTable } from "./create-ddb-table.mjs";
import { S3Client, CreateBucketCommand, HeadBucketCommand } from "@aws-sdk/client-s3";

async function ensureBucket() {
  const endpoint = process.env.S3_ENDPOINT_URL;
  if (!endpoint) return; // no LocalStack configured — skip
  const bucket = process.env.RAILBACK_S3_BUCKET || "railback-test";
  const region = process.env.RAILBACK_S3_REGION || "eu-north-1";
  const s3 = new S3Client({
    region,
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: "fake", secretAccessKey: "fake" },
  });
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    try {
      await s3.send(new CreateBucketCommand({ Bucket: bucket }));
      // eslint-disable-next-line no-console
      console.log(`[jest-global-setup] created bucket ${bucket}`);
    } catch {
      /* race or unreachable — suites handle their own skip */
    }
  }
}

export default async function globalSetup() {
  const r = await createTable();
  if (r.status === "created") {
    // eslint-disable-next-line no-console
    console.log(`[jest-global-setup] created table ${r.tableName}`);
  }
  await ensureBucket();
}
