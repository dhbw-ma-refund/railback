import { DynamoDBClient, ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
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
    if (Object.keys(updates).length === 0) return new Ok(null);
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
      let lastKey: Record<string, unknown> | undefined;
      do {
        const resp = await this._t.send(new QueryCommand({
          TableName: tableName(),
          ...params,
          ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
        }));
        items.push(...((resp.Items as Record<string, unknown>[]) ?? []));
        lastKey = resp.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (lastKey && !("Limit" in params));
      return items;
    });
  }

  _batchDelete(keys: { pk: string; sk: string }[]): Promise<Result<null>> {
    return safe("_batchDelete", async () => {
      const requests = keys.map((k) => ({ DeleteRequest: { Key: { pk: k.pk, sk: k.sk } } }));
      for (let i = 0; i < requests.length; i += 25) {
        await this._t.send(new BatchWriteCommand({
          RequestItems: { [tableName()]: requests.slice(i, i + 25) },
        }));
      }
      return null;
    });
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
