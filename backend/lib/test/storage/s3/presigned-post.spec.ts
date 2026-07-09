// Tests for the S3 presigned-POST helper. We don't hit AWS — instead we
// mock @aws-sdk/s3-presigned-post's createPresignedPost so the test stays
// hermetic. The fields/url shape returned is whatever we hand back.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../../../src/errors/index.js";

const mockCreatePresignedPost = vi.fn();

vi.mock("@aws-sdk/s3-presigned-post", () => ({
  createPresignedPost: (...args: unknown[]) => mockCreatePresignedPost(...args),
}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    constructor(public config: { region?: string }) {}
  },
}));

// Import lazily so the mocks above are wired before the module loads.
const importMod = async () => await import("../../../src/storage/s3/presigned-post.js");

describe("presignPost", () => {
  beforeEach(() => {
    mockCreatePresignedPost.mockReset();
    vi.stubEnv("RAILBACK_AWS_REGION", "eu-central-1");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    const mod = await importMod();
    mod.resetS3ClientCache();
  });

  it("returns the URL and form fields with content-length-range condition", async () => {
    mockCreatePresignedPost.mockResolvedValueOnce({
      url: "https://my-bucket.s3.amazonaws.com/",
      fields: {
        key: "raw/abc/01H.../ticket.pdf",
        "Content-Type": "application/pdf",
        Policy: "base64-policy-here",
        "X-Amz-Signature": "sig",
      },
    });

    const mod = await importMod();
    const result = await mod.presignPost({
      bucket: "railback-storage",
      key: "raw/abc/01H.../ticket.pdf",
      contentType: "application/pdf",
      maxBytes: mod.RAW_UPLOAD_MAX_BYTES,
    });

    expect(result.url).toBe("https://my-bucket.s3.amazonaws.com/");
    expect(result.key).toBe("raw/abc/01H.../ticket.pdf");
    expect(result.expiresIn).toBe(300);
    expect(result.fields["Content-Type"]).toBe("application/pdf");
    expect(result.fields["Policy"]).toBe("base64-policy-here");

    // Verify the policy conditions we passed in
    const [, opts] = mockCreatePresignedPost.mock.calls[0];
    expect(opts.Bucket).toBe("railback-storage");
    expect(opts.Conditions).toEqual([
      ["eq", "$Content-Type", "application/pdf"],
      ["content-length-range", 1, mod.RAW_UPLOAD_MAX_BYTES],
    ]);
    expect(opts.Expires).toBe(300);
  });

  it("honours explicit expiresInSec", async () => {
    mockCreatePresignedPost.mockResolvedValueOnce({ url: "https://x/", fields: {} });
    const mod = await importMod();
    await mod.presignPost({
      bucket: "b",
      key: "k",
      contentType: "image/png",
      maxBytes: 1024,
      expiresInSec: 60,
    });
    const [, opts] = mockCreatePresignedPost.mock.calls[0];
    expect(opts.Expires).toBe(60);
  });

  it("throws ERR_VALIDATION when bucket is empty", async () => {
    const mod = await importMod();
    await expect(
      mod.presignPost({
        bucket: "",
        key: "k",
        contentType: "image/png",
        maxBytes: 1024,
      })
    ).rejects.toBeInstanceOf(AppError);
  });

  it("throws ERR_VALIDATION when key is empty", async () => {
    const mod = await importMod();
    try {
      await mod.presignPost({
        bucket: "b",
        key: "",
        contentType: "image/png",
        maxBytes: 1024,
      });
      throw new Error("expected throw");
    } catch (err) {
      expect((err as AppError).code).toBe("ERR_VALIDATION");
      expect((err as AppError).details).toEqual({ field: "key" });
    }
  });

  it("throws ERR_VALIDATION when maxBytes is non-positive", async () => {
    const mod = await importMod();
    await expect(
      mod.presignPost({
        bucket: "b",
        key: "k",
        contentType: "image/png",
        maxBytes: 0,
      })
    ).rejects.toBeInstanceOf(AppError);
  });

  it("throws ERR_INTERNAL when RAILBACK_AWS_REGION is missing", async () => {
    vi.unstubAllEnvs();
    const mod = await importMod();
    mod.resetS3ClientCache();
    try {
      await mod.presignPost({
        bucket: "b",
        key: "k",
        contentType: "image/png",
        maxBytes: 1024,
      });
      throw new Error("expected throw");
    } catch (err) {
      expect((err as AppError).code).toBe("ERR_INTERNAL");
    }
  });

  it("exposes the standard caps for raw and beleg uploads", async () => {
    const mod = await importMod();
    expect(mod.RAW_UPLOAD_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(mod.BELEG_UPLOAD_MAX_BYTES).toBe(5 * 1024 * 1024);
  });
});
