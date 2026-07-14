import {
  DynamoDBClient,
  ConditionalCheckFailedException,
  TransactionCanceledException,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
  BatchWriteCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { createHash, randomBytes } from "node:crypto";

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

/**
 * Trim + lowercase every email before it becomes part of a DDB key.
 *
 * Mirrors `@railback/lib/storage/ddb/keys.ts#normaliseEmail` — the two live
 * in different packages (this one has no dep on @railback/lib) but MUST
 * stay behaviourally identical, otherwise the backend and the adapter
 * would key the same user into two different partitions on mixed-case
 * input (e.g. registration under "Alice@Example.COM", login under
 * "alice@example.com"). See F7 (2026-07-08).
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * 16-char hex prefix of sha256(normalised email). Used ONLY for S3 key
 * prefixes (`raw/<hash>/…`, `belege/<hash>/…`) so object keys don't carry
 * the plaintext email.
 *
 * Mirrors `@railback/lib/util/hash.ts#emailHash` — must stay behaviourally
 * identical (same normalise → sha256 → 16-char slice) so the adapter and the
 * backend derive the SAME S3 key for the same user+ticket. Do NOT use this
 * for anonymised DDB PKs — those need the full 64-char digest (see
 * DB_SCHEMA.md "Cascade on user delete").
 */
export function emailHash(email: string): string {
  return createHash("sha256").update(normaliseEmail(email), "utf8").digest("hex").slice(0, 16);
}

// ULID generator — Crockford base32, 48-bit timestamp + 80-bit randomness,
// 26 chars total. Mirrors @railback/lib's util/ulid.ts (the db package can't
// import from the backend). Used for belegId so the value matches the
// `^[0-9A-HJKMNP-TV-Z]{26}$` contract the user-handler belege routes enforce
// (post-belege.ts / post-belege-confirm.ts). randomUUID() would produce a
// UUID that fails that regex → "could not parse belegId from presigned key".
const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ULID_TIME_LEN = 10;
const ULID_RAND_BYTES = 10; // 80 bits → 16 base32 chars

function ulidEncodeTime(now: number): string {
  let t = Math.floor(now);
  let out = "";
  for (let i = ULID_TIME_LEN - 1; i >= 0; i--) {
    const mod = t % 32;
    out = (ULID_ALPHABET[mod] as string) + out;
    t = (t - mod) / 32;
  }
  return out;
}

function ulidEncodeRandom(rand: Uint8Array): string {
  let out = "";
  let bits = 0;
  let acc = 0;
  for (let i = 0; i < rand.length; i++) {
    acc = (acc << 8) | (rand[i] as number);
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ULID_ALPHABET[(acc >>> bits) & 0x1f] as string;
    }
  }
  return out;
}

/** Generate a 26-char Crockford-base32 ULID. */
export function ulid(now?: number): string {
  const t = now ?? Date.now();
  const rand = Uint8Array.from(randomBytes(ULID_RAND_BYTES));
  return ulidEncodeTime(t) + ulidEncodeRandom(rand);
}

/**
 * Adapter-local error class. The backend adapter-boundary layer maps
 * AdapterError → AppError (see backend/lib/src/storage/ddb/stubs.ts).
 *
 * Purpose: keep @railback/db free of any dependency on @railback/lib. If the
 * adapter threw AppError directly it would need to import from the backend
 * package, creating a cyclic dep with @railback/lib → @railback/db/dtos.
 *
 * `code` mirrors the ErrorCode union used by AppError; the backend does a
 * 1:1 translation so semantics survive the boundary.
 */
export type AdapterErrorCode =
  | "ERR_CONFLICT"
  | "ERR_NOT_FOUND"
  | "ERR_INTERNAL"
  | "ERR_NOT_IMPLEMENTED";

export class AdapterError extends Error {
  readonly code: AdapterErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: AdapterErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AdapterError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

/**
 * Thrown by every adapter method that has not been wired to a real
 * connector call yet. Backend catches it at the adapter boundary and
 * re-throws AppError("ERR_INTERNAL", ...). Distinct from ConflictError
 * so the backend can distinguish "wire this method" from "row conflict".
 */
export class NotImplementedError extends AdapterError {
  constructor(methodName: string) {
    super("ERR_NOT_IMPLEMENTED", `Not implemented: ${methodName}`);
    this.name = "NotImplementedError";
  }
}

/**
 * Wrap a conditional-write call so ConflictError → AdapterError(ERR_CONFLICT).
 * The backend adapter-boundary layer then maps AdapterError → AppError.
 * Every conditional write inside the adapter should be wrapped in this.
 */
export async function withConflictAsAdapterError<T>(
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ConflictError) {
      throw new AdapterError("ERR_CONFLICT", err.message);
    }
    throw err;
  }
}

export type Result<T> = Ok<T> | Err;

export class Ok<T> {
  constructor(public readonly value: T) {}
  isOk(): this is Ok<T> { return true; }
  isErr(): this is Err { return false; }
  unwrap(): T { return this.value; }
}

export class Err {
  constructor(public readonly error: Error) {}
  isOk(): this is Ok<never> { return false; }
  isErr(): this is Err { return true; }
  unwrap(): never { throw this.error; }
}

function safe<T>(label: string, fn: () => Promise<T>): Promise<Result<T>> {
  return fn()
    .then((v) => new Ok(v) as Result<T>)
    .catch((err: unknown) => {
      const e = err instanceof Error ? err : new Error(String(err));
      console.warn(`${label} — ${e.message}`);
      return new Err(e) as Result<T>;
    });
}

export class BaseConnector {
  protected _t: DynamoDBDocumentClient;

  constructor(client: DynamoDBDocumentClient) {
    this._t = client;
  }

  _get(pk: string, sk: string): Promise<Result<Record<string, unknown> | null>> {
    return safe("_get", async () => {
      const resp = await this._t.send(new GetCommand({ TableName: tableName(), Key: { pk, sk } }));
      return (resp.Item as Record<string, unknown>) ?? null;
    });
  }

  _put(item: Record<string, unknown>): Promise<Result<null>> {
    return safe("_put", async () => {
      await this._t.send(new PutCommand({ TableName: tableName(), Item: item }));
      return null;
    });
  }

  _updateFields(pk: string, sk: string, updates: Record<string, unknown>): Promise<Result<null>> {
    if (Object.keys(updates).length === 0) return Promise.resolve(new Ok(null));
    return safe("_updateFields", async () => {
      const { expr, names, values } = buildSetExpr(updates);
      await this._t.send(new UpdateCommand({
        TableName: tableName(),
        Key: { pk, sk },
        UpdateExpression: expr,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }));
      return null;
    });
  }

  async _updateIf(
    pk: string, sk: string,
    updates: Record<string, unknown>,
    condition: string,
  ): Promise<Result<null>> {
    if (Object.keys(updates).length === 0) throw new Error("_updateIf requires non-empty updates");
    const { expr, names, values } = buildSetExpr(updates);
    try {
      await this._t.send(new UpdateCommand({
        TableName: tableName(),
        Key: { pk, sk },
        UpdateExpression: expr,
        ConditionExpression: condition,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }));
      return new Ok(null);
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) {
        return new Err(new ConflictError(`condition failed on (${pk}, ${sk})`));
      }
      const e = err instanceof Error ? err : new Error(String(err));
      console.warn(`_updateIf — ${e.message}`);
      return new Err(e);
    }
  }

  _delete(pk: string, sk: string): Promise<Result<null>> {
    return safe("_delete", async () => {
      await this._t.send(new DeleteCommand({ TableName: tableName(), Key: { pk, sk } }));
      return null;
    });
  }

  _query(params: Record<string, unknown>): Promise<Result<Record<string, unknown>[]>> {
    return safe("_query", async () => {
      const items: Record<string, unknown>[] = [];
      const limit = typeof params["Limit"] === "number" ? params["Limit"] : undefined;
      let pageParams = { ...params };
      let lastKey: Record<string, unknown> | undefined;
      do {
        const resp = await this._t.send(new QueryCommand({
          TableName: tableName(),
          ...pageParams,
          ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
        }));
        items.push(...((resp.Items as Record<string, unknown>[]) ?? []));
        lastKey = resp.LastEvaluatedKey as Record<string, unknown> | undefined;
        if (limit !== undefined && items.length >= limit) return items.slice(0, limit);
        if (lastKey && limit !== undefined) {
          pageParams = { ...pageParams, Limit: limit - items.length };
        }
      } while (lastKey);
      return items;
    });
  }

  _batchDelete(keys: { pk: string; sk: string }[]): Promise<Result<null>> {
    return safe("_batchDelete", async () => {
      const seen = new Set<string>();
      const unique = keys.filter((k) => {
        const key = `${k.pk}\0${k.sk}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const requests = unique.map((k) => ({ DeleteRequest: { Key: { pk: k.pk, sk: k.sk } } }));
      for (let i = 0; i < requests.length; i += 25) {
        await this._t.send(new BatchWriteCommand({
          RequestItems: { [tableName()]: requests.slice(i, i + 25) },
        }));
      }
      return null;
    });
  }

  /**
   * Caller-managed pagination Scan. The caller supplies Limit + optional
   * ExclusiveStartKey and gets back items + lastEvaluatedKey. This method
   * does NOT auto-paginate — the caller drives the loop. This keeps
   * response sizes bounded and lets the caller stream/short-circuit.
   */
  public _scan(params: {
    FilterExpression?: string;
    ExpressionAttributeValues?: Record<string, unknown>;
    ExpressionAttributeNames?: Record<string, string>;
    ExclusiveStartKey?: Record<string, unknown>;
    Limit?: number;
    ProjectionExpression?: string;
    IndexName?: string;
  }): Promise<Result<{ items: Record<string, unknown>[]; lastEvaluatedKey?: Record<string, unknown> }>> {
    return safe("_scan", async () => {
      const resp = await this._t.send(new ScanCommand({
        TableName: tableName(),
        ...params,
      }));
      const items = (resp.Items as Record<string, unknown>[]) ?? [];
      const lastEvaluatedKey = resp.LastEvaluatedKey as Record<string, unknown> | undefined;
      return lastEvaluatedKey !== undefined
        ? { items, lastEvaluatedKey }
        : { items };
    });
  }

  /**
   * Generic 25-chunk batch writer supporting both Put and Delete. Handles
   * UnprocessedItems with exponential backoff up to 3 attempts per chunk.
   * After the 3rd attempt any remaining UnprocessedItems cause an Err.
   * NOT atomic across chunks (nor within a chunk — DDB BatchWrite is not
   * transactional). Use _transactWrite when atomicity is required.
   */
  public _batchWrite(
    items: Array<{
      Put?: { Item: Record<string, unknown> };
      Delete?: { Key: Record<string, unknown> };
    }>,
  ): Promise<Result<null>> {
    return safe("_batchWrite", async () => {
      const requests = items.map((it) => {
        if (it.Put && it.Delete) throw new Error("_batchWrite item cannot have both Put and Delete");
        if (!it.Put && !it.Delete) throw new Error("_batchWrite item requires Put or Delete");
        return it.Put ? { PutRequest: { Item: it.Put.Item } } : { DeleteRequest: { Key: it.Delete!.Key } };
      });
      const table = tableName();
      for (let i = 0; i < requests.length; i += 25) {
        let chunk = requests.slice(i, i + 25);
        for (let attempt = 0; attempt < 3; attempt++) {
          const resp = await this._t.send(new BatchWriteCommand({
            RequestItems: { [table]: chunk },
          }));
          const unprocessed = resp.UnprocessedItems?.[table];
          if (!unprocessed || unprocessed.length === 0) { chunk = []; break; }
          chunk = unprocessed as typeof chunk;
          // Exponential backoff: 50ms, 100ms, 200ms.
          const delayMs = 50 * Math.pow(2, attempt);
          await new Promise((r) => setTimeout(r, delayMs));
        }
        if (chunk.length > 0) {
          throw new Error(`_batchWrite: ${chunk.length} unprocessed item(s) after 3 attempts`);
        }
      }
      return null;
    });
  }

  /**
   * Atomic TransactWriteItems. Max 25 items per DDB constraint — chunks
   * larger than 25 throw a boundary error because transactions can't
   * span chunks atomically. Callers who need >25 must split into
   * independent transactions and accept partial-failure semantics.
   *
   * On TransactionCanceledException where any CancellationReason is
   * ConditionalCheckFailed, returns Err(ConflictError). Other cancellations
   * (throughput, size, etc.) fall through as generic errors.
   */
  public async _transactWrite(
    items: Array<Record<string, unknown>>,
  ): Promise<Result<null>> {
    if (items.length === 0) return new Ok(null);
    if (items.length > 25) {
      return new Err(new Error(
        `_transactWrite: ${items.length} items exceeds DDB 25-item transaction cap ` +
        `(transactions cannot span chunks atomically)`,
      ));
    }
    try {
      await this._t.send(new TransactWriteCommand({ TransactItems: items as never }));
      return new Ok(null);
    } catch (err) {
      if (err instanceof TransactionCanceledException) {
        const reasons = err.CancellationReasons ?? [];
        const hasConditional = reasons.some((r) => r.Code === "ConditionalCheckFailed");
        if (hasConditional) {
          const idx = reasons.findIndex((r) => r.Code === "ConditionalCheckFailed");
          return new Err(new ConflictError(`transaction condition failed at index ${idx}`));
        }
      }
      const e = err instanceof Error ? err : new Error(String(err));
      console.warn(`_transactWrite — ${e.message}`);
      return new Err(e);
    }
  }

  /**
   * Update that emits both SET and REMOVE clauses in a single UpdateExpression.
   *
   * Convention: null values in `sets` are coerced to REMOVE. Callers who
   * genuinely want to persist a JSON null (uncommon in this codebase — we
   * treat missing == null == absent) must go through _updateFields.
   *
   * `removes` is an explicit list of attribute names to REMOVE, additive
   * with any nulls in `sets`. Both may be empty (no-op returns Ok).
   *
   * `condition` is passed through to ConditionExpression; on
   * ConditionalCheckFailedException returns Err(ConflictError) same as
   * _updateIf.
   */
  public async _updateWithRemove(
    pk: string, sk: string,
    sets: Record<string, unknown>,
    removes: string[] = [],
    condition?: string,
    /**
     * Extra ExpressionAttributeValues bound solely to the ConditionExpression
     * (not consumed by the SET clause). Use for guarded state transitions
     * where the caller needs to reference the PREVIOUS state via a `:prev`
     * placeholder without emitting a redundant SET.
     */
    conditionValues?: Record<string, unknown>,
  ): Promise<Result<null>> {
    const setEntries: Array<[string, unknown]> = [];
    const removeAttrs = new Set(removes);
    for (const [k, v] of Object.entries(sets)) {
      if (v === null) removeAttrs.add(k);
      else setEntries.push([k, v]);
    }
    if (setEntries.length === 0 && removeAttrs.size === 0) return new Ok(null);

    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    const setParts: string[] = [];
    const removeParts: string[] = [];
    let idx = 0;
    for (const [k, v] of setEntries) {
      const ph_n = `#f${idx}`, ph_v = `:v${idx}`;
      names[ph_n] = k;
      values[ph_v] = v;
      setParts.push(`${ph_n} = ${ph_v}`);
      idx++;
    }
    for (const k of removeAttrs) {
      const ph_n = `#f${idx}`;
      names[ph_n] = k;
      removeParts.push(ph_n);
      idx++;
    }
    if (conditionValues) {
      for (const [k, v] of Object.entries(conditionValues)) {
        values[k] = v;
      }
    }
    const clauses: string[] = [];
    if (setParts.length > 0) clauses.push("SET " + setParts.join(", "));
    if (removeParts.length > 0) clauses.push("REMOVE " + removeParts.join(", "));
    const expr = clauses.join(" ");

    try {
      await this._t.send(new UpdateCommand({
        TableName: tableName(),
        Key: { pk, sk },
        UpdateExpression: expr,
        ExpressionAttributeNames: names,
        ...(Object.keys(values).length > 0 ? { ExpressionAttributeValues: values } : {}),
        ...(condition ? { ConditionExpression: condition } : {}),
      }));
      return new Ok(null);
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) {
        return new Err(new ConflictError(`condition failed on (${pk}, ${sk})`));
      }
      const e = err instanceof Error ? err : new Error(String(err));
      console.warn(`_updateWithRemove — ${e.message}`);
      return new Err(e);
    }
  }
}

function tableName(): string {
  return process.env["RAILBACK_DDB_TABLE"] ?? "RailBack";
}

function buildSetExpr(updates: Record<string, unknown>) {
  const setParts: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  Object.entries(updates).forEach(([k, v], i) => {
    const ph_n = `#f${i}`, ph_v = `:v${i}`;
    setParts.push(`${ph_n} = ${ph_v}`);
    names[ph_n] = k;
    values[ph_v] = v;
  });
  return { expr: "SET " + setParts.join(", "), names, values };
}

export function createClient(): DynamoDBDocumentClient {
  const endpoint = process.env["DYNAMODB_ENDPOINT_URL"];
  const client = new DynamoDBClient({
    region: "eu-north-1",
    ...(endpoint ? {
      endpoint,
      credentials: { accessKeyId: "fake", secretAccessKey: "fake" },
    } : {}),
  });
  return DynamoDBDocumentClient.from(client);
}
