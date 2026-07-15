import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  NoSuchKey,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { fromCognitoIdentityPool } from "@aws-sdk/credential-providers";

// Mirrors @aws-sdk/s3-presigned-post's internal Conditions union (not exported
// from the package root). Keeps the presignPost policy array well-typed.
type PresignCondition =
  | ["eq", string, string]
  | ["starts-with", string, string]
  | ["content-length-range", number, number]
  | Record<string, string>;

/**
 * Blob storage connector for S3. All ticket-related bytes live here:
 * raw uploads, rendered EU-form PDFs, receipts (belege), pain.008 XML,
 * and admin-uploaded SEPA reports.
 *
 * Layout: single bucket, prefixes distinguish artefact classes (see
 * CLAUDE.md "S3 bucket layout"). This connector is prefix-agnostic —
 * callers pass full object keys.
 *
 * Env vars:
 *   RAILBACK_S3_BUCKET   (required)
 *   RAILBACK_S3_REGION   (default: eu-north-1, same as DDB region)
 *   S3_ENDPOINT_URL      (optional, for LocalStack / MinIO)
 *   RAILBACK_COGNITO_IDENTITY_POOL_ID (optional, DEMO-only — see presignPost)
 */
export class S3BlobConnector {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly region: string;
  private regionAssertionDone = false;
  private readonly injectedClient: boolean;
  private cognitoClientCache: S3Client | null = null;

  constructor(opts?: { client?: S3Client; bucket?: string; region?: string; assertRegion?: boolean }) {
    this.bucket = opts?.bucket ?? process.env["RAILBACK_S3_BUCKET"] ?? "railback-storage";
    this.region = opts?.region ?? process.env["RAILBACK_S3_REGION"] ?? "eu-north-1";
    const endpoint = process.env["S3_ENDPOINT_URL"];
    this.injectedClient = !!opts?.client;
    this.client = opts?.client ?? new S3Client({
      region: this.region,
      ...(endpoint ? {
        endpoint,
        forcePathStyle: true,
        credentials: { accessKeyId: "fake", secretAccessKey: "fake" },
      } : {}),
    });
    // Opt-in boot-time region check — off by default so unit tests don't
    // hit the network. Callers running in prod should pass assertRegion: true.
    if (opts?.assertRegion) {
      void this.assertBucketRegion();
    }
  }

  /**
   * The S3 client used to SIGN presigned POST policies AND to run server-side
   * writes (putObject). Normally this is the same `this.client` (default
   * credential chain). But in the demo deploy the function's own IAM role is
   * DENIED s3:PutObject everywhere, so a presign it signs — and any PutObject
   * it runs directly — is rejected by S3 with 403, while the shared Cognito
   * unauthenticated identity pool's role IS allowed s3:PutObject (probed
   * 2026-07-11 / re-confirmed 2026-07-15). When RAILBACK_COGNITO_IDENTITY_POOL_ID
   * is set we build a SEPARATE client that signs with that Cognito identity.
   *
   * Scope is WRITE + presign-signing. getObject/deleteObject keep using
   * `this.client`: the Cognito role can GetObject nowhere, and reads in the
   * demo go through plain public HTTPS URLs (objects are written public-read),
   * not this connector's getObject. DEMO-only; unset the env var to revert to
   * the default chain.
   *
   * Disabled when a client was injected (tests) or S3_ENDPOINT_URL is set
   * (LocalStack/MinIO) — those never want the real Cognito flow.
   */
  private writeClient(): S3Client {
    if (this.cognitoClientCache) return this.cognitoClientCache;
    const poolId = process.env["RAILBACK_COGNITO_IDENTITY_POOL_ID"];
    const endpoint = process.env["S3_ENDPOINT_URL"];
    if (this.injectedClient || endpoint || !poolId) {
      this.cognitoClientCache = this.client;
      return this.cognitoClientCache;
    }
    const cognitoRegion = process.env["RAILBACK_COGNITO_REGION"] ?? this.region;
    this.cognitoClientCache = new S3Client({
      region: this.region,
      credentials: fromCognitoIdentityPool({
        identityPoolId: poolId,
        clientConfig: {
          region: cognitoRegion,
          // Anonymous internal Cognito client so GetId /
          // GetCredentialsForIdentity run unauthenticated (like the browser),
          // never inheriting the Lambda execution role's container creds.
          credentials: async () => ({ accessKeyId: "", secretAccessKey: "" }),
        },
      }),
    });
    return this.cognitoClientCache;
  }

  /**
   * True in the demo deploy (Cognito pool set, not LocalStack): objects must be
   * written `public-read` because the account grants no principal s3:GetObject,
   * so reads happen via plain public HTTPS URLs. Mirrors the presignPost ACL
   * gate below.
   */
  private demoPublicRead(): boolean {
    return (
      !this.injectedClient &&
      !!process.env["RAILBACK_COGNITO_IDENTITY_POOL_ID"] &&
      !process.env["S3_ENDPOINT_URL"]
    );
  }

  /**
   * @deprecated retained name for the presign path; delegates to writeClient()
   * so presign + putObject share one Cognito-signed client.
   */
  private presignClient(): S3Client {
    return this.writeClient();
  }


  /**
   * Verifies the configured bucket is in the configured region. Throws if
   * HeadBucket surfaces a different region (via x-amz-bucket-region header
   * on the 301/error response). Idempotent — only runs once per instance.
   */
  private async assertBucketRegion(): Promise<void> {
    if (this.regionAssertionDone) return;
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (err) {
      if (err instanceof S3ServiceException) {
        const actual = err.$response?.headers?.["x-amz-bucket-region"];
        if (actual && actual !== this.region) {
          throw new Error(
            `S3BlobConnector: bucket ${this.bucket} is in region ${actual} ` +
            `but configured region is ${this.region}`,
          );
        }
      }
      throw err;
    }
    this.regionAssertionDone = true;
  }

  /** Fetches an object. Returns null on NoSuchKey; other errors bubble. */
  async getObject(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    try {
      const resp = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const bytes = await resp.Body!.transformToByteArray();
      return { bytes, contentType: resp.ContentType ?? "application/octet-stream" };
    } catch (err) {
      if (err instanceof NoSuchKey) return null;
      if (err instanceof S3ServiceException && err.name === "NoSuchKey") return null;
      throw err;
    }
  }

  /** Uploads bytes verbatim. Overwrites existing object.
   *
   * Uses writeClient() so the demo deploy signs with the Cognito unauth
   * identity (the only principal allowed s3:PutObject; the execution role is
   * denied → 403). In that same demo case the object is written public-read
   * so it can be read back via a plain public HTTPS URL (no principal has
   * s3:GetObject). Production-with-real-IAM / tests / LocalStack keep the
   * default client and set no ACL.
   */
  async putObject(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.writeClient().send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: bytes,
      ContentType: contentType,
      ...(this.demoPublicRead() ? { ACL: "public-read" as const } : {}),
    }));
  }

  /** Idempotent delete. NoSuchKey is silently swallowed. */
  async deleteObject(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (err) {
      if (err instanceof NoSuchKey) return;
      if (err instanceof S3ServiceException && err.name === "NoSuchKey") return;
      throw err;
    }
  }

  /**
   * Presigned POST URL with content-length-range + Content-Type pinning
   * enforced in the policy. See CLAUDE.md — presigned POST is the locked
   * pattern (2026-06-18) precisely because PUT can't enforce size caps.
   */
  async presignPost(
    key: string,
    contentType: string,
    sizeMin: number,
    sizeMax: number,
    ttlSec: number,
  ): Promise<{ url: string; fields: Record<string, string> }> {
    // DEMO read model: when the Cognito demo identity is in play the account's
    // role can PutObject but nothing (not even the demo role) can GetObject on
    // raw/ belege/. Per the account owner (2026-07-13): "nach dem Upload
    // erhältst Du eine S3Location. Von dieser kann die Ressource geladen
    // werden." — i.e. objects are read back via their plain public HTTPS URL.
    // That only works if the object is uploaded ACL: public-read (exactly what
    // the browser demo does). So in the demo deploy we pin the ACL into the
    // POST policy. Gated on the SAME env var as the Cognito presign client, so
    // production-with-proper-IAM and tests/local keep the private no-ACL
    // behaviour (locked 2026-06-18 CLAUDE.md: presign sets no ACL).
    const demoPublicRead = this.demoPublicRead();
    const conditions: PresignCondition[] = [
      ["content-length-range", sizeMin, sizeMax],
      ["eq", "$Content-Type", contentType],
    ];
    const fields: Record<string, string> = { "Content-Type": contentType };
    if (demoPublicRead) {
      conditions.push({ acl: "public-read" });
      fields["acl"] = "public-read";
    }
    const { url, fields: signedFields } = await createPresignedPost(this.presignClient(), {
      Bucket: this.bucket,
      Key: key,
      Conditions: conditions,
      Fields: fields,
      Expires: ttlSec,
    });
    return { url, fields: signedFields };
  }
}
