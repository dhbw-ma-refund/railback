import { describe, it, expect } from "vitest";
import { generateMandateId, generateBatchId } from "../../src/sepa/mandate-id.js";

describe("mandate-id", () => {
  it("generateMandateId returns 26-char ULID", () => {
    const id = generateMandateId();
    expect(id).toHaveLength(26);
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("generateBatchId returns 26-char ULID", () => {
    const id = generateBatchId();
    expect(id).toHaveLength(26);
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("successive calls produce distinct ids", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) ids.add(generateMandateId());
    expect(ids.size).toBe(100);
  });

  it("mandate and batch ids do not collide", () => {
    const m = generateMandateId();
    const b = generateBatchId();
    expect(m).not.toBe(b);
  });
});
