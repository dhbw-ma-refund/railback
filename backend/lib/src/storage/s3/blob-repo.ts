// Real BlobRepo backed by DynamoDB (metadata) + S3 (bytes).
//
// Per CLAUDE.md ("Blobs leben in S3, nicht in DDB"): the bytes live in S3,
// the metadata row (s3_bucket, s3_key, size_bytes, content_type, ttl)
// lives in DDB. This class encapsulates both sides:
//
//   getRawUpload / getRenderedPdf / listReceipts → DDB GetItem / Query
//   putRawUpload / putRenderedPdf / putReceipt   → DDB PutItem (caller
//     has already PUT the bytes to S3 via the presigned-POST flow)
//   presignRawUploadPost / presignReceiptPost     → @railback/lib/storage/s3
//     presignPost helper, with the conventional key layout from CLAUDE.md
//     ("raw/<emailHash>/<ticketId>.<ext>", "belege/<emailHash>/<ticketId>/
//     <belegId>.<ext>")
//
// This module is one of two storage adapters allowed to import @aws-sdk/*
// directly (the other is lib/src/storage/ddb/). The ESLint rule in
// backend/.eslintrc.cjs whitelists lib/src/storage/s3/** and
// lib/src/storage/ddb/** for that reason.
//
// IMPORTANT: real DDB wiring requires a DynamoDBDocumentClient to be
// passed to the constructor — Phase 5 deploy-glue does that. The
// in-memory mock (mocks/in-memory) provides its own BlobRepo and is
// what tests/dev use. This class is the production path.

import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { AppError } from "../../errors/index.js";
import * as keys from "../ddb/keys.js";
import type { BlobRepo } from "../types.js";
import type {
  PresignedPost,
  RawUpload,
  RawUploadInput,
  Receipt,
  ReceiptInput,
  RenderedPdf,
  RenderedPdfInput,
} from "../../types/dto.js";
import { emailHash } from "../../util/hash.js";
import { ulid } from "../../util/ulid.js";
import {
  BELEG_UPLOAD_MAX_BYTES,
  RAW_UPLOAD_MAX_BYTES,
  presignPost,
} from "./presigned-post.js";

interface BaseItem {
  pk: string;
  sk: string;
}

interface RawUploadRow extends BaseItem {
  filename: string;
  s3_bucket: string;
  s3_key: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: string;
  ttl?: number;
}

interface RenderedPdfRow extends BaseItem {
  s3_bucket: string;
  s3_key: string;
  size_bytes: number;
  rendered_at: string;
  ttl?: number;
}

interface ReceiptRow extends BaseItem {
  belegId: string;
  filename: string;
  s3_bucket: string;
  s3_key: string;
  content_type: string;
  size_bytes: number;
  typ: "TAXI" | "BUS" | "HOTEL" | "SONSTIGES";
  amount: string;
  uploaded_at: string;
  ttl?: number;
}

function getBucket(): string {
  const b = process.env.RAILBACK_S3_BUCKET;
  if (!b) {
    throw new AppError(
      "ERR_INTERNAL",
      "RAILBACK_S3_BUCKET not set; S3BlobRepo cannot operate"
    );
  }
  return b;
}

function getTable(): string {
  const t = process.env.RAILBACK_DDB_TABLE;
  if (!t) {
    throw new AppError(
      "ERR_INTERNAL",
      "RAILBACK_DDB_TABLE not set; S3BlobRepo cannot operate"
    );
  }
  return t;
}

let _s3Client: S3Client | null = null;

/** Lazy-init S3 client for GetObject. Mirrors presigned-get.ts pattern. */
function getS3Client(): S3Client {
  if (_s3Client) return _s3Client;
  const region = process.env.RAILBACK_AWS_REGION;
  if (!region) {
    throw new AppError(
      "ERR_INTERNAL",
      "RAILBACK_AWS_REGION not set; S3BlobRepo cannot GetObject"
    );
  }
  _s3Client = new S3Client({ region });
  return _s3Client;
}

/** Reset cached S3 client. Test-only. */
export function resetS3ClientCacheForBlobRepo(): void {
  _s3Client = null;
}

function extOf(contentType: string, filename: string): string {
  const fromName = /\.([A-Za-z0-9]+)$/.exec(filename)?.[1]?.toLowerCase();
  if (fromName) return fromName;
  if (contentType === "application/pdf") return "pdf";
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/png") return "png";
  return "bin";
}

export class S3BlobRepo implements BlobRepo {
  constructor(private readonly ddb: DynamoDBDocumentClient) {}

  // -- raw upload (1 per ticket) -------------------------------------------

  async getRawUpload(email: string, ticketId: string): Promise<RawUpload | null> {
    const norm = keys.normaliseEmail(email);
    const out = await this.ddb.send(
      new GetCommand({
        TableName: getTable(),
        Key: { pk: keys.userPk(norm), sk: keys.rawSk(ticketId) },
      })
    );
    if (!out.Item) return null;
    const r = out.Item as RawUploadRow;
    const upload: RawUpload = {
      email: norm,
      ticketId,
      filename: r.filename,
      s3_bucket: r.s3_bucket,
      s3_key: r.s3_key,
      content_type: r.content_type,
      size_bytes: r.size_bytes,
      uploaded_at: r.uploaded_at,
    };
    if (r.ttl !== undefined) upload.ttl = r.ttl;
    return upload;
  }

  async putRawUpload(
    email: string,
    ticketId: string,
    input: RawUploadInput
  ): Promise<void> {
    const norm = keys.normaliseEmail(email);
    const row: RawUploadRow = {
      pk: keys.userPk(norm),
      sk: keys.rawSk(ticketId),
      filename: input.filename,
      s3_bucket: input.s3_bucket,
      s3_key: input.s3_key,
      content_type: input.content_type,
      size_bytes: input.size_bytes,
      uploaded_at: input.uploaded_at,
    };
    if (input.ttl !== undefined) row.ttl = input.ttl;
    await this.ddb.send(new PutCommand({ TableName: getTable(), Item: row }));
  }

  // -- rendered PDF (1 per ticket) -----------------------------------------

  async getRenderedPdf(
    email: string,
    ticketId: string
  ): Promise<RenderedPdf | null> {
    const norm = keys.normaliseEmail(email);
    const out = await this.ddb.send(
      new GetCommand({
        TableName: getTable(),
        Key: { pk: keys.userPk(norm), sk: keys.renderedSk(ticketId) },
      })
    );
    if (!out.Item) return null;
    const r = out.Item as RenderedPdfRow;
    const pdf: RenderedPdf = {
      email: norm,
      ticketId,
      s3_bucket: r.s3_bucket,
      s3_key: r.s3_key,
      size_bytes: r.size_bytes,
      rendered_at: r.rendered_at,
    };
    if (r.ttl !== undefined) pdf.ttl = r.ttl;
    return pdf;
  }

  async putRenderedPdf(
    email: string,
    ticketId: string,
    input: RenderedPdfInput
  ): Promise<void> {
    const norm = keys.normaliseEmail(email);
    const row: RenderedPdfRow = {
      pk: keys.userPk(norm),
      sk: keys.renderedSk(ticketId),
      s3_bucket: input.s3_bucket,
      s3_key: input.s3_key,
      size_bytes: input.size_bytes,
      rendered_at: input.rendered_at,
    };
    if (input.ttl !== undefined) row.ttl = input.ttl;
    await this.ddb.send(new PutCommand({ TableName: getTable(), Item: row }));
  }

  // -- belege (0..5 per ticket) --------------------------------------------

  async listReceipts(email: string, ticketId: string): Promise<Receipt[]> {
    const norm = keys.normaliseEmail(email);
    const out = await this.ddb.send(
      new QueryCommand({
        TableName: getTable(),
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
        ExpressionAttributeValues: {
          ":pk": keys.userPk(norm),
          ":sk": `TICKET#${ticketId}#BELEG#`,
        },
      })
    );
    return (out.Items ?? []).map((it) => {
      const r = it as ReceiptRow;
      const beleg: Receipt = {
        email: norm,
        ticketId,
        belegId: r.belegId,
        filename: r.filename,
        s3_bucket: r.s3_bucket,
        s3_key: r.s3_key,
        content_type: r.content_type,
        size_bytes: r.size_bytes,
        typ: r.typ,
        amount: r.amount,
        uploaded_at: r.uploaded_at,
      };
      if (r.ttl !== undefined) beleg.ttl = r.ttl;
      return beleg;
    });
  }

  async putReceipt(
    email: string,
    ticketId: string,
    input: ReceiptInput
  ): Promise<Receipt> {
    const norm = keys.normaliseEmail(email);
    const row: ReceiptRow = {
      pk: keys.userPk(norm),
      sk: keys.belegSk(ticketId, input.belegId),
      belegId: input.belegId,
      filename: input.filename,
      s3_bucket: input.s3_bucket,
      s3_key: input.s3_key,
      content_type: input.content_type,
      size_bytes: input.size_bytes,
      typ: input.typ,
      amount: input.amount,
      uploaded_at: input.uploaded_at,
    };
    if (input.ttl !== undefined) row.ttl = input.ttl;
    await this.ddb.send(new PutCommand({ TableName: getTable(), Item: row }));
    const beleg: Receipt = {
      email: norm,
      ticketId,
      belegId: input.belegId,
      filename: input.filename,
      s3_bucket: input.s3_bucket,
      s3_key: input.s3_key,
      content_type: input.content_type,
      size_bytes: input.size_bytes,
      typ: input.typ,
      amount: input.amount,
      uploaded_at: input.uploaded_at,
    };
    if (input.ttl !== undefined) beleg.ttl = input.ttl;
    return beleg;
  }

  async deleteReceipt(
    email: string,
    ticketId: string,
    belegId: string
  ): Promise<void> {
    // Used by user-handler DELETE /tickets/{id}/belege/{belegId} for pre-
    // submission deletes. Hard-delete: row gone, S3 object eventually
    // pruned by lifecycle on the `belege/` prefix.
    const norm = keys.normaliseEmail(email);
    await this.ddb.send(
      new DeleteCommand({
        TableName: getTable(),
        Key: { pk: keys.userPk(norm), sk: keys.belegSk(ticketId, belegId) },
      })
    );
  }

  // -- generic bytes read --------------------------------------------------

  async getBytes(
    key: string
  ): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    try {
      const out = await getS3Client().send(
        new GetObjectCommand({ Bucket: getBucket(), Key: key })
      );
      const body = out.Body;
      if (!body) return null;
      // SDK v3 stream Body exposes transformToByteArray() in Lambda runtimes.
      const bytes = await (
        body as { transformToByteArray(): Promise<Uint8Array> }
      ).transformToByteArray();
      return {
        bytes,
        contentType: out.ContentType ?? "application/octet-stream",
      };
    } catch (err) {
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  // -- generic bytes write -------------------------------------------------

  async putBytes(
    key: string,
    bytes: Uint8Array,
    contentType: string,
    _uploadedAt: string
  ): Promise<void> {
    // uploadedAt is metadata for the caller's bookkeeping (RenderedPdf row);
    // S3 itself stamps LastModified at PUT time. We don't echo uploadedAt
    // as object metadata — that would just duplicate state. Underscore-prefix
    // the param to silence noUnusedParameters.
    await getS3Client().send(
      new PutObjectCommand({
        Bucket: getBucket(),
        Key: key,
        Body: bytes,
        ContentType: contentType,
      })
    );
  }

  // -- presigned-POST (S3) -------------------------------------------------

  async presignRawUploadPost(
    email: string,
    ticketId: string,
    contentType: string
  ): Promise<PresignedPost> {
    const norm = keys.normaliseEmail(email);
    const ext = extOf(contentType, ticketId);
    const key = `raw/${emailHash(norm)}/${ticketId}.${ext}`;
    return presignPost({
      bucket: getBucket(),
      key,
      contentType,
      maxBytes: RAW_UPLOAD_MAX_BYTES,
    });
  }

  async presignReceiptPost(
    email: string,
    ticketId: string,
    contentType: string
  ): Promise<PresignedPost> {
    const norm = keys.normaliseEmail(email);
    const belegId = ulid();
    const ext = extOf(contentType, belegId);
    const key = `belege/${emailHash(norm)}/${ticketId}/${belegId}.${ext}`;
    return presignPost({
      bucket: getBucket(),
      key,
      contentType,
      maxBytes: BELEG_UPLOAD_MAX_BYTES,
    });
  }

  // -- anonymisation-sweeper cascade --------------------------------------
  // Phase-5 wiring lands these on top of S3 DeleteObject + DDB DeleteItem.
  // The in-memory mock has the real impl; the production S3 path is
  // deferred (consistent with the rest of this file's "stub when the DDB
  // path isn't done yet" pattern).

  async deleteBytes(_key: string): Promise<void> {
    throw new AppError(
      "ERR_INTERNAL",
      "S3BlobRepo.deleteBytes: deferred to Phase 5"
    );
  }

  async deleteRawUpload(
    _email: string,
    _ticketId: string
  ): Promise<{ s3_key: string | null }> {
    throw new AppError(
      "ERR_INTERNAL",
      "S3BlobRepo.deleteRawUpload: deferred to Phase 5"
    );
  }

  async deleteRenderedPdf(
    _email: string,
    _ticketId: string
  ): Promise<{ s3_key: string | null }> {
    throw new AppError(
      "ERR_INTERNAL",
      "S3BlobRepo.deleteRenderedPdf: deferred to Phase 5"
    );
  }

  async deleteAllReceipts(
    _email: string,
    _ticketId: string
  ): Promise<{ s3_keys: string[] }> {
    throw new AppError(
      "ERR_INTERNAL",
      "S3BlobRepo.deleteAllReceipts: deferred to Phase 5"
    );
  }
}
