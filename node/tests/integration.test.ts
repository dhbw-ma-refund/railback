import { DynamoDBClient, CreateTableCommand } from "@aws-sdk/client-dynamodb";
import { S3Client, CreateBucketCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { BaseConnector } from "../src/base.js";
import { S3BlobConnector } from "../src/connectors/s3.js";

/**
 * Integration tests against LocalStack + DynamoDB Local.
 *
 * Skipped automatically if endpoints unreachable. Bring the stack up with:
 *   docker compose -f test/infra/docker-compose.yml up -d
 *
 * Or run the dedicated npm script:
 *   npm run test:integration
 *
 * Everything here is best-effort scaffolding — the primary unit test
 * coverage lives in tests/base.test.ts and tests/s3.test.ts.
 */

const DDB_URL = process.env["DYNAMODB_ENDPOINT_URL"] ?? "http://localhost:8000";
const S3_URL = process.env["S3_ENDPOINT_URL"] ?? "http://localhost:4566";
const BUCKET = process.env["RAILBACK_S3_BUCKET"] ?? "railback-integration-test";
const REGION = process.env["RAILBACK_S3_REGION"] ?? "eu-north-1";

async function probe(url: string, timeoutMs = 500): Promise<boolean> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    // Both endpoints return 400 for GET / — that's fine, we just need a socket.
    const r = await fetch(url, { signal: controller.signal }).catch(() => null);
    clearTimeout(t);
    return r !== null;
  } catch { return false; }
}

let ddbReachable = false;
let s3Reachable = false;

beforeAll(async () => {
  ddbReachable = await probe(DDB_URL);
  s3Reachable = await probe(S3_URL);
  if (!ddbReachable || !s3Reachable) return;

  // Bootstrap the DDB table if it doesn't exist
  const ddb = new DynamoDBClient({
    region: REGION, endpoint: DDB_URL,
    credentials: { accessKeyId: "fake", secretAccessKey: "fake" },
  });
  try {
    await ddb.send(new CreateTableCommand({
      TableName: process.env["RAILBACK_DDB_TABLE"] ?? "RailBack",
      BillingMode: "PAY_PER_REQUEST",
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
      AttributeDefinitions: [
        { AttributeName: "pk", AttributeType: "S" },
        { AttributeName: "sk", AttributeType: "S" },
      ],
    }));
  } catch { /* already exists */ }

  // Bootstrap S3 bucket
  const s3 = new S3Client({
    region: REGION, endpoint: S3_URL, forcePathStyle: true,
    credentials: { accessKeyId: "fake", secretAccessKey: "fake" },
  });
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
  } catch {
    try { await s3.send(new CreateBucketCommand({ Bucket: BUCKET })); }
    catch { /* race */ }
  }
});

class TestConnector extends BaseConnector {
  scan(params: Parameters<TestConnector["callScan"]>[0]) { return this.callScan(params); }
  private callScan(params: {
    FilterExpression?: string;
    ExpressionAttributeValues?: Record<string, unknown>;
    Limit?: number;
  }) { return this._scan(params); }
}

const runIntegration = process.env["RAILBACK_RUN_INTEGRATION"] === "1";
const d = runIntegration ? describe : describe.skip;

d("integration: LocalStack + DDB Local", () => {
  test("s3 round trip (put/get/delete)", async () => {
    if (!s3Reachable) { console.warn("S3 endpoint unreachable, skipping"); return; }
    const c = new S3BlobConnector({ bucket: BUCKET, region: REGION });
    await c.putObject("integration/hello.txt", new TextEncoder().encode("hello"), "text/plain");
    const got = await c.getObject("integration/hello.txt");
    expect(got).not.toBeNull();
    expect(new TextDecoder().decode(got!.bytes)).toBe("hello");
    await c.deleteObject("integration/hello.txt");
    expect(await c.getObject("integration/hello.txt")).toBeNull();
  });

  test("ddb scan primitive with real endpoint", async () => {
    if (!ddbReachable) { console.warn("DDB endpoint unreachable, skipping"); return; }
    const client = DynamoDBDocumentClient.from(new DynamoDBClient({
      region: REGION, endpoint: DDB_URL,
      credentials: { accessKeyId: "fake", secretAccessKey: "fake" },
    }));
    const tc = new TestConnector(client);
    const r = await tc.scan({ Limit: 1 });
    expect(r.isOk()).toBe(true);
  });
});
