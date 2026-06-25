// In-memory BlobRepo — bytes live in MemState.blobs, metadata rows mirror the
// DDB sibling-row shapes (RawUploadItem / RenderedPdfItem / OriginalReceiptItem).
// presignRawUploadPost / presignReceiptPost return deterministic shapes so
// frontend tests can assert against a stable URL/policy contract.

import { AppError, emailHash, ulid } from "@railback/lib";
import { keys } from "@railback/lib";
import type {
  BlobRepo,
  PresignedPost,
  RawUpload,
  RawUploadInput,
  Receipt,
  ReceiptInput,
  RenderedPdf,
  RenderedPdfInput,
} from "@railback/lib";
import type {
  OriginalReceiptItem,
  RawUploadItem,
  RenderedPdfItem,
} from "@railback/lib";

import { getRow, listSk, type MemState, putRow, deleteRow } from "./state.js";

const BUCKET = "memory-mock";
const RAW_MAX = 10 * 1024 * 1024; // 10 MB
const BELEG_MAX = 5 * 1024 * 1024; //  5 MB
const PRESIGN_TTL_SEC = 300;

function extFromContentType(ct: string): string {
  const m: Record<string, string> = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/heic": "heic",
  };
  return m[ct.toLowerCase()] ?? "bin";
}

function setBlob(state: MemState, key: string, bytes: Uint8Array, contentType: string, uploadedAt: string): void {
  let bucket = state.blobs.get(BUCKET);
  if (!bucket) {
    bucket = new Map();
    state.blobs.set(BUCKET, bucket);
  }
  bucket.set(key, { bytes, contentType, size: bytes.byteLength, uploadedAt });
}

export class InMemoryBlobRepo implements BlobRepo {
  constructor(private readonly state: MemState) {}

  async getRawUpload(email: string, id: string): Promise<RawUpload | null> {
    const it = getRow<RawUploadItem>(this.state, keys.userPk(email), keys.rawSk(id));
    if (!it) return null;
    const r: RawUpload = {
      email: keys.normaliseEmail(email),
      ticketId: id,
      filename: it.filename,
      s3_bucket: it.s3_bucket,
      s3_key: it.s3_key,
      content_type: it.content_type,
      size_bytes: it.size_bytes,
      uploaded_at: it.uploaded_at,
    };
    if (it.ttl !== undefined) r.ttl = it.ttl;
    return r;
  }

  async putRawUpload(email: string, id: string, input: RawUploadInput): Promise<void> {
    const item: RawUploadItem = {
      PK: keys.userPk(email),
      SK: keys.rawSk(id),
      filename: input.filename,
      s3_bucket: input.s3_bucket,
      s3_key: input.s3_key,
      content_type: input.content_type,
      size_bytes: input.size_bytes,
      uploaded_at: input.uploaded_at,
    };
    if (input.ttl !== undefined) item.ttl = input.ttl;
    putRow(this.state, item.PK, item.SK, item);
  }

  async getRenderedPdf(email: string, id: string): Promise<RenderedPdf | null> {
    const it = getRow<RenderedPdfItem>(this.state, keys.userPk(email), keys.renderedSk(id));
    if (!it) return null;
    const r: RenderedPdf = {
      email: keys.normaliseEmail(email),
      ticketId: id,
      s3_bucket: it.s3_bucket,
      s3_key: it.s3_key,
      size_bytes: it.size_bytes,
      rendered_at: it.rendered_at,
    };
    if (it.ttl !== undefined) r.ttl = it.ttl;
    return r;
  }

  async putRenderedPdf(email: string, id: string, input: RenderedPdfInput): Promise<void> {
    const item: RenderedPdfItem = {
      PK: keys.userPk(email),
      SK: keys.renderedSk(id),
      s3_bucket: input.s3_bucket,
      s3_key: input.s3_key,
      size_bytes: input.size_bytes,
      rendered_at: input.rendered_at,
    };
    if (input.ttl !== undefined) item.ttl = input.ttl;
    putRow(this.state, item.PK, item.SK, item);
  }

  async listReceipts(email: string, id: string): Promise<Receipt[]> {
    const items = listSk<OriginalReceiptItem>(this.state, keys.userPk(email), `TICKET#${id}#BELEG#`);
    return items.map((it) => {
      // SK = TICKET#<id>#BELEG#<belegId>
      const belegId = it.SK.split("#BELEG#")[1] ?? "";
      const r: Receipt = {
        email: keys.normaliseEmail(email),
        ticketId: id,
        belegId,
        filename: it.filename,
        s3_bucket: it.s3_bucket,
        s3_key: it.s3_key,
        content_type: it.content_type,
        size_bytes: it.size_bytes,
        typ: it.typ,
        amount: it.amount,
        uploaded_at: it.uploaded_at,
      };
      if (it.ttl !== undefined) r.ttl = it.ttl;
      return r;
    });
  }

  async putReceipt(email: string, id: string, input: ReceiptInput): Promise<Receipt> {
    if (input.size_bytes > BELEG_MAX) {
      throw new AppError("ERR_VALIDATION", `Beleg exceeds ${BELEG_MAX} bytes`);
    }
    const existing = await this.listReceipts(email, id);
    if (existing.length >= 5) {
      throw new AppError("ERR_CONFLICT", "Max 5 belege per ticket");
    }
    const item: OriginalReceiptItem = {
      PK: keys.userPk(email),
      SK: keys.belegSk(id, input.belegId),
      filename: input.filename,
      s3_bucket: input.s3_bucket,
      s3_key: input.s3_key,
      content_type: input.content_type,
      size_bytes: input.size_bytes,
      typ: input.typ,
      amount: input.amount,
      uploaded_at: input.uploaded_at,
    };
    if (input.ttl !== undefined) item.ttl = input.ttl;
    putRow(this.state, item.PK, item.SK, item);
    const r: Receipt = {
      email: keys.normaliseEmail(email),
      ticketId: id,
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
    if (input.ttl !== undefined) r.ttl = input.ttl;
    return r;
  }

  async deleteReceipt(email: string, id: string, belegId: string): Promise<void> {
    deleteRow(this.state, keys.userPk(email), keys.belegSk(id, belegId));
  }

  async presignRawUploadPost(email: string, id: string, contentType: string): Promise<PresignedPost> {
    const eh = emailHash(email);
    const ext = extFromContentType(contentType);
    const key = `raw/${eh}/${id}.${ext}`;
    return {
      url: "http://memory-mock/post",
      fields: {
        key,
        "Content-Type": contentType,
        "x-amz-content-length-range-min": "1",
        "x-amz-content-length-range-max": String(RAW_MAX),
      },
      key,
      expiresIn: PRESIGN_TTL_SEC,
    };
  }

  async presignReceiptPost(email: string, id: string, contentType: string): Promise<PresignedPost> {
    const eh = emailHash(email);
    const ext = extFromContentType(contentType);
    const belegId = ulid();
    const key = `belege/${eh}/${id}/${belegId}.${ext}`;
    return {
      url: "http://memory-mock/post",
      fields: {
        key,
        "Content-Type": contentType,
        "x-amz-content-length-range-min": "1",
        "x-amz-content-length-range-max": String(BELEG_MAX),
      },
      key,
      expiresIn: PRESIGN_TTL_SEC,
    };
  }
}

// Test helper — bypass presign and stash bytes directly so round-trips can
// assert getRawUpload reads the metadata after we "uploaded" a file.
export function uploadRawBlob(state: MemState, email: string, ticketId: string, opts: {
  filename: string;
  bytes: Uint8Array;
  contentType: string;
}): { s3_key: string; uploadedAt: string } {
  const key = `raw/${emailHash(email)}/${ticketId}.${extFromContentType(opts.contentType)}`;
  const uploadedAt = new Date().toISOString();
  setBlob(state, key, opts.bytes, opts.contentType, uploadedAt);
  return { s3_key: key, uploadedAt };
}

export function readBlob(state: MemState, key: string): { bytes: Uint8Array; contentType: string } | null {
  const bucket = state.blobs.get(BUCKET);
  if (!bucket) return null;
  const b = bucket.get(key);
  return b ? { bytes: b.bytes, contentType: b.contentType } : null;
}

export const MEMORY_BLOB_BUCKET = BUCKET;
