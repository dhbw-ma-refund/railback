// Tests for the real S3-backed BlobRepo. We mock the
// DynamoDBDocumentClient + the S3 presigned-POST helper so the test
// stays hermetic — no real AWS calls.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../../../src/errors/index.js";

// Mock the S3 helper. The real impl is exercised in
// lib/test/storage/s3/presigned-post.spec.ts; here we only need to
// verify the BlobRepo passes the right key + cap.
const mockPresignPost = vi.fn();
vi.mock("../../../src/storage/s3/presigned-post.js", () => ({
  presignPost: (...args: unknown[]) => mockPresignPost(...args),
  RAW_UPLOAD_MAX_BYTES: 10 * 1024 * 1024,
  BELEG_UPLOAD_MAX_BYTES: 5 * 1024 * 1024,
  resetS3ClientCache: vi.fn(),
}));

// Mock the DocumentClient's `send` method. Each test provides the
// response for the next call.
function makeMockDdb(): {
  send: ReturnType<typeof vi.fn>;
  // The real shape would be DynamoDBDocumentClient; we cast at the
  // call-site so we don't have to mock every public method.
} {
  return { send: vi.fn() };
}

const { S3BlobRepo } = await import("../../../src/storage/s3/blob-repo.js");

describe("S3BlobRepo", () => {
  beforeEach(() => {
    mockPresignPost.mockReset();
    vi.stubEnv("RAILBACK_S3_BUCKET", "railback-storage");
    vi.stubEnv("RAILBACK_DDB_TABLE", "railback-main");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("env var guards", () => {
    it("throws ERR_INTERNAL when RAILBACK_S3_BUCKET is missing on presign", async () => {
      vi.unstubAllEnvs();
      const ddb = makeMockDdb();
      const repo = new S3BlobRepo(ddb as never);
      try {
        await repo.presignRawUploadPost("ada@example.com", "TKT_A", "application/pdf");
        throw new Error("expected throw");
      } catch (err) {
        expect((err as AppError).code).toBe("ERR_INTERNAL");
        expect((err as AppError).message).toContain("RAILBACK_S3_BUCKET");
      }
    });

    it("throws ERR_INTERNAL when RAILBACK_DDB_TABLE is missing on a put", async () => {
      vi.unstubAllEnvs();
      vi.stubEnv("RAILBACK_S3_BUCKET", "railback-storage");
      const ddb = makeMockDdb();
      const repo = new S3BlobRepo(ddb as never);
      try {
        await repo.putRawUpload("ada@example.com", "TKT_A", {
          filename: "ticket.pdf",
          s3_bucket: "railback-storage",
          s3_key: "raw/x/TKT_A.pdf",
          content_type: "application/pdf",
          size_bytes: 1024,
          uploaded_at: "2026-06-20T10:00:00Z",
        });
        throw new Error("expected throw");
      } catch (err) {
        expect((err as AppError).code).toBe("ERR_INTERNAL");
        expect((err as AppError).message).toContain("RAILBACK_DDB_TABLE");
      }
    });
  });

  describe("presignRawUploadPost", () => {
    it("builds the conventional raw key + 10MB cap from emailHash", async () => {
      mockPresignPost.mockResolvedValueOnce({
        url: "https://railback-storage.s3.amazonaws.com/",
        fields: { key: "raw/abc/TKT_A.pdf" },
        key: "raw/abc/TKT_A.pdf",
        expiresIn: 300,
      });
      const ddb = makeMockDdb();
      const repo = new S3BlobRepo(ddb as never);
      const out = await repo.presignRawUploadPost(
        "Ada@Example.com",
        "TKT_A",
        "application/pdf",
      );
      expect(out.url).toBe("https://railback-storage.s3.amazonaws.com/");
      const [args] = mockPresignPost.mock.calls[0] as [{ key: string; maxBytes: number; bucket: string; contentType: string }];
      // emailHash lowercases the email; key uses sha256-prefix
      expect(args.bucket).toBe("railback-storage");
      expect(args.contentType).toBe("application/pdf");
      expect(args.maxBytes).toBe(10 * 1024 * 1024);
      expect(args.key).toMatch(/^raw\/[a-f0-9]{16}\/TKT_A\.pdf$/);
    });

    it("uses image/jpeg → .jpg extension when no filename hint", async () => {
      mockPresignPost.mockResolvedValueOnce({ url: "x", fields: {}, key: "k", expiresIn: 300 });
      const ddb = makeMockDdb();
      const repo = new S3BlobRepo(ddb as never);
      await repo.presignRawUploadPost("a@b.de", "TKT_A", "image/jpeg");
      const [args] = mockPresignPost.mock.calls[0] as [{ key: string }];
      expect(args.key).toMatch(/^raw\/[a-f0-9]{16}\/TKT_A\.jpg$/);
    });
  });

  describe("presignReceiptPost", () => {
    it("builds belege key with 5MB cap and a fresh ulid belegId", async () => {
      mockPresignPost.mockResolvedValueOnce({ url: "x", fields: {}, key: "k", expiresIn: 300 });
      const ddb = makeMockDdb();
      const repo = new S3BlobRepo(ddb as never);
      await repo.presignReceiptPost("a@b.de", "TKT_A", "image/png");
      const [args] = mockPresignPost.mock.calls[0] as [{ key: string; maxBytes: number }];
      expect(args.maxBytes).toBe(5 * 1024 * 1024);
      // belege/<hash>/<ticketId>/<ulid>.png  — ulid is 26 chars Crockford
      expect(args.key).toMatch(
        /^belege\/[a-f0-9]{16}\/TKT_A\/[0-9A-HJKMNP-TV-Z]{26}\.png$/,
      );
    });
  });

  describe("putRawUpload + getRawUpload round-trip via mocked DDB", () => {
    it("PutCommand writes the right item shape", async () => {
      const ddb = makeMockDdb();
      ddb.send.mockResolvedValueOnce({});
      const repo = new S3BlobRepo(ddb as never);
      await repo.putRawUpload("ada@example.com", "TKT_A", {
        filename: "ticket.pdf",
        s3_bucket: "railback-storage",
        s3_key: "raw/h/TKT_A.pdf",
        content_type: "application/pdf",
        size_bytes: 12345,
        uploaded_at: "2026-06-20T10:00:00Z",
        ttl: 1735689600,
      });
      expect(ddb.send).toHaveBeenCalledTimes(1);
      const cmd = ddb.send.mock.calls[0]?.[0] as { input: { Item: Record<string, unknown> } };
      expect(cmd.input.Item).toMatchObject({
        pk: "USER#ada@example.com",
        sk: "RAW#TKT_A",
        filename: "ticket.pdf",
        s3_bucket: "railback-storage",
        s3_key: "raw/h/TKT_A.pdf",
        content_type: "application/pdf",
        size_bytes: 12345,
        uploaded_at: "2026-06-20T10:00:00Z",
        ttl: 1735689600,
      });
    });

    it("GetCommand returns null when the row is absent", async () => {
      const ddb = makeMockDdb();
      ddb.send.mockResolvedValueOnce({ Item: undefined });
      const repo = new S3BlobRepo(ddb as never);
      const out = await repo.getRawUpload("ada@example.com", "TKT_A");
      expect(out).toBeNull();
    });

    it("GetCommand maps a row back into the RawUpload DTO", async () => {
      const ddb = makeMockDdb();
      ddb.send.mockResolvedValueOnce({
        Item: {
          pk: "USER#ada@example.com",
          sk: "RAW#TKT_A",
          filename: "ticket.pdf",
          s3_bucket: "railback-storage",
          s3_key: "raw/h/TKT_A.pdf",
          content_type: "application/pdf",
          size_bytes: 99,
          uploaded_at: "2026-06-20T10:00:00Z",
        },
      });
      const repo = new S3BlobRepo(ddb as never);
      const out = await repo.getRawUpload("Ada@Example.com", "TKT_A");
      expect(out).toEqual({
        email: "ada@example.com",
        ticketId: "TKT_A",
        filename: "ticket.pdf",
        s3_bucket: "railback-storage",
        s3_key: "raw/h/TKT_A.pdf",
        content_type: "application/pdf",
        size_bytes: 99,
        uploaded_at: "2026-06-20T10:00:00Z",
      });
    });
  });

  describe("putRenderedPdf + getRenderedPdf", () => {
    it("writes and reads back a RenderedPdf row", async () => {
      const ddb = makeMockDdb();
      ddb.send.mockResolvedValueOnce({}); // put
      ddb.send.mockResolvedValueOnce({
        Item: {
          pk: "USER#ada@example.com",
          sk: "RENDERED#TKT_A",
          s3_bucket: "railback-storage",
          s3_key: "rendered/h/TKT_A.pdf",
          size_bytes: 2048,
          rendered_at: "2026-06-20T10:30:00Z",
        },
      });
      const repo = new S3BlobRepo(ddb as never);
      await repo.putRenderedPdf("ada@example.com", "TKT_A", {
        s3_bucket: "railback-storage",
        s3_key: "rendered/h/TKT_A.pdf",
        size_bytes: 2048,
        rendered_at: "2026-06-20T10:30:00Z",
      });
      const out = await repo.getRenderedPdf("ada@example.com", "TKT_A");
      expect(out?.s3_key).toBe("rendered/h/TKT_A.pdf");
      expect(out?.size_bytes).toBe(2048);
    });
  });

  describe("listReceipts", () => {
    it("queries by pk + sk-prefix and maps rows back into Receipt[]", async () => {
      const ddb = makeMockDdb();
      ddb.send.mockResolvedValueOnce({
        Items: [
          {
            pk: "USER#ada@example.com",
            sk: "TICKET#TKT_A#BELEG#B1",
            belegId: "B1",
            filename: "taxi.pdf",
            s3_bucket: "railback-storage",
            s3_key: "belege/h/TKT_A/B1.pdf",
            content_type: "application/pdf",
            size_bytes: 50,
            typ: "TAXI",
            uploaded_at: "2026-06-20T10:00:00Z",
          },
        ],
      });
      const repo = new S3BlobRepo(ddb as never);
      const out = await repo.listReceipts("ada@example.com", "TKT_A");
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({
        email: "ada@example.com",
        ticketId: "TKT_A",
        belegId: "B1",
        typ: "TAXI",
        s3_key: "belege/h/TKT_A/B1.pdf",
      });
      const cmd = ddb.send.mock.calls[0]?.[0] as { input: { KeyConditionExpression: string; ExpressionAttributeValues: Record<string, string> } };
      expect(cmd.input.KeyConditionExpression).toContain("begins_with");
      expect(cmd.input.ExpressionAttributeValues[":sk"]).toBe(
        "TICKET#TKT_A#BELEG#",
      );
    });

    it("returns empty array when no Items", async () => {
      const ddb = makeMockDdb();
      ddb.send.mockResolvedValueOnce({});
      const repo = new S3BlobRepo(ddb as never);
      const out = await repo.listReceipts("a@b.de", "TKT_A");
      expect(out).toEqual([]);
    });
  });

  describe("putReceipt", () => {
    it("writes the receipt row and returns the full Receipt DTO", async () => {
      const ddb = makeMockDdb();
      ddb.send.mockResolvedValueOnce({});
      const repo = new S3BlobRepo(ddb as never);
      const out = await repo.putReceipt("ada@example.com", "TKT_A", {
        belegId: "B1",
        filename: "hotel.pdf",
        s3_bucket: "railback-storage",
        s3_key: "belege/h/TKT_A/B1.pdf",
        content_type: "application/pdf",
        size_bytes: 99,
        typ: "HOTEL",
        amount: "12.34",
        uploaded_at: "2026-06-20T10:00:00Z",
      });
      expect(out).toMatchObject({
        email: "ada@example.com",
        ticketId: "TKT_A",
        belegId: "B1",
        typ: "HOTEL",
      });
      const cmd = ddb.send.mock.calls[0]?.[0] as { input: { Item: Record<string, unknown> } };
      expect(cmd.input.Item).toMatchObject({
        pk: "USER#ada@example.com",
        sk: "TICKET#TKT_A#BELEG#B1",
        belegId: "B1",
        typ: "HOTEL",
      });
    });
  });
});
