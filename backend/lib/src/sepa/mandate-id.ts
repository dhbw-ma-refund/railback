import { ulid } from "../util/ulid.js";

export type MandateId = string;
export type BatchId = string;

export function generateMandateId(): MandateId {
  return ulid();
}

export function generateBatchId(): BatchId {
  return ulid();
}
