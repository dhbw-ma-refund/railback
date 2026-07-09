// Phase-5 fallback stub: when buildDdbDb() is called WITHOUT a
// DynamoDBDocumentClient, blob ops are not yet usable. Every method
// throws ERR_INTERNAL with a clear "wire up the DocumentClient" message.
// The real S3-backed implementation lives in ./blob-repo.ts and is
// returned by buildDdbDb when a client is provided.

import { AppError } from "../../errors/index.js";
import type { BlobRepo } from "../types.js";

const MSG =
  "S3BlobRepoStub: pass a DynamoDBDocumentClient to buildDdbDb() to use the real S3BlobRepo (deferred to Phase 5)";

function notImpl(): never {
  throw new AppError("ERR_INTERNAL", MSG);
}

type Stub = (...args: unknown[]) => Promise<never>;
const stub: Stub = async () => notImpl();

export class S3BlobRepoStub implements BlobRepo {
  getRawUpload = stub as unknown as BlobRepo["getRawUpload"];
  putRawUpload = stub as unknown as BlobRepo["putRawUpload"];
  getRenderedPdf = stub as unknown as BlobRepo["getRenderedPdf"];
  putRenderedPdf = stub as unknown as BlobRepo["putRenderedPdf"];
  listReceipts = stub as unknown as BlobRepo["listReceipts"];
  putReceipt = stub as unknown as BlobRepo["putReceipt"];
  deleteReceipt = stub as unknown as BlobRepo["deleteReceipt"];
  async getBytes(_key: string): Promise<never> {
    throw new AppError(
      "ERR_INTERNAL",
      "S3BlobRepoStub: getBytes not implemented (Phase 5)"
    );
  }
  async putBytes(
    _key: string,
    _bytes: Uint8Array,
    _contentType: string,
    _uploadedAt: string
  ): Promise<never> {
    throw new AppError(
      "ERR_INTERNAL",
      "S3BlobRepoStub: putBytes not implemented (Phase 5)"
    );
  }
  presignRawUploadPost = stub as unknown as BlobRepo["presignRawUploadPost"];
  presignReceiptPost = stub as unknown as BlobRepo["presignReceiptPost"];
  deleteBytes = stub as unknown as BlobRepo["deleteBytes"];
  deleteRawUpload = stub as unknown as BlobRepo["deleteRawUpload"];
  deleteRenderedPdf = stub as unknown as BlobRepo["deleteRenderedPdf"];
  deleteAllReceipts = stub as unknown as BlobRepo["deleteAllReceipts"];
}

// Backwards-compat alias for code that historically imported `S3BlobRepo`
// from this stubs.ts file. New code should import either:
//   - S3BlobRepo from "./blob-repo.js"   (real, needs DocumentClient)
//   - S3BlobRepoStub from "./stubs.js"   (this file)
export { S3BlobRepoStub as S3BlobRepo };
