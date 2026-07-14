import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  NoSuchKey,
} from "@aws-sdk/client-s3";
import { S3BlobConnector } from "../src/connectors/s3.js";

// Minimal S3Client stub. Only replaces `send`, which is what all commands
// funnel through. Records calls + returns whatever the handler produces.
type Handler = (cmd: unknown) => Promise<unknown>;
function makeStubClient(handler: Handler): S3Client {
  const c = {
    send: (cmd: unknown) => handler(cmd),
    config: { region: () => "eu-north-1" },
  };
  return c as unknown as S3Client;
}

describe("S3BlobConnector", () => {
  describe("getObject", () => {
    test("happy path returns bytes + contentType", async () => {
      const client = makeStubClient(async (cmd) => {
        expect(cmd).toBeInstanceOf(GetObjectCommand);
        return {
          Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
          ContentType: "application/pdf",
        };
      });
      const c = new S3BlobConnector({ client, bucket: "b", region: "eu-north-1" });
      const r = await c.getObject("some/key.pdf");
      expect(r).not.toBeNull();
      expect(r!.contentType).toBe("application/pdf");
      expect(Array.from(r!.bytes)).toEqual([1, 2, 3]);
    });

    test("returns null on NoSuchKey", async () => {
      const client = makeStubClient(async () => {
        throw new NoSuchKey({ $metadata: {}, message: "not found" });
      });
      const c = new S3BlobConnector({ client, bucket: "b", region: "eu-north-1" });
      const r = await c.getObject("missing");
      expect(r).toBeNull();
    });

    test("other errors bubble", async () => {
      const err = new Error("s3 exploded");
      const client = makeStubClient(async () => { throw err; });
      const c = new S3BlobConnector({ client, bucket: "b", region: "eu-north-1" });
      await expect(c.getObject("boom")).rejects.toThrow("s3 exploded");
    });
  });

  describe("putObject", () => {
    test("happy path sends PutObjectCommand with body + contentType", async () => {
      let seen: Record<string, unknown> | null = null;
      const client = makeStubClient(async (cmd) => {
        expect(cmd).toBeInstanceOf(PutObjectCommand);
        seen = (cmd as PutObjectCommand).input as unknown as Record<string, unknown>;
        return {};
      });
      const c = new S3BlobConnector({ client, bucket: "b", region: "eu-north-1" });
      await c.putObject("k", new Uint8Array([9, 8]), "image/png");
      expect(seen).not.toBeNull();
      expect(seen!["Bucket"]).toBe("b");
      expect(seen!["Key"]).toBe("k");
      expect(seen!["ContentType"]).toBe("image/png");
    });

    test("errors bubble", async () => {
      const client = makeStubClient(async () => { throw new Error("denied"); });
      const c = new S3BlobConnector({ client, bucket: "b", region: "eu-north-1" });
      await expect(c.putObject("k", new Uint8Array([1]), "text/plain"))
        .rejects.toThrow("denied");
    });
  });

  describe("deleteObject", () => {
    test("happy path sends DeleteObjectCommand", async () => {
      let called = false;
      const client = makeStubClient(async (cmd) => {
        expect(cmd).toBeInstanceOf(DeleteObjectCommand);
        called = true;
        return {};
      });
      const c = new S3BlobConnector({ client, bucket: "b", region: "eu-north-1" });
      await c.deleteObject("k");
      expect(called).toBe(true);
    });

    test("swallows NoSuchKey (idempotent)", async () => {
      const client = makeStubClient(async () => {
        throw new NoSuchKey({ $metadata: {}, message: "gone" });
      });
      const c = new S3BlobConnector({ client, bucket: "b", region: "eu-north-1" });
      await expect(c.deleteObject("gone")).resolves.toBeUndefined();
    });
  });

  describe("presignPost", () => {
    test("returns url + fields with content-length-range + content-type pinning", async () => {
      // presignPost uses createPresignedPost which signs against the client.
      // We can't stub the signer easily — but we can call it with the local
      // endpoint (LocalStack-style) via S3_ENDPOINT_URL env override and
      // check the shape of the response.
      const prev = process.env["S3_ENDPOINT_URL"];
      process.env["S3_ENDPOINT_URL"] = "http://localhost:4566";
      try {
        const c = new S3BlobConnector({ bucket: "railback-test", region: "eu-north-1" });
        const r = await c.presignPost("raw/user1/t1.pdf", "application/pdf", 1, 10 * 1024 * 1024, 300);
        expect(r.url).toContain("http");
        expect(r.fields).toBeDefined();
        expect(r.fields["Content-Type"]).toBe("application/pdf");
        // policy is a base64-encoded JSON string in the fields
        const policyB64 = r.fields["Policy"];
        expect(policyB64).toBeDefined();
        const policyJson = JSON.parse(Buffer.from(policyB64!, "base64").toString());
        // Should contain the content-length-range and Content-Type conditions
        const flat = JSON.stringify(policyJson.conditions);
        expect(flat).toContain("content-length-range");
        expect(flat).toContain("Content-Type");
      } finally {
        if (prev === undefined) delete process.env["S3_ENDPOINT_URL"];
        else process.env["S3_ENDPOINT_URL"] = prev;
      }
    });
  });

  describe("constructor", () => {
    test("reads bucket + region from env vars", () => {
      const prevB = process.env["RAILBACK_S3_BUCKET"];
      const prevR = process.env["RAILBACK_S3_REGION"];
      process.env["RAILBACK_S3_BUCKET"] = "envbucket";
      process.env["RAILBACK_S3_REGION"] = "eu-central-1";
      try {
        const c = new S3BlobConnector();
        // Access private via cast for assertion
        expect((c as unknown as { bucket: string }).bucket).toBe("envbucket");
        expect((c as unknown as { region: string }).region).toBe("eu-central-1");
      } finally {
        if (prevB === undefined) delete process.env["RAILBACK_S3_BUCKET"];
        else process.env["RAILBACK_S3_BUCKET"] = prevB;
        if (prevR === undefined) delete process.env["RAILBACK_S3_REGION"];
        else process.env["RAILBACK_S3_REGION"] = prevR;
      }
    });

    test("does not perform region assertion by default", () => {
      // No client, no HeadBucket call — should just construct
      const c = new S3BlobConnector({ bucket: "b", region: "eu-north-1" });
      expect(c).toBeDefined();
    });
  });
});
