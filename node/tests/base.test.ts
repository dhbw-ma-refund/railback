import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { BaseConnector, ConflictError } from "../src/base.js";

// -------- test subclass exposes protected primitives --------

class TestConnector extends BaseConnector {
  scan(params: Parameters<TestConnector["callScan"]>[0]) { return this.callScan(params); }
  batchWrite(items: Parameters<TestConnector["callBatchWrite"]>[0]) { return this.callBatchWrite(items); }
  transactWrite(items: Parameters<TestConnector["callTransactWrite"]>[0]) { return this.callTransactWrite(items); }
  updateWithRemove(pk: string, sk: string, sets: Record<string, unknown>, removes: string[] = [], condition?: string) {
    return this.callUpdateWithRemove(pk, sk, sets, removes, condition);
  }
  // Wrappers keep the protected-access in one place, minimally typed
  private callScan(params: {
    FilterExpression?: string;
    ExpressionAttributeValues?: Record<string, unknown>;
    ExpressionAttributeNames?: Record<string, string>;
    ExclusiveStartKey?: Record<string, unknown>;
    Limit?: number;
    ProjectionExpression?: string;
    IndexName?: string;
  }) { return this._scan(params); }
  private callBatchWrite(items: Array<{ Put?: { Item: Record<string, unknown> }; Delete?: { Key: Record<string, unknown> } }>) {
    return this._batchWrite(items);
  }
  private callTransactWrite(items: Array<Record<string, unknown>>) {
    return this._transactWrite(items);
  }
  private callUpdateWithRemove(pk: string, sk: string, sets: Record<string, unknown>, removes: string[], condition?: string) {
    return this._updateWithRemove(pk, sk, sets, removes, condition);
  }
}

function makeClient(endpoint: string, timeout?: number): DynamoDBDocumentClient {
  const client = new DynamoDBClient({
    region: "eu-north-1",
    endpoint,
    credentials: { accessKeyId: "fake", secretAccessKey: "fake" },
    ...(timeout !== undefined ? {
      requestHandler: new NodeHttpHandler({ connectionTimeout: timeout, requestTimeout: timeout }),
      maxAttempts: 1,
    } : {}),
  });
  return DynamoDBDocumentClient.from(client);
}

const good = new TestConnector(makeClient(process.env["DYNAMODB_ENDPOINT_URL"] ?? "http://localhost:8000"));
const bad = new TestConnector(makeClient("http://localhost:19999", 500));

const NS = "b001ts";

describe("_scan", () => {
  test("happy path returns items", async () => {
    const pk = `USER#scan_${NS}@it.de`;
    await good._put({ pk, sk: "PROFILE", vorname: "Scan", user_state: "ACTIVE" });
    const r = await good.scan({
      FilterExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": pk },
      Limit: 100,
    });
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.items.some((i) => i["pk"] === pk)).toBe(true);
    }
    await good._delete(pk, "PROFILE");
  });

  test("error path returns Err when endpoint unreachable", async () => {
    const r = await bad.scan({ Limit: 1 });
    expect(r.isErr()).toBe(true);
  });
});

describe("_batchWrite", () => {
  test("happy path Put then Delete round trip", async () => {
    const pk1 = `USER#bw1_${NS}@it.de`;
    const pk2 = `USER#bw2_${NS}@it.de`;
    const putR = await good.batchWrite([
      { Put: { Item: { pk: pk1, sk: "PROFILE", vorname: "A" } } },
      { Put: { Item: { pk: pk2, sk: "PROFILE", vorname: "B" } } },
    ]);
    expect(putR.isOk()).toBe(true);
    expect((await good._get(pk1, "PROFILE")).unwrap()).not.toBeNull();
    expect((await good._get(pk2, "PROFILE")).unwrap()).not.toBeNull();

    const delR = await good.batchWrite([
      { Delete: { Key: { pk: pk1, sk: "PROFILE" } } },
      { Delete: { Key: { pk: pk2, sk: "PROFILE" } } },
    ]);
    expect(delR.isOk()).toBe(true);
    expect((await good._get(pk1, "PROFILE")).unwrap()).toBeNull();
  });

  test("error path returns Err on unreachable endpoint", async () => {
    const r = await bad.batchWrite([
      { Put: { Item: { pk: "X", sk: "Y" } } },
    ]);
    expect(r.isErr()).toBe(true);
  });

  test("rejects item with both Put and Delete", async () => {
    const r = await good.batchWrite([
      { Put: { Item: { pk: "x", sk: "y" } }, Delete: { Key: { pk: "x", sk: "y" } } },
    ]);
    expect(r.isErr()).toBe(true);
  });
});

describe("_transactWrite", () => {
  test("happy path atomic put", async () => {
    const pk = `USER#tw1_${NS}@it.de`;
    const r = await good.transactWrite([
      { Put: { TableName: process.env["RAILBACK_DDB_TABLE"] ?? "RailBack", Item: { pk, sk: "PROFILE", vorname: "TW" } } },
    ]);
    expect(r.isOk()).toBe(true);
    expect((await good._get(pk, "PROFILE")).unwrap()).not.toBeNull();
    await good._delete(pk, "PROFILE");
  });

  test("returns ConflictError when ConditionalCheckFailed", async () => {
    const pk = `USER#tw2_${NS}@it.de`;
    await good._put({ pk, sk: "PROFILE", vorname: "existing" });
    const table = process.env["RAILBACK_DDB_TABLE"] ?? "RailBack";
    const r = await good.transactWrite([
      {
        Put: {
          TableName: table,
          Item: { pk, sk: "PROFILE", vorname: "shouldFail" },
          ConditionExpression: "attribute_not_exists(pk)",
        },
      },
    ]);
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error).toBeInstanceOf(ConflictError);
    }
    await good._delete(pk, "PROFILE");
  });

  test("rejects >25 items with boundary error", async () => {
    const table = process.env["RAILBACK_DDB_TABLE"] ?? "RailBack";
    const items = Array.from({ length: 26 }, (_, i) => ({
      Put: { TableName: table, Item: { pk: `X${i}`, sk: "Y" } },
    }));
    const r = await good.transactWrite(items);
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error.message).toMatch(/25-item/);
    }
  });

  test("empty items is a no-op", async () => {
    const r = await good.transactWrite([]);
    expect(r.isOk()).toBe(true);
  });
});

describe("_updateWithRemove", () => {
  test("happy path sets and removes in one call", async () => {
    const pk = `USER#uwr1_${NS}@it.de`;
    await good._put({ pk, sk: "PROFILE", vorname: "A", nachname: "B", telefon: "123" });
    const r = await good.updateWithRemove(pk, "PROFILE",
      { vorname: "Updated" }, ["telefon"]);
    expect(r.isOk()).toBe(true);
    const got = (await good._get(pk, "PROFILE")).unwrap() as Record<string, unknown>;
    expect(got["vorname"]).toBe("Updated");
    expect(got["telefon"]).toBeUndefined();
    expect(got["nachname"]).toBe("B");
    await good._delete(pk, "PROFILE");
  });

  test("null values are coerced to REMOVE", async () => {
    const pk = `USER#uwr2_${NS}@it.de`;
    await good._put({ pk, sk: "PROFILE", vorname: "A", telefon: "999" });
    const r = await good.updateWithRemove(pk, "PROFILE", { vorname: "New", telefon: null });
    expect(r.isOk()).toBe(true);
    const got = (await good._get(pk, "PROFILE")).unwrap() as Record<string, unknown>;
    expect(got["vorname"]).toBe("New");
    expect(got["telefon"]).toBeUndefined();
    await good._delete(pk, "PROFILE");
  });

  test("no-op when sets empty and removes empty", async () => {
    const r = await good.updateWithRemove("USER#noop@it.de", "PROFILE", {}, []);
    expect(r.isOk()).toBe(true);
  });

  test("condition failure returns ConflictError", async () => {
    const pk = `USER#uwr3_${NS}@it.de`;
    // row does not exist; condition attribute_exists must fail
    const r = await good.updateWithRemove(pk, "PROFILE",
      { vorname: "X" }, [], "attribute_exists(pk)");
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error).toBeInstanceOf(ConflictError);
    }
  });
});
